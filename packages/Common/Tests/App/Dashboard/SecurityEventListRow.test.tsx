/** @timezone UTC */

import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SecurityEventListRow, {
  SECURITY_EVENT_ROW_ATTRIBUTE_CHIP_TEST_ID,
  SECURITY_EVENT_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventListRow";
import { SECURITY_EVENT_VOLUME_COLORS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventVolume";
import {
  SecurityEventAttributeColumn,
  buildSecurityEventAttributeColumns,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeColumns";

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
  props: {
    isSelected?: boolean;
    onClick?: () => void;
    attributeColumns?: Array<SecurityEventAttributeColumn>;
  } = {},
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

/*
 * Source attributes the viewer chose to see on every row — the fields a
 * Google SecOps detection buries hundreds deep in `attributes`, like the
 * target's first name or the office it sits in.
 */
describe("chosen attribute columns", () => {
  const FIRST_NAME_KEY: string =
    "collectionElements.0.references.0.event.target.user.firstName";
  const CITY_KEY: string =
    "collectionElements.0.references.0.event.target.user.personalAddress.city";
  const ADDRESS_KEY: string =
    "collectionElements.0.references.0.event.target.user.personalAddress.name";

  const COLUMNS: Array<SecurityEventAttributeColumn> =
    buildSecurityEventAttributeColumns([FIRST_NAME_KEY, CITY_KEY, ADDRESS_KEY]);

  const DETECTION: SecurityEvent = event({
    className: "Detection Finding",
    message: "Mass_Password_Reset_Modification",
    targetUser: "jdoe@example.com",
    vendorName: "Google",
    attributes: {
      [FIRST_NAME_KEY]: "jdoe",
      [CITY_KEY]: "Springfield",
      [ADDRESS_KEY]: "100 Example Ave",
      "collectionElements.0.references.0.event.target.user.title": "WB Unit",
    },
  });

  function attributeChips(): Array<HTMLElement> {
    return screen.queryAllByTestId(SECURITY_EVENT_ROW_ATTRIBUTE_CHIP_TEST_ID);
  }

  test("each chosen attribute gets a labelled chip with the event's value", () => {
    renderRow(DETECTION, { attributeColumns: COLUMNS });

    for (const [label, value] of [
      ["user.firstName", "jdoe"],
      ["personalAddress.city", "Springfield"],
      ["personalAddress.name", "100 Example Ave"],
    ]) {
      const labelNode: HTMLElement = screen.getByText(label as string);
      expect(labelNode.parentElement).toHaveTextContent(value as string);
    }
  });

  test("the chips follow the viewer's order", () => {
    renderRow(DETECTION, {
      attributeColumns: buildSecurityEventAttributeColumns([
        CITY_KEY,
        FIRST_NAME_KEY,
      ]),
    });

    expect(
      attributeChips().map((chip: HTMLElement): string => {
        return chip.getAttribute("data-attribute-key") || "";
      }),
    ).toEqual([CITY_KEY, FIRST_NAME_KEY]);
  });

  test("the label's tooltip names the full key, the value's the full value", () => {
    renderRow(DETECTION, { attributeColumns: COLUMNS });

    expect(screen.getByText("user.firstName")).toHaveAttribute(
      "title",
      FIRST_NAME_KEY,
    );
    expect(screen.getByText("100 Example Ave")).toHaveAttribute(
      "title",
      "100 Example Ave",
    );
  });

  test("an attribute this event does not carry gets no chip at all", () => {
    renderRow(
      event({
        message: "another rule",
        attributes: { [CITY_KEY]: "Austin", [FIRST_NAME_KEY]: "   " },
      }),
      { attributeColumns: COLUMNS },
    );

    expect(attributeChips()).toHaveLength(1);
    expect(attributeChips()[0]).toHaveTextContent("Austin");
    expect(screen.queryByText("user.firstName")).toBeNull();
    expect(screen.queryByText("personalAddress.name")).toBeNull();
  });

  test("an event with no attributes at all renders as before", () => {
    renderRow(event({ principalUser: "alice" }), {
      attributeColumns: COLUMNS,
    });

    expect(attributeChips()).toHaveLength(0);
    expect(screen.getByText("user")).toBeInTheDocument();
  });

  test("they come after the typed chips, which stay exactly as they were", () => {
    renderRow(DETECTION, { attributeColumns: COLUMNS });

    const chipLine: HTMLElement = attributeChips()[0]!
      .parentElement as HTMLElement;
    const chipLabels: Array<string> = Array.from(chipLine.children).map(
      (chip: Element): string => {
        return chip.firstElementChild?.textContent || "";
      },
    );

    expect(chipLabels).toEqual([
      "target user",
      "vendor",
      "user.firstName",
      "personalAddress.city",
      "personalAddress.name",
    ]);
  });

  test("no chosen attributes, no attribute chips — even on an event that has them", () => {
    renderRow(DETECTION);

    expect(attributeChips()).toHaveLength(0);
    expect(row()).not.toHaveTextContent("Springfield");
  });

  test("a chosen attribute chip is set apart from the typed ones", () => {
    renderRow(DETECTION, { attributeColumns: COLUMNS });

    const typedChip: HTMLElement = screen.getByText("vendor")
      .parentElement as HTMLElement;

    expect(attributeChips()[0]!.className).not.toBe(typedChip.className);
  });

  test("clicking an attribute chip still opens the event", () => {
    const onClick: MockFunction = getJestMockFunction();

    renderRow(DETECTION, {
      attributeColumns: COLUMNS,
      onClick: onClick as unknown as () => void,
    });

    fireEvent.click(screen.getByText("Springfield"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
