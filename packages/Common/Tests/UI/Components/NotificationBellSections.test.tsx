import NotificationBell, {
  BADGE_COLOR_CLASS_NAMES,
} from "../../../UI/Components/HeaderAlert/NotificationBell/NotificationBell";
import {
  NOTIFICATION_BELL_SECTIONS,
  NotificationBellSection,
  NotificationItem,
  getNotificationBellBadge,
  getNotificationBellSection,
} from "../../../UI/Components/HeaderAlert/NotificationBell/NotificationItem";
import { HeaderAlertType } from "../../../UI/Components/HeaderAlert/HeaderAlert";
import IconProp from "../../../Types/Icon/IconProp";
import { findNestedControls } from "../../Helpers/NestedControls";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

/*
 * THE BELL'S PARTS (#7040): which part draws an item, what its badge
 * counts, and an item that says why it is there and can be put away -
 * "Finish setting up your notifications", amber, under On-Call, with Hide.
 */

afterEach(() => {
  cleanup();
});

type User = ReturnType<typeof userEvent.setup>;

const item: (
  id: string,
  alertType: HeaderAlertType,
  extra?: Partial<NotificationItem>,
) => NotificationItem = (
  id: string,
  alertType: HeaderAlertType,
  extra?: Partial<NotificationItem>,
): NotificationItem => {
  return {
    id: id,
    icon: IconProp.Bell,
    title: `${id} title`,
    count: 1,
    alertType: alertType,
    ...extra,
  };
};

const SETUP: NotificationItem = item("setup", HeaderAlertType.WARNING, {
  title: "Finish setting up your notifications",
  description: "Nothing can reach you yet.",
  section: NotificationBellSection.OnCall,
  dismissTitle: "Hide for a week",
});

describe("which part of the panel draws an item", () => {
  test("its alert type says, unless it names a part", () => {
    expect(getNotificationBellSection(item("a", HeaderAlertType.ERROR))).toBe(
      NotificationBellSection.Critical,
    );
    expect(getNotificationBellSection(item("b", HeaderAlertType.SUCCESS))).toBe(
      NotificationBellSection.OnCall,
    );
    expect(getNotificationBellSection(item("c", HeaderAlertType.INFO))).toBe(
      NotificationBellSection.Information,
    );
    expect(getNotificationBellSection(item("d", HeaderAlertType.WARNING))).toBe(
      NotificationBellSection.Information,
    );
    expect(getNotificationBellSection(SETUP)).toBe(
      NotificationBellSection.OnCall,
    );
  });

  test("the parts, in the order they are drawn, are named by their headings", () => {
    expect(NOTIFICATION_BELL_SECTIONS).toEqual([
      "Critical",
      "On-Call",
      "Information",
    ]);
  });
});

describe("the badge", () => {
  test("counts the most urgent kind there is: critical, then what asks something of the person, then on-call, then the rest", () => {
    expect(
      getNotificationBellBadge([
        item("a", HeaderAlertType.INFO),
        item("b", HeaderAlertType.SUCCESS),
        SETUP,
        item("c", HeaderAlertType.ERROR),
        item("d", HeaderAlertType.ERROR),
      ]),
    ).toEqual({ count: 2, alertType: HeaderAlertType.ERROR });

    expect(
      getNotificationBellBadge([
        item("a", HeaderAlertType.INFO),
        item("b", HeaderAlertType.SUCCESS),
        SETUP,
      ]),
    ).toEqual({ count: 1, alertType: HeaderAlertType.WARNING });

    expect(
      getNotificationBellBadge([
        item("a", HeaderAlertType.INFO),
        item("b", HeaderAlertType.SUCCESS),
      ]),
    ).toEqual({ count: 1, alertType: HeaderAlertType.SUCCESS });

    expect(getNotificationBellBadge([item("a", HeaderAlertType.INFO)])).toEqual(
      { count: 1, alertType: HeaderAlertType.INFO },
    );
  });

  test("an item with nothing to count is not counted, and nothing draws no badge", () => {
    expect(
      getNotificationBellBadge([
        item("a", HeaderAlertType.ERROR, { count: 0 }),
        item("b", HeaderAlertType.INFO),
      ]),
    ).toEqual({ count: 1, alertType: HeaderAlertType.INFO });
    expect(getNotificationBellBadge([])).toBeNull();
  });

  test("is drawn in its kind's colour, amber dark enough for its white count", () => {
    render(<NotificationBell items={[SETUP]} onItemClick={() => {}} />);

    const badge: HTMLElement = screen.getByText("1");

    expect(badge).toHaveClass(BADGE_COLOR_CLASS_NAMES[HeaderAlertType.WARNING]);
    expect(BADGE_COLOR_CLASS_NAMES[HeaderAlertType.WARNING]).toBe(
      "bg-amber-600",
    );
    expect(BADGE_COLOR_CLASS_NAMES[HeaderAlertType.ERROR]).toBe("bg-red-500");
  });
});

describe("the panel", () => {
  test("draws each part under its heading, in order, an item that names On-Call after that part's own", async () => {
    const user: User = userEvent.setup();

    // In the order the Dashboard's header gives them.
    render(
      <NotificationBell
        items={[
          item("incidents", HeaderAlertType.ERROR),
          item("oncall", HeaderAlertType.SUCCESS),
          { ...SETUP, onDismiss: () => {} },
          item("info", HeaderAlertType.INFO),
        ]}
        onItemClick={() => {}}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "View notifications" }),
    );

    const headings: Array<string> = screen
      .getAllByText(/^(Critical|On-Call|Information)$/)
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });

    expect(headings).toEqual(["Critical", "On-Call", "Information"]);

    const onCall: HTMLElement = screen
      .getByText("On-Call")
      .closest("div.py-2") as HTMLElement;
    const opened: Array<string> = within(onCall)
      .getAllByRole("button")
      .map((button: HTMLElement): string => {
        return button.getAttribute("data-testid") || "";
      });

    // The duty first, as it was given, then the setup item and its Hide.
    expect(opened).toEqual([
      "notification-bell-item-oncall",
      "notification-bell-item-setup",
      "notification-bell-item-setup-dismiss",
    ]);
  });

  test("an item says why it is there under its title, and opens on a click", async () => {
    const user: User = userEvent.setup();
    const onItemClick: Mock<(clicked: NotificationItem) => void> = jest.fn();

    render(<NotificationBell items={[SETUP]} onItemClick={onItemClick} />);

    await user.click(
      screen.getByRole("button", { name: "View notifications" }),
    );

    expect(
      screen.getByTestId("notification-bell-item-setup-description"),
    ).toHaveTextContent("Nothing can reach you yet.");
    expect(
      screen.getByTestId("notification-bell-item-setup-description"),
    ).toHaveClass("text-xs", "text-amber-800");

    await user.click(screen.getByTestId("notification-bell-item-setup"));

    expect(onItemClick).toHaveBeenCalledWith(SETUP);
  });

  test("Hide is a button of its own beside the item: it puts it away and opens nothing", async () => {
    const user: User = userEvent.setup();
    const onItemClick: Mock<(clicked: NotificationItem) => void> = jest.fn();
    const onDismiss: Mock<() => void> = jest.fn();

    const { container } = render(
      <NotificationBell
        items={[{ ...SETUP, onDismiss: onDismiss }]}
        onItemClick={onItemClick}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "View notifications" }),
    );

    const hide: HTMLElement = screen.getByRole("button", {
      name: "Hide for a week",
    });

    await user.click(hide);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onItemClick).not.toHaveBeenCalled();
    // Never a control inside another.
    expect(findNestedControls(container)).toEqual([]);
  });

  test("a keyboard reaches the item, then its Hide, and presses each", async () => {
    const user: User = userEvent.setup();
    const onItemClick: Mock<(clicked: NotificationItem) => void> = jest.fn();
    const onDismiss: Mock<() => void> = jest.fn();

    render(
      <NotificationBell
        items={[{ ...SETUP, onDismiss: onDismiss }]}
        onItemClick={onItemClick}
      />,
    );

    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();

    expect(screen.getByTestId("notification-bell-item-setup")).toHaveFocus();

    await user.tab();

    expect(
      screen.getByTestId("notification-bell-item-setup-dismiss"),
    ).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onItemClick).not.toHaveBeenCalled();
  });

  test("an item with no description and no Hide is drawn as it always was", async () => {
    const user: User = userEvent.setup();

    render(
      <NotificationBell
        items={[item("incidents", HeaderAlertType.ERROR)]}
        onItemClick={() => {}}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "View notifications" }),
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "incidents title",
    });

    expect(button).toHaveClass("items-center", "bg-red-50", "border");
    expect(
      screen.queryByTestId("notification-bell-item-incidents-description"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("notification-bell-item-incidents-dismiss"),
    ).not.toBeInTheDocument();
  });
});
