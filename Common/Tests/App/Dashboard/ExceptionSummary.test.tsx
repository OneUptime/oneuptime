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
import ExceptionSummary, {
  EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT,
  getExceptionSummaryStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSummary";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import OneUptimeDate from "../../../Types/Date";

interface ExceptionStatusTestCase {
  color: string;
  isArchived: boolean;
  isResolved: boolean;
  name: string;
  primaryLabel: string;
  renderedLabels: Array<string>;
}

function exceptionWith(
  values: Partial<TelemetryException> = {},
): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  Object.assign(exception, values);
  return exception;
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

      render(<ExceptionSummary exception={exception} />);

      renderedLabels.forEach((label: string) => {
        expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
      });
    },
  );

  test("renders the exception identity and compact operational metadata", () => {
    const firstSeenAt: Date = new Date("2026-09-10T08:15:00.000Z");
    const lastSeenAt: Date = new Date("2026-09-12T17:45:00.000Z");
    const exception: TelemetryException = exceptionWith({
      exceptionType: "CheckoutTimeoutError",
      message: "Payment provider did not respond in time",
      environment: "production",
      occuranceCount: 12345,
      firstSeenAt,
      lastSeenAt,
      lastSeenInRelease: "checkout-api@2026.09.12",
    });

    render(<ExceptionSummary exception={exception} />);

    expect(
      screen.getByRole("region", { name: "Exception summary" }),
    ).toBeInTheDocument();
    expect(screen.getByText("CheckoutTimeoutError")).toBeInTheDocument();
    expect(
      screen.getByText("Payment provider did not respond in time"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /exception message/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("production", { exact: true })).toBeInTheDocument();

    const expectedMetadata: Array<[string, string]> = [
      ["Occurrences", new Intl.NumberFormat().format(12345)],
      [
        "First seen",
        OneUptimeDate.getDateAsLocalShortDateTimeString(firstSeenAt),
      ],
      [
        "Last seen",
        OneUptimeDate.getDateAsLocalShortDateTimeString(lastSeenAt),
      ],
      ["Latest release", "checkout-api@2026.09.12"],
    ];

    expectedMetadata.forEach(([label, value]: [string, string]) => {
      const term: HTMLElement = screen.getByText(label, { exact: true });
      const stat: HTMLElement | null = term.parentElement;

      expect(stat).not.toBeNull();
      expect(within(stat as HTMLElement).getByText(value)).toBeInTheDocument();
    });
  });

  test("uses readable fallbacks when optional telemetry is absent", () => {
    render(<ExceptionSummary exception={exceptionWith()} />);

    expect(screen.getByText("Application exception")).toBeInTheDocument();
    expect(
      screen.getByText("No exception message was recorded."),
    ).toBeInTheDocument();
    expect(screen.getByText("Unresolved", { exact: true })).toBeInTheDocument();

    const occurrences: HTMLElement = screen.getByText("Occurrences", {
      exact: true,
    }).parentElement as HTMLElement;
    expect(
      within(occurrences).getByText("0", { exact: true }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded", { exact: true })).toHaveLength(
      3,
    );
    expect(
      screen.queryByText(/undefined|invalid date/i),
    ).not.toBeInTheDocument();
  });

  test("expands and collapses long messages without removing their content", () => {
    const longMessage: string = "x".repeat(
      EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT + 1,
    );

    render(
      <ExceptionSummary exception={exceptionWith({ message: longMessage })} />,
    );

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

  test("uses explicit cell borders for one, two, and four-column layouts", () => {
    render(<ExceptionSummary exception={exceptionWith()} />);

    const occurrences: HTMLElement = screen.getByText("Occurrences", {
      exact: true,
    }).parentElement as HTMLElement;
    const firstSeen: HTMLElement = screen.getByText("First seen", {
      exact: true,
    }).parentElement as HTMLElement;
    const lastSeen: HTMLElement = screen.getByText("Last seen", {
      exact: true,
    }).parentElement as HTMLElement;
    const latestRelease: HTMLElement = screen.getByText("Latest release", {
      exact: true,
    }).parentElement as HTMLElement;

    expect(occurrences).not.toHaveClass("border-t");
    expect(occurrences).not.toHaveClass("border-l");
    expect(firstSeen).toHaveClass("border-t", "sm:border-l", "sm:border-t-0");
    expect(lastSeen).toHaveClass("border-t", "xl:border-l", "xl:border-t-0");
    expect(lastSeen).not.toHaveClass("sm:border-l");
    expect(latestRelease).toHaveClass(
      "border-t",
      "sm:border-l",
      "xl:border-t-0",
    );
  });
});
