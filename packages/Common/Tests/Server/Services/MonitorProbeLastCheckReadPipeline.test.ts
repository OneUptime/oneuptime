import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import logger from "../../../Server/Utils/Logger";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { useInMemoryTable } from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";

/*
 * A PROBE'S LATEST CHECK THROUGH THE READS PEOPLE MAKE (#6341).
 *
 * MonitorProbe.lastMonitoringLog keeps each step's latest check as the
 * probe sent it, for probe agreement. MonitorProbeService.onFindSuccess
 * cuts it for every read that is not OneUptime's own; the rules are pinned
 * in Tests/Server/Utils/Monitor/MonitorCheckCopiesRedaction.test.ts and
 * who gets which copy in MonitorProbeServiceLastCheckRedaction.test.ts.
 *
 * This drives the reads themselves - findBy (the Probes table, the API's
 * list), findOneBy and findOneById (one row, as the monitor's overview and
 * the API's get read it) - through DatabaseService's whole read pipeline,
 * permission checks included, with the tables in memory: each one a
 * member's read reaches gets the cut copy, and OneUptime's own gets the
 * check as it came.
 */

const REDACTED: string = "[REDACTED]";

const PROJECT_ID: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-000000000001",
);
const MONITOR_ID: string = "d6000000-0000-4000-8000-000000000002";
const QUIET_MONITOR_ID: string = "d6000000-0000-4000-8000-000000000003";
const ROW_ID: string = "d6000000-0000-4000-8000-000000000004";
const QUIET_ROW_ID: string = "d6000000-0000-4000-8000-000000000005";
const PROBE_ID: string = "d6000000-0000-4000-8000-000000000006";

const CONFIGURED_DESTINATION: string =
  "https://api.acme.example/v1/health?tenant={{monitorSecrets.Tenant}}";
const ECHOED_DESTINATION: string =
  "https://api.acme.example/v1/health?tenant=acme-prod-7781";

function stepTo(destination: string): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.monitorDestination = URL.fromString(destination);
  return step;
}

function stepsOf(step: MonitorStep): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };
  return monitorSteps;
}

// A probe's check of an API, as the jsonb column hands it back.
function storedCheck(step: MonitorStep): JSONObject {
  return {
    monitorStepId: { _type: "ObjectID", value: step.id.toString() },
    isOnline: false,
    responseCode: 401,
    responseTimeInMs: 95,
    responseHeaders: {
      "content-type": "application/json",
      authorization: "Bearer abc.def.ghi",
    },
    responseBody: {
      error: "expired",
      user: { email: "jane@acme.example", phone: "+1 555 0100" },
    },
    monitorDestination: { _type: "URL", value: ECHOED_DESTINATION },
    failureCause: "token=abc123 rejected",
  };
}

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            } as UserPermission;
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

const READERS: Array<[string, DatabaseCommonInteractionProps]> = [
  ["a Viewer", member([Permission.Viewer])],
  ["a Monitor Viewer", member([Permission.MonitorViewer])],
  ["a Project Owner", member([Permission.ProjectOwner])],
];

describe("MonitorProbeService: a probe's latest check through the read pipeline", () => {
  let step: MonitorStep;
  let quietStep: MonitorStep;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    step = stepTo(CONFIGURED_DESTINATION);
    quietStep = stepTo(CONFIGURED_DESTINATION);

    useInMemoryTable(MonitorService, [
      {
        _id: MONITOR_ID,
        projectId: PROJECT_ID.toString(),
        name: "Billing API",
        monitorType: MonitorType.API,
        keepResponseContent: true,
        monitorSteps: stepsOf(step),
        version: 1,
      },
      {
        _id: QUIET_MONITOR_ID,
        projectId: PROJECT_ID.toString(),
        name: "Payroll API",
        monitorType: MonitorType.API,
        keepResponseContent: false,
        monitorSteps: stepsOf(quietStep),
        version: 1,
      },
    ]);

    useInMemoryTable(MonitorProbeService, [
      {
        _id: ROW_ID,
        projectId: PROJECT_ID.toString(),
        monitorId: MONITOR_ID,
        probeId: PROBE_ID,
        isEnabled: true,
        lastMonitoringLog: { [step.id.toString()]: storedCheck(step) },
        version: 1,
      },
      {
        _id: QUIET_ROW_ID,
        projectId: PROJECT_ID.toString(),
        monitorId: QUIET_MONITOR_ID,
        probeId: PROBE_ID,
        isEnabled: true,
        lastMonitoringLog: {
          [quietStep.id.toString()]: storedCheck(quietStep),
        },
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function checkOf(row: MonitorProbe | null, ofStep: MonitorStep): JSONObject {
    expect(row).not.toBeNull();

    return (row!.lastMonitoringLog as unknown as JSONObject)[
      ofStep.id.toString()
    ] as JSONObject;
  }

  function expectCut(check: JSONObject): void {
    expect(check["responseHeaders"]).toEqual({
      "content-type": "application/json",
      authorization: REDACTED,
    });
    expect(check["responseBody"]).toEqual({
      error: "expired",
      user: { email: REDACTED, phone: REDACTED },
    });
    expect(check["monitorDestination"]).toBe(CONFIGURED_DESTINATION);
    expect(check["failureCause"]).toBe(`token=${REDACTED} rejected`);
    expect(check["responseCode"]).toBe(401);
    expect(JSON.stringify(check)).not.toContain("acme-prod-7781");
  }

  test.each(READERS)(
    "%s listing them (findBy) gets each check cut by its own monitor's rules",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const rows: Array<MonitorProbe> = await MonitorProbeService.findBy({
        query: {},
        select: {
          _id: true,
          monitorId: true,
          lastMonitoringLog: true,
        },
        limit: 10,
        skip: 0,
        props: props,
      });

      expect(rows).toHaveLength(2);

      const row: MonitorProbe = rows.find((item: MonitorProbe): boolean => {
        return item.id?.toString() === ROW_ID;
      })!;
      const quietRow: MonitorProbe = rows.find(
        (item: MonitorProbe): boolean => {
          return item.id?.toString() === QUIET_ROW_ID;
        },
      )!;

      expectCut(checkOf(row, step));

      // Its monitor keeps no response content: none of it is shown.
      const quiet: JSONObject = checkOf(quietRow, quietStep);

      expect(quiet["responseBody"]).toBeUndefined();
      expect(quiet["responseHeaders"]).toBeUndefined();
      expect(quiet["isResponseContentOmitted"]).toBe(true);
      expect(quiet["monitorDestination"]).toBe(CONFIGURED_DESTINATION);
    },
  );

  test.each(READERS)(
    "%s reading one row (findOneById, findOneBy) gets it cut",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const byId: MonitorProbe | null = await MonitorProbeService.findOneById({
        id: new ObjectID(ROW_ID),
        select: {
          lastMonitoringLog: true,
        },
        props: props,
      });

      expectCut(checkOf(byId, step));

      const byQuery: MonitorProbe | null = await MonitorProbeService.findOneBy({
        query: {
          monitorId: new ObjectID(MONITOR_ID),
          probeId: new ObjectID(PROBE_ID),
        },
        select: {
          monitorId: true,
          lastMonitoringLog: true,
        },
        props: props,
      });

      expectCut(checkOf(byQuery, step));
    },
  );

  test("OneUptime's own read gets each check as the probe sent it: probe agreement judges it", async () => {
    const rows: Array<MonitorProbe> = await MonitorProbeService.findBy({
      query: {
        monitorId: new ObjectID(MONITOR_ID),
      },
      select: {
        monitorId: true,
        lastMonitoringLog: true,
      },
      limit: 10,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    expect(rows).toHaveLength(1);
    expect(checkOf(rows[0]!, step)).toEqual(storedCheck(step));
  });
});
