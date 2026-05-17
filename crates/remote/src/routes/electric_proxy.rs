use std::collections::HashMap;

use axum::{
    Router,
    body::Body,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures::TryStreamExt;
use secrecy::ExposeSecret;
use serde::Deserialize;
use tracing::error;
use uuid::Uuid;

use crate::{AppState, shape_definition::ShapeExport};

#[derive(Deserialize)]
pub(crate) struct OrgShapeQuery {
    pub organization_id: Uuid,
    #[serde(flatten)]
    pub params: HashMap<String, String>,
}

#[derive(Deserialize)]
pub(crate) struct ShapeQuery {
    #[serde(flatten)]
    pub params: HashMap<String, String>,
}

const ELECTRIC_PARAMS: &[&str] = &["offset", "handle", "live", "cursor", "columns"];
const ELECTRIC_STICKY_HEADER: &str = "x-vk-electric-sticky";

/// Replace `$N` placeholders in `template` with the matching value in
/// `params` (1-indexed), quoting each value as a SQL string literal with
/// single-quote escaping. The scanner consumes the full run of digits after
/// `$`, so that `$1` does not match the leading `$1` of `$10`/`$11`/...
fn substitute_placeholders(template: &str, params: &[String]) -> String {
    let mut out = String::with_capacity(template.len());
    let bytes = template.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'$' {
            // Safe: we only branch on ASCII `$`; everything else is copied verbatim.
            out.push(bytes[i] as char);
            i += 1;
            continue;
        }
        let digits_start = i + 1;
        let mut j = digits_start;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if j == digits_start {
            out.push('$');
            i += 1;
            continue;
        }
        // Safe: digits are ASCII; the slice is valid UTF-8.
        let digits = &template[digits_start..j];
        match digits.parse::<usize>() {
            Ok(idx) if idx >= 1 && idx <= params.len() => {
                let escaped = params[idx - 1].replace('\'', "''");
                out.push('\'');
                out.push_str(&escaped);
                out.push('\'');
            }
            _ => {
                out.push('$');
                out.push_str(digits);
            }
        }
        i = j;
    }
    out
}

pub(crate) fn router() -> Router<AppState> {
    let mut router = Router::new();
    for route in crate::shape_routes::all_shape_routes() {
        router = router.merge(route.router);
    }
    router
}

/// Proxy a Shape request to Electric for a specific table.
///
/// The table and where clause are set server-side (not from client params)
/// to prevent unauthorized access to other tables or data.
pub(crate) async fn proxy_table(
    state: &AppState,
    shape: &dyn ShapeExport,
    client_params: &HashMap<String, String>,
    electric_params: &[String],
    session_id: Uuid,
) -> Result<Response, ProxyError> {
    // Build the Electric URL
    let mut origin_url = url::Url::parse(&state.config.electric_url)
        .map_err(|e| ProxyError::InvalidConfig(format!("invalid electric_url: {e}")))?;

    origin_url.set_path("/v1/shape");

    // Set table server-side (security: client can't override)
    origin_url
        .query_pairs_mut()
        .append_pair("table", shape.table());

    // Inline parameter values into the WHERE clause since Electric 1.4.x
    // does not support the params[1]/params[2] query parameter syntax.
    // Scan `$<digits>` as a token so `$1` does not corrupt `$10`/`$11`/...
    let where_clause = substitute_placeholders(shape.where_clause(), electric_params);
    origin_url
        .query_pairs_mut()
        .append_pair("where", &where_clause);

    // Forward safe client params
    for (key, value) in client_params {
        if ELECTRIC_PARAMS.contains(&key.as_str()) {
            origin_url.query_pairs_mut().append_pair(key, value);
        }
    }

    if let Some(secret) = &state.config.electric_secret {
        origin_url
            .query_pairs_mut()
            .append_pair("secret", secret.expose_secret());
    }

    let response = state
        .http_client
        .get(origin_url.as_str())
        .header(ELECTRIC_STICKY_HEADER, session_id.to_string())
        .send()
        .await
        .map_err(ProxyError::Connection)?;

    let status = response.status();
    let mut headers = HeaderMap::new();

    // Copy headers from Electric response, but remove problematic ones
    for (key, value) in response.headers() {
        // Skip headers that interfere with browser handling
        if key == header::CONTENT_ENCODING || key == header::CONTENT_LENGTH {
            continue;
        }
        headers.insert(key.clone(), value.clone());
    }

    // Add Vary header for proper caching with auth
    headers.insert(header::VARY, HeaderValue::from_static("Authorization"));

    // Stream the response body directly without buffering
    let body_stream = response.bytes_stream().map_err(std::io::Error::other);
    let body = Body::from_stream(body_stream);

    Ok((status, headers, body).into_response())
}

#[derive(Debug)]
pub(crate) enum ProxyError {
    Connection(reqwest::Error),
    InvalidConfig(String),
    Authorization(String),
}

impl IntoResponse for ProxyError {
    fn into_response(self) -> Response {
        match self {
            ProxyError::Connection(err) => {
                error!(?err, "failed to connect to Electric service");
                (
                    StatusCode::BAD_GATEWAY,
                    "failed to connect to Electric service",
                )
                    .into_response()
            }
            ProxyError::InvalidConfig(msg) => {
                error!(%msg, "invalid Electric proxy configuration");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
            }
            ProxyError::Authorization(msg) => {
                error!(%msg, "authorization failed for Electric proxy");
                (StatusCode::FORBIDDEN, "forbidden").into_response()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::substitute_placeholders;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn single_placeholder() {
        let out = substitute_placeholders(r#""organization_id" = $1"#, &s(&["abc"]));
        assert_eq!(out, r#""organization_id" = 'abc'"#);
    }

    #[test]
    fn escapes_single_quote() {
        let out = substitute_placeholders("x = $1", &s(&["o'brien"]));
        assert_eq!(out, "x = 'o''brien'");
    }

    #[test]
    fn dollar_one_does_not_eat_dollar_ten() {
        // Regression: naive String::replace("$1", ..) would corrupt $10/$11.
        let out = substitute_placeholders(
            "a = $1 AND b = $10 AND c = $11 AND d = $2",
            &s(&["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11"]),
        );
        assert_eq!(out, "a = 'v1' AND b = 'v10' AND c = 'v11' AND d = 'v2'");
    }

    #[test]
    fn unknown_placeholder_preserved() {
        let out = substitute_placeholders("x = $5", &s(&["only_one"]));
        assert_eq!(out, "x = $5");
    }

    #[test]
    fn lone_dollar_preserved() {
        let out = substitute_placeholders("price = $ then $1", &s(&["10"]));
        assert_eq!(out, "price = $ then '10'");
    }
}
