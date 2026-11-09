import MonitorCriteriaObservationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import { JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A SCRIPT RETURNED, THREW OR PRINTED, IN A ROOT CAUSE (#6341).
 *
 * The root cause of a Custom Code or Synthetic monitor says what the script
 * did: "Result Value was ...", "Script error: ...", "Script log messages:
 * ...". It goes out in email, Slack and Teams, so each value is quoted as
 * any value a root cause quotes (MonitorQuotedValue): redacted, on one
 * line, and bounded - 120 characters of a result or a log line, 80 of an
 * error, whose first words say what went wrong.
 */

const REDACTED: string = "[REDACTED]";

const JWT: string =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

function observe(checkOn: CheckOn, check: JSONObject): string | null {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = MonitorType.CustomJavaScriptCode;

  const criteriaFilter: CriteriaFilter = {
    checkOn: checkOn,
    filterType: FilterType.IsNotEmpty,
    value: undefined,
  };

  return MonitorCriteriaObservationBuilder.describeFilterObservation({
    monitor,
    criteriaFilter,
    dataToProcess: {
      monitorStepId: ObjectID.generate(),
      ...check,
    } as unknown as DataToProcess,
    monitorStep: new MonitorStep(),
  });
}

describe("a Custom Code monitor's run, as a root cause quotes it", () => {
  test("its result: a JSON result's credential and personal fields masked", () => {
    expect(
      observe(CheckOn.ResultValue, {
        customCodeMonitorResponse: {
          result: { ok: false, apiKey: "k-1", contact: "jane@acme.example" },
        },
      }),
    ).toBe(
      `Result Value was {"ok":false,"apiKey":"${REDACTED}","contact":"${REDACTED}"}.`,
    );
  });

  test("its result: a text result read for credentials, on one line, cut at 120", () => {
    expect(
      observe(CheckOn.ResultValue, {
        customCodeMonitorResponse: {
          result: `signed in as jane@acme.example\nwith Bearer ${JWT}`,
        },
      }),
    ).toBe(
      `Result Value was signed in as ${REDACTED} with Bearer ${REDACTED}.`,
    );

    expect(
      observe(CheckOn.ResultValue, {
        customCodeMonitorResponse: { result: "x".repeat(500) },
      }),
    ).toBe(`Result Value was ${"x".repeat(120)}….`);
  });

  test("a result of null or a number reads as written", () => {
    expect(
      observe(CheckOn.ResultValue, {
        customCodeMonitorResponse: { result: null },
      }),
    ).toBe("Result Value was null.");
    expect(
      observe(CheckOn.ResultValue, {
        customCodeMonitorResponse: { result: 42 },
      }),
    ).toBe("Result Value was 42.");
  });

  test("its error: read for credentials, on one line, cut at 80", () => {
    // 80 characters once the token is masked and the lines are joined.
    const quoted: string = `Error: 401 for Bearer ${REDACTED} at main (script.js:4:11) at run (script.js:9:3)`;

    expect(quoted).toHaveLength(80);
    expect(
      observe(CheckOn.Error, {
        customCodeMonitorResponse: {
          scriptError: `Error: 401 for Bearer ${JWT}\n    at main (script.js:4:11)\n    at run (script.js:9:3)\n    at process (node:internal/process:21:7)`,
        },
      }),
    ).toBe(`Script error: ${quoted}….`);
  });

  test("its log lines: each read for credentials and cut at 120", () => {
    expect(
      observe(CheckOn.Error, {
        customCodeMonitorResponse: {
          logMessages: [
            "token=abcdef123456",
            "user jane@acme.example",
            "y".repeat(300),
          ],
        },
      }),
    ).toBe(
      `Script log messages: token=${REDACTED}, user ${REDACTED}, ${"y".repeat(120)}….`,
    );
  });
});

describe("a Synthetic monitor's runs, as a root cause quotes them", () => {
  test("each run's result, read for credentials", () => {
    expect(
      observe(CheckOn.ResultValue, {
        syntheticMonitorResponse: [
          { result: "signed in as jane@acme.example" },
          { result: { session: "s-1", page: "home" } },
          { result: undefined },
        ],
      }),
    ).toBe(
      `Result Value samples: signed in as ${REDACTED}, {"session":"${REDACTED}","page":"home"}.`,
    );
  });

  test("each run's error, read for credentials and cut at 80", () => {
    expect(
      observe(CheckOn.Error, {
        syntheticMonitorResponse: [
          {
            scriptError: "TimeoutError: waiting for #login (password=hunter2)",
          },
          { scriptError: "" },
          { scriptError: `Error: ${"z".repeat(200)}` },
        ],
      }),
    ).toBe(
      `Script errors: TimeoutError: waiting for #login (password=${REDACTED}), Error: ${"z".repeat(73)}….`,
    );
  });
});
