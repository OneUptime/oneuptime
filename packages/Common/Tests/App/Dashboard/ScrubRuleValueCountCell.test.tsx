import ScrubRuleValueCountCell from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleCounts/ScrubRuleValueCountCell";
import {
  NO_SERVICE,
  NO_VALUES_CHANGED,
  NO_VERSION,
  SERVICE_NOT_NAMED,
  VALUES_NOT_COUNTED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleCounts/ScrubRuleCountWords";
import {
  ScrubRuleValueCountOfRule,
  ScrubRuleValueCountOfService,
} from "../../../Types/Telemetry/ScrubRuleValueCounts";
import { INLINE_VALUE_SKELETON_TEST_ID } from "../../../UI/Components/Skeleton/InlineValueSkeleton";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * HOW MANY VALUES A SCRUB RULE CHANGED, IN ITS ROW (#10366), in each state
 * the counts are in.
 *
 * While the counts were read the cell drew a hyphen of its own, in a grey
 * of its own - the mark an empty value leaves, though nothing was known
 * yet, and nothing a screen reader could say (HandWrittenEmptyValueGuard).
 * It draws the shape of the value that comes now, announced as loading, as
 * the cells that read their own data do (Docs/ux/README.md#loading). In the
 * By Service dialog, a version whose last change is not known draws the
 * quiet dash, where its cell was blank.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

afterEach(() => {
  cleanup();
});

const RULE_ID: string = "6f0f2a52-3b8e-4c1d-9a51-7c2b0f6c1d10";
const SERVICE_ID: string = "1d4e5f60-7a8b-4c9d-8e1f-2a3b4c5d6e7f";

function service(
  overrides: Partial<ScrubRuleValueCountOfService>,
): ScrubRuleValueCountOfService {
  return {
    serviceId: SERVICE_ID,
    serviceName: "checkout",
    serviceVersion: "2.4.1",
    valueCount: 10,
    lastChangedAt: "2026-11-23T10:00:00.000Z",
    ...overrides,
  };
}

function countOf(
  services: Array<ScrubRuleValueCountOfService>,
): ScrubRuleValueCountOfRule {
  return {
    scrubRuleId: RULE_ID,
    valueCount: services.reduce(
      (total: number, each: ScrubRuleValueCountOfService): number => {
        return total + each.valueCount;
      },
      0,
    ),
    lastChangedAt: "2026-11-23T10:00:00.000Z",
    services,
  };
}

function cellOf(props: {
  isChecked: boolean | undefined;
  count?: ScrubRuleValueCountOfRule | undefined;
}): void {
  render(
    <ScrubRuleValueCountCell
      ruleName="Hide card numbers"
      isChecked={props.isChecked}
      count={props.count}
      dataTestId="values-changed"
    />,
  );
}

describe("a scrub rule's Values Changed cell", () => {
  test("while the counts are read, draws the shape of the value that comes, announced as loading, never a dash", () => {
    cellOf({ isChecked: undefined, count: undefined });

    expect(screen.getByTestId(INLINE_VALUE_SKELETON_TEST_ID)).toBeVisible();
    expect(screen.getByRole("status", { name: "Loading" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    // Not the mark an empty value leaves, nor a hyphen of its own.
    expect(screen.queryByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeNull();
    expect(screen.queryByText("-")).toBeNull();
    expect(screen.queryByText(NO_VALUES_CHANGED)).toBeNull();
    expect(screen.queryByText(VALUES_NOT_COUNTED)).toBeNull();
  });

  test("when the counts could not be read, says so, and nothing loads", () => {
    cellOf({ isChecked: false, count: undefined });

    expect(screen.getByText(VALUES_NOT_COUNTED)).toBeVisible();
    expect(screen.queryByTestId(INLINE_VALUE_SKELETON_TEST_ID)).toBeNull();
  });

  test("a rule that changed nothing in the days counted says so in words", () => {
    cellOf({ isChecked: true, count: undefined });
    expect(screen.getByTestId("values-changed")).toHaveTextContent(
      NO_VALUES_CHANGED,
    );
    cleanup();

    cellOf({ isChecked: true, count: countOf([]) });
    expect(screen.getByTestId("values-changed")).toHaveTextContent(
      NO_VALUES_CHANGED,
    );
    expect(screen.queryByTestId(INLINE_VALUE_SKELETON_TEST_ID)).toBeNull();
  });

  test("a rule that changed values shows how many, and opens which services and versions sent them", () => {
    cellOf({
      isChecked: true,
      count: countOf([
        service({ valueCount: 1200 }),
        service({ serviceName: "", serviceVersion: "", valueCount: 30 }),
        service({ serviceId: "", serviceName: "", valueCount: 4 }),
      ]),
    });

    const cell: HTMLElement = screen.getByTestId("values-changed");
    expect(cell).toHaveTextContent((1234).toLocaleString());

    fireEvent.click(within(cell).getByRole("button", { name: "By Service" }));

    const dialog: HTMLElement = screen.getByRole("dialog");
    const rows: Array<HTMLElement> = within(dialog).getAllByRole("row");

    // A heading row, then a row for each version.
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("checkout");
    expect(rows[1]).toHaveTextContent("2.4.1");
    expect(rows[2]).toHaveTextContent(SERVICE_NOT_NAMED);
    expect(rows[2]).toHaveTextContent(NO_VERSION);
    expect(rows[3]).toHaveTextContent(NO_SERVICE);
  });

  test("in the dialog, a version whose last change is not known draws the quiet dash, and a known one its time", () => {
    cellOf({
      isChecked: true,
      count: countOf([
        service({ serviceVersion: "2.4.1" }),
        service({ serviceVersion: "2.4.0", lastChangedAt: "" }),
        service({ serviceVersion: "2.3.9", lastChangedAt: "not a date" }),
      ]),
    });

    fireEvent.click(screen.getByRole("button", { name: "By Service" }));

    const rows: Array<HTMLElement> = within(
      screen.getByRole("dialog"),
    ).getAllByRole("row");
    const lastChangedOf: (row: HTMLElement) => HTMLElement = (
      row: HTMLElement,
    ): HTMLElement => {
      const cells: Array<HTMLElement> = within(row).getAllByRole("cell");
      return cells[cells.length - 1]!;
    };

    expect(
      within(lastChangedOf(rows[1]!)).queryByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).toBeNull();
    expect(lastChangedOf(rows[1]!).textContent?.trim()).not.toBe("");

    for (const row of [rows[2]!, rows[3]!]) {
      const lastChanged: HTMLElement = lastChangedOf(row);

      expect(
        within(lastChanged).getByTestId(TABLE_EMPTY_VALUE_TEST_ID),
      ).toBeVisible();
      // Read out as "Not set", never as a bare hyphen.
      expect(lastChanged).toHaveTextContent("Not set");
    }
  });
});
