import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  TELEMETRY_RESOURCE_COPY,
  TELEMETRY_RESOURCE_KEYS,
  TelemetrySetupRowFacts,
  getTelemetryAlertRows,
  getTelemetrySendRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetupResources";
import { TelemetrySetupStep } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetup";
import { GuidedSetupResourceRow } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupResources";
import Route from "../../../Types/API/Route";
import { GuidedSetupResourceStatus } from "../../../Types/GuidedSetup/GuidedSetupRun";

/*
 * WHAT THE TELEMETRY SETUP'S PANEL LISTS (#10276): the service the app's
 * first data makes, then the monitors step 2 makes - waiting for Create,
 * being made, made with Open, put off, or refused with the server's reason
 * and Try again.
 */

const SERVICE_ROUTE: Route = new Route("/dashboard/p/service/svc-1");

function facts(
  extra?: Partial<TelemetrySetupRowFacts>,
): TelemetrySetupRowFacts {
  return {
    service: null,
    serviceRoute: SERVICE_ROUTE,
    monitors: [],
    picked: [],
    refused: [],
    isSaving: false,
    isSkipped: false,
    onRetry: () => {},
    ...extra,
  };
}

function statusesOf(
  rows: Array<GuidedSetupResourceRow>,
): Array<[string, GuidedSetupResourceStatus]> {
  return rows.map(
    (row: GuidedSetupResourceRow): [string, GuidedSetupResourceStatus] => {
      return [row.key, row.status];
    },
  );
}

describe("the telemetry setup's records: step 1", () => {
  test("the service waits for the first data, with nothing to open", () => {
    const [row] = getTelemetrySendRows(facts());

    expect(row!.key).toBe(TELEMETRY_RESOURCE_KEYS.service);
    expect(row!.stepKey).toBe(TelemetrySetupStep.Send);
    expect(row!.kind).toBe(TELEMETRY_RESOURCE_COPY.service);
    expect(row!.status).toBe(GuidedSetupResourceStatus.Waiting);
    expect(row!.statusText).toBeUndefined();
    expect(row!.name).toBeUndefined();
    expect(row!.route).toBeUndefined();
  });

  test("once the data is in, it is receiving data, named as the app named it, and opens its page", () => {
    const [row] = getTelemetrySendRows(
      facts({ service: { id: "svc-1", name: "checkout-api" } }),
    );

    expect(row!.status).toBe(GuidedSetupResourceStatus.Created);
    expect(row!.statusText).toBe(TELEMETRY_RESOURCE_COPY.receivingData);
    expect(row!.name).toBe("checkout-api");
    expect(row!.route).toBe(SERVICE_ROUTE);
  });
});

describe("the telemetry setup's records: step 2", () => {
  const PICKED: TelemetrySetupRowFacts["picked"] = [
    { recommendationId: "error-burst", name: "Error Burst" },
    { recommendationId: "error-log-spike", name: "Error Log Spike" },
  ];

  test("nothing picked and nothing made: no rows, the step's outcome says what is to come", () => {
    expect(getTelemetryAlertRows(facts())).toEqual([]);
  });

  test("each monitor picked waits for Create, then is being made while it runs", () => {
    expect(
      statusesOf(getTelemetryAlertRows(facts({ picked: PICKED }))),
    ).toEqual([
      [TELEMETRY_RESOURCE_KEYS.picked("error-burst"), "waiting"],
      [TELEMETRY_RESOURCE_KEYS.picked("error-log-spike"), "waiting"],
    ]);
    expect(
      statusesOf(
        getTelemetryAlertRows(facts({ picked: PICKED, isSaving: true })),
      ),
    ).toEqual([
      [TELEMETRY_RESOURCE_KEYS.picked("error-burst"), "creating"],
      [TELEMETRY_RESOURCE_KEYS.picked("error-log-spike"), "creating"],
    ]);

    const [first] = getTelemetryAlertRows(facts({ picked: PICKED }));
    expect(first!.stepKey).toBe(TelemetrySetupStep.Alert);
    expect(first!.kind).toBe(TELEMETRY_RESOURCE_COPY.monitor);
    expect(first!.name).toBe("Error Burst");
  });

  test("the monitors made are listed first, each opening its page", () => {
    const route: Route = new Route("/dashboard/p/monitors/mon-1");
    const rows: Array<GuidedSetupResourceRow> = getTelemetryAlertRows(
      facts({
        monitors: [{ id: "mon-1", name: "checkout-api: Error Burst", route }],
        picked: [PICKED[1]!],
      }),
    );

    expect(statusesOf(rows)).toEqual([
      [TELEMETRY_RESOURCE_KEYS.monitor("mon-1"), "created"],
      [TELEMETRY_RESOURCE_KEYS.picked("error-log-spike"), "waiting"],
    ]);
    expect(rows[0]!.name).toBe("checkout-api: Error Burst");
    expect(rows[0]!.route).toBe(route);
    expect(rows[0]!.onRetry).toBeUndefined();
  });

  test("monitors the server refused say why, with Try again, and are not listed twice", () => {
    const onRetry: MockFunction = getJestMockFunction();
    const rows: Array<GuidedSetupResourceRow> = getTelemetryAlertRows(
      facts({
        monitors: [{ id: "mon-1", name: "checkout-api: Error Burst" }],
        // What is still picked is what was refused.
        picked: [PICKED[1]!],
        refused: [
          {
            name: "checkout-api: Error Log Spike",
            message: "This project has reached its monitor limit.",
          },
        ],
        onRetry: onRetry,
      }),
    );

    expect(statusesOf(rows)).toEqual([
      [TELEMETRY_RESOURCE_KEYS.monitor("mon-1"), "created"],
      [TELEMETRY_RESOURCE_KEYS.refused(0), "failed"],
    ]);
    expect(rows[1]!.error).toBe("This project has reached its monitor limit.");
    expect(rows[1]!.name).toBe("checkout-api: Error Log Spike");

    rows[1]!.onRetry!();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("Try again running: what is still picked is being made, the refusals put away", () => {
    expect(
      statusesOf(
        getTelemetryAlertRows(
          facts({
            picked: [PICKED[1]!],
            refused: [{ name: "checkout-api: Error Log Spike", message: "No" }],
            isSaving: true,
          }),
        ),
      ),
    ).toEqual([
      [TELEMETRY_RESOURCE_KEYS.picked("error-log-spike"), "creating"],
    ]);
  });

  test("put off with Not now: what was picked is skipped", () => {
    expect(
      statusesOf(
        getTelemetryAlertRows(facts({ picked: PICKED, isSkipped: true })),
      ),
    ).toEqual([
      [TELEMETRY_RESOURCE_KEYS.picked("error-burst"), "skipped"],
      [TELEMETRY_RESOURCE_KEYS.picked("error-log-spike"), "skipped"],
    ]);
  });

  test("every row's key is its own", () => {
    const rows: Array<GuidedSetupResourceRow> = [
      ...getTelemetrySendRows(facts({ service: { id: "s", name: "s" } })),
      ...getTelemetryAlertRows(
        facts({
          monitors: [
            { id: "mon-1", name: "a" },
            { id: "mon-2", name: "b" },
          ],
          refused: [
            { name: "c", message: "x" },
            { name: "d", message: "y" },
          ],
        }),
      ),
    ];
    const keys: Array<string> = rows.map((row: GuidedSetupResourceRow) => {
      return row.key;
    });

    expect(new Set(keys).size).toBe(keys.length);
  });
});
