import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import ExpandableText from "../../../UI/Components/ExpandableText/ExpandableText";
import IpAddressList from "../../../UI/Components/IpAddressList/IpAddressList";
import OsVersionDisplay from "../../../UI/Components/OsVersionDisplay/OsVersionDisplay";
import CustomFieldFileList from "../../../UI/Components/CustomFields/CustomFieldFileList";
import { PLACEHOLDER_TEXT_CLASS_NAME } from "../../../UI/Components/Detail/PlaceholderText";
import RecurringViewElement from "../../../UI/Components/Events/RecurringViewElement";
import RecurringArrayViewElement from "../../../UI/Components/Events/RecurringArrayViewElement";
import StateTimelineDuration from "../../../UI/Components/StateTimeline/StateTimelineDuration";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import {
  EMPTY_VALUE_MARK,
  isDashText,
} from "../../../UI/Components/Detail/EmptyValue";

/*
 * THE SHARED COMPONENTS DRAW THE QUIET DASH FOR A VALUE THAT IS NOT THERE
 * (#7603).
 *
 * ExpandableText, IpAddressList and OsVersionDisplay - the Hosts list's
 * description, addresses and operating system - drew a grey hyphen of their
 * own (`<span className="text-gray-400">-</span>`), in a different grey and
 * size from the quiet dash in the next cell, with nothing for a screen
 * reader to hear. So did a custom field's empty file list, a recurring
 * event's empty interval and a timeline row with no duration. Each draws
 * TableEmptyValue now: light grey, on the row's line, "Not set".
 */

afterEach(() => {
  cleanup();
});

// The marks drawn outside the quiet dash: a hyphen of a component's own.
function ownDashesOf(container: HTMLElement): Array<string> {
  const clone: HTMLElement = container.cloneNode(true) as HTMLElement;

  for (const quiet of Array.from(
    clone.querySelectorAll(`[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
  )) {
    quiet.remove();
  }

  return Array.from(clone.querySelectorAll("*"))
    .filter((node: Element): boolean => {
      return node.children.length === 0 && isDashText(node.textContent || "");
    })
    .map((node: Element): string => {
      return node.textContent || "";
    });
}

function expectQuietDash(element: ReactElement): HTMLElement {
  const { container } = render(element);

  expect(
    container.querySelectorAll(`[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
  ).toHaveLength(1);
  expect(container.textContent).toBe(`${EMPTY_VALUE_MARK}Not set`);
  expect(ownDashesOf(container)).toEqual([]);

  return container;
}

function expectNoQuietDash(element: ReactElement): HTMLElement {
  const { container } = render(element);

  expect(
    container.querySelector(`[data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
  ).toBeNull();

  return container;
}

describe("ExpandableText", () => {
  test.each([[""], ["-"]])("no text (%j) is the quiet dash", (text: string) => {
    expectQuietDash(<ExpandableText text={text} />);
  });

  test("text is drawn as it is", () => {
    expect(
      expectNoQuietDash(<ExpandableText text="Primary database host" />)
        .textContent,
    ).toBe("Primary database host");
  });
});

describe("IpAddressList", () => {
  test.each([[""], [" , ,"]])(
    "no address (%j) is the quiet dash",
    (text: string) => {
      expectQuietDash(<IpAddressList text={text} />);
    },
  );

  test("an address is drawn", () => {
    expect(
      expectNoQuietDash(<IpAddressList text="10.0.0.4" />).textContent,
    ).toContain("10.0.0.4");
  });
});

describe("OsVersionDisplay", () => {
  test.each([[""], ["   "], ["-"]])(
    "no version (%j) is the quiet dash",
    (text: string) => {
      expectQuietDash(<OsVersionDisplay text={text} />);
    },
  );

  test("a version is drawn", () => {
    expect(
      expectNoQuietDash(<OsVersionDisplay text="Ubuntu 24.04 LTS" />)
        .textContent,
    ).toContain("Ubuntu 24.04 LTS");
  });
});

describe("CustomFieldFileList", () => {
  test.each([[undefined], [""], ["-"], ["—"]])(
    "no file and no words of its own (%j) is the quiet dash, under the field's test id",
    (emptyText: string | undefined) => {
      const container: HTMLElement = expectQuietDash(
        <CustomFieldFileList
          files={[]}
          emptyText={emptyText}
          dataTestId="no-files"
        />,
      );

      expect(
        container.querySelector(
          `[data-testid="no-files"] [data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`,
        ),
      ).not.toBeNull();
    },
  );

  test("no file with words of its own draws the words, as a card's placeholder", () => {
    const container: HTMLElement = expectNoQuietDash(
      <CustomFieldFileList
        files={[]}
        emptyText="No data entered"
        dataTestId="no-files"
      />,
    );

    const words: HTMLElement = container.querySelector(
      '[data-testid="no-files"]',
    ) as HTMLElement;

    expect(words).toHaveTextContent("No data entered");
    expect(words.className).toBe(PLACEHOLDER_TEXT_CLASS_NAME);
  });
});

describe("a recurring event's interval", () => {
  test("no interval is the quiet dash", () => {
    expectQuietDash(<RecurringViewElement value={undefined} />);
  });

  test("no intervals is the quiet dash", () => {
    expectQuietDash(<RecurringArrayViewElement value={undefined} />);
  });

  test("an empty list of intervals is the quiet dash, or the list's own words", () => {
    const empty: HTMLElement = expectQuietDash(
      <RecurringArrayViewElement value={[]} />,
    );

    // Drawn in the list's own line, which holds nothing but the dash.
    expect(
      empty.querySelector(`p > [data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`),
    ).not.toBeNull();
    cleanup();

    expect(
      expectNoQuietDash(
        <RecurringArrayViewElement value={[]} noItemsMessage="Never" />,
      ).textContent,
    ).toBe("Never");
  });
});

describe("a timeline row's duration", () => {
  test("a row with no start is the quiet dash, under the duration's test id", () => {
    const container: HTMLElement = expectQuietDash(
      <StateTimelineDuration startDate={undefined} endDate={undefined} />,
    );

    expect(
      container.querySelector(
        `[data-testid="state-timeline-duration"] [data-testid="${TABLE_EMPTY_VALUE_TEST_ID}"]`,
      ),
    ).not.toBeNull();
  });
});

describe("the check can fail", () => {
  test("a hand-written grey hyphen is a dash of the component's own", () => {
    const { container } = render(
      <span className="text-sm text-gray-400">-</span>,
    );

    expect(ownDashesOf(container)).toEqual(["-"]);
  });
});
