import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { PlaylistEntry } from "./PlaylistDashboards";

/*
 * The player's one bar (issue #5235), above the dashboard on screen: what
 * is on screen and where the rotation is - the dashboard's name, the
 * playlist's, "2 of 5" and what comes next - and the few controls a screen
 * needs: previous, pause or play, next, the keys, full screen and exit. A
 * line along its bottom fills while the dashboard has its turn.
 *
 * Laid out as the dashboard's own toolbar is (Toolbar/DashboardToolbar), so
 * a board in a playlist reads as the same board; on a phone its controls go
 * under the names instead of squeezing them.
 */

export const PLAYLIST_PLAYER_BAR_TEST_ID: string = "playlist-player-bar";

export interface PlaylistPlayerBarTurn {
  // Tells one turn's line from the next: a new one starts empty.
  key: string;
  intervalMs: number;
  // How much of the turn had passed when the line was drawn.
  elapsedMs: number;
}

export interface ComponentProps {
  playlistName: string;
  current: PlaylistEntry | null;
  upcoming: PlaylistEntry | null;
  // From 1; 0 while nothing is on screen.
  position: number;
  count: number;
  isPaused: boolean;
  turn: PlaylistPlayerBarTurn | null;
  isFullScreen: boolean;
  // Whether this browser can show the page full screen.
  canGoFullScreen: boolean;
  onPrevious: () => void;
  onTogglePause: () => void;
  onNext: () => void;
  onToggleFullScreen: () => void;
  onShowShortcuts: () => void;
  onExit: () => void;
}

interface PlayerButtonProps {
  icon: IconProp;
  // Translated: the button's name, and its tooltip.
  label: string;
  onClick: () => void;
  testId: string;
  isDisabled?: boolean | undefined;
  // The button to press next: Play, while the playlist is paused.
  isProminent?: boolean | undefined;
  className?: string | undefined;
}

const PlayerButton: FunctionComponent<PlayerButtonProps> = (
  props: PlayerButtonProps,
): ReactElement => {
  return (
    <button
      type="button"
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 ${
        props.isProminent
          ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"
          : "border-gray-200/60 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      } ${props.className || ""}`}
      onClick={props.onClick}
      disabled={props.isDisabled}
      title={props.label}
      aria-label={props.label}
      data-testid={props.testId}
    >
      <Icon icon={props.icon} className="h-4 w-4" />
    </button>
  );
};

/*
 * The line under the bar: it fills from the start side over the turn,
 * stops while the playlist is paused, and starts empty with each turn - it
 * is drawn again for each (its key). An animation in the shared stylesheet
 * (Theme.css, ou-playlist-turn), so it moves without a render every second.
 */
const TurnLine: FunctionComponent<{
  turn: PlaylistPlayerBarTurn;
  isPaused: boolean;
}> = (props: {
  turn: PlaylistPlayerBarTurn;
  isPaused: boolean;
}): ReactElement => {
  // Read once: a later render must not move the line it started.
  const [elapsedMs] = useState<number>(props.turn.elapsedMs);

  return (
    <div
      className={`ou-playlist-turn-progress h-full ${
        props.isPaused ? "bg-gray-300" : "bg-indigo-500"
      }`}
      style={{
        animationDuration: `${props.turn.intervalMs}ms`,
        animationDelay: `-${elapsedMs}ms`,
        animationPlayState: props.isPaused ? "paused" : "running",
      }}
      data-testid="playlist-player-turn-line"
      data-paused={props.isPaused ? "true" : "false"}
    />
  );
};

const PlaylistPlayerBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // A dashboard on screen. Without one - nothing to show, a failed read - the bar names the playlist alone.
  const isPlaying: boolean = Boolean(props.current) && props.position > 0;
  const hasRotation: boolean = props.count > 1;
  const upcoming: PlaylistEntry | null =
    props.upcoming && props.current && props.upcoming.key !== props.current.key
      ? props.upcoming
      : null;

  const title: string = props.current
    ? props.current.name || translator.translateText("Untitled dashboard") || ""
    : props.playlistName || translator.translateText("Playlist") || "";

  return (
    <header
      className="flex-none px-3 pt-3"
      data-testid={PLAYLIST_PLAYER_BAR_TEST_ID}
    >
      <div
        className="overflow-hidden rounded-2xl border border-gray-200/60 bg-white"
        style={{
          boxShadow:
            "var(--ou-card-shadow, 0 2px 8px -2px rgba(0, 0, 0, 0.08), 0 1px 4px -1px rgba(0, 0, 0, 0.04))",
        }}
      >
        {/*
         * On a phone the transport goes under the names, so a long name is
         * never squeezed to a few letters. With nothing playing there are
         * only Full screen and Exit, and they keep the name's line.
         */}
        <div
          className={`flex px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
            isPlaying
              ? "flex-col gap-2"
              : "flex-row items-center justify-between gap-4"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 max-sm:hidden">
              <Icon
                icon={IconProp.QueueList}
                className="h-4 w-4 text-indigo-500"
              />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1
                  className="truncate text-sm font-semibold text-gray-800"
                  data-testid="playlist-player-dashboard-name"
                >
                  <IsolatedText text={title} />
                </h1>
                {props.isPaused ? (
                  <span
                    className="inline-flex flex-shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700"
                    data-testid="playlist-player-paused"
                  >
                    {translator.translateText("Paused")}
                  </span>
                ) : (
                  <></>
                )}
              </div>
              {isPlaying ? (
                <p
                  className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-500"
                  data-testid="playlist-player-position"
                >
                  <span className="min-w-0 truncate">
                    <IsolatedText text={props.playlistName} />
                  </span>
                  {props.position > 0 ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="flex-none whitespace-nowrap">
                        {translator.translateTemplate(
                          "{{position}} of {{count}}",
                          {
                            position: translator.formatNumber(props.position),
                            count: translator.formatNumber(props.count),
                          },
                        )}
                      </span>
                    </>
                  ) : (
                    <></>
                  )}
                  {upcoming ? (
                    <>
                      <span aria-hidden="true" className="max-sm:hidden">
                        ·
                      </span>
                      <span
                        className="min-w-0 truncate max-sm:hidden"
                        data-testid="playlist-player-up-next"
                      >
                        <TranslatedSentence
                          template="Next: {{name}}"
                          slots={{
                            name: (
                              <IsolatedText
                                text={
                                  upcoming.name ||
                                  translator.translateText(
                                    "Untitled dashboard",
                                  ) ||
                                  ""
                                }
                              />
                            ),
                          }}
                        />
                      </span>
                    </>
                  ) : (
                    <></>
                  )}
                </p>
              ) : (
                <></>
              )}
            </div>
          </div>

          <div
            className={`flex flex-none items-center gap-1 sm:self-auto ${
              isPlaying ? "self-end" : ""
            }`}
            role="toolbar"
            aria-label={translator.translateText("Playlist controls")}
          >
            {isPlaying ? (
              <>
                <PlayerButton
                  icon={IconProp.ChevronLeft}
                  label={translator.translateText("Previous dashboard") || ""}
                  onClick={props.onPrevious}
                  isDisabled={!hasRotation}
                  testId="playlist-player-previous"
                />
                <PlayerButton
                  icon={props.isPaused ? IconProp.Play : IconProp.Pause}
                  label={
                    (props.isPaused
                      ? translator.translateText("Play")
                      : translator.translateText("Pause")) || ""
                  }
                  onClick={props.onTogglePause}
                  isProminent={props.isPaused}
                  testId="playlist-player-pause"
                />
                <PlayerButton
                  icon={IconProp.ChevronRight}
                  label={translator.translateText("Next dashboard") || ""}
                  onClick={props.onNext}
                  isDisabled={!hasRotation}
                  testId="playlist-player-next"
                />
                <div className="mx-1 h-5 w-px bg-gray-200" aria-hidden="true" />
                <PlayerButton
                  icon={IconProp.Keyboard}
                  label={translator.translateText("Keyboard shortcuts") || ""}
                  onClick={props.onShowShortcuts}
                  testId="playlist-player-shortcuts"
                  className="max-sm:hidden"
                />
              </>
            ) : (
              <></>
            )}
            {props.canGoFullScreen ? (
              <PlayerButton
                icon={props.isFullScreen ? IconProp.Collapse : IconProp.Expand}
                label={
                  (props.isFullScreen
                    ? translator.translateText("Exit full screen")
                    : translator.translateText("Full screen")) || ""
                }
                onClick={props.onToggleFullScreen}
                testId="playlist-player-full-screen"
              />
            ) : (
              <></>
            )}
            <PlayerButton
              icon={IconProp.Close}
              label={translator.translateText("Exit the player") || ""}
              onClick={props.onExit}
              testId="playlist-player-exit"
            />
          </div>
        </div>

        {isPlaying ? (
          <div className="h-1 w-full bg-gray-100" aria-hidden="true">
            {props.turn ? (
              <TurnLine
                key={props.turn.key}
                turn={props.turn}
                isPaused={props.isPaused}
              />
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    </header>
  );
};

export default PlaylistPlayerBar;
