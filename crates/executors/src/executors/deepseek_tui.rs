use std::{path::Path, sync::Arc};

use async_trait::async_trait;
use derivative::Derivative;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use workspace_utils::msg_store::MsgStore;

use crate::{
    approvals::ExecutorApprovalService,
    command::{CmdOverrides, CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executors::{
        AppendPrompt, AvailabilityInfo, BaseCodingAgent, ExecutorError, SpawnedChild,
        StandardCodingAgentExecutor, gemini::AcpAgentHarness,
    },
    profile::ExecutorConfig,
};

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct DeepSeekTui {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "mode")]
    pub agent: Option<String>,
    /// Auto-approve agent actions
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<bool>,
    #[serde(flatten)]
    pub cmd: CmdOverrides,
    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    pub approvals: Option<Arc<dyn ExecutorApprovalService>>,
}

impl DeepSeekTui {
    fn build_command(&self) -> Result<CommandBuilder, crate::command::CommandBuildError> {
        let builder = CommandBuilder::new("deepseek serve --acp");
        apply_overrides(builder, &self.cmd)
    }
}

#[async_trait]
impl StandardCodingAgentExecutor for DeepSeekTui {
    fn apply_overrides(&mut self, executor_config: &ExecutorConfig) {
        if let Some(model_id) = executor_config.model_id.as_ref() {
            self.model = Some(model_id.clone());
        }
        if let Some(agent_id) = executor_config.agent_id.as_ref() {
            self.agent = Some(agent_id.clone());
        }
    }

    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let command = self.build_command()?.build_initial()?;
        let combined_prompt = self.append_prompt.combine_prompt(prompt);
        let mut harness = AcpAgentHarness::with_session_namespace("deepseek_sessions");
        if let Some(model) = &self.model {
            harness = harness.with_model(model);
        }
        if let Some(agent) = &self.agent {
            harness = harness.with_mode(agent);
        }
        let approvals = if self.auto_approve.unwrap_or(false) {
            None
        } else {
            self.approvals.clone()
        };
        harness
            .spawn_with_command(current_dir, combined_prompt, command, env, &self.cmd, approvals)
            .await
    }

    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        _reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let command = self.build_command()?.build_follow_up(&[])?;
        let combined_prompt = self.append_prompt.combine_prompt(prompt);
        let mut harness = AcpAgentHarness::with_session_namespace("deepseek_sessions");
        if let Some(model) = &self.model {
            harness = harness.with_model(model);
        }
        if let Some(agent) = &self.agent {
            harness = harness.with_mode(agent);
        }
        let approvals = if self.auto_approve.unwrap_or(false) {
            None
        } else {
            self.approvals.clone()
        };
        harness
            .spawn_follow_up_with_command(
                current_dir,
                combined_prompt,
                session_id,
                command,
                env,
                &self.cmd,
                approvals,
            )
            .await
    }

    fn normalize_logs(
        &self,
        msg_store: Arc<MsgStore>,
        worktree_path: &Path,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        crate::executors::acp::normalize_logs(msg_store, worktree_path)
    }

    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf> {
        dirs::home_dir().map(|home| home.join(".deepseek").join("mcp.json"))
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        let mcp_config_found = self
            .default_mcp_config_path()
            .map(|p| p.exists())
            .unwrap_or(false);

        let config_found = dirs::home_dir()
            .map(|home| home.join(".deepseek").join("config.toml").exists())
            .unwrap_or(false);

        if mcp_config_found || config_found {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }

    fn get_preset_options(&self) -> ExecutorConfig {
        ExecutorConfig {
            executor: BaseCodingAgent::DeepSeekTui,
            variant: None,
            model_id: self.model.clone(),
            agent_id: self.agent.clone(),
            reasoning_id: None,
            permission_policy: None,
        }
    }
}
