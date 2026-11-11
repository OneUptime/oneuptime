import StateChangeLogScreenshots, {
  SCREENSHOTS_OMITTED_FIELD,
} from "../../../Utils/Monitor/StateChangeLogScreenshots";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A STATE CHANGE'S LOG KEEPS NO SCREENSHOTS (issue #6903).
 *
 * The check that opened or resolved an incident or an alert is kept with the
 * state change (IncidentStateTimeline.stateChangeLog,
 * AlertStateTimeline.stateChangeLog). A Synthetic monitor's check carries a
 * base64 screenshot per browser and screen size - megabytes a row, 13 GB for
 * one installation's 46 thousand incident state changes - and the log is
 * read as JSON text, where a screenshot is pages of base64. So the log keeps
 * everything but them, and each run that had some says it left them out.
 * Only a Synthetic run's screenshots go: what a Custom Code script returned
 * is the script's, whatever its keys are called.
 */

// A screenshot as a probe sends one: a PNG, base64, about this long a megabyte.
function screenshot(seed: string, bytes: number = 1024): string {
  return `iVBORw0KGgo${seed}`.padEnd(bytes, "A");
}

// A Synthetic monitor's check, as MonitorRecordEvidence stores it.
function syntheticCheck(): JSONObject {
  return {
    monitorId: "6f000000-0000-4000-8000-000000000001",
    probeId: "6f000000-0000-4000-8000-000000000002",
    isOnline: false,
    monitoredAt: "2026-11-11T10:00:00.000Z",
    failureCause: "The checkout page did not load.",
    syntheticMonitorResponse: [
      {
        browserType: "Chromium",
        screenSizeType: "Desktop",
        executionTimeInMS: 5120,
        logMessages: ["Opened https://shop.example.com", "Clicked Checkout"],
        scriptError: "Timeout 30000ms exceeded.",
        result: { step: "checkout", ok: false },
        capturedMetrics: [{ name: "checkout.load", value: 5120 }],
        retryAttempts: [
          {
            attemptNumber: 1,
            scriptError: "timeout",
            executionTimeInMS: 30000,
          },
        ],
        totalAttempts: 2,
        screenshots: {
          "checkout-page": screenshot("desktop-1"),
          "after-click": screenshot("desktop-2"),
        },
      },
      {
        browserType: "Firefox",
        screenSizeType: "Mobile",
        executionTimeInMS: 4870,
        logMessages: ["Opened https://shop.example.com"],
        result: null,
        capturedMetrics: [],
        screenshots: {
          "checkout-page": screenshot("mobile-1"),
        },
      },
    ],
  };
}

function copyOf(value: JSONObject): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

function runsOf(log: JSONObject): Array<JSONObject> {
  return log["syntheticMonitorResponse"] as Array<JSONObject>;
}

describe("StateChangeLogScreenshots.leaveOut", () => {
  test("leaves out every run's screenshots, and each such run says so", () => {
    const stored: JSONObject =
      StateChangeLogScreenshots.leaveOut(syntheticCheck());

    for (const run of runsOf(stored)) {
      expect(run).not.toHaveProperty("screenshots");
      expect(run[SCREENSHOTS_OMITTED_FIELD]).toBe(true);
    }

    expect(SCREENSHOTS_OMITTED_FIELD).toBe("areScreenshotsOmitted");
    expect(JSON.stringify(stored)).not.toContain("iVBORw0KGgo");
  });

  test("keeps everything else the check said: the runs' logs, errors, results and timings, and the check's own fields", () => {
    const original: JSONObject = syntheticCheck();
    const stored: JSONObject = StateChangeLogScreenshots.leaveOut(original);

    const expected: JSONObject = copyOf(original);

    for (const run of runsOf(expected)) {
      delete run["screenshots"];
      run[SCREENSHOTS_OMITTED_FIELD] = true;
    }

    expect(stored).toEqual(expected);
  });

  test("changes nothing it was given: the monitor's own logs keep the screenshots", () => {
    const original: JSONObject = syntheticCheck();
    const before: JSONObject = copyOf(original);

    StateChangeLogScreenshots.leaveOut(original);

    expect(original).toEqual(before);
  });

  test("a check with screenshots of megabytes keeps a few hundred bytes of the runs", () => {
    const check: JSONObject = syntheticCheck();

    for (const run of runsOf(check)) {
      run["screenshots"] = {
        "full-page": screenshot("big", 3 * 1024 * 1024),
      };
    }

    const stored: JSONObject = StateChangeLogScreenshots.leaveOut(check);

    expect(JSON.stringify(check).length).toBeGreaterThan(6 * 1024 * 1024);
    expect(JSON.stringify(stored).length).toBeLessThan(2 * 1024);
  });

  test("only the runs that had screenshots say they were left out", () => {
    const check: JSONObject = syntheticCheck();
    delete runsOf(check)[1]!["screenshots"];
    runsOf(check).push({
      browserType: "Webkit",
      screenSizeType: "Tablet",
      executionTimeInMS: 10,
      logMessages: [],
      result: null,
      capturedMetrics: [],
      screenshots: {},
    });

    const stored: JSONObject = StateChangeLogScreenshots.leaveOut(check);
    const runs: Array<JSONObject> = runsOf(stored);

    expect(runs[0]![SCREENSHOTS_OMITTED_FIELD]).toBe(true);
    expect(runs[1]).toEqual(runsOf(check)[1]);
    expect(runs[1]).not.toHaveProperty(SCREENSHOTS_OMITTED_FIELD);
    // An empty set of screenshots had nothing to leave out.
    expect(runs[2]).toEqual(runsOf(check)[2]);
  });

  test("a log with no screenshots comes back as it was given: the same object", () => {
    const check: JSONObject = syntheticCheck();

    for (const run of runsOf(check)) {
      delete run["screenshots"];
    }

    expect(StateChangeLogScreenshots.leaveOut(check)).toBe(check);

    const httpCheck: JSONObject = {
      responseCode: 503,
      responseTimeInMs: 812,
      responseBody: "<html>Service Unavailable</html>",
      responseHeaders: { "content-type": "text/html" },
    };

    expect(StateChangeLogScreenshots.leaveOut(httpCheck)).toBe(httpCheck);
  });

  test("what a Custom Code script returned is the script's, even under a key called screenshots", () => {
    const check: JSONObject = {
      customCodeMonitorResponse: {
        result: { screenshots: { home: "a picture the script took" } },
        logMessages: [],
        capturedMetrics: [],
        executionTimeInMS: 12,
      },
      screenshots: { "not-a-run": screenshot("other") },
    };

    expect(StateChangeLogScreenshots.leaveOut(check)).toBe(check);
  });

  test("a Synthetic run's screenshots are left out wherever the check keeps its runs", () => {
    const check: JSONObject = {
      steps: [{ name: "Checkout", response: syntheticCheck() }],
    };

    const stored: JSONObject = StateChangeLogScreenshots.leaveOut(check);
    const step: JSONObject = (stored["steps"] as Array<JSONObject>)[0]!;

    for (const run of runsOf(step["response"] as JSONObject)) {
      expect(run).not.toHaveProperty("screenshots");
      expect(run[SCREENSHOTS_OMITTED_FIELD]).toBe(true);
    }
  });

  test("a run that is not an object is kept as it is", () => {
    const check: JSONObject = syntheticCheck();
    runsOf(check).push("a run as text" as unknown as JSONObject);

    const stored: JSONObject = StateChangeLogScreenshots.leaveOut(check);

    expect(runsOf(stored)[2]).toBe("a run as text");
    expect(runsOf(stored)[0]![SCREENSHOTS_OMITTED_FIELD]).toBe(true);
  });

  test.each([[null], [undefined]])(
    "%p is given back",
    (value: null | undefined) => {
      expect(StateChangeLogScreenshots.leaveOut(value)).toBe(value);
    },
  );

  test("the walk is bounded: a log nested past any check's depth is given back as it is", () => {
    let deep: JSONObject = syntheticCheck();

    for (let level: number = 0; level < 20; level++) {
      deep = { nested: deep };
    }

    expect(StateChangeLogScreenshots.leaveOut(deep)).toBe(deep);
  });
});

describe("StateChangeLogScreenshots.hasAny", () => {
  test("finds a Synthetic run's screenshots, and nothing else", () => {
    expect(StateChangeLogScreenshots.hasAny(syntheticCheck(), 0)).toBe(true);
    expect(
      StateChangeLogScreenshots.hasAny(
        { syntheticMonitorResponse: [{ screenshots: {} }] },
        0,
      ),
    ).toBe(false);
    expect(
      StateChangeLogScreenshots.hasAny(
        { syntheticMonitorResponse: { screenshots: { a: "b" } } },
        0,
      ),
    ).toBe(false);
    expect(StateChangeLogScreenshots.hasAny("text", 0)).toBe(false);
    expect(StateChangeLogScreenshots.hasAny(undefined, 0)).toBe(false);
  });
});
