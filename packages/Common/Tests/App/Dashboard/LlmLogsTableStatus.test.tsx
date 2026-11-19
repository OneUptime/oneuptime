import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * Issue #6495: an AI log a daily AI limit refused said "Budget Exceeded" in
 * its status pill - the word issue #6440 took out of OneUptime AI, for a
 * limit a project sets on purpose - and one the AI credits refused said
 * "Insufficient Balance". Both were the stored value, drawn as it is, in
 * English in every language. The stored values stay (the logs already
 * written, the API); the pill and the Status filter say them in the
 * product's words, in the reader's language: "Daily Limit Reached", "AI
 * Credits Used Up". The filter still finds each log by what it stores.
 *
 * The table itself is captured, not rendered: its columns are under test.
 */
const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import LlmLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AILogs/LlmLogsTable";
import {
  getLlmLogStatusColor,
  getLlmLogStatusFilterOptions,
  getLlmLogStatusLabel,
  hasLlmLogStatusMessage,
  LLM_LOG_STATUS_LABELS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AILogs/LlmLogStatusWords";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import LlmLogStatus from "../../../Types/LlmLogStatus";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import FieldType from "../../../UI/Components/Types/FieldType";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

interface StatusColumn {
  title: string;
  getElement: (item: LlmLog) => ReactElement;
}

interface StatusFilter {
  title: string;
  type: FieldType;
  filterDropdownOptions?: Array<DropdownOption> | undefined;
}

interface ActionButton {
  title: string;
  isVisible: (item: LlmLog) => boolean;
}

function tableProps(): Record<string, unknown> {
  render(<LlmLogsTable />);

  return mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
}

function statusColumn(): StatusColumn {
  const column: StatusColumn | undefined = (
    (tableProps()["columns"] || []) as Array<StatusColumn>
  ).find((candidate: StatusColumn): boolean => {
    return candidate.title === "Status";
  });

  expect(column).toBeDefined();

  return column!;
}

function logWith(status: string): LlmLog {
  const log: LlmLog = new LlmLog();
  log.status = status as LlmLogStatus;
  return log;
}

afterEach(() => {
  cleanup();
  mockCapturedTableProps.length = 0;
});

describe("an AI log's status, in the product's words", () => {
  test("the stored values stay as they are", () => {
    expect(LlmLogStatus.BudgetExceeded).toBe("Budget Exceeded");
    expect(LlmLogStatus.InsufficientBalance).toBe("Insufficient Balance");
  });

  test.each([
    [LlmLogStatus.BudgetExceeded, "Daily Limit Reached"],
    [LlmLogStatus.InsufficientBalance, "AI Credits Used Up"],
    [LlmLogStatus.Success, "Success"],
    [LlmLogStatus.Error, "Error"],
  ])("a log that stores %s says %s", (status: string, words: string) => {
    expect(getLlmLogStatusLabel(status)).toBe(words);

    render(statusColumn().getElement(logWith(status)));

    expect(screen.getByTestId("pill-text")).toHaveTextContent(
      new RegExp(`^${words}$`),
    );
  });

  test("a refused call keeps its yellow pill; a failed one stays red", () => {
    expect(getLlmLogStatusColor(LlmLogStatus.BudgetExceeded)).toBe(Yellow);
    expect(getLlmLogStatusColor(LlmLogStatus.InsufficientBalance)).toBe(Yellow);
    expect(getLlmLogStatusColor(LlmLogStatus.Error)).toBe(Red);
    expect(getLlmLogStatusColor(LlmLogStatus.Success)).toBe(Green);
  });

  test("a status this Dashboard does not know is drawn as stored", () => {
    expect(getLlmLogStatusLabel("Something New")).toBe("Something New");
  });

  test("no pill says budget", () => {
    for (const status of Object.values(LlmLogStatus)) {
      render(statusColumn().getElement(logWith(status)));
    }

    expect(document.body.textContent).not.toMatch(/budget/i);
  });

  test("the Status message is offered for each status that did not go through", () => {
    const viewError: ActionButton | undefined = (
      (tableProps()["actionButtons"] || []) as Array<ActionButton>
    ).find((button: ActionButton): boolean => {
      return button.title === "View Error";
    });

    expect(viewError).toBeDefined();
    for (const status of [
      LlmLogStatus.Error,
      LlmLogStatus.InsufficientBalance,
      LlmLogStatus.BudgetExceeded,
    ]) {
      expect(viewError!.isVisible(logWith(status))).toBe(true);
      expect(hasLlmLogStatusMessage(status)).toBe(true);
    }
    expect(viewError!.isVisible(logWith(LlmLogStatus.Success))).toBe(false);
  });
});

describe("the Status filter finds a log by what it stores, in the words its pill says", () => {
  test("a dropdown of every status, labelled as its pill, valued as stored", () => {
    const filter: StatusFilter | undefined = (
      (tableProps()["filters"] || []) as Array<StatusFilter>
    ).find((candidate: StatusFilter): boolean => {
      return candidate.title === "Status";
    });

    expect(filter?.type).toBe(FieldType.Dropdown);
    expect(filter?.filterDropdownOptions).toEqual(
      getLlmLogStatusFilterOptions(),
    );
    expect(getLlmLogStatusFilterOptions()).toEqual([
      { label: "Success", value: "Success" },
      { label: "Error", value: "Error" },
      { label: "AI Credits Used Up", value: "Insufficient Balance" },
      { label: "Daily Limit Reached", value: "Budget Exceeded" },
    ]);
  });
});

describe("the statuses in every Dashboard language", () => {
  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each status its own way",
    (language: string) => {
      const unworded: Array<string> = Object.values(
        LLM_LOG_STATUS_LABELS,
      ).filter((key: string): boolean => {
        return !isWordedInDashboardLocale(key, language);
      });

      expect(unworded).toEqual([]);
    },
  );

  test("German draws the daily limit's pill in German, never the stored English", () => {
    const de: Record<string, string> = readDashboardLocale("de");
    const label: string = dashboardTranslator("de").translateText(
      getLlmLogStatusLabel(LlmLogStatus.BudgetExceeded),
    ) as string;

    expect(label).toBe(de["Daily Limit Reached"]);
    expect(label).not.toBe("Budget Exceeded");
    expect(label).not.toBe("Daily Limit Reached");
  });
});
