import AppLink from "../AppLink/AppLink";
import {
  computeCreateActionGates,
  PaletteCreateActionGates,
} from "../CommandPalette/DashboardCommandPaletteHelpers";
import EventName from "../../Utils/EventName";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import KeyboardKey, {
  KeyboardKeyUtil,
  KeyboardShortcutKey,
} from "Common/UI/Components/KeyboardShortcut/KeyboardKey";
import KeyboardShortcut, {
  KeyboardShortcutSize,
} from "Common/UI/Components/KeyboardShortcut/KeyboardShortcut";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import UiAnalytics from "Common/UI/Utils/Analytics";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The two things people come to Home to do besides reading it: find
 * something, and start something.
 *
 * Search opens the command palette - every page, plus a live search over
 * monitors, incidents, alerts, status pages and on-call - which until now was
 * reached only through a small icon in the header or by knowing Cmd/Ctrl+K.
 * A search box is the one control everybody already knows how to use, so it
 * gets the room.
 *
 * Next to it, as few buttons as will do: Declare Incident, the one action
 * that cannot wait, and one Create menu for the rest. Every action is a
 * create flow the palette offers, gated by the same rule
 * (computeCreateActionGates): it is shown only to someone who may do it, so
 * nobody is handed a form they cannot submit.
 */

export interface HomeQuickAction {
  key: string;
  title: string;
  icon: IconProp;
  pageMap: PageMap;
}

interface QuickActionDefinition extends HomeQuickAction {
  isAllowed: (gates: PaletteCreateActionGates) => boolean;
}

export const DECLARE_INCIDENT_ACTION: QuickActionDefinition = {
  key: "declare-incident",
  title: translationKey("Declare Incident"),
  icon: IconProp.Alert,
  pageMap: PageMap.INCIDENT_CREATE,
  isAllowed: (gates: PaletteCreateActionGates): boolean => {
    return gates.canCreateIncident;
  },
};

// The Create menu, in the order it lists them.
const CREATE_ACTIONS: Array<QuickActionDefinition> = [
  {
    key: "create-monitor",
    title: translationKey("Create Monitor"),
    icon: IconProp.AltGlobe,
    pageMap: PageMap.MONITOR_CREATE,
    isAllowed: (gates: PaletteCreateActionGates): boolean => {
      return gates.canCreateMonitor;
    },
  },
  {
    key: "schedule-maintenance",
    title: translationKey("Schedule Maintenance"),
    icon: IconProp.Clock,
    pageMap: PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,
    isAllowed: (gates: PaletteCreateActionGates): boolean => {
      return gates.canCreateScheduledMaintenance;
    },
  },
  {
    key: "create-announcement",
    title: translationKey("Create Announcement"),
    icon: IconProp.Announcement,
    pageMap: PageMap.ANNOUNCEMENT_CREATE,
    isAllowed: (gates: PaletteCreateActionGates): boolean => {
      return gates.canCreateAnnouncement;
    },
  },
];

const toAction: (definition: QuickActionDefinition) => HomeQuickAction = (
  definition: QuickActionDefinition,
): HomeQuickAction => {
  return {
    key: definition.key,
    title: definition.title,
    icon: definition.icon,
    pageMap: definition.pageMap,
  };
};

export interface HomeQuickActions {
  declareIncident: HomeQuickAction | null;
  create: Array<HomeQuickAction>;
}

// The actions these gates allow.
export const getHomeQuickActions: (
  gates: PaletteCreateActionGates,
) => HomeQuickActions = (gates: PaletteCreateActionGates): HomeQuickActions => {
  return {
    declareIncident: DECLARE_INCIDENT_ACTION.isAllowed(gates)
      ? toAction(DECLARE_INCIDENT_ACTION)
      : null,
    create: CREATE_ACTIONS.filter(
      (definition: QuickActionDefinition): boolean => {
        return definition.isAllowed(gates);
      },
    ).map(toAction),
  };
};

// What the signed-in user may create, by the palette's rule.
export const getCurrentCreateActionGates: () => PaletteCreateActionGates =
  (): PaletteCreateActionGates => {
    return computeCreateActionGates({
      held: PermissionGate.getHeldPermissions(),
      isMasterAdmin: User.isMasterAdmin(),
    });
  };

// The palette's own chord (DashboardCommandPalette listens for it).
const SEARCH_SHORTCUT: Array<KeyboardShortcutKey> = [KeyboardKey.Mod, "K"];

const BUTTON_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const NEUTRAL_BUTTON_CLASS_NAME: string = `${BUTTON_CLASS_NAME} border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:bg-gray-50`;

export interface ComponentProps {
  projectId: string;
  gates: PaletteCreateActionGates;
}

const HomeCommandBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const actions: HomeQuickActions = getHomeQuickActions(props.gates);

  const openSearch: () => void = (): void => {
    UiAnalytics.capture("dashboard/home/search-opened", {
      projectId: props.projectId,
    });
    GlobalEvents.dispatchEvent(EventName.COMMAND_PALETTE_TOGGLE);
  };

  const recordAction: (action: HomeQuickAction) => void = (
    action: HomeQuickAction,
  ): void => {
    UiAnalytics.capture("dashboard/home/quick-action", {
      projectId: props.projectId,
      action: action.key,
    });
  };

  const routeOf: (action: HomeQuickAction) => Route = (
    action: HomeQuickAction,
  ): Route => {
    return RouteUtil.populateRouteParams(RouteMap[action.pageMap] as Route);
  };

  const renderActionLink: (
    action: HomeQuickAction,
    className: string,
  ) => ReactElement = (
    action: HomeQuickAction,
    className: string,
  ): ReactElement => {
    return (
      <AppLink
        key={action.key}
        to={routeOf(action)}
        onNavigateComplete={() => {
          recordAction(action);
        }}
        className={className}
      >
        <span
          data-testid={`home-quick-action-${action.key}`}
          className="inline-flex items-center gap-1.5"
        >
          <Icon icon={action.icon} className="h-4 w-4 flex-none" />
          <span className="whitespace-nowrap">
            {translator.translateText(action.title)}
          </span>
        </span>
      </AppLink>
    );
  };

  const renderCreate: () => ReactElement | null = (): ReactElement | null => {
    if (actions.create.length === 0) {
      return null;
    }

    // One thing to create needs no menu.
    if (actions.create.length === 1) {
      return renderActionLink(actions.create[0]!, NEUTRAL_BUTTON_CLASS_NAME);
    }

    return (
      <MoreMenu
        dataTestId="home-create-menu"
        ariaLabel={translator.translateText("Create") || "Create"}
        triggerClassName={NEUTRAL_BUTTON_CLASS_NAME}
        elementToBeShownInsteadOfButton={
          <span className="inline-flex items-center gap-1.5">
            <Icon icon={IconProp.Add} className="h-4 w-4 flex-none" />
            <span className="whitespace-nowrap">
              {translator.translateText("Create")}
            </span>
            <Icon
              icon={IconProp.ChevronDown}
              className="h-3.5 w-3.5 flex-none text-gray-400"
            />
          </span>
        }
      >
        {actions.create.map((action: HomeQuickAction): ReactElement => {
          return (
            <MoreMenuItem
              key={action.key}
              icon={action.icon}
              text={action.title}
              dataTestId={`home-quick-action-${action.key}`}
              onClick={() => {
                recordAction(action);
                Navigation.navigate(routeOf(action));
              }}
            />
          );
        })}
      </MoreMenu>
    );
  };

  const hasActions: boolean = Boolean(
    actions.declareIncident || actions.create.length > 0,
  );

  return (
    <div
      data-testid="home-command-bar"
      className="flex flex-col gap-3 md:flex-row md:items-center"
    >
      <button
        type="button"
        onClick={openSearch}
        data-testid="home-search"
        aria-keyshortcuts={KeyboardKeyUtil.getAriaKeyShortcuts(SEARCH_SHORTCUT)}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Icon
          icon={IconProp.Search}
          className="h-5 w-5 flex-none text-gray-400"
        />
        <span className="min-w-0 flex-1 truncate text-sm text-gray-500">
          {translator.translateText(
            "Search monitors, incidents, status pages and more…",
          )}
        </span>
        <KeyboardShortcut
          keys={SEARCH_SHORTCUT}
          size={KeyboardShortcutSize.Small}
          className="max-sm:hidden sm:inline-flex"
        />
      </button>
      {hasActions ? (
        <div
          data-testid="home-quick-actions"
          className="flex flex-none flex-wrap items-center gap-2"
        >
          {actions.declareIncident
            ? renderActionLink(
                actions.declareIncident,
                `${BUTTON_CLASS_NAME} border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100`,
              )
            : null}
          {renderCreate()}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default HomeCommandBar;
