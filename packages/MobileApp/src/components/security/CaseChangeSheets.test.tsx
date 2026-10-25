import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { CaseValueSheet, CloseCaseSheet } from "./CaseChangeSheets";
import { ThemeProvider, darkColors, lightColors } from "../../theme";
import {
  getCaseValueChoices,
  type CaseValueChoice,
} from "../../security/caseValues";
import {
  SECURITY_PRIORITY_IDS,
  SECURITY_STATUS_IDS,
  makeSecurityCasePriorities,
  makeSecurityCaseStatuses,
} from "../../__tests__/testSupport";
import type {
  SecurityCasePriorityItem,
  SecurityCaseStatusItem,
} from "../../api/types";

/*
 * The sheets a case is changed in from the phone: Change Status and Change
 * Priority, which change the case at once - the one it has marked Current,
 * archived ones left out unless it has one - and Close Case, which asks what
 * the case turned out to be, starting from OneUptime AI's read when it has
 * one, before anything is written.
 */

let mockColorScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

beforeEach(() => {
  mockColorScheme = "light";
});

type RenderedElement = ReturnType<typeof screen.getByTestId>;

function isChecked(element: RenderedElement): boolean | undefined {
  return (element.props.accessibilityState as { checked?: boolean } | undefined)
    ?.checked;
}

function isDisabled(element: RenderedElement): boolean | undefined {
  return (
    element.props.accessibilityState as { disabled?: boolean } | undefined
  )?.disabled;
}

const STATUSES: Array<SecurityCaseStatusItem> = [
  ...makeSecurityCaseStatuses(),
  {
    _id: "5717a7e5-00aa-4000-8000-0000000000aa",
    name: "Retired",
    order: 2.5,
    isArchived: true,
  },
];

function statusSheet(
  props: Partial<React.ComponentProps<typeof CaseValueSheet>> = {},
): React.JSX.Element {
  return (
    <CaseValueSheet
      visible
      kind="status"
      caseNumber="CASE-142"
      choices={
        getCaseValueChoices(
          STATUSES,
          SECURITY_STATUS_IDS.investigating,
        ) as Array<CaseValueChoice<SecurityCaseStatusItem>>
      }
      onPick={jest.fn()}
      onClose={jest.fn()}
      {...props}
    />
  );
}

describe("Change status", () => {
  test("asks for the new status of the case, by its number", async () => {
    await render(statusSheet());

    expect(screen.getByRole("header", { name: "Change status" })).toBeTruthy();
    expect(screen.getByText("Pick the new status for CASE-142.")).toBeTruthy();
  });

  test("offers the project's statuses in its order, without the archived one", async () => {
    await render(statusSheet());

    expect(
      screen.getAllByRole("radio").map((element: RenderedElement) => {
        return element.props.accessibilityLabel as string;
      }),
    ).toEqual(["New", "Investigating, Current", "Contained", "Closed"]);
  });

  test("the case's own status is marked Current and checked", async () => {
    await render(statusSheet());

    const current: RenderedElement = screen.getByTestId(
      `case-status-option-${SECURITY_STATUS_IDS.investigating}`,
    );
    expect(isChecked(current)).toBe(true);
    expect(screen.getByText("Current")).toBeTruthy();
  });

  test("a case in an archived status sees it, marked Archived", async () => {
    await render(
      statusSheet({
        choices: getCaseValueChoices(
          STATUSES,
          "5717a7e5-00aa-4000-8000-0000000000aa",
        ) as Array<CaseValueChoice<SecurityCaseStatusItem>>,
      }),
    );

    expect(screen.getByText("Retired")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
  });

  test("picking another status hands it over at once", async () => {
    const onPick: jest.Mock = jest.fn();
    await render(statusSheet({ onPick }));

    await fireEvent.press(
      screen.getByTestId(`case-status-option-${SECURITY_STATUS_IDS.contained}`),
    );

    expect(onPick).toHaveBeenCalledTimes(1);
    expect((onPick.mock.calls[0]![0] as SecurityCaseStatusItem)._id).toBe(
      SECURITY_STATUS_IDS.contained,
    );
  });

  test("picking the status it has already changes nothing", async () => {
    const onPick: jest.Mock = jest.fn();
    await render(statusSheet({ onPick }));

    await fireEvent.press(
      screen.getByTestId(
        `case-status-option-${SECURITY_STATUS_IDS.investigating}`,
      ),
    );

    expect(onPick).not.toHaveBeenCalled();
  });

  test("Cancel, and a tap outside, close it", async () => {
    const onClose: jest.Mock = jest.fn();
    await render(statusSheet({ onClose }));

    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    await fireEvent.press(
      screen.getByTestId("case-status-sheet-dismiss-area", {
        includeHiddenElements: true,
      }),
    );

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("nothing is drawn while it is closed", async () => {
    await render(statusSheet({ visible: false }));

    expect(screen.queryByTestId("case-status-sheet")).toBeNull();
  });
});

describe("Change priority", () => {
  const priorities: Array<SecurityCasePriorityItem> =
    makeSecurityCasePriorities();

  test("offers the priorities most urgent first, OneUptime AI's suggestion marked", async () => {
    await render(
      <CaseValueSheet
        visible
        kind="priority"
        caseNumber="CASE-142"
        choices={
          getCaseValueChoices(
            priorities,
            SECURITY_PRIORITY_IDS.medium,
          ) as Array<CaseValueChoice<SecurityCasePriorityItem>>
        }
        suggestedId={SECURITY_PRIORITY_IDS.high}
        onPick={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("header", { name: "Change priority" }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("radio").map((element: RenderedElement) => {
        return element.props.accessibilityLabel as string;
      }),
    ).toEqual([
      "Critical",
      "High, Suggested by OneUptime AI",
      "Medium, Current",
      "Low",
      "Informational",
    ]);
  });

  test("a suggestion the case already has is only Current", async () => {
    await render(
      <CaseValueSheet
        visible
        kind="priority"
        caseNumber="CASE-142"
        choices={
          getCaseValueChoices(priorities, SECURITY_PRIORITY_IDS.high) as Array<
            CaseValueChoice<SecurityCasePriorityItem>
          >
        }
        suggestedId={SECURITY_PRIORITY_IDS.high}
        onPick={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByText("Suggested by OneUptime AI")).toBeNull();
  });
});

function closeSheet(
  props: Partial<React.ComponentProps<typeof CloseCaseSheet>> = {},
): React.JSX.Element {
  return (
    <CloseCaseSheet
      visible
      caseNumber="CASE-142"
      statusName="Closed"
      submitting={false}
      onSubmit={jest.fn()}
      onClose={jest.fn()}
      {...props}
    />
  );
}

describe("Close case", () => {
  test("says where the case goes, and asks what it turned out to be", async () => {
    await render(closeSheet());

    expect(screen.getByRole("header", { name: "Close CASE-142" })).toBeTruthy();
    expect(
      screen.getByText("It moves to Closed. Pick what it turned out to be."),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("radio").map((element: RenderedElement) => {
        return element.props.accessibilityLabel as string;
      }),
    ).toEqual([
      "True Positive",
      "Benign Positive",
      "False Positive",
      "Undetermined",
    ]);
    expect(
      screen.getByText("Malicious or unauthorized activity really happened."),
    ).toBeTruthy();
  });

  test("without a suggestion nothing is picked, and it cannot close yet", async () => {
    const onSubmit: jest.Mock = jest.fn();
    await render(closeSheet({ onSubmit }));

    for (const radio of screen.getAllByRole("radio")) {
      expect(isChecked(radio)).toBe(false);
    }
    expect(isDisabled(screen.getByTestId("close-case-submit"))).toBe(true);

    await fireEvent.press(screen.getByTestId("close-case-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("OneUptime AI's read picks its verdict to start with, marked as its", async () => {
    await render(closeSheet({ suggestedVerdict: "False Positive" }));

    expect(
      isChecked(screen.getByTestId("close-case-verdict-False Positive")),
    ).toBe(true);
    expect(
      screen.getByRole("radio", {
        name: "False Positive, Suggested by OneUptime AI",
      }),
    ).toBeTruthy();
    expect(isDisabled(screen.getByTestId("close-case-submit"))).toBe(false);
  });

  test("the verdict picked and the note, trimmed, are what it closes with", async () => {
    const onSubmit: jest.Mock = jest.fn();
    await render(closeSheet({ onSubmit, suggestedVerdict: "True Positive" }));

    await fireEvent.press(
      screen.getByTestId("close-case-verdict-Benign Positive"),
    );
    await fireEvent.changeText(
      screen.getByTestId("close-case-note"),
      "  Our own red team.  ",
    );
    await fireEvent.press(screen.getByTestId("close-case-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      verdict: "Benign Positive",
      closingNote: "Our own red team.",
    });
  });

  test("a note being written keeps the sheet open on a stray tap outside", async () => {
    const onClose: jest.Mock = jest.fn();
    await render(closeSheet({ onClose }));

    await fireEvent.changeText(
      screen.getByTestId("close-case-note"),
      "Half a thought",
    );
    await fireEvent.press(
      screen.getByTestId("close-case-sheet-dismiss-area", {
        includeHiddenElements: true,
      }),
    );
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("close-case-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("while it closes, nothing can be changed or cancelled", async () => {
    const onClose: jest.Mock = jest.fn();
    const onSubmit: jest.Mock = jest.fn();
    await render(
      closeSheet({
        onClose,
        onSubmit,
        submitting: true,
        suggestedVerdict: "True Positive",
      }),
    );

    expect(isDisabled(screen.getByTestId("close-case-cancel"))).toBe(true);
    expect(
      isDisabled(screen.getByTestId("close-case-verdict-False Positive")),
    ).toBe(true);
    await fireEvent.press(
      screen.getByTestId("close-case-sheet-dismiss-area", {
        includeHiddenElements: true,
      }),
    );
    await fireEvent.press(screen.getByTestId("close-case-submit"));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("opened again, it starts from the suggestion and an empty note", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      closeSheet({ suggestedVerdict: "True Positive" }),
    );
    await fireEvent.press(
      screen.getByTestId("close-case-verdict-Undetermined"),
    );
    await fireEvent.changeText(screen.getByTestId("close-case-note"), "Draft");

    await view.rerender(
      closeSheet({ visible: false, suggestedVerdict: "True Positive" }),
    );
    await view.rerender(closeSheet({ suggestedVerdict: "True Positive" }));

    expect(
      isChecked(screen.getByTestId("close-case-verdict-True Positive")),
    ).toBe(true);
    expect(screen.getByTestId("close-case-note").props.value).toBe("");
  });

  test("the sheet follows dark mode", async () => {
    mockColorScheme = "dark";

    await render(
      <ThemeProvider>
        {closeSheet({ suggestedVerdict: "True Positive" })}
      </ThemeProvider>,
    );

    expect(screen.getByTestId("close-case-sheet")).toHaveStyle({
      backgroundColor: darkColors.backgroundSecondary,
    });
    expect(screen.getByTestId("close-case-verdict-True Positive")).toHaveStyle({
      backgroundColor: darkColors.cardAccent,
    });
    expect(screen.getByTestId("close-case-sheet")).not.toHaveStyle({
      backgroundColor: lightColors.backgroundSecondary,
    });
  });
});
