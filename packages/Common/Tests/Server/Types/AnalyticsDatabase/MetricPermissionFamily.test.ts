import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../../../Types/Permission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A metric data point is read, written and deleted with the Telemetry
 * Service Metrics permissions - the family the permission picker offers for
 * metrics, and the one the metric catalogue (MetricType) already used.
 * Before, its table was read with Read Telemetry Service Traces and every
 * column with Read Telemetry Service Log, so the metric permission read
 * nothing, and only a role or the two other families together read a chart.
 *
 * Asked of the analytics gate itself - the record's check, then the
 * select's - for every permission a team or an API key can be granted, one
 * at a time. Metric data goes through this gate on every chart, the metrics
 * explorer, the API and the MCP tools.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function propsFor(
  permissions: Array<Permission>,
  scope?: PermissionScope,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: [
          Permission.CurrentUser,
          Permission.UnAuthorizedSsoUser,
          ...permissions,
        ].map((permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            ...(scope ? { scope } : {}),
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

const GRANTABLE: Array<Permission> = PermissionHelper.getTenantPermissionProps()
  .map((props: PermissionProps) => {
    return props.permission;
  })
  .sort();

const METRIC_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadTelemetryServiceMetrics,
].sort();

const METRIC_CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.CreateTelemetryServiceMetrics,
].sort();

// What a metric chart asks for.
const CHART_SELECT: Record<string, boolean> = {
  name: true,
  value: true,
  time: true,
  attributes: true,
  primaryEntityId: true,
};

function mayRead(
  permissions: Array<Permission>,
  select: Record<string, boolean>,
): boolean {
  const props: DatabaseCommonInteractionProps = propsFor(permissions);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ModelPermission as any).checkModelLevelPermissions(
      Metric,
      props,
      DatabaseRequestType.Read,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ModelPermission as any).checkSelectPermission(Metric, select, props);
  } catch {
    return false;
  }

  return true;
}

function mayCreate(permissions: Array<Permission>): boolean {
  const metric: Metric = new Metric();
  metric.projectId = projectId;
  metric.primaryEntityId = ObjectID.generate();
  metric.name = "http.server.duration";
  metric.value = 12;
  metric.time = new Date();

  try {
    ModelPermission.checkCreatePermissions(
      Metric,
      metric,
      propsFor(permissions),
    );
  } catch {
    return false;
  }

  return true;
}

function mayDo(
  permissions: Array<Permission>,
  type: DatabaseRequestType,
): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ModelPermission as any).checkModelLevelPermissions(
      Metric,
      propsFor(permissions),
      type,
    );
  } catch {
    return false;
  }

  return true;
}

describe("metric data points are read with the metric permissions", () => {
  test("the harness refuses a permission of another signal", () => {
    // Runs first: if the props were mis-shaped, everything below is false.
    expect(mayRead([Permission.TelemetryViewer], CHART_SELECT)).toBe(true);
    expect(mayRead([Permission.ReadTelemetryException], CHART_SELECT)).toBe(
      false,
    );
  });

  test("a chart's columns are read by exactly the metric readers, each on its own", () => {
    /*
     * A metric is an operational resource, so its columns - which let in
     * everyone the table does - accept Read All Operational Resources too.
     */
    expect(
      GRANTABLE.filter((permission: Permission) => {
        return mayRead([permission], CHART_SELECT);
      }),
    ).toEqual(
      [...METRIC_READERS, Permission.ReadAllOperationalResources].sort(),
    );
  });

  test("every column of a data point is read by who reads the table", () => {
    const columns: Array<string> = Object.keys(
      new Metric().getColumnAccessControlForAllColumns(),
    ).sort();

    expect(columns.length).toBeGreaterThan(30);

    for (const column of columns) {
      for (const permission of METRIC_READERS) {
        expect([
          column,
          permission,
          mayRead([permission], { [column]: true }),
        ]).toEqual([column, permission, true]);
      }
    }
  });

  test("Read Telemetry Service Metrics on its own reads a chart", () => {
    expect(
      mayRead([Permission.ReadTelemetryServiceMetrics], CHART_SELECT),
    ).toBe(true);
  });

  test.each([
    [[Permission.ReadTelemetryServiceTraces]],
    [[Permission.ReadTelemetryServiceLog]],
    [
      [
        Permission.ReadTelemetryServiceTraces,
        Permission.ReadTelemetryServiceLog,
      ],
    ],
  ])(
    "the trace and log permissions do not read metrics: %j",
    (permissions: Array<Permission>) => {
      expect(mayRead(permissions, CHART_SELECT)).toBe(false);
      expect(mayRead(permissions, { value: true })).toBe(false);
    },
  );

  test("the table's own read list is the metric readers", () => {
    expect([...new Metric().getReadPermissions()].sort()).toEqual(
      METRIC_READERS,
    );
  });
});

describe("metric data points are written with the metric permissions", () => {
  test("a data point is created by exactly the metric creators, each on its own", () => {
    // And Create All Operational Resources, as for every operational resource.
    expect(
      GRANTABLE.filter((permission: Permission) => {
        return mayCreate([permission]);
      }),
    ).toEqual(
      [...METRIC_CREATORS, Permission.CreateAllOperationalResources].sort(),
    );
  });

  test("the trace and log create permissions, even together, do not create one", () => {
    expect(
      mayCreate([
        Permission.CreateTelemetryServiceTraces,
        Permission.CreateTelemetryServiceLog,
      ]),
    ).toBe(false);
  });

  test.each([
    [DatabaseRequestType.Update, Permission.EditTelemetryServiceMetrics],
    [DatabaseRequestType.Delete, Permission.DeleteTelemetryServiceMetrics],
  ])("%s takes %s", (type: DatabaseRequestType, permission: Permission) => {
    expect(mayDo([permission], type)).toBe(true);
  });

  test.each([
    [DatabaseRequestType.Update, Permission.EditTelemetryServiceTraces],
    [DatabaseRequestType.Delete, Permission.DeleteTelemetryServiceTraces],
  ])(
    "%s no longer takes %s",
    (type: DatabaseRequestType, permission: Permission) => {
      expect(mayDo([permission], type)).toBe(false);
    },
  );
});

/*
 * A grant's scope follows the permission that reads the table: an
 * Owned-scoped Read Telemetry Service Metrics narrows metric reads to the
 * services the user owns, as an Owned-scoped log read narrows logs.
 */
describe("a scoped metric grant narrows metric reads", () => {
  const ownedService: ObjectID = ObjectID.generate();

  beforeEach(() => {
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(ModelPermission as any, "resolveOwnedParentIds")
      .mockResolvedValue(new Set<string>([ownedService.toString()]) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an Owned-scoped Read Telemetry Service Metrics reads only owned services", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = await (ModelPermission as any).addReadScopeToQuery(
      Metric,
      { projectId },
      propsFor([Permission.ReadTelemetryServiceMetrics], PermissionScope.Owned),
      DatabaseRequestType.Read,
    );

    expect(query.primaryEntityId).toBeInstanceOf(Includes);
    expect(new Set(query.primaryEntityId.values)).toEqual(
      new Set([ownedService.toString(), projectId.toString()]),
    );
  });

  test("an unscoped Read Telemetry Service Metrics reads every service", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = await (ModelPermission as any).addReadScopeToQuery(
      Metric,
      { projectId },
      propsFor([Permission.ReadTelemetryServiceMetrics], PermissionScope.All),
      DatabaseRequestType.Read,
    );

    expect(query.primaryEntityId).toBeUndefined();
  });
});
