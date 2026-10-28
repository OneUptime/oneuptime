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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A security case's response targets on screen.
 *
 *   - The duration field on Response Targets' Edit: a whole number and its
 *     unit. A saved target opens in the largest unit it fills whole, an
 *     empty one says "No target" in the unit the field starts in, and the
 *     form gets minutes, null for none, or what it must refuse.
 *   - The case header's chip: the target the case works against now and
 *     how long is left, or how far past it, grey, amber or red, when it is
 *     due on hover; nothing once the targets are met. It counts down on its
 *     own, every half minute.
 *   - The lists' Due cell and the line under a row's priority: the same,
 *     shorter; a dash in the Due cell when nothing is due.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import ResponseTargetDurationField from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/ResponseTargetDurationField";
import { ResponseTargetUnit } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/ResponseTargetDuration";
import { RESPONSE_TARGETS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/ResponseTargetsCopy";
import SecurityCaseTargetChip, {
  SECURITY_CASE_TARGET_REFRESH_MS,
  SecurityCaseDueCell,
  SecurityCaseDueLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/SecurityCaseTargetChip";
import { SecurityCaseTargetCase } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/SecurityCaseTargetDisplay";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import OneUptimeDate from "../../../Types/Date";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { SecurityCaseTargetState } from "../../../Utils/SecurityCase/SecurityCaseTargets";
import {
  buildDefaultTestPrioritiesWithTargets,
  testPriorityId,
} from "../../Helpers/SecurityCaseValues";

const OPENED: Date = new Date("2026-10-14T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const PRIORITIES: Array<SecurityCasePriority> =
  buildDefaultTestPrioritiesWithTargets();

function at(minutes: number): Date {
  return new Date(OPENED.getTime() + minutes * MINUTE);
}

let now: Date;

function criticalCase(
  overrides: Partial<SecurityCaseTargetCase> = {},
): SecurityCaseTargetCase {
  return {
    securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.Critical),
    createdAt: OPENED,
    acknowledgeDueAt: at(15),
    containDueAt: at(240),
    ...overrides,
  };
}

beforeEach(() => {
  now = at(5);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return now;
  });
  jest
    .spyOn(OneUptimeDate, "getDateAsUserFriendlyLocalFormattedString")
    .mockImplementation((date: string | Date): string => {
      return `at ${typeof date === "string" ? date : date.toISOString()}`;
    });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the response target field", () => {
  function amount(): HTMLInputElement {
    return within(
      screen.getByTestId(RESPONSE_TARGETS_TEST_IDS.durationField),
    ).getByRole("spinbutton") as HTMLInputElement;
  }

  test("a saved target opens in the largest unit it fills whole", () => {
    render(
      <ResponseTargetDurationField initialMinutes={240} onChange={() => {}} />,
    );

    expect(amount()).toHaveValue(4);
    expect(
      screen.getByTestId(RESPONSE_TARGETS_TEST_IDS.durationField),
    ).toHaveTextContent("Hours");
  });

  test("an empty one says No target, in the unit the field starts in", () => {
    render(
      <ResponseTargetDurationField
        initialMinutes={null}
        emptyUnit={ResponseTargetUnit.Minutes}
        onChange={() => {}}
      />,
    );

    expect(amount()).toHaveValue(null);
    expect(amount()).toHaveAttribute("placeholder", "No target");
    expect(
      screen.getByTestId(RESPONSE_TARGETS_TEST_IDS.durationField),
    ).toHaveTextContent("Minutes");
  });

  test("the form gets minutes, null when emptied, and what it must refuse as it was typed", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ResponseTargetDurationField
        initialMinutes={null}
        emptyUnit={ResponseTargetUnit.Minutes}
        onChange={onChange}
      />,
    );

    fireEvent.change(amount(), { target: { value: "15" } });
    expect(onChange).toHaveBeenLastCalledWith(15);

    fireEvent.change(amount(), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.change(amount(), { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith({
      amount: "0",
      unit: ResponseTargetUnit.Minutes,
    });
  });

  test("a new unit turns the amount into its minutes", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ResponseTargetDurationField initialMinutes={120} onChange={onChange} />,
    );

    // "2" "Hours", then Days.
    const unit: HTMLElement = within(
      screen.getByTestId(RESPONSE_TARGETS_TEST_IDS.durationField),
    ).getByRole("combobox");

    fireEvent.keyDown(unit, { key: "ArrowDown", code: "ArrowDown" });
    await act(async () => {
      fireEvent.click(await screen.findByText("Days"));
    });

    expect(onChange).toHaveBeenLastCalledWith(2 * 24 * 60);
  });

  test("its own label names the amount when the form does not", () => {
    render(<ResponseTargetDurationField onChange={() => {}} />);

    expect(amount()).toHaveAttribute("aria-label", "Amount");
  });
});

describe("the case header's chip", () => {
  function chip(): HTMLElement {
    return screen.getByTestId(RESPONSE_TARGETS_TEST_IDS.chip);
  }

  test("the target now and how long is left, in grey", () => {
    render(
      <SecurityCaseTargetChip
        securityCase={criticalCase()}
        priorities={PRIORITIES}
      />,
    );

    expect(chip()).toHaveAttribute("data-target", "Acknowledge");
    expect(chip()).toHaveAttribute(
      "data-state",
      SecurityCaseTargetState.OnTrack,
    );
    expect(chip()).toHaveTextContent("Acknowledge in 10 min");
  });

  test("past its due time: how far, in red", () => {
    now = at(20);
    render(
      <SecurityCaseTargetChip
        securityCase={criticalCase()}
        priorities={PRIORITIES}
      />,
    );

    expect(chip()).toHaveAttribute(
      "data-state",
      SecurityCaseTargetState.Missed,
    );
    expect(chip()).toHaveTextContent("Acknowledge overdue by 5 min");
  });

  test("counts down on its own, and turns amber in the target's last fifth", () => {
    jest.useFakeTimers();
    render(
      <SecurityCaseTargetChip
        securityCase={criticalCase()}
        priorities={PRIORITIES}
      />,
    );

    expect(chip()).toHaveAttribute(
      "data-state",
      SecurityCaseTargetState.OnTrack,
    );

    now = at(13);
    act(() => {
      jest.advanceTimersByTime(SECURITY_CASE_TARGET_REFRESH_MS);
    });

    expect(chip()).toHaveAttribute(
      "data-state",
      SecurityCaseTargetState.AtRisk,
    );
    expect(chip()).toHaveTextContent("Acknowledge in 2 min");
  });

  test("nothing once every target is met", () => {
    render(
      <SecurityCaseTargetChip
        securityCase={criticalCase({
          acknowledgedAt: at(2),
          containedAt: at(3),
        })}
        priorities={PRIORITIES}
      />,
    );

    expect(screen.queryByTestId(RESPONSE_TARGETS_TEST_IDS.chip)).toBeNull();
  });
});

describe("the case lists", () => {
  test("the Due cell: when, then which target; a dash when nothing is due", () => {
    now = at(100);
    render(
      <SecurityCaseDueCell
        securityCase={criticalCase({ acknowledgedAt: at(1) })}
        priorities={PRIORITIES}
      />,
    );

    const cell: HTMLElement = screen.getByTestId(
      RESPONSE_TARGETS_TEST_IDS.dueCell,
    );
    expect(cell).toHaveTextContent("in 2 h 20 min");
    expect(cell).toHaveTextContent("Contain");
    // When it is due, on hover.
    expect(cell).toHaveAttribute("title", `Due at ${at(240).toISOString()}`);
    cleanup();

    now = at(300);
    const { rerender } = render(
      <SecurityCaseDueCell
        securityCase={criticalCase({ acknowledgedAt: at(1) })}
        priorities={PRIORITIES}
      />,
    );
    expect(
      screen.getByTestId(RESPONSE_TARGETS_TEST_IDS.dueCell),
    ).toHaveTextContent("1 h overdue");

    rerender(
      <SecurityCaseDueCell
        securityCase={criticalCase({
          acknowledgedAt: at(1),
          containedAt: at(2),
        })}
        priorities={PRIORITIES}
      />,
    );
    expect(screen.queryByTestId(RESPONSE_TARGETS_TEST_IDS.dueCell)).toBeNull();
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  test("the line under a row's priority says the same as the chip, and nothing when nothing is due", () => {
    const { rerender } = render(
      <SecurityCaseDueLine
        securityCase={criticalCase()}
        priorities={PRIORITIES}
      />,
    );

    expect(
      screen.getByTestId(RESPONSE_TARGETS_TEST_IDS.dueLine),
    ).toHaveTextContent("Acknowledge in 10 min");

    rerender(
      <SecurityCaseDueLine
        securityCase={criticalCase({
          acknowledgeDueAt: null,
          containDueAt: null,
        })}
        priorities={PRIORITIES}
      />,
    );
    expect(screen.queryByTestId(RESPONSE_TARGETS_TEST_IDS.dueLine)).toBeNull();
  });
});
