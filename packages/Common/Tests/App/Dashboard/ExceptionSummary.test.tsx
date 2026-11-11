import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ExceptionSummary, {
  EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT,
  EXCEPTION_SUMMARY_TEST_IDS,
  getExceptionSummaryStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSummary";
import {
  EVENT_HEADER_CLASS_NAME,
  getEventHeaderFactsClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventHeaderLayout";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";

/*
 * The exception's header: the product's record header (EventHeaderLayout),
 * as an incident's is. Pills, then the type as the title, the message under
 * it, two buttons and a ⋯, and the facts - Assignee among them.
 */

interface ExceptionStatusTestCase {
  color: string;
  icon: IconProp;
  isArchived: boolean;
  isResolved: boolean;
  name: string;
  primaryLabel: string;
  renderedLabels: Array<string>;
}

const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";

function exceptionWith(
  values: Partial<TelemetryException> = {},
): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  Object.assign(exception, values);
  return exception;
}

function renderSummary(
  props: React.ComponentProps<typeof ExceptionSummary>,
): ReturnType<typeof render> {
  // The Service fact links to the service page, which needs a router.
  return render(
    <MemoryRouter>
      <ExceptionSummary {...props} />
    </MemoryRouter>,
  );
}

// A fact of the header, by its label: the label's own box.
function fact(label: string): HTMLElement {
  return screen.getByText(label, { exact: true }).parentElement as HTMLElement;
}

const TWO_BUTTONS: React.ReactElement = (
  <>
    <button type="button">Resolve</button>
    <button type="button">Archive</button>
  </>
);

const MORE: React.ReactElement = (
  <button type="button" aria-label="More actions">
    ⋯
  </button>
);

function besideFromRem(): string {
  return (
    screen
      .getByTestId(EXCEPTION_SUMMARY_TEST_IDS.header)
      .getAttribute("data-actions-beside-from") || ""
  );
}

afterEach(() => {
  cleanup();
});

describe("ExceptionSummary", () => {
  test.each([
    {
      name: "unresolved",
      isResolved: false,
      isArchived: false,
      primaryLabel: "Unresolved",
      icon: IconProp.Error,
      color: "bg-red-50",
      renderedLabels: ["Unresolved"],
    },
    {
      name: "resolved",
      isResolved: true,
      isArchived: false,
      primaryLabel: "Resolved",
      icon: IconProp.CheckCircle,
      color: "bg-emerald-50",
      renderedLabels: ["Resolved"],
    },
    {
      name: "archived",
      isResolved: false,
      isArchived: true,
      primaryLabel: "Archived",
      icon: IconProp.Archive,
      color: "bg-amber-50",
      renderedLabels: ["Archived"],
    },
    {
      name: "resolved and archived",
      isResolved: true,
      isArchived: true,
      primaryLabel: "Resolved",
      icon: IconProp.CheckCircle,
      color: "bg-emerald-50",
      renderedLabels: ["Resolved", "Archived"],
    },
  ])(
    "says where a $name exception stands in its first pill, with an icon",
    ({
      isResolved,
      isArchived,
      primaryLabel,
      icon,
      color,
      renderedLabels,
    }: ExceptionStatusTestCase) => {
      const exception: TelemetryException = exceptionWith({
        isResolved,
        isArchived,
      });
      const status: ReturnType<typeof getExceptionSummaryStatus> =
        getExceptionSummaryStatus(exception);

      expect(status.label).toBe(primaryLabel);
      expect(status.icon).toBe(icon);
      expect(status.pillClassName.split(" ")).toContain(color);

      renderSummary({ exception });

      const pills: HTMLElement = screen.getByTestId(
        EXCEPTION_SUMMARY_TEST_IDS.pills,
      );
      const statusPill: HTMLElement = screen.getByTestId(
        "exception-summary-status",
      );

      // The status leads the pills.
      expect(pills.firstElementChild).toBe(statusPill);
      expect(statusPill).toHaveTextContent(primaryLabel);
      expect(statusPill).toHaveClass(color);
      expect(statusPill.querySelector("svg")).not.toBeNull();

      renderedLabels.forEach((label: string) => {
        expect(
          within(pills).getByText(label, { exact: true }),
        ).toBeInTheDocument();
      });
    },
  );

  test("draws no status square beside the title: the pill says it", () => {
    renderSummary({ exception: exceptionWith() });

    expect(
      screen.queryByTestId("exception-summary-status-icon"),
    ).not.toBeInTheDocument();
  });

  test("is the product's record header, sized by its own width", () => {
    renderSummary({ exception: exceptionWith() });

    const header: HTMLElement = screen.getByRole("region", {
      name: "Exception summary",
    });

    expect(header).toHaveAttribute(
      "data-testid",
      EXCEPTION_SUMMARY_TEST_IDS.header,
    );
    expect(header.className).toBe(EVENT_HEADER_CLASS_NAME);
    expect(header.className).toContain("[container-type:inline-size]");
  });

  test("names the exception by its type, as the page's heading, with its message under it in the reading font", () => {
    renderSummary({
      exception: exceptionWith({
        exceptionType: "CheckoutTimeoutError",
        message: "Payment provider did not respond in time",
      }),
    });

    const title: HTMLElement = screen.getByRole("heading", {
      level: 2,
      name: "CheckoutTimeoutError",
    });

    expect(title).toHaveAttribute(
      "data-testid",
      EXCEPTION_SUMMARY_TEST_IDS.title,
    );

    const message: HTMLElement = screen.getByTestId(
      EXCEPTION_SUMMARY_TEST_IDS.message,
    );

    expect(message).toHaveTextContent(
      "Payment provider did not respond in time",
    );
    // A sentence, not code: the message reads in the page's own font.
    expect(message.className).not.toContain("font-mono");
    expect(message).toHaveClass("text-sm", "text-gray-700");
    // The title comes before the message, as it is read.
    expect(
      title.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("renders the exception's facts: occurrences, first and last seen with their releases", () => {
    const firstSeenAt: Date = new Date(Date.now() - 6 * DAY);
    const lastSeenAt: Date = new Date(Date.now() - 4 * MINUTE);
    const exception: TelemetryException = exceptionWith({
      exceptionType: "CheckoutTimeoutError",
      message: "Payment provider did not respond in time",
      environment: "production",
      occuranceCount: 12345,
      firstSeenAt,
      lastSeenAt,
      firstSeenInRelease: "checkout-api@2026.09.08",
      lastSeenInRelease: "checkout-api@2026.09.12",
    });

    renderSummary({ exception });

    expect(
      screen.queryByRole("button", {
        name: /(expand|collapse) exception message/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("exception-summary-environment"),
    ).toHaveTextContent("production");

    const occurrences: HTMLElement = fact("Occurrences");
    expect(occurrences).toHaveAttribute(
      "data-testid",
      "exception-summary-stat-occurrences",
    );
    expect(
      within(occurrences).getByText(new Intl.NumberFormat().format(12345)),
    ).toBeInTheDocument();
    expect(within(occurrences).getByText("all time")).toBeInTheDocument();

    const firstSeen: HTMLElement = fact("First seen");
    expect(within(firstSeen).getByText("6 days ago")).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsLocalShortDateTimeString(firstSeenAt),
    );
    expect(
      within(firstSeen).getByText("in checkout-api@2026.09.08"),
    ).toBeInTheDocument();

    const lastSeen: HTMLElement = fact("Last seen");
    expect(within(lastSeen).getByText("4 minutes ago")).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsLocalShortDateTimeString(lastSeenAt),
    );
    expect(
      within(lastSeen).getByText("in checkout-api@2026.09.12"),
    ).toBeInTheDocument();
  });

  test("names the service the exception belongs to once it is loaded", () => {
    const service: Service = new Service();
    service._id = SERVICE_ID;
    service.name = "checkout-api";
    service.serviceColor = new Color("#6366f1");

    renderSummary({
      exception: exceptionWith({
        primaryEntityId: new ObjectID(SERVICE_ID),
        primaryEntityType: ServiceType.OpenTelemetry,
      }),
      services: [service],
    });

    const serviceFact: HTMLElement = fact("Service");
    expect(within(serviceFact).getByText("checkout-api")).toBeInTheDocument();
    expect(within(serviceFact).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining(SERVICE_ID),
    );
  });

  test("labels infrastructure resources that have no service row", () => {
    renderSummary({
      exception: exceptionWith({
        primaryEntityId: new ObjectID(SERVICE_ID),
        primaryEntityType: ServiceType.KubernetesCluster,
      }),
    });

    expect(
      within(fact("Service")).getByText("Kubernetes telemetry"),
    ).toBeInTheDocument();
  });

  test("uses readable fallbacks when optional telemetry is absent", () => {
    renderSummary({ exception: exceptionWith() });

    expect(screen.getByText("Application exception")).toBeInTheDocument();
    expect(
      screen.getByText("No exception message was recorded."),
    ).toBeInTheDocument();
    expect(screen.getByText("Unresolved", { exact: true })).toBeInTheDocument();
    expect(
      within(fact("Occurrences")).getByText("0", { exact: true }),
    ).toBeInTheDocument();
    // First seen, last seen and the service.
    expect(screen.getAllByText("Not recorded", { exact: true })).toHaveLength(
      3,
    );
    expect(
      screen.queryByText(/undefined|invalid date/i),
    ).not.toBeInTheDocument();
    // Nothing to copy, and no empty badges.
    expect(
      screen.queryByRole("button", { name: /copy/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("exception-summary-unhandled"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("exception-summary-error-class"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("exception-summary-environment"),
    ).not.toBeInTheDocument();
  });

  test("flags unhandled exceptions and shows the AI error class", () => {
    renderSummary({
      exception: exceptionWith({ unhandled: true, errorClass: "code-fault" }),
    });

    expect(screen.getByTestId("exception-summary-unhandled")).toHaveTextContent(
      "Unhandled",
    );
    expect(
      screen.getByTestId("exception-summary-error-class"),
    ).toHaveTextContent("Code fault");
  });

  test("says when it came back after it was resolved, beside its status", () => {
    renderSummary({
      exception: exceptionWith({
        isResolved: false,
        regressedAt: new Date(Date.now() - 2 * DAY),
        firstSeenAt: new Date(Date.now() - 30 * DAY),
      }),
    });

    const regressed: HTMLElement = screen.getByTestId(
      "exception-summary-regressed",
    );

    expect(regressed).toHaveTextContent("Regressed");
    expect(regressed.getAttribute("title")).toMatch(/after it was resolved/);
    expect(screen.queryByTestId("exception-summary-new")).toBeNull();
  });

  test.each([
    ["unclassified", "unknown"],
    ["an unrecognised value", "flaky"],
  ])(
    "hides the error class badge when it is %s",
    (_name: string, value: string) => {
      renderSummary({ exception: exceptionWith({ errorClass: value }) });

      expect(
        screen.queryByTestId("exception-summary-error-class"),
      ).not.toBeInTheDocument();
    },
  );

  test("offers a copy button for a recorded message", () => {
    renderSummary({
      exception: exceptionWith({ message: "Inventory reservation failed" }),
    });

    expect(screen.getByTitle("Copy exception message")).toBeInTheDocument();
  });

  test("offers no actions when it is given none (the Settings page)", () => {
    renderSummary({ exception: exceptionWith() });

    expect(
      screen.queryByTestId(EXCEPTION_SUMMARY_TEST_IDS.actions),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(EXCEPTION_SUMMARY_TEST_IDS.morePlace),
    ).not.toBeInTheDocument();
    expect(besideFromRem()).toBe("never");
  });

  test("its buttons and its ⋯ form one named group, the buttons in a row of their own", () => {
    renderSummary({
      exception: exceptionWith(),
      actions: { buttons: TWO_BUTTONS, more: MORE },
    });

    const group: HTMLElement = screen.getByRole("group", {
      name: "Exception actions",
    });

    expect(group).toHaveAttribute(
      "data-testid",
      EXCEPTION_SUMMARY_TEST_IDS.actions,
    );

    const buttons: HTMLElement = within(group).getByTestId(
      EXCEPTION_SUMMARY_TEST_IDS.buttons,
    );

    expect(
      within(buttons)
        .getAllByRole("button")
        .map((button: HTMLElement) => {
          return button.textContent;
        }),
    ).toEqual(["Resolve", "Archive"]);

    const morePlace: HTMLElement = within(group).getByTestId(
      EXCEPTION_SUMMARY_TEST_IDS.morePlace,
    );

    expect(
      within(morePlace).getByRole("button", { name: "More actions" }),
    ).toBeInTheDocument();
    // The ⋯ is not one of the buttons that wrap.
    expect(buttons.contains(morePlace)).toBe(false);
  });

  test("without a ⋯ it keeps no place for one", () => {
    renderSummary({
      exception: exceptionWith(),
      actions: { buttons: TWO_BUTTONS, more: null },
    });

    expect(
      screen.queryByTestId(EXCEPTION_SUMMARY_TEST_IDS.morePlace),
    ).not.toBeInTheDocument();
    // The pills keep no room at their end for a ⋯ that is not there.
    expect(
      screen.getByTestId(EXCEPTION_SUMMARY_TEST_IDS.pills),
    ).not.toHaveClass("pe-11");
  });

  test("with a ⋯ the pills keep its corner free until the actions sit beside them", () => {
    renderSummary({
      exception: exceptionWith(),
      actions: { buttons: TWO_BUTTONS, more: MORE },
    });

    const width: string = besideFromRem();

    expect(width).toMatch(/^\d+rem$/);
    expect(screen.getByTestId(EXCEPTION_SUMMARY_TEST_IDS.pills)).toHaveClass(
      "pe-11",
      `[@container(min-width:${width})]:pe-0`,
    );
    expect(
      screen.getByTestId(EXCEPTION_SUMMARY_TEST_IDS.morePlace),
    ).toHaveClass("absolute", `[@container(min-width:${width})]:static`);
  });

  test("its actions move beside the pills at the header's own width, never at the window's", () => {
    renderSummary({
      exception: exceptionWith({ message: "Inventory reservation failed" }),
      actions: { buttons: TWO_BUTTONS, more: MORE },
    });

    const width: string = besideFromRem();
    const top: HTMLElement = screen.getByTestId(EXCEPTION_SUMMARY_TEST_IDS.top);
    const actions: HTMLElement = screen.getByTestId(
      EXCEPTION_SUMMARY_TEST_IDS.actions,
    );

    expect(top).toHaveClass(
      "flex",
      "flex-wrap",
      `[@container(min-width:${width})]:grid`,
    );
    expect(actions).toHaveClass(
      "justify-end",
      `[@container(min-width:${width})]:col-start-2`,
    );
    // No window breakpoints: a header beside the side menu is narrower than the window.
    for (const element of [top, actions]) {
      expect(element.className).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
    }
    // The title takes the whole row under the pills and the actions there.
    expect(screen.getByTestId(EXCEPTION_SUMMARY_TEST_IDS.title)).toHaveClass(
      "basis-full",
      `[@container(min-width:${width})]:col-span-2`,
    );
  });

  test("the more there is to fit beside the actions, the wider the header has to be before they go there", () => {
    renderSummary({
      exception: exceptionWith(),
      actions: { buttons: TWO_BUTTONS, more: MORE },
    });

    const plain: number = parseInt(besideFromRem(), 10);

    cleanup();

    renderSummary({
      exception: exceptionWith({
        unhandled: true,
        errorClass: "code-fault",
        environment: "production-eu-west-2",
        regressedAt: new Date(Date.now() - DAY),
      }),
      actions: { buttons: TWO_BUTTONS, more: MORE },
    });

    const busy: string = besideFromRem();

    // Pills too many for the row stay where they are: the actions go under the title.
    expect(busy === "never" || parseInt(busy, 10) > plain).toBe(true);
  });

  test("its words for Reopen and Unarchive are measured, not Resolve's and Archive's", () => {
    renderSummary({
      exception: exceptionWith(),
      actions: { buttons: TWO_BUTTONS, more: MORE },
    });

    const unresolved: string = besideFromRem();

    cleanup();

    renderSummary({
      exception: exceptionWith({ isResolved: true, isArchived: true }),
      actions: { buttons: TWO_BUTTONS, more: MORE },
    });

    // "Reopen" + "Unarchive" and two pills need at least the room "Resolve" + "Archive" and one do.
    const settled: string = besideFromRem();

    expect(
      settled === "never" || parseInt(settled, 10) >= parseInt(unresolved, 10),
    ).toBe(true);
  });

  test("names who owns it as a fact, drawn as the control it is given", () => {
    renderSummary({
      exception: exceptionWith(),
      assignee: (
        <button type="button" data-testid="assignee-control">
          Assign
        </button>
      ),
    });

    const assignee: HTMLElement = screen.getByTestId(
      "exception-summary-stat-assignee",
    );

    expect(within(assignee).getByText("Assignee")).toBeInTheDocument();

    const control: HTMLElement =
      within(assignee).getByTestId("assignee-control");

    // Not inside the box that cuts a long value short (and its focus ring).
    expect(control.closest(".truncate")).toBeNull();
    // The fact comes last, after the service.
    const facts: HTMLElement = screen.getByTestId(
      EXCEPTION_SUMMARY_TEST_IDS.facts,
    );

    expect(facts.lastElementChild).toBe(assignee);
    expect(facts.className).toBe(getEventHeaderFactsClassName(5));
  });

  test("without an assignee control it has the four facts it always has", () => {
    renderSummary({ exception: exceptionWith() });

    const facts: HTMLElement = screen.getByTestId(
      EXCEPTION_SUMMARY_TEST_IDS.facts,
    );

    expect(
      Array.from(facts.children).map((child: Element) => {
        return child.getAttribute("data-testid");
      }),
    ).toEqual([
      "exception-summary-stat-occurrences",
      "exception-summary-stat-first-seen",
      "exception-summary-stat-last-seen",
      "exception-summary-stat-service",
    ]);
    expect(facts.className).toBe(getEventHeaderFactsClassName(4));
    expect(facts.tagName).toBe("DL");
  });

  test("expands and collapses long messages without removing their content", () => {
    const longMessage: string = "x".repeat(
      EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT + 1,
    );

    renderSummary({ exception: exceptionWith({ message: longMessage }) });

    const message: HTMLElement = screen.getByTestId(
      EXCEPTION_SUMMARY_TEST_IDS.message,
    );
    const expandButton: HTMLElement = screen.getByRole("button", {
      name: "Expand exception message",
    });

    expect(message).toHaveClass("line-clamp-3");
    expect(message).toHaveTextContent(longMessage);
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(expandButton).toHaveAttribute("aria-controls", message.id);
    expect(expandButton).toHaveTextContent("Show more");

    fireEvent.click(expandButton);

    const collapseButton: HTMLElement = screen.getByRole("button", {
      name: "Collapse exception message",
    });
    expect(message).not.toHaveClass("line-clamp-3");
    expect(message.textContent).toBe(longMessage);
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");
    expect(collapseButton).toHaveTextContent("Show less");

    fireEvent.click(collapseButton);

    expect(message).toHaveClass("line-clamp-3");
    expect(
      screen.getByRole("button", { name: "Expand exception message" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("does not clamp a message exactly at the limit", () => {
    renderSummary({
      exception: exceptionWith({
        message: "y".repeat(EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT),
      }),
    });

    expect(
      screen.getByTestId(EXCEPTION_SUMMARY_TEST_IDS.message),
    ).not.toHaveClass("line-clamp-3");
  });
});
