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
  getExceptionSummaryStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSummary";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";

interface ExceptionStatusTestCase {
  color: string;
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
  // The Service cell links to the service page, which needs a router.
  return render(
    <MemoryRouter>
      <ExceptionSummary {...props} />
    </MemoryRouter>,
  );
}

function stat(label: string): HTMLElement {
  return screen.getByText(label, { exact: true }).parentElement as HTMLElement;
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
      color: "bg-red-50",
      renderedLabels: ["Unresolved"],
    },
    {
      name: "resolved",
      isResolved: true,
      isArchived: false,
      primaryLabel: "Resolved",
      color: "bg-emerald-50",
      renderedLabels: ["Resolved"],
    },
    {
      name: "archived",
      isResolved: false,
      isArchived: true,
      primaryLabel: "Archived",
      color: "bg-amber-50",
      renderedLabels: ["Archived"],
    },
    {
      name: "resolved and archived",
      isResolved: true,
      isArchived: true,
      primaryLabel: "Resolved",
      color: "bg-emerald-50",
      renderedLabels: ["Resolved", "Archived"],
    },
  ])(
    "shows the primary status and archive state for a $name exception",
    ({
      isResolved,
      isArchived,
      primaryLabel,
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
      expect(status.containerClassName).toBe(color);

      renderSummary({ exception });

      renderedLabels.forEach((label: string) => {
        expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
      });
      expect(screen.getByTestId("exception-summary-status-icon")).toHaveClass(
        color,
      );
    },
  );

  test("renders the exception identity and compact operational metadata", () => {
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
      screen.getByRole("region", { name: "Exception summary" }),
    ).toBeInTheDocument();
    expect(screen.getByText("CheckoutTimeoutError")).toBeInTheDocument();
    expect(
      screen.getByText("Payment provider did not respond in time"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /(expand|collapse) exception message/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("exception-summary-environment"),
    ).toHaveTextContent("production");

    expect(
      within(stat("Occurrences")).getByText(
        new Intl.NumberFormat().format(12345),
      ),
    ).toBeInTheDocument();

    const firstSeen: HTMLElement = stat("First seen");
    expect(within(firstSeen).getByText("6 days ago")).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsLocalShortDateTimeString(firstSeenAt),
    );
    expect(
      within(firstSeen).getByText("in checkout-api@2026.09.08"),
    ).toBeInTheDocument();

    const lastSeen: HTMLElement = stat("Last seen");
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

    const serviceCell: HTMLElement = stat("Service");
    expect(within(serviceCell).getByText("checkout-api")).toBeInTheDocument();
    expect(within(serviceCell).getByRole("link")).toHaveAttribute(
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
      within(stat("Service")).getByText("Kubernetes telemetry"),
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
      within(stat("Occurrences")).getByText("0", { exact: true }),
    ).toBeInTheDocument();
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

  test("renders the triage actions it is given and nothing when it is not", () => {
    const { rerender } = renderSummary({ exception: exceptionWith() });

    expect(
      screen.queryByTestId("exception-summary-actions"),
    ).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ExceptionSummary
          exception={exceptionWith()}
          actions={<button type="button">Resolve</button>}
        />
      </MemoryRouter>,
    );

    expect(
      within(screen.getByTestId("exception-summary-actions")).getByRole(
        "button",
        { name: "Resolve" },
      ),
    ).toBeInTheDocument();
  });

  test("expands and collapses long messages without removing their content", () => {
    const longMessage: string = "x".repeat(
      EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT + 1,
    );

    renderSummary({ exception: exceptionWith({ message: longMessage }) });

    const message: HTMLElement = screen.getByTestId(
      "exception-summary-message",
    );
    const expandButton: HTMLElement = screen.getByRole("button", {
      name: "Expand exception message",
    });

    expect(message).toHaveClass("line-clamp-3");
    expect(message).toHaveTextContent(longMessage);
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(expandButton).toHaveAttribute("aria-controls", message.id);

    fireEvent.click(expandButton);

    const collapseButton: HTMLElement = screen.getByRole("button", {
      name: "Collapse exception message",
    });
    expect(message).not.toHaveClass("line-clamp-3");
    expect(message.textContent).toBe(longMessage);
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

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

    expect(screen.getByTestId("exception-summary-message")).not.toHaveClass(
      "line-clamp-3",
    );
  });

  test("uses explicit cell borders for one, two, and four-column layouts", () => {
    renderSummary({ exception: exceptionWith() });

    const occurrences: HTMLElement = screen.getByTestId(
      "exception-summary-stat-occurrences",
    );
    const firstSeen: HTMLElement = screen.getByTestId(
      "exception-summary-stat-first-seen",
    );
    const lastSeen: HTMLElement = screen.getByTestId(
      "exception-summary-stat-last-seen",
    );
    const service: HTMLElement = screen.getByTestId(
      "exception-summary-stat-service",
    );

    expect(occurrences).not.toHaveClass("border-t");
    expect(occurrences).not.toHaveClass("border-l");
    expect(firstSeen).toHaveClass("border-t", "sm:border-l", "sm:border-t-0");
    expect(lastSeen).toHaveClass("border-t", "xl:border-l", "xl:border-t-0");
    expect(lastSeen).not.toHaveClass("sm:border-l");
    expect(service).toHaveClass("border-t", "sm:border-l", "xl:border-t-0");
  });
});
