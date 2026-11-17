import NotificationBell from "../../../UI/Components/HeaderAlert/NotificationBell/NotificationBell";
import { NotificationItem } from "../../../UI/Components/HeaderAlert/NotificationBell/NotificationItem";
import HeaderAlert, {
  HeaderAlertType,
} from "../../../UI/Components/HeaderAlert/HeaderAlert";
import Steps from "../../../UI/Components/Forms/Steps/Steps";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import IconText from "../../../UI/Components/IconText/IconText";
import ProgressButtonItem from "../../../UI/Components/ProgressButtons/ProgressButtonItem";
import UptimeBarTooltip from "../../../UI/Components/Graphs/UptimeBarTooltip";
import FilterViewer, {
  FILTER_ATTRIBUTE_CHIP_CLASS_NAME,
} from "../../../UI/Components/Filters/FilterViewer";
import Filter from "../../../UI/Components/Filters/Types/Filter";
import FieldType from "../../../UI/Components/Types/FieldType";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";
import GenericObject from "../../../Types/GenericObject";
import { JSONObject } from "../../../Types/JSON";
import { findNestedControls } from "../../Helpers/NestedControls";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

/*
 * Everyday controls a keyboard could not use (#9136): each was a `div` or an
 * `li` with only a click. Each is walked here with the keyboard alone - Tab
 * to reach it, Enter or Space to press it - as a person without a mouse
 * would, and none holds a control inside another.
 */

afterEach(() => {
  cleanup();
});

type User = ReturnType<typeof userEvent.setup>;

describe("the notification bell, from the keyboard", () => {
  const items: Array<NotificationItem> = [
    {
      id: "active-incidents",
      icon: IconProp.Alert,
      title: "2 Active Incidents",
      count: 2,
      alertType: HeaderAlertType.ERROR,
    },
    {
      id: "on-call",
      icon: IconProp.Call,
      title: "You are on call",
      count: 1,
      alertType: HeaderAlertType.SUCCESS,
    },
  ];

  test("Tab reaches each item once the bell is open, and Enter or Space opens it", async () => {
    const user: User = userEvent.setup();
    const onItemClick: Mock<(item: NotificationItem) => void> = jest.fn();

    render(<NotificationBell items={items} onItemClick={onItemClick} />);

    await user.tab();
    expect(
      screen.getByRole("button", { name: "View notifications" }),
    ).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.tab();

    const first: HTMLElement = screen.getByRole("button", {
      name: "2 Active Incidents",
    });

    expect(first).toHaveFocus();
    expect(first.tagName).toBe("BUTTON");
    expect(first).toHaveClass("focus-visible:ring-2");

    await user.keyboard("{Enter}");
    expect(onItemClick).toHaveBeenCalledWith(items[0]);

    // Choosing closes the panel; open it again and choose with Space.
    await user.click(
      screen.getByRole("button", { name: "View notifications" }),
    );
    await user.tab();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "You are on call" }),
    ).toHaveFocus();

    await user.keyboard(" ");
    expect(onItemClick).toHaveBeenLastCalledWith(items[1]);
  });

  test("Escape closes the panel and hands focus back to the bell", async () => {
    const user: User = userEvent.setup();

    render(<NotificationBell items={items} onItemClick={() => {}} />);

    const bell: HTMLElement = screen.getByRole("button", {
      name: "View notifications",
    });

    await user.click(bell);
    await user.tab();
    expect(
      screen.getByRole("button", { name: "2 Active Incidents" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("button", { name: "2 Active Incidents" }),
    ).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
    expect(bell).toHaveAttribute("aria-expanded", "false");
  });

  test("its items hold no control inside another", async () => {
    const user: User = userEvent.setup();
    const { container } = render(
      <NotificationBell items={items} onItemClick={() => {}} />,
    );

    await user.click(
      screen.getByRole("button", { name: "View notifications" }),
    );

    expect(findNestedControls(container)).toEqual([]);
  });
});

describe("a header alert", () => {
  test("that does something is a button a keyboard presses", async () => {
    const user: User = userEvent.setup();
    const onClick: Mock<() => void> = jest.fn();

    render(
      <HeaderAlert
        icon={IconProp.Alert}
        title="3"
        suffix="Incidents"
        alertType={HeaderAlertType.ERROR}
        onClick={onClick}
      />,
    );

    await user.tab();

    const alert: HTMLElement = screen.getByRole("button", {
      name: "3 Incidents",
    });

    expect(alert).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test("that does nothing is not offered as a control", () => {
    render(
      <HeaderAlert
        icon={IconProp.Alert}
        title="3"
        alertType={HeaderAlertType.INFO}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("a form's steps", () => {
  const steps: Array<FormStep<GenericObject>> = [
    { id: "monitor-info", title: "Monitor Info" },
    { id: "criteria", title: "Criteria" },
    { id: "notifications", title: "Notifications" },
  ];

  test("a finished step is a button: Tab reaches it, Enter and Space go back to it", async () => {
    const user: User = userEvent.setup();
    const onClick: Mock<(step: FormStep<GenericObject>) => void> = jest.fn();

    render(
      <Steps
        steps={steps}
        currentFormStepId="criteria"
        formValues={{}}
        onClick={onClick}
      />,
    );

    await user.tab();

    const finished: HTMLElement = screen.getByRole("button", {
      name: "Monitor Info",
    });

    expect(finished).toHaveFocus();
    expect(finished).toHaveClass("focus-visible:ring-2");

    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledWith(steps[0]);

    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test("the current step and a step not reached yet are not buttons", () => {
    render(
      <Steps
        steps={steps}
        currentFormStepId="criteria"
        formValues={{}}
        onClick={() => {}}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByText("Criteria").closest("[aria-current]"),
    ).toHaveAttribute("aria-current", "step");
  });

  test("on a form that allows any step, a step not reached yet is a button too", () => {
    render(
      <Steps
        steps={steps}
        currentFormStepId="criteria"
        formValues={{}}
        allowAnyStep={true}
        onClick={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Criteria" }),
    ).not.toBeInTheDocument();
  });

  test("under a finger a step is at least 44px tall", () => {
    render(
      <Steps
        steps={steps}
        currentFormStepId="criteria"
        formValues={{}}
        onClick={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Monitor Info" })).toHaveClass(
      "[@media(pointer:coarse)]:min-h-11",
    );
  });
});

describe("an icon beside words", () => {
  test("that does something is a button a keyboard presses", async () => {
    const user: User = userEvent.setup();
    const onClick: Mock<() => void> = jest.fn();

    render(<IconText icon={IconProp.Link} text="Open" onClick={onClick} />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("that does nothing is plain text", () => {
    render(<IconText icon={IconProp.Link} text="Open" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("a progress step", () => {
  test("still to do is a button a keyboard presses", async () => {
    const user: User = userEvent.setup();
    const onClick: Mock<() => void> = jest.fn();

    render(
      <ol>
        <ProgressButtonItem
          id="step-2"
          title="Add a monitor"
          color={new Color("#4f46e5")}
          stepCount={2}
          isCurrentStep={true}
          isLastStep={false}
          onClick={onClick}
        />
      </ol>,
    );

    await user.tab();

    const step: HTMLElement = screen.getByRole("button", {
      name: /Add a monitor/,
    });

    expect(step).toHaveFocus();
    expect(step).toHaveAttribute("aria-current", "step");

    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("that is done is not a button", () => {
    render(
      <ol>
        <ProgressButtonItem
          id="step-1"
          title="Create a project"
          color={new Color("#4f46e5")}
          stepCount={1}
          isCompletedStep={true}
          isCurrentStep={false}
          isLastStep={false}
          onClick={() => {}}
        />
      </ol>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("an uptime day's incidents", () => {
  test("open from the keyboard as they do on a click", async () => {
    const user: User = userEvent.setup();
    const onIncidentClick: Mock<(id: string) => void> = jest.fn();

    render(
      <UptimeBarTooltip
        date={new Date("2026-11-10T00:00:00Z")}
        uptimePercent={99}
        hasEvents={true}
        statusDurations={[]}
        incidents={[
          {
            id: "incident-1",
            title: "API is down",
            declaredAt: new Date("2026-11-10T08:00:00Z"),
            monitorIds: [],
          },
        ]}
        onIncidentClick={onIncidentClick}
      />,
    );

    const incident: HTMLElement = screen.getByRole("button", {
      name: /API is down/,
    });

    await user.tab();
    expect(incident).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onIncidentClick).toHaveBeenCalledTimes(2);
    expect(onIncidentClick).toHaveBeenCalledWith("incident-1");
  });

  test("with nowhere to open are not offered as controls", () => {
    render(
      <UptimeBarTooltip
        date={new Date("2026-11-10T00:00:00Z")}
        uptimePercent={99}
        hasEvents={true}
        statusDurations={[]}
        incidents={[
          {
            id: "incident-1",
            title: "API is down",
            declaredAt: new Date("2026-11-10T08:00:00Z"),
            monitorIds: [],
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("attribute filter chips", () => {
  interface Row extends GenericObject {
    attributes: JSONObject;
  }

  const filters: Array<Filter<Row>> = [
    { key: "attributes", title: "Attributes", type: FieldType.JSON },
  ];

  test("wrap onto lines of their own on a narrow screen, every word in sight", () => {
    render(
      <FilterViewer<Row>
        id="logs"
        filters={filters}
        filterData={
          {
            attributes: {
              "service.name": "checkout",
              "k8s.pod.name": "checkout-7d9f8b6c5d-abcde-a-very-long-pod-name",
              "host.name": "prod-eu-west-1-node-17",
            },
          } as Row
        }
        showFilterModal={false}
        pluralLabel="Logs"
      />,
    );

    const row: HTMLElement = screen.getByTestId("filter-attribute-chips");

    expect(row).toHaveClass("flex", "flex-wrap", "gap-2", "max-w-full");
    expect(row.className).not.toContain("space-x-");

    const chips: Array<HTMLElement> = screen
      .getAllByTestId("filter-attribute-chip")
      .map((sentence: HTMLElement): HTMLElement => {
        return sentence.parentElement as HTMLElement;
      });

    expect(chips).toHaveLength(3);

    for (const chip of chips) {
      expect(chip.className).toBe(FILTER_ATTRIBUTE_CHIP_CLASS_NAME);
      expect(chip).toHaveClass("max-w-full", "[overflow-wrap:anywhere]");
      // Grows with its words: never cut to one line's height.
      expect(chip).toHaveClass("min-h-7");
      expect(chip).not.toHaveClass("h-7", "truncate");
    }

    expect(row).toHaveTextContent(
      "checkout-7d9f8b6c5d-abcde-a-very-long-pod-name",
    );
  });
});
