import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../Utils/NavigationItems";
import EventName from "../../Utils/EventName";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  buildEntitySearchQuery,
  buildEntitySearchSelect,
  buildEntitySearchSort,
  buildNavigationCommandDescriptors,
  computeCreateActionGates,
  getEntitySearchSpecs,
  getVisibleActionIds,
  isRoutePathNavigable,
  PALETTE_ENTITY_SEARCH_LIMIT,
  PALETTE_RECENTS_STORAGE_KEY,
  PaletteActionId,
  PaletteEntitySearchSpec,
  PaletteNavigationCatalogEntry,
  PaletteNavigationCommandDescriptor,
} from "./DashboardCommandPaletteHelpers";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import CommandPalette from "Common/UI/Components/CommandPalette/CommandPalette";
import { MoreMenuItem, NavItem } from "Common/UI/Components/Navbar/NavBar";
import {
  PaletteCommand,
  PaletteSearchProvider,
  PaletteSearchResult,
} from "Common/UI/Components/CommandPalette/Types";
import KeyboardKey from "Common/UI/Components/KeyboardShortcut/KeyboardKey";
import { ADMIN_DASHBOARD_URL } from "Common/UI/Config";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import ThemeUtil, { Theme, useTheme } from "Common/UI/Utils/Theme";
import User from "Common/UI/Utils/User";
import Alert from "Common/Models/DatabaseModels/Alert";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * The dashboard's command palette host: always mounted (App.tsx, next to
 * AIChatPanel), owns the Cmd/Ctrl+K shortcut (the legacy NavBar binding is
 * disabled via disableCommandKShortcut) and the COMMAND_PALETTE_TOGGLE global
 * event, and feeds the generic Common CommandPalette with:
 *  - every page from the shared NavBar catalog (useDashboardNavigationItems),
 *  - quick actions (create flows, theme, Ask AI, global pages, logout),
 *  - live entity search across monitors/incidents/alerts/status pages/on-call.
 */

/*
 * One async search provider per entity type. Generic so ModelAPI keeps its
 * model typing; every call is try/caught so one failing entity type shows an
 * empty section instead of taking the palette down.
 */
function createEntitySearchProvider<
  TBaseModel extends DatabaseBaseModel,
>(data: {
  spec: PaletteEntitySearchSpec;
  modelType: { new (): TBaseModel };
  sectionTitle: string;
  onNavigate: () => void;
}): PaletteSearchProvider {
  return {
    id: data.spec.id,
    title: data.sectionTitle,
    search: async (searchText: string): Promise<Array<PaletteSearchResult>> => {
      try {
        const result: ListResult<TBaseModel> =
          await ModelAPI.getList<TBaseModel>({
            modelType: data.modelType,
            query: buildEntitySearchQuery(
              data.spec,
              searchText,
            ) as Query<TBaseModel>,
            select: buildEntitySearchSelect(data.spec) as Select<TBaseModel>,
            sort: buildEntitySearchSort(data.spec) as Sort<TBaseModel>,
            limit: PALETTE_ENTITY_SEARCH_LIMIT,
            skip: 0,
          });

        const results: Array<PaletteSearchResult> = [];

        for (const item of result.data) {
          const modelId: string | undefined =
            item._id?.toString() || item.id?.toString();
          const title: string =
            ((item as unknown as JSONObject)[data.spec.titleField] as string) ||
            "";

          if (!modelId || !title) {
            continue;
          }

          results.push({
            id: `${data.spec.id}-${modelId}`,
            title,
            icon: data.spec.icon,
            iconColor: data.spec.iconColor,
            onSelect: () => {
              data.onNavigate();
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[data.spec.viewPageMap] as Route,
                  { modelId: new ObjectID(modelId) },
                ),
              );
            },
          });
        }

        return results;
      } catch {
        // Per-provider isolation: a failed search shows nothing, never an error.
        return [];
      }
    },
  };
}

const DashboardCommandPalette: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const theme: Theme = useTheme();

  const closePalette: () => void = useCallback((): void => {
    setIsOpen(false);
  }, []);

  // Toggle from anywhere via the global event bus.
  useEffect(() => {
    const toggle: () => void = (): void => {
      setIsOpen((open: boolean) => {
        return !open;
      });
    };

    GlobalEvents.addEventListener(EventName.COMMAND_PALETTE_TOGGLE, toggle);

    return () => {
      GlobalEvents.removeEventListener(
        EventName.COMMAND_PALETTE_TOGGLE,
        toggle,
      );
    };
  }, []);

  /*
   * Cmd/Ctrl+K opens the palette from anywhere. Same guard style as
   * AIChatPanel's Cmd/Ctrl+I: bail on extra modifiers and on events another
   * handler already claimed (defaultPrevented). No input-focus guard — the
   * chorded shortcut never collides with plain typing.
   */
  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== "k" ||
        event.defaultPrevented
      ) {
        return;
      }

      event.preventDefault();
      setIsOpen((open: boolean) => {
        return !open;
      });
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Shared page catalog — same hook the NavBar renders from, so no drift.
  const { navItems, moreMenuItems, rightElement }: DashboardNavigationItems =
    useDashboardNavigationItems();

  /*
   * Navigate to a PageMap entry, refusing routes whose populated path still
   * carries a ":param" placeholder (no project selected) — same guard the
   * breadcrumbs use. Closes the palette first so navigation feels instant.
   */
  const navigateToPageMap: (pageMap: PageMap) => void = useCallback(
    (pageMap: PageMap): void => {
      const populated: Route = RouteUtil.populateRouteParams(
        RouteMap[pageMap] as Route,
      );
      if (!isRoutePathNavigable(populated.toString())) {
        return;
      }
      closePalette();
      Navigation.navigate(populated);
    },
    [closePalette],
  );

  /*
   * Everything below is only needed while the palette is open; keeping the
   * closed-state render this cheap matters because the host is mounted on
   * every page.
   */
  let commands: Array<PaletteCommand> = [];
  let searchProviders: Array<PaletteSearchProvider> | undefined = undefined;

  const hasProjectSelected: boolean =
    ProjectUtil.getCurrentProjectId() !== null;

  if (isOpen) {
    const essentialsCategory: string = t("navbar.categories.essentials");

    // --- pages from the shared catalog -----------------------------------
    const catalogEntries: Array<PaletteNavigationCatalogEntry> = [
      ...navItems.map((item: NavItem): PaletteNavigationCatalogEntry => {
        return {
          title: item.title,
          description: item.description,
          icon: item.icon,
          category: essentialsCategory,
          routePath: item.route.toString(),
          templatePath: (item.activeRoute || item.route).toString(),
        };
      }),
      ...moreMenuItems.map(
        (item: MoreMenuItem): PaletteNavigationCatalogEntry => {
          return {
            title: item.title,
            description: item.description,
            icon: item.icon,
            iconColor: item.iconColor,
            category: item.category || essentialsCategory,
            routePath: item.route.toString(),
            templatePath: (item.activeRoute || item.route).toString(),
          };
        },
      ),
      {
        title: rightElement.title,
        description: rightElement.description,
        icon: rightElement.icon,
        category: t("commandPalette.categories.account", "Account"),
        routePath: rightElement.route.toString(),
        templatePath: (
          rightElement.activeRoute || rightElement.route
        ).toString(),
      },
    ];

    const navigationCommands: Array<PaletteCommand> =
      buildNavigationCommandDescriptors(catalogEntries).map(
        (descriptor: PaletteNavigationCommandDescriptor): PaletteCommand => {
          return {
            id: descriptor.id,
            title: descriptor.title,
            description: descriptor.description,
            icon: descriptor.icon,
            iconColor: descriptor.iconColor,
            category: descriptor.category,
            onSelect: () => {
              closePalette();
              Navigation.navigate(new Route(descriptor.routePath));
            },
          };
        },
      );

    // --- actions ----------------------------------------------------------
    const permissions: Array<Permission> = PermissionUtil.getAllPermissions();
    const isMasterAdmin: boolean = User.isMasterAdmin();

    const visibleActionIds: Array<PaletteActionId> = getVisibleActionIds({
      ...computeCreateActionGates({ permissions, isMasterAdmin }),
      hasProjectSelected,
      isMasterAdmin,
    });

    const actionsCategory: string = t(
      "commandPalette.categories.actions",
      "Actions",
    );
    const quickLinksCategory: string = t(
      "commandPalette.categories.quickLinks",
      "Quick links",
    );
    const accountCategory: string = t(
      "commandPalette.categories.account",
      "Account",
    );

    const actionCommandsById: Record<PaletteActionId, PaletteCommand> = {
      "action-declare-incident": {
        id: "action-declare-incident",
        title: t("commandPalette.actions.declareIncident", "Declare Incident"),
        icon: IconProp.Alert,
        iconColor: "rose",
        category: actionsCategory,
        keywords: ["new", "create", "report", "outage"],
        onSelect: () => {
          navigateToPageMap(PageMap.INCIDENT_CREATE);
        },
      },
      "action-create-monitor": {
        id: "action-create-monitor",
        title: t("commandPalette.actions.createMonitor", "Create Monitor"),
        icon: IconProp.AltGlobe,
        iconColor: "blue",
        category: actionsCategory,
        keywords: ["new", "add", "check", "uptime"],
        onSelect: () => {
          navigateToPageMap(PageMap.MONITOR_CREATE);
        },
      },
      "action-create-alert": {
        id: "action-create-alert",
        title: t("commandPalette.actions.createAlert", "Create Alert"),
        icon: IconProp.ExclaimationCircle,
        iconColor: "amber",
        category: actionsCategory,
        keywords: ["new", "add"],
        onSelect: () => {
          navigateToPageMap(PageMap.ALERT_CREATE);
        },
      },
      "action-create-scheduled-maintenance": {
        id: "action-create-scheduled-maintenance",
        title: t(
          "commandPalette.actions.createScheduledMaintenance",
          "Create Scheduled Maintenance",
        ),
        icon: IconProp.Clock,
        iconColor: "cyan",
        category: actionsCategory,
        keywords: ["new", "add", "downtime", "window"],
        onSelect: () => {
          navigateToPageMap(PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE);
        },
      },
      "action-create-announcement": {
        id: "action-create-announcement",
        title: t(
          "commandPalette.actions.createAnnouncement",
          "Create Announcement",
        ),
        icon: IconProp.Announcement,
        iconColor: "emerald",
        category: actionsCategory,
        keywords: ["new", "add", "status page", "post"],
        onSelect: () => {
          navigateToPageMap(PageMap.ANNOUNCEMENT_CREATE);
        },
      },
      "action-toggle-theme": {
        id: "action-toggle-theme",
        title:
          theme === Theme.Dark
            ? t("commandPalette.actions.lightTheme", "Switch to light theme")
            : t("commandPalette.actions.darkTheme", "Switch to dark theme"),
        icon: theme === Theme.Dark ? IconProp.Sun : IconProp.Moon,
        iconColor: "indigo",
        category: actionsCategory,
        keywords: ["theme", "dark", "light", "mode", "appearance"],
        onSelect: () => {
          ThemeUtil.toggleTheme();
        },
      },
      "action-ask-ai": {
        id: "action-ask-ai",
        title: t("commandPalette.actions.askAi", "Ask AI"),
        icon: IconProp.Sparkles,
        iconColor: "violet",
        category: actionsCategory,
        keywords: ["chat", "copilot", "assistant"],
        shortcut: [KeyboardKey.Mod, "I"],
        onSelect: () => {
          closePalette();
          GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE);
        },
      },
      "action-keyboard-shortcuts": {
        id: "action-keyboard-shortcuts",
        title: t("keyboardShortcuts.title", "Keyboard shortcuts"),
        icon: IconProp.Keyboard,
        iconColor: "slate",
        category: actionsCategory,
        keywords: ["keys", "hotkeys", "shortcut", "keyboard"],
        shortcut: ["?"],
        onSelect: () => {
          closePalette();
          GlobalEvents.dispatchEvent(EventName.KEYBOARD_SHORTCUTS_TOGGLE);
        },
      },
      "action-active-incidents": {
        id: "action-active-incidents",
        title: t("commandPalette.actions.activeIncidents", "Active Incidents"),
        icon: IconProp.Alert,
        iconColor: "rose",
        category: quickLinksCategory,
        keywords: ["ongoing", "open"],
        onSelect: () => {
          navigateToPageMap(PageMap.ACTIVE_INCIDENTS);
        },
      },
      "action-my-on-call-policies": {
        id: "action-my-on-call-policies",
        title: t(
          "commandPalette.actions.myOnCallPolicies",
          "My On-Call Policies",
        ),
        icon: IconProp.Call,
        iconColor: "stone",
        category: quickLinksCategory,
        keywords: ["duty", "escalation", "schedule"],
        onSelect: () => {
          navigateToPageMap(PageMap.MY_ON_CALL_POLICIES);
        },
      },
      "action-project-invitations": {
        id: "action-project-invitations",
        title: t(
          "commandPalette.actions.projectInvitations",
          "Project Invitations",
        ),
        icon: IconProp.Email,
        iconColor: "blue",
        category: quickLinksCategory,
        keywords: ["invite", "join", "team"],
        onSelect: () => {
          navigateToPageMap(PageMap.PROJECT_INVITATIONS);
        },
      },
      "action-admin-dashboard": {
        id: "action-admin-dashboard",
        title: t("commandPalette.actions.adminDashboard", "Admin Dashboard"),
        icon: IconProp.Settings,
        iconColor: "slate",
        category: accountCategory,
        keywords: ["master", "administration"],
        onSelect: () => {
          closePalette();
          Navigation.navigate(ADMIN_DASHBOARD_URL);
        },
      },
      "action-log-out": {
        id: "action-log-out",
        title: t("commandPalette.actions.logOut", "Log out"),
        icon: IconProp.Logout,
        iconColor: "slate",
        category: accountCategory,
        keywords: ["sign out", "exit"],
        onSelect: () => {
          navigateToPageMap(PageMap.LOGOUT);
        },
      },
    };

    const actionCommands: Array<PaletteCommand> = visibleActionIds.map(
      (actionId: PaletteActionId): PaletteCommand => {
        return actionCommandsById[actionId];
      },
    );

    commands = [...actionCommands, ...navigationCommands];

    // --- live entity search (project-scoped, so project required) ---------
    if (hasProjectSelected) {
      const findSpec: (id: string) => PaletteEntitySearchSpec = (
        id: string,
      ): PaletteEntitySearchSpec => {
        return getEntitySearchSpecs().find((spec: PaletteEntitySearchSpec) => {
          return spec.id === id;
        }) as PaletteEntitySearchSpec;
      };

      searchProviders = [
        createEntitySearchProvider<Monitor>({
          spec: findSpec("monitors"),
          modelType: Monitor,
          sectionTitle: t("commandPalette.sections.monitors", "Monitors"),
          onNavigate: closePalette,
        }),
        createEntitySearchProvider<Incident>({
          spec: findSpec("incidents"),
          modelType: Incident,
          sectionTitle: t("commandPalette.sections.incidents", "Incidents"),
          onNavigate: closePalette,
        }),
        createEntitySearchProvider<Alert>({
          spec: findSpec("alerts"),
          modelType: Alert,
          sectionTitle: t("commandPalette.sections.alerts", "Alerts"),
          onNavigate: closePalette,
        }),
        createEntitySearchProvider<StatusPage>({
          spec: findSpec("status-pages"),
          modelType: StatusPage,
          sectionTitle: t(
            "commandPalette.sections.statusPages",
            "Status Pages",
          ),
          onNavigate: closePalette,
        }),
        createEntitySearchProvider<OnCallDutyPolicy>({
          spec: findSpec("on-call-policies"),
          modelType: OnCallDutyPolicy,
          sectionTitle: t(
            "commandPalette.sections.onCallPolicies",
            "On-Call Policies",
          ),
          onNavigate: closePalette,
        }),
      ];
    }
  }

  return (
    <CommandPalette
      commands={commands}
      searchProviders={searchProviders}
      isOpen={isOpen}
      onClose={closePalette}
      recentStorageKey={PALETTE_RECENTS_STORAGE_KEY}
    />
  );
};

export default DashboardCommandPalette;
