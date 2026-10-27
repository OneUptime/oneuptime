import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import KeyboardShortcutsModal from "Common/UI/Components/KeyboardShortcut/KeyboardShortcutsModal";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import { hasOpenModalDialog } from "Common/UI/Utils/GlobalKeyboardShortcut";
import { isPageRightToLeft } from "Common/UI/Utils/PageLanguage";
import { usePageScrollLock } from "Common/UI/Utils/PageScrollLock";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardViewer from "../DashboardView";
import { PlaylistEntry } from "./PlaylistDashboards";
import { getPlaylistTurnElapsedMs } from "./PlaylistPlayback";
import PlaylistPlayerBar, { PlaylistPlayerBarTurn } from "./PlaylistPlayerBar";
import {
  PlaylistPlayerKeyAction,
  PlaylistPlayerShortcut,
  PlaylistPlayerShortcutGroup,
  getPlaylistPlayerKeyAction,
  getPlaylistPlayerShortcutGroups,
} from "./PlaylistPlayerKeys";
import { PlaylistPlayerStatus, PlaylistRound } from "./PlaylistPlayerState";
import { readPlaylistRound } from "./PlaylistRead";
import {
  PageFullScreen,
  usePageFullScreen,
  useScreenWakeLock,
} from "./PlaylistScreen";
import usePlaylistPlayer, {
  PlaylistClock,
  PlaylistPlayer as PlaylistPlayerControls,
  PlaylistRoundReader,
  SYSTEM_PLAYLIST_CLOCK,
} from "./UsePlaylistPlayer";

/*
 * A playlist played on a screen (issue #5235): its dashboards one after
 * another, each for the playlist's interval, round and round - over the
 * whole window, above the Dashboard's own header and menus, the way a NOC
 * wall shows it. Full screen hides the browser too.
 *
 * Each dashboard is shown as its editors saved it (DashboardViewer's
 * isPlayback): its own default time range, auto-refresh and variables, read
 * only. The next one is drawn out of sight ahead of its turn, so when the
 * turn comes it is already there - the screen never goes blank between two
 * dashboards. Only dashboards the viewer may read are played; the playlist
 * is read again in each round's last turn, so a change to it reaches the
 * screen within a round (PlaylistPlayerState).
 *
 * The keys (PlaylistPlayerKeys): Space pauses, the arrows go back and on, F
 * is full screen, Escape leaves, ? lists them.
 */

export const PLAYLIST_PLAYER_TEST_ID: string = "playlist-player";

export interface ComponentProps {
  playlistId: ObjectID;
  // Leaves the player: back to the playlist's page.
  onExit: () => void;
  // Where the empty player sends someone to add dashboards: the playlist's page.
  onOpenPlaylist: () => void;
  // Where a player whose playlist is gone sends someone: all playlists.
  onOpenPlaylists: () => void;
  // For tests: the time, a reader of the playlist, and a stand-in board.
  clock?: PlaylistClock | undefined;
  readRound?: PlaylistRoundReader | undefined;
  renderDashboard?: ((entry: PlaylistEntry) => ReactElement) | undefined;
}

const renderPlaylistDashboard: (entry: PlaylistEntry) => ReactElement = (
  entry: PlaylistEntry,
): ReactElement => {
  return (
    <DashboardViewer
      dashboardId={new ObjectID(entry.dashboardId)}
      isPlayback={true}
    />
  );
};

const PlaylistPlayer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const clock: PlaylistClock = props.clock || SYSTEM_PLAYLIST_CLOCK;
  const playlistId: string = props.playlistId.toString();

  const readRound: PlaylistRoundReader =
    useCallback((): Promise<PlaylistRound | null> => {
      return props.readRound
        ? props.readRound()
        : readPlaylistRound(new ObjectID(playlistId));
    }, [playlistId, props.readRound]);

  const player: PlaylistPlayerControls = usePlaylistPlayer({
    readRound: readRound,
    clock: clock,
    getErrorMessage: (error: unknown): string => {
      return API.getFriendlyErrorMessage(error as Error);
    },
  });

  const fullScreen: PageFullScreen = usePageFullScreen();
  const [isShortcutsSheetOpen, setIsShortcutsSheetOpen] =
    useState<boolean>(false);

  /*
   * What the player says to a screen reader after a press of Previous or
   * Next: the dashboard it went to. The rotation itself goes on quietly.
   */
  const [announcement, setAnnouncement] = useState<string>("");
  const announceNextTurnRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const rootRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  // The page under the player stays still, and the screen stays on.
  usePageScrollLock(true);
  useScreenWakeLock(true);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const current: PlaylistEntry | null = player.current;

  useEffect(() => {
    if (!announceNextTurnRef.current || !current) {
      return;
    }

    announceNextTurnRef.current = false;
    setAnnouncement(current.name);
  }, [current?.key]);

  const goToNext: () => void = useCallback((): void => {
    announceNextTurnRef.current = true;
    player.next();
  }, [player.next]);

  const goToPrevious: () => void = useCallback((): void => {
    announceNextTurnRef.current = true;
    player.previous();
  }, [player.previous]);

  const exit: () => void = useCallback((): void => {
    fullScreen.exit();
    props.onExit();
  }, [fullScreen.exit, props.onExit]);

  // The latest handlers, for the one key listener the player keeps.
  const handlersRef: React.MutableRefObject<{
    next: () => void;
    previous: () => void;
    togglePause: () => void;
    toggleFullScreen: () => void;
    exit: () => void;
    showShortcuts: () => void;
  }> = useRef({
    next: goToNext,
    previous: goToPrevious,
    togglePause: player.togglePause,
    toggleFullScreen: fullScreen.toggle,
    exit: exit,
    showShortcuts: (): void => {
      setIsShortcutsSheetOpen(true);
    },
  });

  handlersRef.current = {
    next: goToNext,
    previous: goToPrevious,
    togglePause: player.togglePause,
    toggleFullScreen: fullScreen.toggle,
    exit: exit,
    showShortcuts: (): void => {
      setIsShortcutsSheetOpen(true);
    },
  };

  /*
   * On the window, before anything else hears it: the Dashboard's own "?"
   * sheet and its "g then a key" navigation stand down for a key the
   * player took (it is marked default-prevented).
   */
  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const action: PlaylistPlayerKeyAction | null = getPlaylistPlayerKeyAction(
        {
          event: event,
          isRightToLeft: isPageRightToLeft(),
          isDialogOpen: hasOpenModalDialog(document),
        },
      );

      if (!action) {
        return;
      }

      event.preventDefault();

      switch (action) {
        case PlaylistPlayerKeyAction.TogglePause:
          handlersRef.current.togglePause();
          break;
        case PlaylistPlayerKeyAction.Next:
          handlersRef.current.next();
          break;
        case PlaylistPlayerKeyAction.Previous:
          handlersRef.current.previous();
          break;
        case PlaylistPlayerKeyAction.ToggleFullScreen:
          handlersRef.current.toggleFullScreen();
          break;
        case PlaylistPlayerKeyAction.Exit:
          handlersRef.current.exit();
          break;
        case PlaylistPlayerKeyAction.ShowShortcuts:
          handlersRef.current.showShortcuts();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  const status: PlaylistPlayerStatus = player.state.status;
  const round: PlaylistRound | null = player.state.round;
  const playback: typeof player.state.playback = player.state.playback;
  const upcoming: PlaylistEntry | null = player.upcoming;
  const renderDashboard: (entry: PlaylistEntry) => ReactElement =
    props.renderDashboard || renderPlaylistDashboard;

  const turn: PlaylistPlayerBarTurn | null = playback
    ? {
        key: `${player.state.roundNumber}-${playback.index}-${playback.turnStartedAt}`,
        intervalMs: playback.intervalMs,
        elapsedMs: getPlaylistTurnElapsedMs(playback, clock.now()),
      }
    : null;

  /*
   * The dashboard on screen, then the one after it, out of sight. The one
   * on screen comes first, so the one that was next keeps its place - and
   * everything it has drawn - when its turn comes.
   */
  const boards: Array<{ entry: PlaylistEntry; isOnScreen: boolean }> = [];

  if (status === PlaylistPlayerStatus.Playing && current) {
    boards.push({ entry: current, isOnScreen: true });

    if (upcoming && upcoming.key !== current.key) {
      boards.push({ entry: upcoming, isOnScreen: false });
    }
  }

  const getMessage: () => ReactElement | null = (): ReactElement | null => {
    if (status === PlaylistPlayerStatus.Empty) {
      return (
        <EmptyState
          id="playlist-player-empty"
          icon={IconProp.QueueList}
          title="Nothing to show yet"
          description="This playlist has no dashboards you can see. Add dashboards to it, and they show here."
          paddingClassName="py-24"
          footer={
            <Button
              title="Open playlist"
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={props.onOpenPlaylist}
              dataTestId="playlist-player-open-playlist"
            />
          }
        />
      );
    }

    if (status === PlaylistPlayerStatus.NotFound) {
      return (
        <EmptyState
          id="playlist-player-not-found"
          icon={IconProp.QueueList}
          title="Playlist not found"
          description="This playlist was deleted, or you do not have access to it."
          paddingClassName="py-24"
          footer={
            <Button
              title="All playlists"
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={props.onOpenPlaylists}
              dataTestId="playlist-player-open-playlists"
            />
          }
        />
      );
    }

    if (status === PlaylistPlayerStatus.Error) {
      return (
        <EmptyState
          id="playlist-player-error"
          icon={IconProp.Alert}
          title="Could not load this playlist"
          description={
            player.state.errorMessage ||
            "Something went wrong. The player tries again in a minute."
          }
          paddingClassName="py-24"
          footer={
            <Button
              title="Try again"
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={player.readAgain}
              dataTestId="playlist-player-try-again"
            />
          }
        />
      );
    }

    return null;
  };

  const shortcutGroups: Array<PlaylistPlayerShortcutGroup> =
    getPlaylistPlayerShortcutGroups({ isRightToLeft: isPageRightToLeft() });

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="region"
      aria-label={translator.translateText("Playlist player")}
      className="fixed inset-0 z-40 flex flex-col overflow-hidden focus:outline-none"
      style={{ background: "var(--ou-background-primary, #f8f9fb)" }}
      data-testid={PLAYLIST_PLAYER_TEST_ID}
      data-status={status}
    >
      <PlaylistPlayerBar
        playlistName={round ? round.name : ""}
        current={current}
        upcoming={upcoming}
        position={playback && current ? playback.index + 1 : 0}
        count={playback ? playback.count : 0}
        isPaused={Boolean(playback && playback.isPaused)}
        turn={turn}
        isFullScreen={fullScreen.isFullScreen}
        canGoFullScreen={fullScreen.canGoFullScreen}
        onPrevious={goToPrevious}
        onTogglePause={player.togglePause}
        onNext={goToNext}
        onToggleFullScreen={fullScreen.toggle}
        onShowShortcuts={() => {
          setIsShortcutsSheetOpen(true);
        }}
        onExit={exit}
      />

      <main
        className="relative min-h-0 flex-1 overflow-auto"
        data-testid="playlist-player-stage"
      >
        {status === PlaylistPlayerStatus.Loading ? (
          <PageLoader isVisible={true} />
        ) : (
          <></>
        )}

        {boards.map((board: { entry: PlaylistEntry; isOnScreen: boolean }) => {
          return (
            <div
              key={board.entry.key}
              className={
                board.isOnScreen
                  ? "relative"
                  : "pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
              }
              aria-hidden={board.isOnScreen ? undefined : true}
              data-testid={
                board.isOnScreen
                  ? "playlist-player-on-screen"
                  : "playlist-player-up-next-board"
              }
              data-dashboard-id={board.entry.dashboardId}
            >
              {renderDashboard(board.entry)}
            </div>
          );
        })}

        {getMessage() || <></>}
      </main>

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {isShortcutsSheetOpen ? (
        <KeyboardShortcutsModal
          title="Keyboard shortcuts"
          description="These keys work while a playlist plays."
          groups={shortcutGroups.map((group: PlaylistPlayerShortcutGroup) => {
            return {
              id: group.id,
              title: translator.translateText(group.title) || "",
              shortcuts: group.shortcuts.map(
                (shortcut: PlaylistPlayerShortcut) => {
                  return {
                    id: shortcut.id,
                    keySequence: [shortcut.keys],
                    description:
                      translator.translateText(shortcut.description) || "",
                  };
                },
              ),
            };
          })}
          thenLabel={translator.translateText("then") || ""}
          closeButtonText="Close"
          onClose={() => {
            setIsShortcutsSheetOpen(false);
            rootRef.current?.focus({ preventScroll: true });
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default PlaylistPlayer;
