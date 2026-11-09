import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import { OnFind } from "../../../Server/Types/Database/Hooks";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A PROBE'S LATEST CHECK, AS ITS READERS GET IT (#6341).
 *
 * MonitorProbe.lastMonitoringLog keeps each step's latest check as the
 * probe sent it: probe agreement judges it again against the criteria, and
 * a filter on the body needs the body. Every read that is not OneUptime's
 * own - the Probes page, the monitor's overview, the API - gets it cut as
 * the monitor's logs are, by its monitor's switch and its step's
 * destination. The rules themselves are pinned in
 * Tests/Server/Utils/Monitor/MonitorCheckCopiesRedaction.test.ts; this pins
 * who gets which copy.
 */

const REDACTED: string = "[REDACTED]";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b6c7d8e-9f0a-4b1c-8d3e-4f5a6b7c8d9e",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "6c7d8e9f-0a1b-4c2d-9e4f-5a6b7c8d9e0f",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "7d8e9f0a-1b2c-4d3e-8f5a-6b7c8d9e0f1a",
);

const READER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("8e9f0a1b-2c3d-4e4f-9a6b-7c8d9e0f1a2b"),
};

function stepTo(destination: string): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.monitorDestination = URL.fromString(destination);
  return step;
}

function monitorOf(input: {
  id: ObjectID;
  step: MonitorStep;
  keepResponseContent?: boolean | undefined;
}): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [input.step],
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = input.id;
  monitor.monitorType = MonitorType.API;
  monitor.monitorSteps = monitorSteps;

  if (input.keepResponseContent !== undefined) {
    monitor.keepResponseContent = input.keepResponseContent;
  }

  return monitor;
}

// A probe's check of an API, as the column hands it back.
function lastCheck(step: MonitorStep): JSONObject {
  return {
    monitorStepId: { _type: "ObjectID", value: step.id.toString() },
    isOnline: false,
    responseCode: 401,
    responseTimeInMs: 95,
    responseHeaders: {
      "content-type": "application/json",
      "set-cookie": "sid=abc",
    },
    responseBody: { error: "expired", user: { email: "jane@acme.example" } },
    monitorDestination: {
      _type: "URL",
      value: "https://api.acme.example/v1?tenant=acme-prod-7781",
    },
    failureCause: "token=abc123 rejected",
  };
}

function rowOf(input: {
  monitorId?: ObjectID | undefined;
  checks: JSONObject;
}): MonitorProbe {
  const row: MonitorProbe = new MonitorProbe();
  row.id = ObjectID.generate();

  if (input.monitorId) {
    row.monitorId = input.monitorId;
  }

  row.lastMonitoringLog = input.checks as unknown as MonitorStepProbeResponse;
  return row;
}

type OnFindSuccessFunction = (
  onFind: OnFind<MonitorProbe>,
  items: Array<MonitorProbe>,
) => Promise<OnFind<MonitorProbe>>;

async function read(
  rows: Array<MonitorProbe>,
  props: DatabaseCommonInteractionProps,
): Promise<Array<MonitorProbe>> {
  const onFindSuccess: OnFindSuccessFunction = (
    MonitorProbeService as unknown as { onFindSuccess: OnFindSuccessFunction }
  ).onFindSuccess.bind(MonitorProbeService);

  const result: OnFind<MonitorProbe> = await onFindSuccess(
    {
      findBy: {
        query: {},
        select: { lastMonitoringLog: true },
        limit: 10,
        skip: 0,
        props: props,
      },
      carryForward: null,
    },
    rows,
  );

  return result.carryForward as Array<MonitorProbe>;
}

function checkOf(row: MonitorProbe, step: MonitorStep): JSONObject {
  return (row.lastMonitoringLog as unknown as JSONObject)[
    step.id.toString()
  ] as JSONObject;
}

describe("MonitorProbeService: a probe's latest check as its readers get it", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("OneUptime's own read gets the check as the probe sent it: probe agreement judges it", async () => {
    const step: MonitorStep = stepTo("https://api.acme.example/v1");
    const findMonitors: SpyInstance<typeof MonitorService.findBy> = jest.spyOn(
      MonitorService,
      "findBy",
    );

    const rows: Array<MonitorProbe> = await read(
      [
        rowOf({
          monitorId: MONITOR_ID,
          checks: { [step.id.toString()]: lastCheck(step) },
        }),
      ],
      { isRoot: true },
    );

    expect(checkOf(rows[0]!, step)).toEqual(lastCheck(step));
    expect(findMonitors).not.toHaveBeenCalled();
  });

  test("a person's read gets it cut as the monitor's logs are", async () => {
    const step: MonitorStep = stepTo(
      "https://api.acme.example/v1?tenant={{monitorSecrets.Tenant}}",
    );

    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([monitorOf({ id: MONITOR_ID, step })]);

    const rows: Array<MonitorProbe> = await read(
      [
        rowOf({
          monitorId: MONITOR_ID,
          checks: { [step.id.toString()]: lastCheck(step) },
        }),
      ],
      READER,
    );

    expect(checkOf(rows[0]!, step)).toEqual({
      monitorStepId: { _type: "ObjectID", value: step.id.toString() },
      isOnline: false,
      responseCode: 401,
      responseTimeInMs: 95,
      responseHeaders: {
        "content-type": "application/json",
        "set-cookie": REDACTED,
      },
      responseBody: { error: "expired", user: { email: REDACTED } },
      // The destination as configured, the secret by name.
      monitorDestination:
        "https://api.acme.example/v1?tenant={{monitorSecrets.Tenant}}",
      failureCause: `token=${REDACTED} rejected`,
    });
  });

  test("by its own monitor's switch: a monitor that keeps no response content shows none", async () => {
    const step: MonitorStep = stepTo("https://api.acme.example/v1");
    const otherStep: MonitorStep = stepTo("https://other.acme.example");

    const findMonitors: SpyInstance<typeof MonitorService.findBy> = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        monitorOf({ id: MONITOR_ID, step, keepResponseContent: false }),
        monitorOf({ id: OTHER_MONITOR_ID, step: otherStep }),
      ]);

    const rows: Array<MonitorProbe> = await read(
      [
        rowOf({
          monitorId: MONITOR_ID,
          checks: { [step.id.toString()]: lastCheck(step) },
        }),
        rowOf({
          monitorId: OTHER_MONITOR_ID,
          checks: { [otherStep.id.toString()]: lastCheck(otherStep) },
        }),
        rowOf({
          monitorId: MONITOR_ID,
          checks: { [step.id.toString()]: lastCheck(step) },
        }),
      ],
      READER,
    );

    for (const row of [rows[0]!, rows[2]!]) {
      const check: JSONObject = checkOf(row, step);

      expect(check["responseBody"]).toBeUndefined();
      expect(check["responseHeaders"]).toBeUndefined();
      expect(check["isResponseContentOmitted"]).toBe(true);
      expect(check["responseCode"]).toBe(401);
    }

    expect(checkOf(rows[1]!, otherStep)["responseBody"]).toEqual({
      error: "expired",
      user: { email: REDACTED },
    });

    // One read of the monitors, each asked for once, as OneUptime reads them.
    expect(findMonitors).toHaveBeenCalledTimes(1);

    const query: JSONObject = findMonitors.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(query["props"]).toEqual({ isRoot: true });
    expect(query["select"]).toEqual({
      _id: true,
      keepResponseContent: true,
      monitorSteps: true,
    });
  });

  test("a read that did not select the monitor still gets its monitor's rules", async () => {
    const step: MonitorStep = stepTo("https://api.acme.example/v1");
    const row: MonitorProbe = rowOf({
      checks: { [step.id.toString()]: lastCheck(step) },
    });

    const findRows: SpyInstance<typeof MonitorProbeService.findBy> = jest
      .spyOn(MonitorProbeService, "findBy")
      .mockImplementation(async (): Promise<Array<MonitorProbe>> => {
        const found: MonitorProbe = new MonitorProbe();
        found.id = row.id!;
        found.monitorId = MONITOR_ID;
        return [found];
      });

    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        monitorOf({ id: MONITOR_ID, step, keepResponseContent: false }),
      ]);

    const rows: Array<MonitorProbe> = await read([row], READER);

    expect(findRows).toHaveBeenCalledTimes(1);
    expect(
      (findRows.mock.calls[0]![0] as unknown as JSONObject)["props"],
    ).toEqual({ isRoot: true });
    expect(checkOf(rows[0]!, step)["responseBody"]).toBeUndefined();
    expect(checkOf(rows[0]!, step)["isResponseContentOmitted"]).toBe(true);
  });

  test("a check whose monitor cannot be read shows no response content: the switch is unknown", async () => {
    const step: MonitorStep = stepTo("https://api.acme.example/v1");

    jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);

    const rows: Array<MonitorProbe> = await read(
      [
        rowOf({
          monitorId: MONITOR_ID,
          checks: { [step.id.toString()]: lastCheck(step) },
        }),
      ],
      READER,
    );

    const check: JSONObject = checkOf(rows[0]!, step);

    expect(check["responseBody"]).toBeUndefined();
    expect(check["responseHeaders"]).toBeUndefined();
    expect(check["isResponseContentOmitted"]).toBe(true);
    // Without its step, the address the probe echoed - read by the URL rules.
    expect(check["monitorDestination"]).toBe(
      "https://api.acme.example/v1?tenant=acme-prod-7781",
    );
    expect(check["failureCause"]).toBe(`token=${REDACTED} rejected`);
  });

  test("rows without a latest check cost no read", async () => {
    const findMonitors: SpyInstance<typeof MonitorService.findBy> = jest.spyOn(
      MonitorService,
      "findBy",
    );
    const findRows: SpyInstance<typeof MonitorProbeService.findBy> = jest.spyOn(
      MonitorProbeService,
      "findBy",
    );

    const empty: MonitorProbe = new MonitorProbe();
    empty.id = ObjectID.generate();
    empty.monitorId = MONITOR_ID;

    const rows: Array<MonitorProbe> = await read(
      [empty, rowOf({ monitorId: MONITOR_ID, checks: {} })],
      READER,
    );

    expect(rows).toHaveLength(2);
    expect(findMonitors).not.toHaveBeenCalled();
    expect(findRows).not.toHaveBeenCalled();
  });
});
