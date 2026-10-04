import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { FunctionComponent, ReactElement } from "react";
import MonitorCriteriaElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  describeNestedControls,
  findNestedControls,
} from "../../Helpers/NestedControls";

/*
 * A monitor criteria's header used to be one role="button" (open/close)
 * holding the criteria's drag handle. A screen reader reads such a header as
 * one control, so the handle was lost inside it. Now the handle and a real
 * open/close button sit side by side; the button's ::after still covers the
 * header, so a press anywhere on it opens or closes the criteria, and the
 * handle is lifted above it.
 */

type UserEventController = ReturnType<typeof userEvent.setup>;

function buildCriteria(name: string): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 3000,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: name,
    description: "",
  };
  return instance;
}

const renderCriteria: () => RenderResult = (): RenderResult => {
  const initial: MonitorCriteria = new MonitorCriteria();
  initial.data = {
    monitorCriteriaInstanceArray: [
      buildCriteria("Checkout is slow"),
      buildCriteria("Checkout is down"),
    ],
  };

  const Wrapper: FunctionComponent = (): ReactElement => {
    const [value, setValue] = React.useState<MonitorCriteria>(initial);

    return (
      <MonitorCriteriaElement
        monitorType={MonitorType.Website}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={[]}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        userDropdownOptions={[]}
        value={value}
        onChange={(changed: MonitorCriteria) => {
          setValue(changed);
        }}
      />
    );
  };

  return render(<Wrapper />);
};

const headers: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.getAllByTestId("monitor-criteria-header");
};

const toggleOf: (header: HTMLElement) => HTMLElement = (
  header: HTMLElement,
): HTMLElement => {
  const toggle: HTMLElement | undefined = within(header)
    .getAllByRole("button")
    .find((button: HTMLElement): boolean => {
      return button.hasAttribute("aria-expanded");
    });

  if (!toggle) {
    throw new Error("The criteria header has no open/close button.");
  }

  return toggle;
};

const handleOf: (header: HTMLElement) => HTMLElement = (
  header: HTMLElement,
): HTMLElement => {
  return within(header).getByLabelText("Drag to reorder criteria");
};

const classesOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
};

afterEach(() => {
  cleanup();
});

describe("a monitor criteria's header", () => {
  test("holds its drag handle and open/close button side by side", () => {
    const view: RenderResult = renderCriteria();

    expect(headers()).toHaveLength(2);

    for (const header of headers()) {
      const toggle: HTMLElement = toggleOf(header);
      const handle: HTMLElement = handleOf(header);

      expect(header).not.toHaveAttribute("role");
      expect(header).not.toHaveAttribute("tabindex");
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle).toHaveAttribute("type", "button");
      expect(toggle.contains(handle)).toBe(false);
      expect(handle.parentElement).toBe(header);
    }

    expect(describeNestedControls(findNestedControls(view.container))).toEqual(
      [],
    );
  });

  test("the open/close button says which criteria and where it sits", () => {
    renderCriteria();

    expect(toggleOf(headers()[0]!)).toHaveAccessibleName(
      /Checkout is slow.*1 of 2/,
    );
    expect(toggleOf(headers()[1]!)).toHaveAccessibleName(
      /Checkout is down.*2 of 2/,
    );
  });

  test("a press on it closes and opens the criteria", async () => {
    const user: UserEventController = userEvent.setup();
    renderCriteria();

    // Criteria start open.
    expect(toggleOf(headers()[0]!)).toHaveAttribute("aria-expanded", "true");

    await user.click(toggleOf(headers()[0]!));
    expect(toggleOf(headers()[0]!)).toHaveAttribute("aria-expanded", "false");
    expect(toggleOf(headers()[1]!)).toHaveAttribute("aria-expanded", "true");

    await user.click(toggleOf(headers()[0]!));
    expect(toggleOf(headers()[0]!)).toHaveAttribute("aria-expanded", "true");
  });

  test.each(["{Enter}", " "])(
    "%p on it closes the criteria",
    async (key: string) => {
      const user: UserEventController = userEvent.setup();
      renderCriteria();

      act(() => {
        toggleOf(headers()[1]!).focus();
      });
      await user.keyboard(key);

      expect(toggleOf(headers()[1]!)).toHaveAttribute("aria-expanded", "false");
      expect(toggleOf(headers()[0]!)).toHaveAttribute("aria-expanded", "true");
    },
  );

  test("a press on the drag handle does not close the criteria", () => {
    renderCriteria();

    fireEvent.click(handleOf(headers()[0]!));

    expect(toggleOf(headers()[0]!)).toHaveAttribute("aria-expanded", "true");
  });

  test("its open/close button covers the header, below the handle", () => {
    renderCriteria();

    const header: HTMLElement = headers()[0]!;

    expect(classesOf(header)).toEqual(
      expect.arrayContaining([
        "relative",
        "cursor-pointer",
        "hover:bg-gray-100",
      ]),
    );
    expect(classesOf(toggleOf(header))).toEqual(
      expect.arrayContaining([
        "after:absolute",
        "after:inset-0",
        "focus-visible:after:ring-2",
      ]),
    );
    expect(classesOf(handleOf(header))).toEqual(
      expect.arrayContaining(["relative", "z-10"]),
    );
  });
});
