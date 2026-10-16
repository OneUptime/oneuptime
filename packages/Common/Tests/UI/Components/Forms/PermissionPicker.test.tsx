import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import PermissionPicker from "../../../../UI/Components/Forms/Fields/PermissionPicker";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../../Types/Permission";

/*
 * THE FULL LIST OF PERMISSIONS (Forms/Fields/PermissionPicker), behind Add
 * Permission on a team's and a custom role's page.
 *
 * Opened on a permission already picked - Edit on a row - it showed that
 * permission's group from the top: "Read Telemetry Service Log" sat some
 * hundred rows down the Telemetry list, out of sight, and nothing said which
 * row was the pick to anyone not seeing the tint (custom roles UI review).
 * The pick is now pressed (aria-pressed), and the list scrolls to it once,
 * so a person looking at the dialog sees it; picking another row neither
 * jumps nor scrolls.
 */

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

const PICKED_ROW_TOP: number = 2000;
const LIST_HEIGHT: number = 400;
const ROW_HEIGHT: number = 50;

/*
 * jsdom lays nothing out: give the pressed row, and the list, the sizes a
 * browser would, so the scroll can be read.
 */
const layout: Array<{ property: string; descriptor: PropertyDescriptor }> = [];

function fakeLayout(): void {
  for (const property of ["offsetTop", "offsetHeight", "clientHeight"]) {
    const descriptor: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);

    if (descriptor) {
      layout.push({ property, descriptor });
    }
  }

  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("aria-pressed") === "true" ? PICKED_ROW_TOP : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(): number {
      return ROW_HEIGHT;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("data-testid") === "permission-picker-list"
        ? LIST_HEIGHT
        : 0;
    },
  });
}

function restoreLayout(): void {
  for (const { property, descriptor } of layout) {
    Object.defineProperty(HTMLElement.prototype, property, descriptor);
  }
  layout.length = 0;
}

function titleOf(permission: Permission): string {
  return (
    PermissionHelper.getAllPermissionProps().find(
      (props: PermissionProps): boolean => {
        return props.permission === permission;
      },
    )?.title || ""
  );
}

// The row whose title is exactly this permission's, or null.
function findRow(permission: Permission): HTMLElement | null {
  const title: string = titleOf(permission);

  return (
    screen.queryAllByRole("button").find((button: HTMLElement): boolean => {
      return Array.from(button.querySelectorAll("div")).some(
        (part: HTMLDivElement): boolean => {
          return part.textContent === title;
        },
      );
    }) || null
  );
}

function rowOf(permission: Permission): HTMLElement {
  const row: HTMLElement | null = findRow(permission);

  if (!row) {
    throw new Error("No row for " + permission);
  }

  return row;
}

describe("the full list of permissions", () => {
  beforeEach(() => {
    fakeLayout();
  });

  afterEach(() => {
    cleanup();
    restoreLayout();
  });

  test("opened on a pick, shows its group with the pick pressed, scrolled into view", () => {
    render(
      <PermissionPicker
        onChange={() => {}}
        initialValue={Permission.ReadTelemetryServiceLog}
      />,
    );

    const picked: HTMLElement = rowOf(Permission.ReadTelemetryServiceLog);
    expect(picked).toHaveAttribute("aria-pressed", "true");

    const list: HTMLElement = screen.getByTestId("permission-picker-list");
    // Centred in the list: its top, less half of what is left around it.
    expect(list.scrollTop).toBe(
      PICKED_ROW_TOP - (LIST_HEIGHT - ROW_HEIGHT) / 2,
    );

    // Every other row is not pressed.
    const pressed: Array<HTMLElement> = screen
      .getAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return button.getAttribute("aria-pressed") === "true";
      });
    expect(pressed).toEqual([picked]);
  });

  test("picking another row presses it and hands it on, without scrolling back", () => {
    const picks: Array<Permission | null> = [];

    render(
      <PermissionPicker
        onChange={(value: Permission | null) => {
          picks.push(value);
        }}
        initialValue={Permission.ReadTelemetryServiceLog}
      />,
    );

    const list: HTMLElement = screen.getByTestId("permission-picker-list");
    list.scrollTop = 12;

    const other: HTMLElement = rowOf(Permission.CreateTelemetryIngestionKey);
    fireEvent.click(other);

    expect(picks).toEqual([Permission.CreateTelemetryIngestionKey]);
    expect(rowOf(Permission.CreateTelemetryIngestionKey)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(rowOf(Permission.ReadTelemetryServiceLog)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(list.scrollTop).toBe(12);
  });

  test("opened with nothing picked, starts at the top of the first group", () => {
    render(<PermissionPicker onChange={() => {}} />);

    expect(screen.getByTestId("permission-picker-list").scrollTop).toBe(0);
    expect(
      screen.getAllByRole("button").some((button: HTMLElement): boolean => {
        return button.getAttribute("aria-pressed") === "true";
      }),
    ).toBe(false);
  });

  test("leaves out what it is told to: a custom role never holds Project Owner", () => {
    render(
      <PermissionPicker
        onChange={() => {}}
        excludePermissions={[Permission.ProjectOwner]}
      />,
    );

    // The first group is the project's: Project Owner would be listed there.
    expect(findRow(Permission.ProjectOwner)).toBeNull();
    expect(rowOf(Permission.ProjectAdmin)).toBeInTheDocument();
  });
});
