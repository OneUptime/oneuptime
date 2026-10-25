import EventStateTrack, {
  EventStateTrackState,
  getEventStateTrackColumns,
  getEventStateTrackStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStateTrack";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Color from "../../../Types/Color";

/*
 * The track under an event header's title: every state of the record's list
 * in order, each over a segment, the segments filled in the current state's
 * colour up to and including it. It replaced a row of dots so faint it read
 * as the card's footer.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          if (key === "Created") {
            return "Erstellt";
          }

          if (key === "State progress") {
            return "Statusverlauf";
          }

          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

const RED: Color = new Color("#ef4444");
const AMBER: Color = new Color("#f59e0b");
const GREEN: Color = new Color("#10b981");

const STATES: Array<EventStateTrackState> = [
  { id: "created", name: "Created", color: RED },
  { id: "acknowledged", name: "Acknowledged", color: AMBER },
  { id: "resolved", name: "Resolved", color: GREEN },
];

function steps(): Array<HTMLElement> {
  return Array.from(
    screen.getByTestId("event-state-track").querySelectorAll("li"),
  );
}

function segments(): Array<HTMLElement> {
  return screen.getAllByTestId("event-state-track-segment");
}

afterEach(() => {
  cleanup();
});

describe("getEventStateTrackStep", () => {
  test("is reached before the current state, current at it, upcoming after it", () => {
    expect(getEventStateTrackStep(0, 1)).toBe("reached");
    expect(getEventStateTrackStep(1, 1)).toBe("current");
    expect(getEventStateTrackStep(2, 1)).toBe("upcoming");
  });

  test("marks every state upcoming when the current one is not in the list", () => {
    expect(getEventStateTrackStep(0, -1)).toBe("upcoming");
    expect(getEventStateTrackStep(5, -1)).toBe("upcoming");
  });
});

describe("EventStateTrack", () => {
  test("is a list named for what it shows, one item per state, in order", () => {
    render(<EventStateTrack states={STATES} currentStateId="acknowledged" />);

    const track: HTMLElement = screen.getByRole("list", {
      name: "Statusverlauf",
    });

    expect(track.tagName).toBe("OL");
    expect(
      steps().map((step: HTMLElement): string => {
        return step.textContent || "";
      }),
    ).toEqual(["Erstellt", "Acknowledged", "Resolved"]);
  });

  test("marks the current state as the step a screen reader hears", () => {
    render(<EventStateTrack states={STATES} currentStateId="acknowledged" />);

    expect(
      steps().map((step: HTMLElement): string | null => {
        return step.getAttribute("aria-current");
      }),
    ).toEqual([null, "step", null]);
  });

  test("fills every segment up to the current state in that state's colour", () => {
    render(<EventStateTrack states={STATES} currentStateId="acknowledged" />);

    expect(segments()[0]).toHaveStyle({ backgroundColor: "#f59e0b" });
    expect(segments()[1]).toHaveStyle({ backgroundColor: "#f59e0b" });
    expect(segments()[2]!.style.backgroundColor).toBe("");
    expect(segments()[2]).toHaveClass("bg-gray-200");
  });

  test("a resolved record is a full track in the resolved colour", () => {
    render(<EventStateTrack states={STATES} currentStateId="resolved" />);

    for (const segment of segments()) {
      expect(segment).toHaveStyle({ backgroundColor: "#10b981" });
      expect(segment).not.toHaveClass("bg-gray-200");
    }
  });

  test("a new record fills only its first segment", () => {
    render(<EventStateTrack states={STATES} currentStateId="created" />);

    expect(segments()[0]).toHaveStyle({ backgroundColor: "#ef4444" });
    expect(segments()[1]).toHaveClass("bg-gray-200");
    expect(segments()[2]).toHaveClass("bg-gray-200");
  });

  test("draws the current name strongest, the reached ones quieter and the upcoming ones quietest - each readable", () => {
    render(<EventStateTrack states={STATES} currentStateId="acknowledged" />);

    const labels: Array<HTMLElement> = steps().map(
      (step: HTMLElement): HTMLElement => {
        return step.querySelector("span[title]") as HTMLElement;
      },
    );

    expect(labels[0]).toHaveClass("font-medium", "text-gray-600");
    expect(labels[1]).toHaveClass("font-semibold", "text-gray-900");
    // gray-500 on white is 4.8:1; the old rail's gray-400 was 2.5:1.
    expect(labels[2]).toHaveClass("font-medium", "text-gray-500");
    for (const label of labels) {
      expect(label).toHaveClass("text-xs", "truncate");
      expect(label).not.toHaveClass("text-gray-400");
    }
  });

  test("gives every state an equal share of the width, the current one at least its name's", () => {
    render(
      <EventStateTrack
        states={[
          ...STATES,
          { id: "postmortem", name: "Postmortem done", color: GREEN },
        ]}
        currentStateId="acknowledged"
      />,
    );

    // jsdom does not read min-content, so the style is read as written.
    expect(
      screen.getByTestId("event-state-track").getAttribute("style"),
    ).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(min-content, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
    );
  });

  test("its columns: equal shares, and the current state's grows to hold its name", () => {
    expect(getEventStateTrackColumns(3, 0)).toBe(
      "minmax(min-content, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
    );
    expect(getEventStateTrackColumns(3, 2)).toBe(
      "minmax(0, 1fr) minmax(0, 1fr) minmax(min-content, 1fr)",
    );
    // A state that is not in the list: every share is equal.
    expect(getEventStateTrackColumns(2, -1)).toBe(
      "minmax(0, 1fr) minmax(0, 1fr)",
    );
    // An empty list still draws one column.
    expect(getEventStateTrackColumns(0, -1)).toBe("minmax(0, 1fr)");
  });

  test("the current state's name takes at most half the header, so the others keep a share", () => {
    render(<EventStateTrack states={STATES} currentStateId="acknowledged" />);

    const labels: Array<HTMLElement> = steps().map(
      (step: HTMLElement): HTMLElement => {
        return step.querySelector("span[title]") as HTMLElement;
      },
    );

    expect(labels[1]).toHaveClass("max-w-[50cqw]", "truncate");
    expect(labels[0]).not.toHaveClass("max-w-[50cqw]");
    expect(labels[2]).not.toHaveClass("max-w-[50cqw]");
  });

  test("names each state in full under the pointer, so a cut name can still be read", () => {
    render(
      <EventStateTrack
        states={[
          STATES[0]!,
          {
            id: "verifying",
            name: "Waiting for the customer to verify the fix in production",
            color: AMBER,
          },
        ]}
        currentStateId="verifying"
      />,
    );

    expect(
      screen.getByTitle(
        "Waiting for the customer to verify the fix in production",
      ),
    ).toHaveClass("truncate");
  });

  test("its segments are decoration: the names say it", () => {
    render(<EventStateTrack states={STATES} currentStateId="acknowledged" />);

    for (const segment of segments()) {
      expect(segment).toHaveAttribute("aria-hidden", "true");
      expect(segment).toHaveTextContent("");
    }
  });

  test("a state with no colour fills its segments in black rather than nothing", () => {
    render(
      <EventStateTrack
        states={[
          { id: "a", name: "Open", color: undefined as unknown as Color },
          { id: "b", name: "Closed", color: GREEN },
        ]}
        currentStateId="a"
      />,
    );

    expect(segments()[0]).toHaveStyle({ backgroundColor: "#000000" });
  });
});
