import PageMap from "./PageMap";
import {
  EMPTY_KEYBOARD_SEQUENCE_STATE,
  KEYBOARD_SEQUENCE_TIMEOUT_IN_MS,
  KeyboardEventLike,
  KeyboardSequenceOutcome,
  KeyboardSequenceResult,
  KeyboardSequenceState,
  reduceKeyboardSequence,
  shouldIgnoreGlobalKeyPress,
} from "Common/UI/Utils/GlobalKeyboardShortcut";

/**
 * The dashboard's "go to" shortcuts: press the leader key, then one letter, and
 * land on that product's page — the same grammar GitHub, Linear and Gmail use,
 * so most people already have the muscle memory.
 *
 * The catalog is React-free and free of `t()` so it can be pinned by the
 * plain-node App suite: the invariants that matter (no two destinations
 * claiming a letter, nothing colliding with the leader itself) are properties
 * of this list, and are worth failing a build over rather than discovering as a
 * shortcut that silently stopped working.
 */

/**
 * The leader. "g" for "go", and the one letter that can never be a
 * destination — see reduceKeyboardSequence, which treats a repeated leader as
 * a re-arm.
 */
export const DASHBOARD_GO_TO_LEADER_KEY: string = "g";

export interface DashboardGoToShortcut {
  /** The key pressed after the leader. Always a single lowercase letter. */
  key: string;
  pageMap: PageMap;
  /**
   * i18n key and its English default, for the row in the shortcuts dialog.
   * The default is carried here rather than in en.json because every locale
   * file must mirror en.json key-for-key (Scripts/I18n/ValidateLocales), and
   * a key added to English alone fails that check.
   */
  titleKey: string;
  defaultTitle: string;
}

/*
 * Ten destinations, each keyed on the first letter of its own name, so the
 * shortcut is guessable from the page it opens. Deliberately not the whole
 * product catalog: a list long enough to need a lookup table is a list nobody
 * memorises, and Cmd/Ctrl+K already covers everything else by name.
 */
const DASHBOARD_GO_TO_SHORTCUTS: Array<DashboardGoToShortcut> = [
  {
    key: "h",
    pageMap: PageMap.HOME,
    titleKey: "navbar.home",
    defaultTitle: "Home",
  },
  {
    key: "m",
    pageMap: PageMap.MONITORS,
    titleKey: "navbar.items.monitorsTitle",
    defaultTitle: "Monitors",
  },
  {
    key: "i",
    pageMap: PageMap.INCIDENTS,
    titleKey: "navbar.items.incidentsTitle",
    defaultTitle: "Incidents",
  },
  {
    key: "a",
    pageMap: PageMap.ALERTS,
    titleKey: "navbar.items.alertsTitle",
    defaultTitle: "Alerts",
  },
  {
    key: "o",
    pageMap: PageMap.ON_CALL_DUTY,
    titleKey: "navbar.items.onCallDutyTitle",
    defaultTitle: "On-Call Duty",
  },
  {
    key: "s",
    pageMap: PageMap.STATUS_PAGES,
    titleKey: "navbar.items.statusPagesTitle",
    defaultTitle: "Status Pages",
  },
  {
    key: "e",
    pageMap: PageMap.SCHEDULED_MAINTENANCE_EVENTS,
    titleKey: "navbar.items.scheduledMaintenanceTitle",
    defaultTitle: "Scheduled Maintenance",
  },
  {
    key: "d",
    pageMap: PageMap.DASHBOARDS,
    titleKey: "navbar.items.dashboardsTitle",
    defaultTitle: "Dashboards",
  },
  {
    key: "l",
    pageMap: PageMap.LOGS,
    titleKey: "navbar.items.logsTitle",
    defaultTitle: "Logs",
  },
  {
    key: "t",
    pageMap: PageMap.TRACES,
    titleKey: "navbar.items.tracesTitle",
    defaultTitle: "Traces",
  },
];

export function getDashboardGoToShortcuts(): Array<DashboardGoToShortcut> {
  // A copy, so a caller sorting or splicing for display cannot edit the source.
  return [...DASHBOARD_GO_TO_SHORTCUTS];
}

/**
 * The destination a completed sequence points at, or null when the second key
 * is not bound. Case-insensitive: the letter arrives from a KeyboardEvent,
 * which reports "H" whenever caps lock happens to be on.
 */
export function findDashboardGoToShortcut(
  key: string,
): DashboardGoToShortcut | null {
  const normalizedKey: string = (key || "").toLowerCase();

  return (
    DASHBOARD_GO_TO_SHORTCUTS.find((shortcut: DashboardGoToShortcut) => {
      return shortcut.key === normalizedKey;
    }) || null
  );
}

// ---- resolving one keypress -------------------------------------------------

/**
 * What the dashboard should do about a key that was just pressed.
 */
export enum DashboardKeyAction {
  /** Nothing. The keypress was not ours. */
  None = "None",
  OpenShortcutsModal = "OpenShortcutsModal",
  CloseShortcutsModal = "CloseShortcutsModal",
  /** Go to `pageMap`. */
  NavigateToPage = "NavigateToPage",
}

export interface DashboardKeyResolution {
  action: DashboardKeyAction;
  /** Only set when the action is NavigateToPage. */
  pageMap: PageMap | null;
  /** The sequence state to carry into the next keypress. */
  sequenceState: KeyboardSequenceState;
  /**
   * Whether the caller should call preventDefault(). Only true when the key
   * was actually claimed, so a keypress we ignore stays available to the page.
   */
  shouldPreventDefault: boolean;
}

/**
 * The whole global-shortcut decision for one keypress, as a pure function.
 *
 * This is the part worth testing — "?" while a form dialog is open must not
 * open anything, "g" then "i" must navigate but "g" then a second later "i"
 * must not — and none of it needs React or a browser to be true. The component
 * that owns the listener is a thin adapter over this.
 */
export function resolveDashboardKeyPress(input: {
  event: KeyboardEventLike;
  /** Is the shortcuts dialog itself on screen? */
  isShortcutsModalOpen: boolean;
  /** Is any modal dialog on screen (including the shortcuts one)? */
  isDialogOpen: boolean;
  sequenceState: KeyboardSequenceState;
  now: number;
}): DashboardKeyResolution {
  const ignored: DashboardKeyResolution = {
    action: DashboardKeyAction.None,
    pageMap: null,
    sequenceState: input.sequenceState,
    shouldPreventDefault: false,
  };

  if (shouldIgnoreGlobalKeyPress(input.event)) {
    return ignored;
  }

  if (input.event.key === "?") {
    /*
     * Closing has to be checked before the dialog guard: the shortcuts dialog
     * is itself modal, so it would otherwise block its own toggle.
     */
    if (input.isShortcutsModalOpen) {
      return {
        action: DashboardKeyAction.CloseShortcutsModal,
        pageMap: null,
        sequenceState: EMPTY_KEYBOARD_SEQUENCE_STATE,
        shouldPreventDefault: true,
      };
    }

    // Someone else's dialog is in front. "?" belongs to whatever that is.
    if (input.isDialogOpen) {
      return ignored;
    }

    return {
      action: DashboardKeyAction.OpenShortcutsModal,
      pageMap: null,
      sequenceState: EMPTY_KEYBOARD_SEQUENCE_STATE,
      shouldPreventDefault: true,
    };
  }

  /*
   * No navigating out from under a dialog: the user may be halfway through a
   * form, and losing that to a stray keystroke is not a trade worth making.
   * The armed leader is dropped too, so a dialog cannot leave one behind.
   */
  if (input.isShortcutsModalOpen || input.isDialogOpen) {
    return {
      ...ignored,
      sequenceState: EMPTY_KEYBOARD_SEQUENCE_STATE,
    };
  }

  const sequenceResult: KeyboardSequenceResult = reduceKeyboardSequence({
    state: input.sequenceState,
    key: input.event.key,
    now: input.now,
    leaderKey: DASHBOARD_GO_TO_LEADER_KEY,
    timeoutInMs: KEYBOARD_SEQUENCE_TIMEOUT_IN_MS,
  });

  if (
    sequenceResult.outcome !== KeyboardSequenceOutcome.Completed ||
    !sequenceResult.key
  ) {
    return {
      action: DashboardKeyAction.None,
      pageMap: null,
      sequenceState: sequenceResult.state,
      shouldPreventDefault: false,
    };
  }

  const shortcut: DashboardGoToShortcut | null = findDashboardGoToShortcut(
    sequenceResult.key,
  );

  if (!shortcut) {
    /*
     * The leader was pressed and then something unbound. The sequence is over
     * either way, but the key itself was never ours — leave it to the page.
     */
    return {
      action: DashboardKeyAction.None,
      pageMap: null,
      sequenceState: sequenceResult.state,
      shouldPreventDefault: false,
    };
  }

  return {
    action: DashboardKeyAction.NavigateToPage,
    pageMap: shortcut.pageMap,
    sequenceState: sequenceResult.state,
    shouldPreventDefault: true,
  };
}
