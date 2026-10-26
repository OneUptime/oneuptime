import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import RuleLibraryTable from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryTable";
import {
  LibraryRuleView,
  getLibraryRuleViews,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryUtil";

/*
 * The Rule Library's Data and Severity below lg
 * (Column.hideBelowLargeScreen). Beside the Security Events side menu at
 * 768px the card is 478px wide, and Rule, Data, Severity and Add needed
 * 566px: Add ran under the sticky last column until about 860px, and in
 * German at 900px, where Data is as wide as Anmeldeereignisse. Below lg
 * the severity and the events go under the rule's name, as on a phone's
 * card, and a row is the rule and its Add.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

const VIEWS: Array<LibraryRuleView> = getLibraryRuleViews({
  category: "",
  search: "",
  existingRules: [],
}).slice(0, 3);

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function renderTable(width: number): Promise<void> {
  setViewportWidth(width);

  render(
    <RuleLibraryTable
      views={VIEWS}
      isLoading={false}
      error=""
      onRetry={(): void => {}}
      emptyState={undefined}
      addingIds={[]}
      canAdd={true}
      getProblem={(): undefined => {
        return undefined;
      }}
      isProblemAlert={false}
      problemKey={0}
      onOpen={(): void => {}}
      onAdd={(): void => {}}
    />,
  );

  await act(async () => {
    await Promise.resolve();
  });
}

function headerTitles(): Array<string> {
  return screen
    .queryAllByRole("columnheader")
    .map((header: HTMLElement): string => {
      return (header.textContent || "").trim();
    })
    .filter(Boolean);
}

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

describe("the Rule Library's data and severity", () => {
  test("there are rules to draw", () => {
    expect(VIEWS.length).toBe(3);
  });

  test("from lg up each is a column of its own, and not under the name", async () => {
    for (const width of [1024, 1280]) {
      await renderTable(width);

      expect([width, headerTitles()]).toEqual([
        width,
        ["Rule", "Data", "Severity", "Actions"],
      ]);
      for (const view of VIEWS) {
        expect(
          screen.getByTestId(`rule-library-severity-${view.entry.id}`),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId(`rule-library-data-${view.entry.id}`),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId(`rule-library-card-facts-${view.entry.id}`),
        ).toBeNull();
      }
      cleanup();
    }
  });

  test("below lg they go under the rule's name, and a row is the rule and its Add", async () => {
    // What the Data column says of each rule from lg up.
    await renderTable(1280);
    const dataWords: Record<string, string> = {};
    for (const view of VIEWS) {
      dataWords[view.entry.id] = (
        screen.getByTestId(`rule-library-data-${view.entry.id}`).textContent ||
        ""
      ).trim();
      expect(dataWords[view.entry.id]).toBeTruthy();
    }
    cleanup();

    for (const width of [1023, 900, 768]) {
      await renderTable(width);

      expect([width, headerTitles()]).toEqual([width, ["Rule", "Actions"]]);

      for (const view of VIEWS) {
        const rule: HTMLElement = screen.getByTestId(
          `rule-library-rule-${view.entry.id}`,
        );
        const facts: HTMLElement = within(rule).getByTestId(
          `rule-library-card-facts-${view.entry.id}`,
        );

        // The events it reads, as the Data column says them.
        expect(facts).toHaveTextContent(dataWords[view.entry.id]!);
        expect(
          screen.queryByTestId(`rule-library-severity-${view.entry.id}`),
        ).toBeNull();
        expect(
          screen.queryByTestId(`rule-library-data-${view.entry.id}`),
        ).toBeNull();
        // Still a table's row, its Add at its end.
        expect(rule.closest("tr")).not.toBeNull();
        expect(
          within(rule.closest("tr") as HTMLElement).getByTestId(
            `rule-library-add-${view.entry.id}`,
          ),
        ).toBeInTheDocument();
      }

      cleanup();
    }
  });

  test("on a phone's card the severity and the events go under the name, as before", async () => {
    await renderTable(390);

    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
    for (const view of VIEWS) {
      const rule: HTMLElement = screen.getByTestId(
        `rule-library-rule-${view.entry.id}`,
      );

      expect(
        within(rule).getByTestId(`rule-library-card-facts-${view.entry.id}`),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(`rule-library-data-${view.entry.id}`),
      ).toBeNull();
    }
  });
});
