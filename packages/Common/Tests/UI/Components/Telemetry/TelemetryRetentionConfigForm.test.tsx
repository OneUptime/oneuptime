import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import TelemetryRetentionConfigForm from "../../../../UI/Components/Telemetry/TelemetryRetentionConfigForm";
import TelemetryRetentionConfig from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import { SpanStatus } from "../../../../Models/AnalyticsModels/Span";

/*
 * This form decides when a customer's telemetry is deleted, so the values it
 * emits are not a display concern - they are how long the data exists.
 *
 * Two shapes have to be exactly right and neither is visible from reading the
 * form:
 *
 *  - A cleared field must REMOVE its key, all the way up. A pillar left as
 *    `{}`, or a `bySeverity` left with no entries, is not the same thing as
 *    "no override": it is a configuration object that exists. The whole
 *    config has to collapse to null when nothing is overridden at all.
 *  - A value that is not a positive number of days must clear the field
 *    rather than be stored. Storing 0 or -1 as a retention means data deleted
 *    on the next sweep, from a field the customer was in the middle of
 *    typing.
 */

const emitted: Array<TelemetryRetentionConfig | null> = [];

function renderForm(value?: TelemetryRetentionConfig): void {
  emitted.length = 0;
  render(
    <TelemetryRetentionConfigForm
      value={value}
      onChange={(next: TelemetryRetentionConfig | null): void => {
        emitted.push(next);
      }}
    />,
  );
}

function lastEmitted(): TelemetryRetentionConfig | null {
  return emitted[emitted.length - 1] as TelemetryRetentionConfig | null;
}

/*
 * The four pillar inputs share a placeholder and appear in the order their
 * sections do. "renders the four pillars in a known order" pins that order,
 * so these indices mean what they say.
 */
const PILLAR: Record<string, number> = {
  logs: 0,
  traces: 1,
  metrics: 2,
  profiles: 3,
};

function pillarInput(pillar: string): HTMLElement {
  return screen.getAllByPlaceholderText("Use default retention")[
    PILLAR[pillar] as number
  ] as HTMLElement;
}

function severityInput(index: number): HTMLElement {
  return screen.getAllByPlaceholderText("Use logs default")[
    index
  ] as HTMLElement;
}

function statusInput(index: number): HTMLElement {
  return screen.getAllByPlaceholderText("Use traces default")[
    index
  ] as HTMLElement;
}

function type(element: HTMLElement, value: string): void {
  fireEvent.change(element, { target: { value: value } });
}

afterEach(() => {
  cleanup();
});

describe("TelemetryRetentionConfigForm: layout", () => {
  test("renders the four pillars in a known order", () => {
    renderForm();

    const headings: Array<string> = screen
      .getAllByRole("heading")
      .map((heading: HTMLElement): string => {
        return heading.textContent || "";
      });

    expect(headings).toEqual(["Logs", "Traces", "Metrics", "Profiles"]);
    expect(
      screen.getAllByPlaceholderText("Use default retention"),
    ).toHaveLength(4);
  });

  test("offers an override for every log severity and span status", () => {
    renderForm();

    expect(screen.getAllByPlaceholderText("Use logs default")).toHaveLength(7);
    expect(screen.getAllByPlaceholderText("Use traces default")).toHaveLength(
      3,
    );
  });

  test("starts empty when there is no configuration", () => {
    renderForm();

    expect(pillarInput("logs")).toHaveValue(null);
    expect(severityInput(0)).toHaveValue(null);
  });

  test("shows the values it was given", () => {
    renderForm({
      logs: { default: 30, bySeverity: { [LogSeverity.Error]: 90 } },
      metrics: { default: 15 },
    });

    expect(pillarInput("logs")).toHaveValue(30);
    expect(pillarInput("metrics")).toHaveValue(15);
    expect(severityInput(1)).toHaveValue(90);
  });
});

describe("TelemetryRetentionConfigForm: pillar defaults", () => {
  test.each(["logs", "traces", "metrics", "profiles"])(
    "sets the %s default",
    (pillar: string) => {
      renderForm();
      type(pillarInput(pillar), "45");

      expect(lastEmitted()).toEqual({ [pillar]: { default: 45 } });
    },
  );

  test("keeps the pillars independent of one another", () => {
    renderForm();
    type(pillarInput("logs"), "30");
    type(pillarInput("metrics"), "15");

    expect(lastEmitted()).toEqual({
      logs: { default: 30 },
      metrics: { default: 15 },
    });
  });

  /*
   * Collapsing to null is what tells the caller "no overrides at all, use the
   * platform defaults". An empty object is a configuration that exists and
   * overrides nothing, which is a different thing to everything reading it.
   */
  test("emits null once the last override is cleared", () => {
    renderForm();
    type(pillarInput("logs"), "30");
    expect(lastEmitted()).toEqual({ logs: { default: 30 } });

    type(pillarInput("logs"), "");
    expect(lastEmitted()).toBeNull();
  });

  test("drops only the cleared pillar while another still has a value", () => {
    renderForm();
    type(pillarInput("logs"), "30");
    type(pillarInput("traces"), "10");
    type(pillarInput("logs"), "");

    expect(lastEmitted()).toEqual({ traces: { default: 10 } });
  });

  /*
   * A retention of zero or less is not a shorter retention, it is immediate
   * deletion - and it is what a half-typed "-" or a "0" on the way to "30"
   * looks like. Treat it as no override rather than store it.
   */
  test.each(["0", "-1", "-30"])(
    "treats %s days as no override rather than as a retention",
    (value: string) => {
      renderForm();
      type(pillarInput("logs"), value);

      expect(lastEmitted()).toBeNull();
    },
  );

  test("truncates a fractional number of days", () => {
    renderForm();
    type(pillarInput("logs"), "7.9");

    expect(lastEmitted()).toEqual({ logs: { default: 7 } });
  });

  /*
   * The dangerous middle. "0.9" is greater than zero, so a positivity check
   * made before truncating let it through - and Math.trunc(0.9) is 0, a
   * retention of zero days, which deletes that pillar's telemetry on the
   * next sweep. Whole days are the only unit here: less than one day is an
   * empty field, not an instruction.
   */
  test.each(["0.9", "0.1", "0.0001"])(
    "treats %s of a day as an empty field, not as zero days",
    (value: string) => {
      renderForm();
      type(pillarInput("logs"), value);

      expect(lastEmitted()).toBeNull();
    },
  );
});

describe("TelemetryRetentionConfigForm: per-severity overrides", () => {
  /*
   * Severity inputs follow the order the form lists them: Fatal, Error,
   * Warning, Information, Debug, Trace, Unspecified.
   */
  test("adds an override under the severity it belongs to", () => {
    renderForm();
    type(severityInput(1), "90");

    expect(lastEmitted()).toEqual({
      logs: { bySeverity: { [LogSeverity.Error]: 90 } },
    });
  });

  test("keeps the logs default alongside a severity override", () => {
    renderForm();
    type(pillarInput("logs"), "30");
    type(severityInput(1), "90");

    expect(lastEmitted()).toEqual({
      logs: { default: 30, bySeverity: { [LogSeverity.Error]: 90 } },
    });
  });

  test("clears one severity without touching the others", () => {
    renderForm();
    type(severityInput(1), "90");
    type(severityInput(0), "180");
    type(severityInput(1), "");

    expect(lastEmitted()).toEqual({
      logs: { bySeverity: { [LogSeverity.Fatal]: 180 } },
    });
  });

  /*
   * Removing the last severity has to remove bySeverity itself, and then
   * logs itself - an empty map left behind is a map that exists.
   */
  test("removes the map, then the pillar, when the last override goes", () => {
    renderForm();
    type(severityInput(1), "90");
    type(severityInput(1), "");

    expect(lastEmitted()).toBeNull();
  });

  test("leaves the logs default behind when the last severity override goes", () => {
    renderForm();
    type(pillarInput("logs"), "30");
    type(severityInput(1), "90");
    type(severityInput(1), "");

    expect(lastEmitted()).toEqual({ logs: { default: 30 } });
  });

  test.each(["0", "-5"])(
    "treats a severity override of %s as no override",
    (value: string) => {
      renderForm();
      type(severityInput(1), value);

      expect(lastEmitted()).toBeNull();
    },
  );
});

describe("TelemetryRetentionConfigForm: per-status overrides", () => {
  // Status inputs follow the order the form lists them: Error, Ok, Unset.
  test("adds an override under the span status it belongs to", () => {
    renderForm();
    type(statusInput(0), "60");

    expect(lastEmitted()).toEqual({
      traces: { byStatus: { [SpanStatus.Error]: 60 } },
    });
  });

  test("keeps the traces default alongside a status override", () => {
    renderForm();
    type(pillarInput("traces"), "7");
    type(statusInput(0), "60");

    expect(lastEmitted()).toEqual({
      traces: { default: 7, byStatus: { [SpanStatus.Error]: 60 } },
    });
  });

  test("clears one status without touching the others", () => {
    renderForm();
    type(statusInput(0), "60");
    type(statusInput(1), "3");
    type(statusInput(0), "");

    expect(lastEmitted()).toEqual({
      traces: { byStatus: { [SpanStatus.Ok]: 3 } },
    });
  });

  test("removes the map, then the pillar, when the last override goes", () => {
    renderForm();
    type(statusInput(0), "60");
    type(statusInput(0), "");

    expect(lastEmitted()).toBeNull();
  });

  test("does not disturb the other pillars", () => {
    renderForm();
    type(pillarInput("logs"), "30");
    type(statusInput(0), "60");

    expect(lastEmitted()).toEqual({
      logs: { default: 30 },
      traces: { byStatus: { [SpanStatus.Error]: 60 } },
    });
  });
});
