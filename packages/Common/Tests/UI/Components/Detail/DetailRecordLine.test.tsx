import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import DetailRecordLine from "../../../../UI/Components/Detail/DetailRecordLine";
import {
  RecordTime,
  RecordTimeKind,
} from "../../../../UI/Components/Detail/DetailRecordTime";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";

/*
 * "Can you also show created along the same lines as ID so it doesn't take
 * space up top."
 *
 * The small line a details card ends with: the record's ID, then when it was
 * created and, where the card says, last updated. What a person sees on it,
 * hovers and reads, in their own time zone.
 */

const RECORD_ID: string = "dafafe92-41c3-4f0e-9a8b-2c7d5e1f3a60";
const CREATED: Date = new Date("2026-09-30T13:25:13.000Z");
const UPDATED: Date = new Date("2026-10-01T08:12:47.000Z");

const CREATED_TIME: RecordTime = {
  kind: RecordTimeKind.Created,
  date: CREATED,
};
const UPDATED_TIME: RecordTime = {
  kind: RecordTimeKind.Updated,
  date: UPDATED,
};

let previousTimezone: Timezone | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  previousTimezone = OneUptimeDate.getUserTimezone();
  OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  OneUptimeDate.setUserTimezone(previousTimezone);
  jest.restoreAllMocks();
});

function recordLine(): HTMLElement {
  return screen.getByTestId("detail-record-line");
}

function pieces(): Array<string> {
  return Array.from(recordLine().children).map((child: Element): string => {
    return child.getAttribute("data-testid") || child.tagName;
  });
}

async function hover(element: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(element);
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
}

describe("the record line", () => {
  test("reads ID, then Created, then Updated", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        times={[CREATED_TIME, UPDATED_TIME]}
      />,
    );

    expect(pieces()).toEqual([
      "detail-id-line",
      "detail-created-at",
      "detail-updated-at",
    ]);
    expect(recordLine()).toHaveTextContent(
      `ID${RECORD_ID}…CreatedSep 30 2026, 14:25 BSTUpdatedOct 01 2026, 09:12 BST`,
    );
  });

  test("the ID is the same ID line as before, copy button and all", () => {
    render(<DetailRecordLine recordId={RECORD_ID} times={[CREATED_TIME]} />);

    const idLine: HTMLElement = screen.getByTestId("detail-id-line");

    expect(within(idLine).getByTestId("detail-id-label")).toHaveTextContent(
      "ID",
    );
    expect(within(idLine).getByTestId("detail-id-value").textContent).toBe(
      RECORD_ID,
    );
    expect(
      within(idLine).getByRole("button", { name: "Copy ID to clipboard" }),
    ).toBeInTheDocument();
    // The time is not part of what the copy button copies.
    expect(idLine).not.toHaveTextContent("Created");
  });

  test("Created says so, with a clock, and the time the row it replaces showed", () => {
    render(<DetailRecordLine recordId={RECORD_ID} times={[CREATED_TIME]} />);

    const created: HTMLElement = screen.getByTestId("detail-created-at");

    expect(screen.getByTestId("detail-created-at-label")).toHaveTextContent(
      "Created",
    );
    expect(screen.getByTestId("detail-created-at-value")).toHaveTextContent(
      "Sep 30 2026, 14:25 BST",
    );
    // An icon of its own, as the ID has: each piece starts with one.
    expect(created.querySelectorAll("svg")).toHaveLength(1);
  });

  test("the time is a <time> a machine can read to the second", () => {
    render(<DetailRecordLine times={[CREATED_TIME, UPDATED_TIME]} />);

    const createdValue: HTMLElement = screen.getByTestId(
      "detail-created-at-value",
    );
    const updatedValue: HTMLElement = screen.getByTestId(
      "detail-updated-at-value",
    );

    expect(createdValue.tagName).toBe("TIME");
    expect(createdValue).toHaveAttribute(
      "datetime",
      "2026-09-30T13:25:13.000Z",
    );
    expect(updatedValue.tagName).toBe("TIME");
    expect(updatedValue).toHaveAttribute(
      "datetime",
      "2026-10-01T08:12:47.000Z",
    );
  });

  test("hovering the time gives it to the second", async () => {
    render(<DetailRecordLine recordId={RECORD_ID} times={[CREATED_TIME]} />);

    await hover(screen.getByTestId("detail-created-at-value"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Sep 30 2026, 14:25:13 BST",
    );
  });

  test("Updated reads the same way, under its own word", async () => {
    render(<DetailRecordLine times={[UPDATED_TIME]} />);

    expect(screen.getByTestId("detail-updated-at-label")).toHaveTextContent(
      "Updated",
    );
    expect(screen.getByTestId("detail-updated-at-value")).toHaveTextContent(
      "Oct 01 2026, 09:12 BST",
    );

    await hover(screen.getByTestId("detail-updated-at-value"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Oct 01 2026, 09:12:47 BST",
    );
  });

  test("a card that shows Created but no ID gets a line with just Created", () => {
    render(<DetailRecordLine times={[CREATED_TIME]} />);

    expect(pieces()).toEqual(["detail-created-at"]);
    expect(screen.queryByTestId("detail-id-line")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a line with only the ID is the ID", () => {
    render(<DetailRecordLine recordId={RECORD_ID} />);

    expect(pieces()).toEqual(["detail-id-line"]);
    expect(screen.queryByTestId("detail-created-at")).toBeNull();
  });

  test("nothing on it is a field: no label element, no row", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        times={[CREATED_TIME, UPDATED_TIME]}
      />,
    );

    expect(recordLine().querySelector("label")).toBeNull();
    expect(recordLine().querySelector("[role='row']")).toBeNull();
  });
});

describe("the reader's time", () => {
  test("is in the time zone they picked", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    render(<DetailRecordLine times={[CREATED_TIME]} />);

    expect(screen.getByTestId("detail-created-at-value")).toHaveTextContent(
      "Sep 30 2026, 09:25 EDT",
    );
  });

  test("moves the date too when the zone crosses midnight", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    render(
      <DetailRecordLine
        times={[
          {
            kind: RecordTimeKind.Created,
            date: new Date("2026-09-30T23:45:00.000Z"),
          },
        ]}
      />,
    );

    expect(screen.getByTestId("detail-created-at-value")).toHaveTextContent(
      "Oct 01 2026, 05:15 IST",
    );
  });

  test("is on the clock they read", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    render(<DetailRecordLine times={[CREATED_TIME]} />);

    expect(screen.getByTestId("detail-created-at-value")).toHaveTextContent(
      "Sep 30 2026, 02:25 PM BST",
    );
  });
});

describe("on a narrow card", () => {
  test("the pieces wrap between each other, never inside one", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        times={[CREATED_TIME, UPDATED_TIME]}
      />,
    );

    // The line wraps its pieces, with room between them either way.
    expect(recordLine()).toHaveClass(
      "flex",
      "flex-wrap",
      "items-center",
      "gap-x-4",
      "gap-y-1.5",
      "min-w-0",
    );

    for (const testId of ["detail-created-at", "detail-updated-at"]) {
      const piece: HTMLElement = screen.getByTestId(testId);
      const word: HTMLElement = screen.getByTestId(`${testId}-label`)
        .parentElement as HTMLElement;

      // A piece is one unit that never grows wider than the line...
      expect(piece).toHaveClass("inline-flex", "min-w-0", "max-w-full");
      /*
       * ...whose icon and word stay together, and whose time can fall
       * under them only on a card too narrow for the piece itself.
       */
      expect(piece).toHaveClass("flex-wrap");
      expect(word).toHaveClass("shrink-0", "inline-flex");
      expect(word).toContainElement(piece.querySelector("svg"));
    }
  });

  test("is set small and quiet, like the ID", () => {
    render(<DetailRecordLine recordId={RECORD_ID} times={[CREATED_TIME]} />);

    expect(recordLine()).toHaveClass("text-xs", "text-gray-500");
    expect(screen.getByTestId("detail-created-at")).toHaveClass(
      "text-xs",
      "text-gray-500",
    );
    expect(screen.getByTestId("detail-created-at-value")).toHaveClass(
      "text-gray-600",
    );
    expect(
      screen.getByTestId("detail-created-at").querySelector("svg"),
    ).toHaveClass("h-3.5", "w-3.5", "text-gray-400");
  });

  test("takes the spacing its card asks for", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        times={[CREATED_TIME]}
        className="mt-3 border-t border-gray-100 pt-3"
      />,
    );

    expect(recordLine()).toHaveClass(
      "mt-3",
      "border-t",
      "border-gray-100",
      "pt-3",
    );
    // The ID inside does not draw a second divider.
    expect(screen.getByTestId("detail-id-line")).not.toHaveClass("border-t");
  });
});
