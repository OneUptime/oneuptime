/*
 * Where the session replay player is allowed to go wide.
 *
 * The player lives at /rum/:id/session-replay/:sessionId inside the RUM
 * application's ModelPage, whose side menu takes a quarter of the width
 * the recording needs. No route moves (Pages/Rum/Layout.tsx would land the
 * player inside the RUM-list side menu and break SessionReplayRoutes.test.ts),
 * so Pages/Rum/View/Layout.tsx asks this pure matcher whether the current
 * path is the player and, when the viewer's "wide" preference is on, drops
 * the side menu and the page gutters for that one page.
 *
 * Path-shape detection is deliberately narrow - last-but-one segment
 * "session-replay", last segment a 32-character lowercase hex session id -
 * so the list (/session-replay), the audit page (/session-replay-audit)
 * and the settings page (/session-replay-settings) all keep their menu.
 * SessionReplayLayout.test.ts pins those four cases.
 */

/* The recorder mints session ids as 32 lowercase hex characters. */
const SESSION_ID_SEGMENT: RegExp = /^[0-9a-f]{32}$/;

const PLAYER_PARENT_SEGMENT: string = "session-replay";

/*
 * ModelPage's default container is "mb-auto max-w-full px-4 sm:px-6 lg:px-8
 * mt-5 h-max". Wide keeps max-w-full (the page never scrolls sideways) and
 * trims the gutters and top margin so the stage and the rail get the room.
 */
export const SESSION_REPLAY_PLAYER_WIDE_CLASS_NAME: string =
  "mb-auto max-w-full px-3 sm:px-4 mt-3 h-max";

function pathSegments(path: string): Array<string> {
  /* A stray query string or hash must not make the last segment "abc?t=4". */
  const questionMark: number = path.indexOf("?");
  const withoutQuery: string =
    questionMark >= 0 ? path.slice(0, questionMark) : path;
  const hash: number = withoutQuery.indexOf("#");
  const clean: string = hash >= 0 ? withoutQuery.slice(0, hash) : withoutQuery;

  return clean.split("/").filter((segment: string): boolean => {
    return segment.length > 0;
  });
}

/* True only for the player page: .../session-replay/<32 lowercase hex>. */
export function isSessionReplayPlayerPath(
  path: string | null | undefined,
): boolean {
  if (typeof path !== "string" || path.length === 0) {
    return false;
  }

  const segments: Array<string> = pathSegments(path);

  if (segments.length < 2) {
    return false;
  }

  const last: string = segments[segments.length - 1] as string;
  const parent: string = segments[segments.length - 2] as string;

  return parent === PLAYER_PARENT_SEGMENT && SESSION_ID_SEGMENT.test(last);
}

export interface SessionReplayPlayerLayout {
  isPlayerPath: boolean;
  /* Drop ModelPage's sideMenu prop: only on the player, only when wide. */
  shouldHideSideMenu: boolean;
  /* ModelPage className override; undefined keeps the default container. */
  className: string | undefined;
}

/*
 * The single decision Layout.tsx renders from. Wide OFF on the player page
 * is the ordinary layout with the menu, so a viewer who wants the RUM
 * navigation is one keypress (w) away from it.
 */
export function resolveSessionReplayPlayerLayout(args: {
  path: string | null | undefined;
  isWide: boolean;
}): SessionReplayPlayerLayout {
  const isPlayerPath: boolean = isSessionReplayPlayerPath(args.path);
  const isWideLayout: boolean = isPlayerPath && args.isWide;

  return {
    isPlayerPath: isPlayerPath,
    shouldHideSideMenu: isWideLayout,
    className: isWideLayout ? SESSION_REPLAY_PLAYER_WIDE_CLASS_NAME : undefined,
  };
}
