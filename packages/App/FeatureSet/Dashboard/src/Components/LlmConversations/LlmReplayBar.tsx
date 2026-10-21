import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import LlmConversationReplay from "Common/Utils/Telemetry/LlmConversationReplay";
import { LlmTranscriptStep } from "Common/Utils/Telemetry/LlmConversationTranscript";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ReplayButtonGroup,
  ReplayClock,
  ReplaySwitch,
  ReplayToolButton,
  ReplayToolbarDivider,
} from "../SessionReplay/ReplayUi";
import { LlmConversationReplayController } from "./useLlmConversationReplay";
import {
  LLM_REPLAY_MARKER_CLASS_NAMES,
  LlmReplayMarker,
  buildLlmReplayMarkers,
} from "./LlmReplayModel";
import { formatLlmClock } from "./LlmConversationFormat";

/*
 * The replay's transport, pinned to the bottom of the conversation while it
 * scrolls: play, step back and forward through the messages, start over or
 * jump to the end, the speed, "Skip waiting", and a scrubber whose dots are
 * the messages - indigo for the person, violet for the AI, cyan for tools,
 * red where something went wrong.
 *
 * It borrows session replay's controls (SessionReplay/ReplayUi) so the two
 * players look and work alike. The scrubber is a slider: focused, its arrow
 * keys step through the messages and Home / End go to either end.
 */

export interface ComponentProps {
  controller: LlmConversationReplayController;
  steps: ReadonlyArray<LlmTranscriptStep>;
}

const LlmReplayBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const controller: LlmConversationReplayController = props.controller;
  const trackRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const markers: Array<LlmReplayMarker> = useMemo(() => {
    return buildLlmReplayMarkers(props.steps, controller.timeline);
  }, [props.steps, controller.timeline]);

  const progress: number = LlmConversationReplay.progress(
    controller.timeline,
    controller.clockMs,
  );

  const seekFromPointer: (clientX: number) => void = (
    clientX: number,
  ): void => {
    const track: HTMLDivElement | null = trackRef.current;

    if (!track) {
      return;
    }

    const rect: DOMRect = track.getBoundingClientRect();

    if (rect.width <= 0) {
      return;
    }

    controller.pause();
    controller.seekToProgress((clientX - rect.left) / rect.width);
  };

  const total: number = props.steps.length;
  const position: number = controller.isAtEnd
    ? total
    : Math.max(0, controller.currentIndex + 1);

  /*
   * "Replay" at the end: a conversation opens fully drawn, and the first
   * press starts it over from the first message.
   */
  const playLabel: string =
    (controller.isPlaying
      ? translator.translateText("Pause")
      : controller.isAtEnd
        ? translator.translateText("Replay")
        : translator.translateText("Play")) || "";

  const positionText: string = translator.translateTemplate(
    "Message {{position}} of {{total}}",
    { position: position, total: total },
  );

  return (
    <div
      className="sticky bottom-3 z-10 mt-6 rounded-xl bg-white px-3 py-2.5 shadow-lg ring-1 ring-gray-200 sm:px-4"
      data-testid="llm-replay-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={controller.togglePlay}
          disabled={total === 0}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-indigo-600 pl-3 pr-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="llm-replay-play"
          data-state={controller.isPlaying ? "playing" : "paused"}
          title={translator.translateText("Play or pause (K)") || ""}
        >
          <Icon
            icon={controller.isPlaying ? IconProp.Pause : IconProp.Play}
            className="h-4 w-4"
          />
          <span>{playLabel}</span>
        </button>

        <ReplayButtonGroup ariaLabel="Move through the conversation">
          <ReplayToolButton
            icon={IconProp.Backward}
            title="First message"
            variant="segment"
            isDisabled={total === 0 || controller.clockMs <= 0}
            dataTestId="llm-replay-restart"
            onClick={() => {
              controller.pause();
              controller.restart();
            }}
          />
          <ReplayToolButton
            icon={IconProp.ChevronLeft}
            title="Previous message (J)"
            variant="segment"
            isDisabled={total === 0 || controller.clockMs <= 0}
            dataTestId="llm-replay-previous"
            onClick={() => {
              controller.pause();
              controller.previous();
            }}
          />
          <ReplayToolButton
            icon={IconProp.ChevronRight}
            title="Next message (L)"
            variant="segment"
            isDisabled={total === 0 || controller.isAtEnd}
            dataTestId="llm-replay-next"
            onClick={() => {
              controller.pause();
              controller.next();
            }}
          />
          <ReplayToolButton
            icon={IconProp.Forward}
            title="Whole conversation"
            variant="segment"
            isDisabled={total === 0 || controller.isAtEnd}
            dataTestId="llm-replay-end"
            onClick={controller.goToEnd}
          />
        </ReplayButtonGroup>

        <ReplayClock
          currentText={formatLlmClock(controller.clockMs)}
          totalText={formatLlmClock(controller.timeline.durationMs)}
          dataTestId="llm-replay-clock"
        />

        <div className="max-sm:hidden items-center gap-2 sm:flex">
          <ReplayToolbarDivider />

          <ReplayToolButton
            label={`${controller.speed}x`}
            title="Playback speed"
            dataTestId="llm-replay-speed"
            onClick={controller.cycleSpeed}
          />

          <ReplaySwitch
            isChecked={controller.skipWaiting}
            label={translator.translateText("Skip waiting") || ""}
            title={
              translator.translateText(
                "Shorten long pauses between messages while replaying",
              ) || ""
            }
            dataTestId="llm-replay-skip-waiting"
            onChange={controller.setSkipWaiting}
          />
        </div>

        <div
          className="ml-auto text-xs text-gray-500"
          data-testid="llm-replay-position"
        >
          {positionText}
        </div>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={total > 0 ? 0 : -1}
        aria-label={translator.translateText("Replay position") || ""}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={position}
        aria-valuetext={positionText}
        className="relative mt-2 h-6 cursor-pointer touch-none select-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        data-testid="llm-replay-scrubber"
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          if (total === 0) {
            return;
          }

          if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            controller.pause();
            controller.previous();
          } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            controller.pause();
            controller.next();
          } else if (event.key === "Home") {
            event.preventDefault();
            controller.pause();
            controller.restart();
          } else if (event.key === "End") {
            event.preventDefault();
            controller.goToEnd();
          }
        }}
        onPointerDown={(event: React.PointerEvent<HTMLDivElement>) => {
          if (total === 0) {
            return;
          }

          setIsDragging(true);
          event.currentTarget.setPointerCapture?.(event.pointerId);
          seekFromPointer(event.clientX);
        }}
        onPointerMove={(event: React.PointerEvent<HTMLDivElement>) => {
          if (isDragging) {
            seekFromPointer(event.clientX);
          }
        }}
        onPointerUp={(event: React.PointerEvent<HTMLDivElement>) => {
          setIsDragging(false);
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => {
          setIsDragging(false);
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-200" />
        <div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-indigo-500"
          style={{ width: `${progress * 100}%` }}
          data-testid="llm-replay-progress"
        />
        {markers.map((marker: LlmReplayMarker) => {
          return (
            <div
              key={marker.index}
              className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${LLM_REPLAY_MARKER_CLASS_NAMES[marker.tone]} ${
                marker.index > controller.currentIndex ? "opacity-40" : ""
              }`}
              style={{ left: `${marker.position * 100}%` }}
              data-testid="llm-replay-marker"
              data-tone={marker.tone}
              aria-hidden="true"
            />
          );
        })}
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-2 ring-indigo-500"
          style={{ left: `${progress * 100}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
};

export default LlmReplayBar;
