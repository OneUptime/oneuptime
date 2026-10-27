import {
  isTextEntryTarget,
  KeyboardEventLike,
} from "Common/UI/Utils/GlobalKeyboardShortcut";

/*
 * The player's keys as a pure table (issue #5235): a keydown becomes a
 * PlaylistPlayerKeyAction here and nowhere else, so the window listener
 * (PlaylistPlayer), the "?" sheet (PLAYLIST_PLAYER_SHORTCUTS) and the tests
 * read one map. React-free and DOM-free beyond a duck-typed look at the
 * event target, so App's tests run it in node.
 *
 *   Space        pause, or play again
 *   → / ←        the next / the previous dashboard - the other way round on
 *                a page read right to left, where the next one is on the left
 *   F            full screen, or out of it
 *   Escape       leave the player (a browser in full screen takes Escape
 *                itself, to leave full screen first)
 *   ?            the keys, in a dialog
 *
 * A key is the page's when a chord holds it (Ctrl, Cmd or Alt: the
 * browser's), when it lands in a text field, when another handler took it,
 * while a dialog is open (the dialog's own keys), and when it repeats from
 * being held down. Space on a focused button presses the button instead.
 */

export enum PlaylistPlayerKeyAction {
  TogglePause = "TogglePause",
  Next = "Next",
  Previous = "Previous",
  ToggleFullScreen = "ToggleFullScreen",
  Exit = "Exit",
  ShowShortcuts = "ShowShortcuts",
}

export interface PlaylistPlayerKeyInput extends KeyboardEventLike {
  repeat?: boolean | undefined;
}

interface ElementLike {
  tagName?: unknown;
  getAttribute?: unknown;
}

// Roles a focused element answers Space and Enter with itself.
const ACTIVATED_ROLES: ReadonlySet<string> = new Set<string>([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "switch",
  "tab",
]);

// Whether Space on this element presses it: a button, a link, a control.
export function isActivatedBySpace(
  target: EventTarget | ElementLike | null | undefined,
): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }

  const element: ElementLike = target as ElementLike;

  if (typeof element.tagName !== "string") {
    return false;
  }

  const tag: string = element.tagName.toLowerCase();

  if (tag === "button" || tag === "a" || tag === "summary") {
    return true;
  }

  if (typeof element.getAttribute !== "function") {
    return false;
  }

  const role: unknown = (
    element.getAttribute as (attributeName: string) => unknown
  )("role");

  return typeof role === "string" && ACTIVATED_ROLES.has(role);
}

export function getPlaylistPlayerKeyAction(data: {
  event: PlaylistPlayerKeyInput;
  // Whether the page reads right to left (a Persian one).
  isRightToLeft: boolean;
  // Whether a dialog is in front of the player.
  isDialogOpen: boolean;
}): PlaylistPlayerKeyAction | null {
  const event: PlaylistPlayerKeyInput = data.event;

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  if (event.defaultPrevented || event.repeat) {
    return null;
  }

  if (data.isDialogOpen || isTextEntryTarget(event.target)) {
    return null;
  }

  switch (event.key) {
    case " ":
    case "Spacebar":
      return isActivatedBySpace(event.target)
        ? null
        : PlaylistPlayerKeyAction.TogglePause;
    case "ArrowRight":
      return data.isRightToLeft
        ? PlaylistPlayerKeyAction.Previous
        : PlaylistPlayerKeyAction.Next;
    case "ArrowLeft":
      return data.isRightToLeft
        ? PlaylistPlayerKeyAction.Next
        : PlaylistPlayerKeyAction.Previous;
    case "f":
    case "F":
      return PlaylistPlayerKeyAction.ToggleFullScreen;
    case "Escape":
    case "Esc":
      return PlaylistPlayerKeyAction.Exit;
    case "?":
      return PlaylistPlayerKeyAction.ShowShortcuts;
    default:
      return null;
  }
}

export interface PlaylistPlayerShortcut {
  id: string;
  // KeyboardKey values ("Space", "ArrowRight") or the key as typed.
  keys: Array<string>;
  // English; the sheet translates it.
  description: string;
}

/*
 * The keys the "?" sheet lists, in the order a viewer reaches for them. On
 * a page read right to left the arrows are listed the way they work there.
 */
export function getPlaylistPlayerShortcuts(data: {
  isRightToLeft: boolean;
}): Array<PlaylistPlayerShortcut> {
  return [
    {
      id: "toggle-pause",
      keys: ["Space"],
      description: "Pause or play",
    },
    {
      id: "next",
      keys: [data.isRightToLeft ? "ArrowLeft" : "ArrowRight"],
      description: "Next dashboard",
    },
    {
      id: "previous",
      keys: [data.isRightToLeft ? "ArrowRight" : "ArrowLeft"],
      description: "Previous dashboard",
    },
    {
      id: "full-screen",
      keys: ["F"],
      description: "Full screen",
    },
    {
      id: "exit",
      keys: ["Escape"],
      description: "Exit the player",
    },
    {
      id: "shortcuts",
      keys: ["?"],
      description: "Show keyboard shortcuts",
    },
  ];
}
