import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslateValue from "Common/UI/Utils/Translation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface EventStateTrackState {
  id: string;
  name: string;
  color: Color;
}

export interface ComponentProps {
  // The states the record walks down, in their order.
  states: Array<EventStateTrackState>;
  currentStateId?: string | undefined;
}

export type EventStateTrackStep = "reached" | "current" | "upcoming";

// Where a state stands against the current one; nothing is reached when the current state is not in the list.
export function getEventStateTrackStep(
  index: number,
  currentIndex: number,
): EventStateTrackStep {
  if (currentIndex < 0 || index > currentIndex) {
    return "upcoming";
  }

  return index === currentIndex ? "current" : "reached";
}

// A state's segment of the track, under its name.
export const EVENT_STATE_TRACK_SEGMENT_CLASS_NAME: string =
  "mt-1.5 block h-1 rounded-full";

const LABEL_CLASS_NAMES: Record<EventStateTrackStep, string> = {
  // At most half the header (a size container), so its share never crowds the others out.
  current: "max-w-[50cqw] font-semibold text-gray-900",
  reached: "font-medium text-gray-600",
  upcoming: "font-medium text-gray-500",
};

/*
 * The track's columns: an equal share each, and the current state's at
 * least as wide as its name - so the name the reader most needs is never
 * cut ("زمان‌بندی‌شده", Scheduled, is wider than a quarter of a phone's
 * header) - while the others share what is left, each cut if it must be.
 */
export function getEventStateTrackColumns(
  count: number,
  currentIndex: number,
): string {
  return Array.from(
    { length: Math.max(1, count) },
    (_value: unknown, index: number): string => {
      return index === currentIndex
        ? "minmax(min-content, 1fr)"
        : "minmax(0, 1fr)";
    },
  ).join(" ");
}

/*
 * Where the record stands on its way through its states, as one track under
 * the title: every state of its list in order, each over a segment, the
 * segments filled in the current state's colour up to and including it.
 * Read at a glance - how far along, and what comes next - and by a screen
 * reader as a list whose current step says so.
 *
 * Every state shares the width equally, so the track reads as progress
 * however long the names are - but the current state's share grows to hold
 * its name, up to half the header. Another name longer than its share (a
 * project's own long state on a phone) is cut, whole under the pointer.
 */
const EventStateTrack: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();

  const currentIndex: number = props.states.findIndex(
    (state: EventStateTrackState): boolean => {
      return state.id === props.currentStateId;
    },
  );
  const currentColor: string = (
    props.states[currentIndex]?.color || Black
  ).toString();

  return (
    <ol
      aria-label={translator.translateText("State progress")}
      data-testid="event-state-track"
      className="grid gap-1.5"
      style={{
        gridTemplateColumns: getEventStateTrackColumns(
          props.states.length,
          currentIndex,
        ),
      }}
    >
      {props.states.map(
        (state: EventStateTrackState, index: number): ReactElement => {
          const step: EventStateTrackStep = getEventStateTrackStep(
            index,
            currentIndex,
          );
          // A project's own state reads as named; a default one in the reader's words.
          const name: string = translateString(state.name) || state.name;

          return (
            <li
              key={`${state.id}-${index}`}
              className="min-w-0"
              data-step={step}
              aria-current={step === "current" ? "step" : undefined}
            >
              <span
                className={`block truncate text-xs ${LABEL_CLASS_NAMES[step]}`}
                title={name}
              >
                {name}
              </span>
              {/*
               * 4px: a line to read the progress by, quieter than the
               * header's main button, whatever the state's colour.
               */}
              <span
                aria-hidden="true"
                data-testid="event-state-track-segment"
                className={`${EVENT_STATE_TRACK_SEGMENT_CLASS_NAME} ${
                  step === "upcoming" ? "bg-gray-200" : ""
                }`}
                style={
                  step === "upcoming"
                    ? undefined
                    : { backgroundColor: currentColor }
                }
              />
            </li>
          );
        },
      )}
    </ol>
  );
};

export default EventStateTrack;
