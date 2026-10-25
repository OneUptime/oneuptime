import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import useTranslateValue from "Common/UI/Utils/Translation";
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

const LABEL_CLASS_NAMES: Record<EventStateTrackStep, string> = {
  current: "font-semibold text-gray-900",
  reached: "font-medium text-gray-600",
  upcoming: "font-medium text-gray-500",
};

/*
 * Where the record stands on its way through its states, as one track under
 * the title: every state of its list in order, each over a segment, the
 * segments filled in the current state's colour up to and including it.
 * Read at a glance - how far along, and what comes next - and by a screen
 * reader as a list whose current step says so.
 *
 * Every state shares the width equally, so the track reads as progress
 * however long the names are; a name longer than its share (a project's own
 * long state on a phone) is cut, whole under the pointer.
 */
const EventStateTrack: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

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
      aria-label={translateString("State progress") || "State progress"}
      data-testid="event-state-track"
      className="grid gap-1.5"
      style={{
        gridTemplateColumns: `repeat(${Math.max(1, props.states.length)}, minmax(0, 1fr))`,
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
              <span
                aria-hidden="true"
                data-testid="event-state-track-segment"
                className={`mt-1.5 block h-1.5 rounded-full ${
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
