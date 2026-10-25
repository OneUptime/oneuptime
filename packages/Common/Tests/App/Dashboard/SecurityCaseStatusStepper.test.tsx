import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * A case's status steps, laid out by the width they have. The case's header
 * sits beside its side menu, so a 768px window leaves the steps about 440px;
 * four to a row there, keyed to the window's breakpoints, broke
 * "Investigating" into "Investi" and "gating". Now the steps are a size
 * container of their own and every column count is keyed to it, a step
 * keeping at least 10rem whenever more than one share a row.
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

import SecurityCaseStatusStepper, {
  SECURITY_CASE_STEPS_CONTAINER_CLASS_NAME,
  getSecurityCaseStepsGridClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseStatusStepper";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  buildDefaultTestStatuses,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

const WHITESPACE: RegExp = /\s+/;
const VIEWPORT_VARIANT: RegExp = /^(sm|md|lg|xl|2xl):/;
const CONTAINER_COLUMNS: RegExp =
  /^\[@container\(min-width:(\d+(?:\.\d+)?)rem\)\]:grid-cols-(\d+)$/;

// Every project names its statuses as it likes, and has as many as it likes.
const STEP_COUNTS: Array<number> = [1, 2, 3, 4, 5, 6, 7, 8, 12];

function classesOf(className: string): Array<string> {
  return className.split(WHITESPACE).filter((name: string): boolean => {
    return name.length > 0;
  });
}

interface ContainerColumns {
  minWidthInRem: number;
  columns: number;
}

function containerColumnsOf(className: string): Array<ContainerColumns> {
  return classesOf(className)
    .map((name: string): ContainerColumns | null => {
      const match: RegExpMatchArray | null = name.match(CONTAINER_COLUMNS);

      return match
        ? { minWidthInRem: Number(match[1]), columns: Number(match[2]) }
        : null;
    })
    .filter((value: ContainerColumns | null): value is ContainerColumns => {
      return value !== null;
    });
}

afterEach(() => {
  cleanup();
});

describe("the grid the steps sit on", () => {
  test.each(STEP_COUNTS)(
    "%i steps: never keyed to the window's breakpoints",
    (count: number) => {
      expect(
        classesOf(getSecurityCaseStepsGridClassName(count)).filter(
          (name: string): boolean => {
            return VIEWPORT_VARIANT.test(name);
          },
        ),
      ).toEqual([]);
    },
  );

  test.each(STEP_COUNTS)(
    "%i steps: one to a row in the narrowest place",
    (count: number) => {
      expect(classesOf(getSecurityCaseStepsGridClassName(count))).toContain(
        "grid-cols-1",
      );
    },
  );

  test.each(STEP_COUNTS)(
    "%i steps: a step keeps at least 10rem whenever more share a row - room for Investigating beside its number",
    (count: number) => {
      const steps: Array<ContainerColumns> = containerColumnsOf(
        getSecurityCaseStepsGridClassName(count),
      );

      // Two steps or more share a row once there is room.
      expect(steps.length).toBeGreaterThanOrEqual(count === 1 ? 0 : 1);
      expect(
        steps.filter((step: ContainerColumns): boolean => {
          return step.minWidthInRem / step.columns < 10;
        }),
      ).toEqual([]);
    },
  );

  test.each(STEP_COUNTS)(
    "%i steps: never more columns than steps, and more columns only as the width grows",
    (count: number) => {
      const steps: Array<ContainerColumns> = containerColumnsOf(
        getSecurityCaseStepsGridClassName(count),
      );

      let previous: ContainerColumns = { minWidthInRem: 0, columns: 1 };

      for (const step of steps) {
        expect(step.columns).toBeLessThanOrEqual(count);
        expect(step.minWidthInRem).toBeGreaterThan(previous.minWidthInRem);
        expect(step.columns).toBeGreaterThan(previous.columns);
        previous = step;
      }
    },
  );

  test("four steps - a new project's - go two to a row on a phone and all four in a row from 40rem", () => {
    expect(containerColumnsOf(getSecurityCaseStepsGridClassName(4))).toEqual([
      { minWidthInRem: 20, columns: 2 },
      { minWidthInRem: 40, columns: 4 },
    ]);
  });

  test("a list of more than six goes four to a row at the most", () => {
    for (const count of [7, 8, 12]) {
      expect(
        Math.max(
          ...containerColumnsOf(getSecurityCaseStepsGridClassName(count)).map(
            (step: ContainerColumns): number => {
              return step.columns;
            },
          ),
        ),
      ).toBe(4);
    }
  });
});

describe("the stepper", () => {
  test("is a size container of its own, so the grid follows the width it has wherever it is drawn", () => {
    render(
      <SecurityCaseStatusStepper
        statuses={buildDefaultTestStatuses()}
        statusId={testStatusId(SecurityCaseStage.Acknowledged)}
      />,
    );

    const steps: HTMLElement = screen.getByTestId("security-case-status-steps");

    expect(SECURITY_CASE_STEPS_CONTAINER_CLASS_NAME).toBe(
      "[container-type:inline-size]",
    );
    expect((steps.parentElement as HTMLElement).className).toBe(
      SECURITY_CASE_STEPS_CONTAINER_CLASS_NAME,
    );
    expect(steps.className).toBe(
      `grid gap-2 ${getSecurityCaseStepsGridClassName(4)}`,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
