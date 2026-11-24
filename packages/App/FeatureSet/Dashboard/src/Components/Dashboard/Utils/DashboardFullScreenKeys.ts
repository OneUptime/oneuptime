import {
  isTextEntryTarget,
  KeyboardEventLike,
} from "Common/UI/Utils/GlobalKeyboardShortcut";

/*
 * The keys of a dashboard shown full screen (issue #10409), as a pure table:
 * a keydown becomes a DashboardFullScreenKeyAction here and nowhere else, so
 * the window listener (UseDashboardFullScreen) and the tests read one rule.
 * React-free and DOM-free beyond a duck-typed look at the event target, so
 * App's tests run it in node.
 *
 *   Escape   leave full screen, back to the dashboard's page with its menus
 *
 * One Escape never does two things. It is the dashboard's only when nothing
 * else had it first: not with a chord (Ctrl, Cmd, Alt or Shift: the
 * browser's), not in a text field, not one another handler took (a menu, a
 * tooltip or a widget's drag closes on it and marks it), not while a dialog
 * or a menu is in front, not when it repeats from being held down - and
 * not while the browser is full screen, whose own Escape leaves that first
 * (the browser takes it, and the page hears only that it left).
 */

export enum DashboardFullScreenKeyAction {
  Exit = "ExitFullScreen",
}

export interface DashboardFullScreenKeyInput extends KeyboardEventLike {
  repeat?: boolean | undefined;
}

export function getDashboardFullScreenKeyAction(data: {
  event: DashboardFullScreenKeyInput;
  // Whether a dialog or a menu is in front of the dashboard.
  hasOpenLayer: boolean;
  // Whether the browser shows the page full screen: its Escape is the browser's.
  isBrowserFullScreen: boolean;
}): DashboardFullScreenKeyAction | null {
  const event: DashboardFullScreenKeyInput = data.event;

  if (event.key !== "Escape" && event.key !== "Esc") {
    return null;
  }

  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return null;
  }

  if (event.defaultPrevented || event.repeat) {
    return null;
  }

  if (
    data.hasOpenLayer ||
    data.isBrowserFullScreen ||
    isTextEntryTarget(event.target)
  ) {
    return null;
  }

  return DashboardFullScreenKeyAction.Exit;
}
