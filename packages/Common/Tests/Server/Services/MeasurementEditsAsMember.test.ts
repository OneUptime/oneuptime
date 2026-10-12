import AlertMeasurementService from "../../../Server/Services/AlertMeasurementService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentMeasurementService from "../../../Server/Services/IncidentMeasurementService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import logger from "../../../Server/Utils/Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO MAY CHANGE WHAT A MEASUREMENT MEANS, through the whole update.
 *
 * Changing a measurement's anchors, states, unit or switch rewrites its
 * history: the service asks the backfill worker to work every value out
 * again by stamping three backfill columns. Those columns are OneUptime's
 * (create: [], update: []). The stamp used to be written in onBeforeUpdate,
 * and DatabaseService holds what that hook leaves to the CALLER's column
 * permissions - so every member who may edit a measurement, the project
 * owner included, was refused with "User is not allowed to update on
 * backfillRequestedAt column of Alert Measurement". The suites that pinned
 * the stamp called the hook alone, as root. The stamp is now written in
 * onUpdatePermitted, once the change has passed every check; this suite
 * runs the whole update, as each member, for incidents, alerts and
 * scheduled maintenance events alike.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MEASUREMENT_ID: string = "22222222-2222-4222-8222-222222222222";

interface Domain {
  label: string;
  modelName: string;
  service: DatabaseService<BaseModel>;
  stateService: { findBy: (...args: Array<unknown>) => Promise<unknown> };
  edit: Permission;
  read: Permission;
  origin: string;
  endStateRole: string;
  role: string;
}

const DOMAINS: Array<Domain> = [
  {
    label: "an incident measurement",
    modelName: "Incident Measurement",
    service:
      IncidentMeasurementService as unknown as DatabaseService<BaseModel>,
    stateService: IncidentStateService as unknown as Domain["stateService"],
    edit: Permission.EditIncidentMeasurement,
    read: Permission.ReadIncidentMeasurement,
    origin: "Declared At",
    endStateRole: "endIncidentStateRole",
    role: "Resolved",
  },
  {
    label: "an alert measurement",
    modelName: "Alert Measurement",
    service: AlertMeasurementService as unknown as DatabaseService<BaseModel>,
    stateService: AlertStateService as unknown as Domain["stateService"],
    edit: Permission.EditAlertMeasurement,
    read: Permission.ReadAlertMeasurement,
    origin: "Created At",
    endStateRole: "endAlertStateRole",
    role: "Resolved",
  },
  {
    label: "a scheduled maintenance measurement",
    modelName: "Scheduled Maintenance Measurement",
    service:
      ScheduledMaintenanceMeasurementService as unknown as DatabaseService<BaseModel>,
    stateService:
      ScheduledMaintenanceStateService as unknown as Domain["stateService"],
    edit: Permission.EditScheduledMaintenanceMeasurement,
    read: Permission.ReadScheduledMaintenanceMeasurement,
    origin: "Scheduled Starts At",
    endStateRole: "endScheduledMaintenanceStateRole",
    role: "Ended",
  },
];

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the update to be refused, but it went through.");
}

// The update's hooks, reached through a cast as every service suite does.
interface UpdateHooks {
  onBeforeUpdate(updateBy: UpdateBy<BaseModel>): Promise<OnUpdate<BaseModel>>;
  onUpdatePermitted(updateBy: UpdateBy<BaseModel>): Promise<void>;
}

describe.each(DOMAINS)("changing $label", (domain: Domain) => {
  let table: InMemoryTable;

  function stored(column: string): unknown {
    return table.get(MEASUREMENT_ID)?.[column];
  }

  async function change(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    await domain.service.updateOneById({
      id: new ObjectID(MEASUREMENT_ID),
      data: data as never,
      props: props,
    });
  }

  // Who may edit a measurement: the model's update list.
  const EDITORS: Array<[string, Array<Permission>]> = [
    ["a project owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
    [`someone holding ${domain.edit}`, [domain.edit, domain.read]],
  ];

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});
    jest.spyOn(domain.stateService, "findBy").mockResolvedValue([] as never);

    table = useInMemoryTable(domain.service, [
      {
        _id: MEASUREMENT_ID,
        projectId: PROJECT_ID.toString(),
        name: "Time to resolve",
        key: "time-to-resolve",
        startAnchorType: domain.origin,
        endAnchorType: "State Role Entered",
        [domain.endStateRole]: domain.role,
        startStateOccurrence: "First",
        endStateOccurrence: "First",
        isEnabled: true,
        unit: "seconds",
        isSystemDefined: false,
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(EDITORS)(
    "%s changes its unit, and its history is worked out again",
    async (_who: string, permissions: Array<Permission>) => {
      await change({ unit: "minutes" }, member(permissions));

      expect(stored("unit")).toBe("minutes");
      expect(stored("backfillRequestedAt")).toBeInstanceOf(Date);
      // Cleared, or the restarted backfill would resume mid-way through.
      expect(stored("backfillCursorCreatedAt")).toBeNull();
      expect(stored("backfillCompletedAt")).toBeNull();
    },
  );

  test.each(EDITORS)(
    "%s switches it off - a change of meaning too",
    async (_who: string, permissions: Array<Permission>) => {
      await change({ isEnabled: false }, member(permissions));

      expect(stored("isEnabled")).toBe(false);
      expect(stored("backfillRequestedAt")).toBeInstanceOf(Date);
    },
  );

  test("a rename leaves the history alone: no backfill is asked for", async () => {
    await change({ name: "Time to fix" }, member([Permission.ProjectOwner]));

    expect(stored("name")).toBe("Time to fix");
    expect(stored("backfillRequestedAt")).toBeUndefined();
  });

  test.each([
    ["a project member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
  ])(
    "%s may not change it, and nothing changes",
    async (_who: string, permissions: Array<Permission>) => {
      const error: unknown = await refusalOf(
        change({ unit: "minutes" }, member(permissions as Array<Permission>)),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(stored("unit")).toBe("seconds");
      expect(stored("backfillRequestedAt")).toBeUndefined();
    },
  );

  test("the backfill columns are still OneUptime's: a member who sends one is refused, and nothing changes", async () => {
    const error: unknown = await refusalOf(
      change(
        { unit: "minutes", backfillRequestedAt: new Date() },
        member([Permission.ProjectOwner]),
      ),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe(
      "backfillRequestedAt",
    );
    expect((error as Error).message).toContain(
      `User is not allowed to update on backfillRequestedAt column of ${domain.modelName}`,
    );
    expect(stored("unit")).toBe("seconds");
  });

  test("OneUptime itself changes it the same way", async () => {
    await change({ unit: "hours" }, { isRoot: true });

    expect(stored("unit")).toBe("hours");
    expect(stored("backfillRequestedAt")).toBeInstanceOf(Date);
  });

  describe("the order of the hooks", () => {
    const hooks: UpdateHooks = domain.service as unknown as UpdateHooks;

    function updateOf(data: Record<string, unknown>): UpdateBy<BaseModel> {
      return {
        id: new ObjectID(MEASUREMENT_ID),
        query: { _id: MEASUREMENT_ID },
        data: data,
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<BaseModel>;
    }

    test("onBeforeUpdate, which runs before the permission checks, writes none of the backfill columns", async () => {
      const updateBy: UpdateBy<BaseModel> = updateOf({ unit: "minutes" });

      await hooks.onBeforeUpdate(updateBy);

      const data: Record<string, unknown> = updateBy.data as unknown as Record<
        string,
        unknown
      >;

      for (const column of [
        "backfillRequestedAt",
        "backfillCursorCreatedAt",
        "backfillCompletedAt",
      ]) {
        expect([column, data[column]]).toEqual([column, undefined]);
      }
    });

    test("onUpdatePermitted writes them, for the update onBeforeUpdate found to change the meaning - and once", async () => {
      const updateBy: UpdateBy<BaseModel> = updateOf({ unit: "minutes" });

      await hooks.onBeforeUpdate(updateBy);
      await hooks.onUpdatePermitted(updateBy);

      const data: Record<string, unknown> = updateBy.data as unknown as Record<
        string,
        unknown
      >;

      expect(data["backfillRequestedAt"]).toBeInstanceOf(Date);

      // A second ask for the same update finds nothing left to do.
      delete data["backfillRequestedAt"];
      await hooks.onUpdatePermitted(updateBy);

      expect(data["backfillRequestedAt"]).toBeUndefined();
    });

    test("onUpdatePermitted leaves an update it was not told about alone", async () => {
      const rename: UpdateBy<BaseModel> = updateOf({ name: "Time to fix" });
      const unmarked: UpdateBy<BaseModel> = updateOf({ unit: "minutes" });

      await hooks.onBeforeUpdate(rename);
      await hooks.onUpdatePermitted(rename);
      await hooks.onUpdatePermitted(unmarked);

      expect(
        (rename.data as unknown as Record<string, unknown>)[
          "backfillRequestedAt"
        ],
      ).toBeUndefined();
      expect(
        (unmarked.data as unknown as Record<string, unknown>)[
          "backfillRequestedAt"
        ],
      ).toBeUndefined();
    });
  });
});
