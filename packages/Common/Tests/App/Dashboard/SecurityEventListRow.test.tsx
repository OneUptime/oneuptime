/** @timezone UTC */

import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SecurityEventListRow, {
  SECURITY_EVENT_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventListRow";
import { SECURITY_EVENT_VOLUME_COLORS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventVolume";

/*
 * One security event as a dense list row — the shape the logs and traces
 * explorers use, rather than a grid of table cells.
 *
 * Line one is the read that has to work while scrolling: when, how bad, what
 * class, what happened. Line two is the context a responder scans for, and
 * every chip on it is labelled because `svc-deploy` and `web-01` are
 * indistinguishable without one — a SIEM row that shows the wrong side of an
 * interaction is worse than one that shows nothing.
 */

function event(fields: Partial<SecurityEvent> = {}): SecurityEvent {
  return Object.assign(new SecurityEvent(), fields);
}

function renderRow(
  securityEvent: SecurityEvent,
  props: { isSelected?: boolean; onClick?: () => void } = {},
): void {
  render(<SecurityEventListRow securityEvent={securityEvent} {...props} />);
}

function row(): HTMLElement {
  return screen.getByTestId(SECURITY_EVENT_ROW_TEST_ID);
}

function severityDot(): HTMLElement {
  const dot: Element | null = row().querySelector("span[aria-hidden='true']");

  if (!dot) {
    throw new Error("The row has no severity dot.");
  }

  return dot as HTMLElement;
}

afterEach(() => {
  cleanup();
});

describe("what the row says", () => {
  test("reads severity, class and message on one line", () => {
    renderRow(
      event({
        time: new Date("2026-09-17T10:00:00.000Z"),
        severityName: OcsfSeverity.Critical,
        className: "Authentication",
        message: "Failed logon for alice",
      }),
    );

    expect(row()).toHaveTextContent("Critical");
    expect(row()).toHaveTextContent("Authentication");
    expect(row()).toHaveTextContent("Failed logon for alice");
  });

  test("only the first line of a multi-line message is shown", () => {
    renderRow(
      event({ message: "Failed logon\n  at Authenticator.verify\n  at ..." }),
    );

    expect(row()).toHaveTextContent("Failed logon");
    expect(row()).not.toHaveTextContent("Authenticator.verify");
  });

  test("an event with no message says so rather than showing a blank line", () => {
    renderRow(event({ className: "Authentication" }));

    expect(row()).toHaveTextContent("No message recorded");
  });

  test("labels every identity chip, so the two sides of an interaction stay apart", () => {
    renderRow(
      event({
        principalUser: "alice",
        principalHost: "web-01",
        principalIp: "10.0.0.4",
        targetUser: "root",
        targetHost: "db-01",
        targetIp: "10.0.0.9",
        statusName: "Failure",
        ruleName: "BruteForce",
        vendorName: "Acme",
      }),
    );

    for (const [label, value] of [
      ["user", "alice"],
      ["host", "web-01"],
      ["ip", "10.0.0.4"],
      ["target user", "root"],
      ["target host", "db-01"],
      ["target ip", "10.0.0.9"],
      ["status", "Failure"],
      ["rule", "BruteForce"],
      ["vendor", "Acme"],
    ]) {
      const labelNode: HTMLElement = screen.getByText(label as string);
      expect(labelNode.parentElement).toHaveTextContent(value as string);
    }
  });

  test("a field the source did not send gets no chip at all", () => {
    renderRow(event({ principalUser: "alice" }));

    expect(screen.getByText("user")).toBeInTheDocument();
    expect(screen.queryByText("host")).toBeNull();
    expect(screen.queryByText("target user")).toBeNull();
    expect(screen.queryByText("rule")).toBeNull();
  });

  test("the time is shown, and an event with none renders without one", () => {
    renderRow(event({ time: new Date("2026-09-17T10:00:00.000Z") }));

    expect(row().textContent).toContain("2026");

    cleanup();
    renderRow(event({ message: "no time" }));

    expect(row()).toHaveTextContent("no time");
  });
});

describe("severity colour", () => {
  test("uses the volume chart's palette, so a colour means one thing on the page", () => {
    renderRow(event({ severityName: OcsfSeverity.Critical }));

    expect(severityDot()).toHaveStyle({
      backgroundColor: SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.Critical],
    });
  });

  /*
   * The column defaults to '' and pre-normalization rows exist. Anything that
   * is not an OCSF name is read as Unknown — the same fallback the volume
   * chart uses, so the chart's total always equals the number of rows listed.
   */
  test("an unrecognised or missing severity reads as Unknown", () => {
    renderRow(event({ severityName: "" as OcsfSeverity }));

    expect(row()).toHaveTextContent(OcsfSeverity.Unknown);
    expect(severityDot()).toHaveStyle({
      backgroundColor: SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.Unknown],
    });

    cleanup();
    renderRow(event({ severityName: "SUPER-BAD" as OcsfSeverity }));

    expect(row()).toHaveTextContent(OcsfSeverity.Unknown);
  });

  test.each([
    OcsfSeverity.Fatal,
    OcsfSeverity.Critical,
    OcsfSeverity.High,
    OcsfSeverity.Medium,
    OcsfSeverity.Low,
    OcsfSeverity.Informational,
    OcsfSeverity.Other,
    OcsfSeverity.Unknown,
  ])("%s has its own colour", (severity: OcsfSeverity): void => {
    renderRow(event({ severityName: severity }));

    expect(severityDot()).toHaveStyle({
      backgroundColor: SECURITY_EVENT_VOLUME_COLORS[severity],
    });
  });
});

describe("opening an event", () => {
  test("the whole row is one button", () => {
    renderRow(event({ message: "Failed logon" }));

    expect(row().tagName).toBe("BUTTON");
    expect(row()).toHaveAttribute("type", "button");
  });

  test("clicking it asks the page to open the event", () => {
    const onClick: MockFunction = getJestMockFunction();

    renderRow(event({ message: "Failed logon" }), {
      onClick: onClick as unknown as () => void,
    });

    fireEvent.click(row());

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("the open event is marked, so the list says which one the drawer shows", () => {
    renderRow(event({ message: "Failed logon" }), { isSelected: true });

    expect(row()).toHaveAttribute("aria-pressed", "true");

    cleanup();
    renderRow(event({ message: "Failed logon" }));

    expect(row()).not.toHaveAttribute("aria-pressed");
  });
});
