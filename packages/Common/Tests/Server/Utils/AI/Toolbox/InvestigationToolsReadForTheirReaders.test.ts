import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import Log from "../../../../../Models/AnalyticsModels/Log";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../../Server/Services/AlertService";
import AlertStateService from "../../../../../Server/Services/AlertStateService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import { QueryAlertsTool } from "../../../../../Server/Utils/AI/Toolbox/AlertTools";
import { QueryMonitorsTool } from "../../../../../Server/Utils/AI/Toolbox/MonitorTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import TelemetryReadAccess from "../../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../../../../../Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ReadAudience from "../../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  keptForAudience,
  readAudienceOf,
  readAudienceProps,
} from "../../../../Helpers/ReadAudienceFixtures";

/*
 * AN INVESTIGATION'S TOOLS, ASKED ALONG THE WAY (#9576). The engine hands
 * every tool the run's props, which carry the report's readers, and each
 * tool reads with them (ToolboxReadsForItsCaller), so the permission layer
 * leaves out of every list, count and aggregate what one of the readers
 * may not read. Here the database is stubbed to answer as the permission
 * layer's conditions make it answer (keptForAudience): a record set apart
 * by an owner or a label, where some role reads its kind only by owner or
 * label, is never named or counted in a tool's answer; one nobody set apart
 * still is; and a project whose roles narrow nobody reads them all.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SET_APART_ALERT: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const OPEN_ALERT: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const SET_APART_MONITOR: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const OPEN_MONITOR: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const SET_APART_SERVICE: string = "cccccccc-cccc-4ccc-8ccc-000000000001";

// A project where a team reads every kind only for some labels.
const NARROWED: ReadAudience = readAudienceOf({
  projectId: PROJECT_ID,
  labelledPermissions: [Permission.ProjectMember],
});
// A project whose roles narrow nobody.
const READERS: ReadAudience = readAudienceOf({ projectId: PROJECT_ID });

function contextFor(audience: ReadAudience): ToolContext {
  return { projectId: PROJECT_ID, props: readAudienceProps(audience) };
}

function alert(id: string, title: string): Alert {
  const row: Alert = new Alert(new ObjectID(id));
  row.title = title;
  row.alertNumber = 1;
  row.createdAt = new Date("2026-11-18T10:00:00.000Z");
  return row;
}

function monitor(id: string, name: string): Monitor {
  const row: Monitor = new Monitor(new ObjectID(id));
  row.name = name;
  return row;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_alerts, asked by an investigation", () => {
  let reads: Array<DatabaseCommonInteractionProps>;

  beforeEach(() => {
    reads = [];
    const rows: Array<Alert> = [
      alert(SET_APART_ALERT, "Payroll export failed (HR only)"),
      alert(OPEN_ALERT, "Checkout latency high"),
    ];
    const kept: (props: DatabaseCommonInteractionProps) => Array<Alert> = (
      props: DatabaseCommonInteractionProps,
    ): Array<Alert> => {
      return keptForAudience({
        modelType: Alert,
        rows,
        props,
        setApartIds: [SET_APART_ALERT],
      });
    };

    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([ObjectID.generate()]);
    jest
      .spyOn(AlertService, "findBy")
      .mockImplementation((async (findBy: {
        props: DatabaseCommonInteractionProps;
      }): Promise<Array<Alert>> => {
        reads.push(findBy.props);
        return kept(findBy.props);
      }) as never);
    jest
      .spyOn(AlertService, "countBy")
      .mockImplementation((async (countBy: {
        props: DatabaseCommonInteractionProps;
      }): Promise<PositiveNumber> => {
        reads.push(countBy.props);
        return new PositiveNumber(kept(countBy.props).length);
      }) as never);
  });

  test("reads and counts with the run's readers", async () => {
    await QueryAlertsTool.execute({ state: "active" }, contextFor(NARROWED));

    expect(reads).toHaveLength(2);

    for (const props of reads) {
      expect(props).toEqual(readAudienceProps(NARROWED));
    }
  });

  test("an alert set apart is neither named nor counted; one nobody set apart is", async () => {
    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { state: "active" },
      contextFor(NARROWED),
    );

    expect(result.dataForLlm).toContain("Checkout latency high");
    expect(result.dataForLlm).not.toContain("Payroll");
    expect(result.dataForLlm).not.toContain(SET_APART_ALERT);
    expect(result.rowCount).toBe(1);
  });

  test("a project whose roles narrow nobody names it, as before", async () => {
    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { state: "active" },
      contextFor(READERS),
    );

    expect(result.dataForLlm).toContain("Payroll export failed");
    expect(result.rowCount).toBe(2);
  });
});

describe("query_monitors, asked by an investigation", () => {
  beforeEach(() => {
    const rows: Array<Monitor> = [
      monitor(SET_APART_MONITOR, "payroll-db (HR only)"),
      monitor(OPEN_MONITOR, "checkout-api"),
    ];
    const kept: (props: DatabaseCommonInteractionProps) => Array<Monitor> = (
      props: DatabaseCommonInteractionProps,
    ): Array<Monitor> => {
      return keptForAudience({
        modelType: Monitor,
        rows,
        props,
        setApartIds: [SET_APART_MONITOR],
      });
    };

    jest
      .spyOn(MonitorService, "findBy")
      .mockImplementation((async (findBy: {
        props: DatabaseCommonInteractionProps;
      }): Promise<Array<Monitor>> => {
        return kept(findBy.props);
      }) as never);
    jest
      .spyOn(MonitorService, "countBy")
      .mockImplementation((async (countBy: {
        props: DatabaseCommonInteractionProps;
      }): Promise<PositiveNumber> => {
        return new PositiveNumber(kept(countBy.props).length);
      }) as never);
  });

  test("a monitor set apart is neither named nor counted; one nobody set apart is", async () => {
    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      {},
      contextFor(NARROWED),
    );

    expect(result.dataForLlm).toContain("checkout-api");
    expect(result.dataForLlm).not.toContain("payroll-db");
    expect(result.rowCount).toBe(1);
  });

  test("a project whose roles narrow nobody names it, as before", async () => {
    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      {},
      contextFor(READERS),
    );

    expect(result.dataForLlm).toContain("payroll-db");
    expect(result.rowCount).toBe(2);
  });
});

/*
 * Every telemetry tool asks TelemetryReadAccess whose telemetry its caller
 * may read (ToolboxTelemetryReadScope): an investigation is answered with
 * every resource but those set apart.
 */
describe("the telemetry tools, asked by an investigation", () => {
  test("a service set apart is left out of every aggregation request", async () => {
    const filter: TelemetryServiceFilter =
      await TelemetryReadAccess.getServiceFilter({
        modelType: Log,
        props: readAudienceProps(
          readAudienceOf({
            projectId: PROJECT_ID,
            labelledPermissions: [Permission.ReadService],
            telemetryBlockedIds: [SET_APART_SERVICE],
          }),
        ),
      });

    expect(
      (filter.excludedServiceIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SET_APART_SERVICE]);
  });

  test("asked for the service set apart, it reads nothing of it", async () => {
    const filter: TelemetryServiceFilter =
      await TelemetryReadAccess.getServiceFilter({
        modelType: Log,
        props: readAudienceProps(
          readAudienceOf({
            projectId: PROJECT_ID,
            labelledPermissions: [Permission.ReadService],
            telemetryBlockedIds: [SET_APART_SERVICE],
          }),
        ),
        requested: [SET_APART_SERVICE],
      });

    expect(
      (filter.serviceIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).not.toContain(SET_APART_SERVICE);
  });

  test("a project whose roles narrow nobody reads every service's telemetry, as before", async () => {
    expect(
      await TelemetryReadAccess.getServiceFilter({
        modelType: Log,
        props: readAudienceProps(READERS),
      }),
    ).toEqual({});
  });
});
