import ProductEvents from "Common/UI/Utils/ProductEvents";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../Utils/NavigationItems";
import { getItemPlacement } from "../../Utils/ProjectProducts/ProductsMenu";
import { ProjectProductsState } from "../../Utils/ProjectProducts/ProjectProductsStore";
import useProjectProducts from "../../Utils/ProjectProducts/UseProjectProducts";
import { ProductPlacement } from "Common/Types/Product/ProjectProducts";
import EventName from "../../Utils/EventName";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  buildEntitySearchQuery,
  buildEntitySearchSelect,
  buildEntitySearchSort,
  buildGlossaryTermDescriptors,
  buildNavigationCommandDescriptors,
  buildPageSearchCommandDescriptors,
  buildProjectSwitchDescriptors,
  canDeleteProject,
  canSearchRecordsOf,
  computeCreateActionGates,
  getEntitySearchResultTitle,
  getEntitySearchSpecs,
  getPageSearchCommandRanking,
  getVisibleActionIds,
  withoutActionsOfProductsOff,
  isQuestion,
  isRoutePathNavigable,
  PageSearchAvailability,
  PageSearchCommandDescriptor,
  PALETTE_ENTITY_SEARCH_LIMIT,
  PALETTE_RECENTS_STORAGE_KEY,
  PALETTE_SEARCH_PRIORITY,
  PaletteActionId,
  PaletteEntitySearchSpec,
  PaletteGlossaryEntry,
  PaletteGlossaryTermDescriptor,
  PaletteNavigationCatalogEntry,
  PaletteNavigationCommandDescriptor,
  PaletteProjectSwitchDescriptor,
  PROJECT_SWITCH_KEYWORDS,
} from "./DashboardCommandPaletteHelpers";
import { openAskAi } from "../AIChat/AskAiEvents";
import {
  getProductOfPage,
  getProductOfPath,
} from "../../Utils/ProjectProducts/ProductOfRoute";
import { getOffProducts } from "Common/Types/Product/ServerProducts";
import ProductKey from "Common/Types/Product/ProductKey";
import {
  HowOneUptimeWorksOpenedFrom,
  openHowOneUptimeWorks,
} from "../Home/HowOneUptimeWorksDialog";
import {
  GiveFeedbackOpenedFrom,
  openGiveFeedback,
} from "../Feedback/GiveFeedbackDialog";
import { getPageSearchAreas } from "./PageSearchIndex";
import { useProductFeedbackSettings } from "Common/UI/Utils/ProductFeedback";
import { ProductFeedbackSettings } from "Common/Types/ProductFeedback/ProductFeedback";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { HeldPermissions } from "Common/Types/HeldPermissions";
import {
  GLOSSARY_INDEX_DOCS_PAGE,
  getDocsPageUrl,
  getGlossaryTermUrl,
  LoadedGlossary,
  loadGlossary,
} from "Common/UI/Utils/Glossary";
import CommandPalette from "Common/UI/Components/CommandPalette/CommandPalette";
import { MoreMenuItem, NavItem } from "Common/UI/Components/Navbar/NavBar";
import {
  PaletteCommand,
  PaletteSearchProvider,
  PaletteSearchResult,
} from "Common/UI/Components/CommandPalette/Types";
import KeyboardKey from "Common/UI/Components/KeyboardShortcut/KeyboardKey";
import { ADMIN_DASHBOARD_URL, BILLING_ENABLED } from "Common/UI/Config";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { DocsSearchHit, searchDocs } from "Common/UI/Utils/DocsSearch";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import LeaveGuard from "Common/UI/Utils/LeaveGuard";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import ThemeUtil, {
  Theme,
  ThemePreference,
  useTheme,
  useThemePreference,
} from "Common/UI/Utils/Theme";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import User from "Common/UI/Utils/User";
import Alert from "Common/Models/DatabaseModels/Alert";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "Common/Models/DatabaseModels/Host";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "Common/Models/DatabaseModels/Project";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import Service from "Common/Models/DatabaseModels/Service";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Team from "Common/Models/DatabaseModels/Team";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { isDashboardRecordingConfigured } from "../../Utils/DashboardRecording/DashboardRecordingConfig";

/*
 * The dashboard's command palette host: always mounted (App.tsx, next to
 * AskAiPanel), owns the Cmd/Ctrl+K shortcut (the legacy NavBar binding is
 * disabled via disableCommandKShortcut) and the COMMAND_PALETTE_TOGGLE global
 * event, and feeds the generic Common CommandPalette with:
 *  - every product from the shared NavBar catalog (useDashboardNavigationItems),
 *  - quick actions (create flows, theme, Ask AI, global pages, logout),
 *  - every page the menus link to and the actions done on them (API Keys,
 *    On-Call Schedules, Delete Project...), from PageSearchIndex.ts. These
 *    are offered while searching only, each with the breadcrumb of where it
 *    lives,
 *  - live entity search across monitors, incidents, alerts, status pages,
 *    on-call policies, and (#6816) services, hosts, on-call schedules,
 *    scheduled maintenance, dashboards, workflows, runbooks and teams - each
 *    kind only where the person may read it,
 *  - the person's other projects ("Switch to Acme Staging"),
 *  - How OneUptime works, the Glossary and its terms (#6936),
 *  - "Ask AI: ..." for a question nothing else answers.
 */

/*
 * The kinds of record Search looks for, in the order their sections are
 * listed, each with its model (for the request and the read permission)
 * and its section's name, in English: the reader's words come from the
 * locale (translateText).
 */
interface EntitySearchKind {
  specId: string;
  modelType: { new (): DatabaseBaseModel };
  sectionTitle: string;
  // The five kinds Search always found keep their own locale keys.
  sectionKey?: string | undefined;
}

export const ENTITY_SEARCH_KINDS: ReadonlyArray<EntitySearchKind> = [
  {
    specId: "monitors",
    modelType: Monitor,
    sectionTitle: "Monitors",
    sectionKey: "commandPalette.sections.monitors",
  },
  {
    specId: "incidents",
    modelType: Incident,
    sectionTitle: "Incidents",
    sectionKey: "commandPalette.sections.incidents",
  },
  {
    specId: "alerts",
    modelType: Alert,
    sectionTitle: "Alerts",
    sectionKey: "commandPalette.sections.alerts",
  },
  {
    specId: "status-pages",
    modelType: StatusPage,
    sectionTitle: "Status Pages",
    sectionKey: "commandPalette.sections.statusPages",
  },
  {
    specId: "on-call-policies",
    modelType: OnCallDutyPolicy,
    sectionTitle: "On-Call Policies",
    sectionKey: "commandPalette.sections.onCallPolicies",
  },
  { specId: "services", modelType: Service, sectionTitle: "Services" },
  { specId: "hosts", modelType: Host, sectionTitle: "Hosts" },
  {
    specId: "on-call-schedules",
    modelType: OnCallDutyPolicySchedule,
    sectionTitle: "On-Call Schedules",
  },
  {
    specId: "scheduled-maintenance",
    modelType: ScheduledMaintenance,
    sectionTitle: "Scheduled Maintenance",
  },
  { specId: "dashboards", modelType: Dashboard, sectionTitle: "Dashboards" },
  { specId: "workflows", modelType: Workflow, sectionTitle: "Workflows" },
  { specId: "runbooks", modelType: Runbook, sectionTitle: "Runbooks" },
  { specId: "teams", modelType: Team, sectionTitle: "Teams" },
];

export interface ComponentProps {
  /*
   * The person's projects and how to switch to one, as the project picker
   * has them: each other project is a result ("Switch to Acme Staging").
   */
  projects?: Array<Project> | undefined;
  onProjectSelected?: ((project: Project) => void) | undefined;
}

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
          // "INC-18 Manually declared" for a numbered entity.
          const title: string = getEntitySearchResultTitle(data.spec, item);

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

/*
 * Search's Documentation group (#6822): the docs pages and sections that
 * answer what was typed, from the installation's own docs search (the one
 * the docs' search box asks), opened in a new tab. A read that fails shows
 * nothing, never an error.
 */
export function createDocsSearchProvider(data: {
  sectionTitle: string;
  language?: string | undefined;
  onNavigate: () => void;
}): PaletteSearchProvider {
  return {
    id: "docs",
    title: data.sectionTitle,
    search: async (searchText: string): Promise<Array<PaletteSearchResult>> => {
      const hits: Array<DocsSearchHit> = await searchDocs({
        query: searchText,
        language: data.language,
      });

      return hits.map(
        (hit: DocsSearchHit, index: number): PaletteSearchResult => {
          return {
            id: `docs-${index}-${hit.url}`,
            title: hit.title,
            description: hit.where,
            icon: IconProp.Book,
            iconColor: "indigo",
            onSelect: () => {
              data.onNavigate();
              Navigation.navigate(URL.fromString(hit.url), {
                openInNewTab: true,
              });
            },
          };
        },
      );
    },
  };
}

/*
 * Whether the current project has monitor groups turned on, as its menu
 * reads it. The palette is mounted outside the pages' error boundary, so a
 * stored project it cannot read leaves Monitor Groups out rather than take
 * the dashboard down.
 */
const isMonitorGroupsEnabled: () => boolean = (): boolean => {
  try {
    const project: Project | null = ProjectUtil.getCurrentProject();
    return Boolean(project?.isFeatureFlagMonitorGroupsEnabled);
  } catch {
    return false;
  }
};

const DashboardCommandPalette: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t, i18n } = useTranslation();
  const language: string | undefined =
    i18n?.resolvedLanguage || i18n?.language || undefined;
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const theme: Theme = useTheme();
  const themePreference: ThemePreference = useThemePreference();
  // Give feedback is offered once the server says it takes feedback (#6832).
  const feedbackSettings: ProductFeedbackSettings | null =
    useProductFeedbackSettings();

  const closePalette: () => void = useCallback((): void => {
    setIsOpen(false);
  }, []);

  /*
   * The Glossary's terms, read once per language the first time Search
   * opens (loadGlossary keeps the read). Search works the same without
   * them: a read that fails leaves the terms out.
   */
  const [glossaryEntries, setGlossaryEntries] = useState<
    Array<PaletteGlossaryEntry>
  >([]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    let isCurrent: boolean = true;

    loadGlossary(language)
      .then((glossary: LoadedGlossary): void => {
        if (!isCurrent) {
          return;
        }

        setGlossaryEntries(
          Array.from(glossary.definitions.values()).map(
            (definition: {
              id: string;
              term: string;
            }): PaletteGlossaryEntry => {
              return {
                id: definition.id,
                term: definition.term,
                alsoCalled: glossary.alsoCalled?.get(definition.id) || [],
              };
            },
          ),
        );
      })
      .catch((): void => {
        // No terms: everything else is still found.
      });

    return () => {
      isCurrent = false;
    };
  }, [isOpen, language]);

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
   * AskAiPanel's Cmd/Ctrl+I: bail on extra modifiers and on events another
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
   * The project's products (#6814): one it hides is found by searching, and
   * left out of what browsing lists; one switched off on the server is not
   * offered at all.
   */
  const products: ProjectProductsState = useProjectProducts();
  /*
   * Switched off on the server (#6815): its actions, its records, its pages
   * and Ask AI's row are left out too.
   */
  const offProducts: Array<ProductKey> = getOffProducts(
    products.answer.offOnServer || {},
  );

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

  const currentProjectId: string =
    ProjectUtil.getCurrentProjectId()?.toString() || "";
  const hasProjectSelected: boolean = currentProjectId.length > 0;

  // What the page rows are built from, while the palette is open.
  let pageCatalogEntries: Array<PaletteNavigationCatalogEntry> = [];
  let pageAvailability: PageSearchAvailability | null = null;

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
      ...moreMenuItems
        .filter((item: MoreMenuItem): boolean => {
          return (
            getItemPlacement({ item: item, answer: products.answer }) !==
            ProductPlacement.Off
          );
        })
        .map((item: MoreMenuItem): PaletteNavigationCatalogEntry => {
          return {
            title: item.title,
            description: item.description,
            keywords: item.keywords,
            icon: item.icon,
            iconColor: item.iconColor,
            category: item.category || essentialsCategory,
            routePath: item.route.toString(),
            templatePath: (item.activeRoute || item.route).toString(),
            isSearchOnly:
              getItemPlacement({ item: item, answer: products.answer }) ===
              ProductPlacement.Hidden,
          };
        }),
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
            keywords: descriptor.keywords,
            icon: descriptor.icon,
            iconColor: descriptor.iconColor,
            category: descriptor.category,
            isSearchOnly: descriptor.isSearchOnly,
            searchPriority: PALETTE_SEARCH_PRIORITY.product,
            onSelect: () => {
              closePalette();
              Navigation.navigate(new Route(descriptor.routePath));
            },
          };
        },
      );

    /*
     * --- actions ----------------------------------------------------------
     * What the user holds, and what a team of theirs blocks.
     */
    const heldPermissions: HeldPermissions =
      PermissionGate.getHeldPermissions();
    const isMasterAdmin: boolean = User.isMasterAdmin();

    const visibleActionIds: Array<PaletteActionId> =
      withoutActionsOfProductsOff(
        getVisibleActionIds({
          ...computeCreateActionGates({
            held: heldPermissions,
            isMasterAdmin,
          }),
          hasProjectSelected,
          isMasterAdmin,
          isThemeFollowingDevice: themePreference === ThemePreference.System,
          canGiveFeedback: feedbackSettings?.isOn === true,
        }),
        offProducts,
      );

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
      /*
       * Back to the device's light or dark, once Light or Dark was picked:
       * the user menu's System, from the keyboard.
       */
      "action-system-theme": {
        id: "action-system-theme",
        title: t(
          "commandPalette.actions.systemTheme",
          "Switch to system theme",
        ),
        icon: IconProp.ComputerDesktop,
        iconColor: "indigo",
        category: actionsCategory,
        keywords: [
          "theme",
          "system",
          "device",
          "auto",
          "dark",
          "light",
          "mode",
          "appearance",
        ],
        onSelect: () => {
          ThemeUtil.setPreference(ThemePreference.System);
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
      /*
       * The map of the product, from the keyboard (#6936). The dialog
       * records that it was opened from here.
       */
      "action-how-oneuptime-works": {
        id: "action-how-oneuptime-works",
        title: t("help.howOneUptimeWorks", "How OneUptime works"),
        icon: IconProp.Map,
        iconColor: "indigo",
        category: actionsCategory,
        keywords: [
          "how it works",
          "overview",
          "getting started",
          "concepts",
          "introduction",
          "tour",
          "help",
        ],
        onSelect: () => {
          closePalette();
          openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.CommandPalette);
        },
      },
      // Every word OneUptime uses, on the docs, in the reader's language.
      "action-glossary": {
        id: "action-glossary",
        title: t("help.glossary", "Glossary"),
        icon: IconProp.BookOpen,
        iconColor: "slate",
        category: actionsCategory,
        keywords: [
          "terms",
          "definitions",
          "dictionary",
          "vocabulary",
          "words",
          "meaning",
          "help",
        ],
        onSelect: () => {
          closePalette();
          Navigation.navigate(
            URL.fromString(getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, language)),
            { openInNewTab: true },
          );
        },
      },
      /*
       * Tell OneUptime what was hard (#6832): the dialog Help opens, kept
       * on this server for its admins.
       */
      "action-give-feedback": {
        id: "action-give-feedback",
        title: t("help.giveFeedback", "Give feedback"),
        icon: IconProp.ChatBubbleLeftRight,
        iconColor: "indigo",
        category: actionsCategory,
        keywords: [
          "feedback",
          "suggestion",
          "confusing",
          "hard",
          "report a problem",
          "tell us",
          "help",
        ],
        onSelect: () => {
          closePalette();
          openGiveFeedback(GiveFeedbackOpenedFrom.CommandPalette);
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

    // --- every page the menus link to: built below, and kept (useMemo) ----
    pageCatalogEntries = catalogEntries;
    pageAvailability = {
      isBillingEnabled: BILLING_ENABLED,
      isMonitorGroupsEnabled: isMonitorGroupsEnabled(),
      isDashboardRecordingOn: isDashboardRecordingConfigured(),
      canDeleteProject:
        hasProjectSelected &&
        canDeleteProject({ held: heldPermissions, isMasterAdmin }),
    };

    /*
     * --- the person's other projects (#6816) -----------------------------
     * "Switch to Acme Staging", found by the project's name or "switch
     * project", through the project picker's own switch.
     */
    const onProjectSelected: ((project: Project) => void) | undefined =
      props.onProjectSelected;
    const projectsCategory: string =
      translator.translateText("Projects") || "Projects";
    const projectCommands: Array<PaletteCommand> = onProjectSelected
      ? buildProjectSwitchDescriptors({
          projects: (props.projects || []).map(
            (project: Project): { id: string; name: string } => {
              return {
                id: project._id?.toString() || project.id?.toString() || "",
                name: project.name?.toString() || "",
              };
            },
          ),
          currentProjectId: currentProjectId,
        }).map((descriptor: PaletteProjectSwitchDescriptor): PaletteCommand => {
          return {
            id: descriptor.id,
            title: translator.translateTemplate("Switch to {{projectName}}", {
              projectName: descriptor.name,
            }),
            keywords: [descriptor.name, ...PROJECT_SWITCH_KEYWORDS],
            icon: IconProp.Folder,
            iconColor: "slate",
            category: projectsCategory,
            isSearchOnly: true,
            searchPriority: PALETTE_SEARCH_PRIORITY.action,
            onSelect: () => {
              const project: Project | undefined = (props.projects || []).find(
                (candidate: Project): boolean => {
                  return (
                    (candidate._id?.toString() || candidate.id?.toString()) ===
                    descriptor.projectId
                  );
                },
              );

              closePalette();

              if (!project) {
                return;
              }

              /*
               * The switch reloads the app in the other project: a page
               * holding unsaved work asks first, before anything switches
               * (LeaveGuard), as the project picker's own switch does.
               */
              LeaveGuard.whenLeaving(
                `/dashboard/${descriptor.projectId}`,
                () => {
                  onProjectSelected(project);
                },
              );
            },
          };
        })
      : [];

    /*
     * --- the Glossary's terms (#6936) ------------------------------------
     * "probe" offers Probe, opened on the Glossary page in a new tab.
     */
    const glossaryCategory: string = t("help.glossary", "Glossary");
    const glossaryCommands: Array<PaletteCommand> =
      buildGlossaryTermDescriptors(glossaryEntries).map(
        (descriptor: PaletteGlossaryTermDescriptor): PaletteCommand => {
          return {
            id: descriptor.id,
            title: descriptor.title,
            keywords: descriptor.keywords,
            breadcrumb: [glossaryCategory],
            breadcrumbKeywords: ["Glossary"],
            icon: IconProp.BookOpen,
            iconColor: "slate",
            category: glossaryCategory,
            isSearchOnly: true,
            searchPriority: PALETTE_SEARCH_PRIORITY.action,
            onSelect: () => {
              closePalette();
              Navigation.navigate(
                URL.fromString(
                  getGlossaryTermUrl(
                    descriptor.termId as GlossaryTerm,
                    language,
                  ),
                ),
                { openInNewTab: true },
              );
            },
          };
        },
      );

    commands = [
      ...actionCommands,
      ...navigationCommands,
      ...projectCommands,
      ...glossaryCommands,
    ];

    /*
     * --- live entity search (project-scoped, so project required) ---------
     * One provider per kind the person may read: a kind they may not would
     * only send a request the server refuses.
     */
    if (hasProjectSelected) {
      const specs: Array<PaletteEntitySearchSpec> = getEntitySearchSpecs();

      searchProviders = ENTITY_SEARCH_KINDS.filter(
        (kind: EntitySearchKind): boolean => {
          // Records of a product switched off on the server are not offered.
          const viewPage: PageMap | undefined = specs.find(
            (spec: PaletteEntitySearchSpec): boolean => {
              return spec.id === kind.specId;
            },
          )?.viewPageMap;
          const product: ProductKey | null = viewPage
            ? getProductOfPage(viewPage)
            : null;

          if (product && offProducts.includes(product)) {
            return false;
          }

          return canSearchRecordsOf({
            model: new kind.modelType(),
            held: heldPermissions,
            isMasterAdmin,
          });
        },
      ).map((kind: EntitySearchKind): PaletteSearchProvider => {
        return createEntitySearchProvider<DatabaseBaseModel>({
          spec: specs.find((spec: PaletteEntitySearchSpec): boolean => {
            return spec.id === kind.specId;
          }) as PaletteEntitySearchSpec,
          modelType: kind.modelType,
          sectionTitle: kind.sectionKey
            ? t(kind.sectionKey, kind.sectionTitle)
            : translator.translateText(kind.sectionTitle) || kind.sectionTitle,
          onNavigate: closePalette,
        });
      });
    }

    /*
     * --- the docs (#6822), under the pages and records -------------------
     * Read from the installation's own docs search, in the reader's
     * language, with or without a project; each opens in a new tab, so
     * the page the person was on stays where it was.
     */
    searchProviders = [
      ...(searchProviders || []),
      createDocsSearchProvider({
        sectionTitle: t("help.documentation", "Documentation"),
        language,
        onNavigate: closePalette,
      }),
    ];
  }

  /*
   * Every page the menus link to, and the actions done on them: about four
   * hundred rows. They are built when Search opens, and again only when the
   * project, the language, the products menu or what the user may do
   * changes. A re-render while Search is open keeps the same rows, so the
   * search keeps the work it did on them (PaletteFilter caches it per row).
   */
  const pageCommandsKey: string = pageAvailability
    ? JSON.stringify([
        currentProjectId,
        translator.language,
        pageAvailability,
        offProducts,
        pageCatalogEntries.map(
          (entry: PaletteNavigationCatalogEntry): Array<string> => {
            return [entry.routePath, entry.title];
          },
        ),
      ])
    : "";

  const pageCommands: Array<PaletteCommand> = useMemo(() => {
    if (!pageAvailability) {
      return [];
    }

    const pagesCategory: string = t("commandPalette.categories.pages", "Pages");
    const actionsCategory: string = t(
      "commandPalette.categories.actions",
      "Actions",
    );

    // The products menu's own names, so a breadcrumb names a product the same way.
    const productTitleByRoutePath: Map<string, string> = new Map();
    pageCatalogEntries.forEach((entry: PaletteNavigationCatalogEntry): void => {
      if (!productTitleByRoutePath.has(entry.routePath)) {
        productTitleByRoutePath.set(entry.routePath, entry.title);
      }
    });

    return buildPageSearchCommandDescriptors({
      areas: getPageSearchAreas(),
      availability: pageAvailability,
      getRouteTemplate: (pageKey: string): string | undefined => {
        return RouteMap[pageKey]?.toString();
      },
      getRoutePath: (pageKey: string): string | undefined => {
        const route: Route | undefined = RouteMap[pageKey];
        return route
          ? RouteUtil.populateRouteParams(route).toString()
          : undefined;
      },
      getProductTitle: (routePath: string): string | undefined => {
        return productTitleByRoutePath.get(routePath);
      },
      translate: (text: string): string => {
        return translator.translateText(text) || text;
      },
      catalog: pageCatalogEntries,
    })
      .filter((descriptor: PageSearchCommandDescriptor): boolean => {
        // A page of a product switched off on the server is not offered.
        const product: ProductKey | null = getProductOfPath(
          descriptor.routePath,
        );
        return !product || !offProducts.includes(product);
      })
      .map((descriptor: PageSearchCommandDescriptor): PaletteCommand => {
        return {
          id: descriptor.id,
          title: descriptor.title,
          titleAliases: descriptor.titleAliases,
          keywords: descriptor.keywords,
          breadcrumb: descriptor.breadcrumb,
          breadcrumbKeywords: descriptor.breadcrumbKeywords,
          icon: descriptor.icon,
          iconColor: descriptor.iconColor,
          /*
           * A setting is listed among the pages, by how well it matches: in
           * a group of its own, a page that only held the words somewhere in
           * a keyword ("processors" for "sso") was drawn above "Require SSO
           * for Login".
           */
          category: descriptor.isAction ? actionsCategory : pagesCategory,
          isSearchOnly: true,
          /*
           * Between equally good matches a page before a setting, and a
           * setting never before its page.
           */
          ...getPageSearchCommandRanking(descriptor),
          onSelect: () => {
            closePalette();
            Navigation.navigate(new Route(descriptor.routePath));
          },
        };
      });
  }, [pageCommandsKey]);

  if (pageCommands.length > 0) {
    commands = [...commands, ...pageCommands];
  }

  /*
   * A search that found nothing (issue #6830): how many there are, and on
   * OneUptime Cloud the words - cut short, and dropped off Cloud
   * (ProductEvent's search/no_results).
   */
  const recordSearchFoundNothing: (searchedQuery: string) => void = (
    searchedQuery: string,
  ): void => {
    ProductEvents.send(ProductEventName.SearchFoundNothing, {
      source: "command_palette",
      query_length: searchedQuery.length,
      query: searchedQuery,
    });
  };

  /*
   * A question nothing answers (#6816): "how do I add a phone number" finds
   * no page or record, so Search offers to ask it, as the last row. Ask AI
   * opens on a new conversation with the question in its composer, unsent.
   * The search still counts as one that found nothing.
   */
  const getFallbackCommands: (query: string) => Array<PaletteCommand> = (
    query: string,
  ): Array<PaletteCommand> => {
    if (!isQuestion(query) || offProducts.includes(ProductKey.AIChat)) {
      return [];
    }

    const question: string = query.trim();

    return [
      {
        id: "ask-ai-question",
        title: translator.translateTemplate("Ask AI: {{question}}", {
          question: question,
        }),
        icon: IconProp.Sparkles,
        iconColor: "violet",
        category: translator.translateText("Ask AI") || "Ask AI",
        onSelect: () => {
          closePalette();
          openAskAi({ prompt: question });
        },
      },
    ];
  };

  return (
    <CommandPalette
      commands={commands}
      searchProviders={searchProviders}
      isOpen={isOpen}
      onClose={closePalette}
      recentStorageKey={PALETTE_RECENTS_STORAGE_KEY}
      onSearchFoundNothing={recordSearchFoundNothing}
      getFallbackCommands={getFallbackCommands}
    />
  );
};

export default DashboardCommandPalette;
