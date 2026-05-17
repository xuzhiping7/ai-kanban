import { useMemo, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useUserContext } from '@/shared/hooks/useUserContext';
import { useActions } from '@/shared/hooks/useActions';
import { useSyncErrorContext } from '@/shared/hooks/useSyncErrorContext';
import { useUserOrganizations } from '@/shared/hooks/useUserOrganizations';
import { useOrganizationStore } from '@/shared/stores/useOrganizationStore';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import {
  Navbar,
  type NavbarSectionItem,
  type NavbarBreadcrumbItem,
  type MobileTabId,
} from '@vibe/ui/components/Navbar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@vibe/ui/components/Popover';
import { cn } from '@/shared/lib/utils';
import { CaretDownIcon } from '@phosphor-icons/react';
import { useAllOrganizationProjects } from '@/shared/hooks/useAllOrganizationProjects';
import { useShape } from '@/shared/integrations/electric/hooks';
import { PROJECT_ISSUES_SHAPE } from 'shared/remote-types';
import { RemoteIssueLink } from './RemoteIssueLink';
import { AppBarUserPopoverContainer } from './AppBarUserPopoverContainer';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { NavbarActionGroups } from '@/shared/actions';
import {
  NavbarDivider,
  type ActionDefinition,
  type NavbarItem as ActionNavbarItem,
  type ActionVisibilityContext,
  isSpecialIcon,
  getActionIcon,
  getActionTooltip,
  isActionActive,
  isActionEnabled,
  isActionVisible,
} from '@/shared/types/actions';
import { useActionVisibilityContext } from '@/shared/hooks/useActionVisibilityContext';
import { useMobileActiveTab } from '@/shared/stores/useUiPreferencesStore';
import { CommandBarDialog } from '@/shared/dialogs/command-bar/CommandBarDialog';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { getProjectDestination } from '@/shared/lib/routes/appNavigation';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useCurrentAppDestination } from '@/shared/hooks/useCurrentAppDestination';
import { getRemoteAuthDegradedMessage } from '@/shared/lib/auth/remoteAuthDegraded';

/**
 * Check if a NavbarItem is a divider
 */
function isDivider(item: ActionNavbarItem): item is typeof NavbarDivider {
  return 'type' in item && item.type === 'divider';
}

/**
 * Filter navbar items by visibility, keeping dividers but removing them
 * if they would appear at the start, end, or consecutively.
 */
function filterNavbarItems(
  items: readonly ActionNavbarItem[],
  ctx: ActionVisibilityContext
): ActionNavbarItem[] {
  // Filter actions by visibility, keep dividers
  const filtered = items.filter((item) => {
    if (isDivider(item)) return true;
    if (!isActionVisible(item, ctx)) return false;
    return !isSpecialIcon(getActionIcon(item, ctx));
  });

  // Remove leading/trailing dividers and consecutive dividers
  const result: ActionNavbarItem[] = [];
  for (const item of filtered) {
    if (isDivider(item)) {
      // Only add divider if we have items before it and last item wasn't a divider
      if (result.length > 0 && !isDivider(result[result.length - 1])) {
        result.push(item);
      }
    } else {
      result.push(item);
    }
  }

  // Remove trailing divider
  if (result.length > 0 && isDivider(result[result.length - 1])) {
    result.pop();
  }

  return result;
}

function toNavbarSectionItems(
  items: readonly ActionNavbarItem[],
  ctx: ActionVisibilityContext,
  onExecuteAction: (action: ActionDefinition) => void
): NavbarSectionItem[] {
  return items.reduce<NavbarSectionItem[]>((result, item) => {
    if (isDivider(item)) {
      result.push({ type: 'divider' });
      return result;
    }

    const icon = getActionIcon(item, ctx);
    if (isSpecialIcon(icon)) {
      return result;
    }

    result.push({
      type: 'action',
      id: item.id,
      icon,
      isActive: isActionActive(item, ctx),
      tooltip: getActionTooltip(item, ctx),
      shortcut: item.shortcut,
      disabled: !isActionEnabled(item, ctx),
      onClick: () => onExecuteAction(item),
    });
    return result;
  }, []);
}

export interface NavbarProject {
  id: string;
  name: string;
  color: string;
}

export function NavbarContainer({
  mobileMode = false,
  onOrgSelect,
  onOpenDrawer,
  projects,
  activeProjectId,
  onProjectClick,
  preProjectSlot,
  notificationSlot,
  onSignIn,
}: {
  mobileMode?: boolean;
  onOrgSelect?: (orgId: string) => void;
  onOpenDrawer?: () => void;
  projects?: NavbarProject[];
  activeProjectId?: string | null;
  onProjectClick?: (projectId: string) => void;
  preProjectSlot?: ReactNode;
  notificationSlot?: ReactNode;
  onSignIn?: () => void;
}) {
  const { t } = useTranslation('common');
  const { executeAction } = useActions();
  const { workspace: selectedWorkspace, isCreateMode } = useWorkspaceContext();
  const { workspaces } = useUserContext();
  const syncErrorContext = useSyncErrorContext();
  const { remoteAuthDegraded } = useUserSystem();
  const { isSignedIn } = useAuth();
  const appNavigation = useAppNavigation();
  const destination = useCurrentAppDestination();
  const projectDestination = useMemo(
    () => getProjectDestination(destination),
    [destination]
  );
  const isOnProjectPage = projectDestination !== null;
  const projectId = projectDestination?.projectId ?? null;
  const isOnProjectSubRoute =
    projectDestination !== null && projectDestination.kind !== 'project';
  const [mobileActiveTab, setMobileActiveTab] = useMobileActiveTab();

  // Find remote workspace linked to current local workspace
  const linkedRemoteWorkspace = useMemo(() => {
    if (!selectedWorkspace?.id) return null;
    return (
      workspaces.find((w) => w.local_workspace_id === selectedWorkspace.id) ??
      null
    );
  }, [workspaces, selectedWorkspace?.id]);

  const { data: orgsData } = useUserOrganizations();
  const selectedOrgId = useOrganizationStore((s) => s.selectedOrgId);
  const orgName =
    orgsData?.organizations.find((o) => o.id === selectedOrgId)?.name ?? '';

  // Get action visibility context (includes all state for visibility/active/enabled)
  const actionCtx = useActionVisibilityContext();

  // Action handler - all actions go through the standard executeAction
  const handleExecuteAction = useCallback(
    (action: ActionDefinition) => {
      if (action.requiresTarget && selectedWorkspace?.id) {
        executeAction(action, selectedWorkspace.id);
      } else {
        executeAction(action);
      }
    },
    [executeAction, selectedWorkspace?.id]
  );

  const leftItems = useMemo(
    () =>
      toNavbarSectionItems(
        filterNavbarItems(NavbarActionGroups.left, actionCtx),
        actionCtx,
        handleExecuteAction
      ),
    [actionCtx, handleExecuteAction]
  );

  const rightItems = useMemo(
    () =>
      toNavbarSectionItems(
        filterNavbarItems(NavbarActionGroups.right, actionCtx),
        actionCtx,
        handleExecuteAction
      ),
    [actionCtx, handleExecuteAction]
  );

  const navbarTitle = isCreateMode
    ? 'Create Workspace'
    : isOnProjectPage
      ? orgName
      : selectedWorkspace?.branch;

  // Breadcrumbs: Project / Issue / Workspace (only on workspace pages with linked project)
  const linkedProjectId = linkedRemoteWorkspace?.project_id ?? null;
  const linkedIssueId = linkedRemoteWorkspace?.issue_id ?? null;
  const shouldResolveBreadcrumbData =
    !isOnProjectPage && !isCreateMode && !!linkedProjectId;
  const shouldResolveIssueBreadcrumb =
    shouldResolveBreadcrumbData && !!linkedIssueId;

  const { data: allProjects, isLoading: isProjectsLoading } =
    useAllOrganizationProjects({
      enabled: shouldResolveBreadcrumbData,
    });
  const { data: projectIssues, isLoading: isProjectIssuesLoading } = useShape(
    PROJECT_ISSUES_SHAPE,
    { project_id: linkedProjectId || '' },
    { enabled: shouldResolveIssueBreadcrumb }
  );
  const linkedProject = allProjects.find((p) => p.id === linkedProjectId);
  const isWaitingForProjectBreadcrumb =
    shouldResolveBreadcrumbData && !linkedProject && isProjectsLoading;
  const isWaitingForIssueBreadcrumb =
    shouldResolveIssueBreadcrumb && isProjectIssuesLoading;
  const isWaitingForBreadcrumbData =
    isWaitingForProjectBreadcrumb || isWaitingForIssueBreadcrumb;

  const breadcrumbs = useMemo((): NavbarBreadcrumbItem[] | undefined => {
    if (
      !shouldResolveBreadcrumbData ||
      !linkedProjectId ||
      isWaitingForBreadcrumbData
    ) {
      return undefined;
    }

    const project = linkedProject;
    if (!project) return undefined;

    const items: NavbarBreadcrumbItem[] = [
      {
        label: project.name,
        onClick: () => appNavigation.goToProject(linkedProjectId),
      },
    ];

    if (linkedIssueId) {
      const issue = projectIssues.find((i) => i.id === linkedIssueId);
      if (issue) {
        items.push({
          label: issue.simple_id,
          onClick: () =>
            appNavigation.goToProjectIssue(linkedProjectId, linkedIssueId),
        });
      }
    }

    const workspaceLabel =
      selectedWorkspace?.name || selectedWorkspace?.branch || '';
    if (workspaceLabel) {
      items.push({ label: workspaceLabel });
    }

    return items.length > 1 ? items : undefined;
  }, [
    shouldResolveBreadcrumbData,
    linkedProjectId,
    linkedIssueId,
    linkedProject,
    isWaitingForBreadcrumbData,
    projectIssues,
    selectedWorkspace?.name,
    selectedWorkspace?.branch,
    appNavigation,
  ]);

  // Mobile-specific callbacks
  const handleOpenCommandBar = useCallback(() => {
    CommandBarDialog.show();
  }, []);

  const handleOpenSettings = useCallback(() => {
    SettingsDialog.show();
  }, []);

  const handleNavigateBack = useCallback(() => {
    if (isOnProjectPage && projectId) {
      // On project sub-route: go back to project root (kanban board)
      appNavigation.goToProject(projectId);
    } else {
      // Non-project page: go to workspaces
      appNavigation.goToWorkspaces();
    }
  }, [isOnProjectPage, projectId, appNavigation]);

  const handleNavigateToBoard = useMemo(() => {
    if (!isOnProjectPage || !projectId) return null;
    return () => {
      appNavigation.goToProject(projectId);
    };
  }, [isOnProjectPage, projectId, appNavigation]);

  // Build user popover slot for mobile mode
  const userPopoverSlot = useMemo(() => {
    if (!mobileMode) return undefined;
    return (
      <AppBarUserPopoverContainer
        organizations={orgsData?.organizations ?? []}
        selectedOrgId={selectedOrgId ?? ''}
        onOrgSelect={onOrgSelect ?? (() => {})}
      />
    );
  }, [mobileMode, orgsData?.organizations, selectedOrgId, onOrgSelect]);

  // Active project name for the selector button
  const activeProjectName = useMemo(() => {
    if (!activeProjectId || !projects) return null;
    return projects.find((p) => p.id === activeProjectId)?.name ?? null;
  }, [activeProjectId, projects]);

  // Build project selector slot for desktop navbar
  const projectSelectorSlot = useMemo(() => {
    if (mobileMode || !isSignedIn || !projects || projects.length === 0) {
      return null;
    }
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-sm text-sm',
              'text-normal hover:bg-brand/10 cursor-pointer',
              'max-w-[200px]'
            )}
          >
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{
                backgroundColor: activeProjectId
                  ? `hsl(${projects.find((p) => p.id === activeProjectId)?.color ?? 'var(--brand)'})`
                  : 'var(--muted)',
              }}
            />
            <span className="truncate">
              {activeProjectName ?? 'Select project'}
            </span>
            <CaretDownIcon className="size-3 shrink-0 text-low" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-56 p-1">
          <div className="max-h-64 overflow-y-auto">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onProjectClick?.(project.id)}
                className={cn(
                  'flex items-center gap-2.5 w-full px-3 py-2 rounded-sm text-sm text-left cursor-pointer',
                  'hover:bg-secondary',
                  project.id === activeProjectId
                    ? 'bg-brand/10 text-high'
                    : 'text-normal'
                )}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: `hsl(${project.color})` }}
                />
                <span className="truncate">{project.name}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    );
  }, [
    mobileMode,
    isSignedIn,
    projects,
    activeProjectId,
    activeProjectName,
    onProjectClick,
  ]);

  // Build user slot for desktop navbar
  const desktopUserSlot = useMemo(() => {
    if (mobileMode) return undefined;
    if (!isSignedIn && onSignIn) {
      return (
        <button
          type="button"
          onClick={onSignIn}
          className="px-3 py-1 rounded-sm text-sm font-medium bg-brand text-on-brand hover:bg-brand-hover cursor-pointer"
        >
          Sign in
        </button>
      );
    }
    return (
      <AppBarUserPopoverContainer
        organizations={orgsData?.organizations ?? []}
        selectedOrgId={selectedOrgId ?? ''}
        onOrgSelect={onOrgSelect ?? (() => {})}
      />
    );
  }, [
    mobileMode,
    isSignedIn,
    onSignIn,
    orgsData?.organizations,
    selectedOrgId,
    onOrgSelect,
  ]);

  const syncErrors = useMemo(() => {
    const errors = syncErrorContext?.errors ? [...syncErrorContext.errors] : [];

    if (remoteAuthDegraded) {
      errors.push({
        streamId: 'remote-auth-degraded',
        tableName: 'Remote authentication',
        error: {
          message: getRemoteAuthDegradedMessage(remoteAuthDegraded, t),
        },
        retry: () => window.location.reload(),
      });
    }

    return errors;
  }, [remoteAuthDegraded, syncErrorContext?.errors, t]);

  return (
    <Navbar
      workspaceTitle={navbarTitle}
      breadcrumbs={breadcrumbs}
      leftItems={leftItems}
      rightItems={rightItems}
      preProjectSlot={preProjectSlot}
      projectSlot={projectSelectorSlot}
      notificationSlot={notificationSlot}
      userSlot={desktopUserSlot}
      syncErrors={syncErrors}
      mobileMode={mobileMode}
      mobileUserSlot={userPopoverSlot}
      isOnProjectPage={isOnProjectPage}
      isOnProjectSubRoute={isOnProjectSubRoute}
      onOpenCommandBar={handleOpenCommandBar}
      onOpenSettings={handleOpenSettings}
      onNavigateBack={handleNavigateBack}
      onNavigateToBoard={handleNavigateToBoard}
      onOpenDrawer={onOpenDrawer}
      mobileActiveTab={mobileActiveTab as MobileTabId}
      onMobileTabChange={(tab) => setMobileActiveTab(tab)}
      leftSlot={
        !breadcrumbs &&
        !isWaitingForBreadcrumbData &&
        linkedRemoteWorkspace?.issue_id ? (
          <RemoteIssueLink
            projectId={linkedRemoteWorkspace.project_id}
            issueId={linkedRemoteWorkspace.issue_id}
          />
        ) : null
      }
    />
  );
}
