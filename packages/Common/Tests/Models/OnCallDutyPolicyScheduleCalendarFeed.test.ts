import AllModelTypes from "../../Models/DatabaseModels/Index";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleCalendarFeed from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import ProjectOnCallCalendarFeed from "../../Models/DatabaseModels/ProjectOnCallCalendarFeed";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The shared schedule feed is a project capability that renders one
 * schedule's whole roster to whoever holds the link. Who may publish, rotate
 * or copy it therefore has to be EXACTLY who may edit or read the schedule -
 * not a hand-typed approximation that drifts the next time somebody adds a
 * role tier to OnCallDutyPolicySchedule. This pins the four access lists to
 * the schedule model's, operation by operation, and the same for the
 * project-wide feed, which follows the schedule model rather than any of its
 * own.
 */

type ModelType = { new (): BaseModel };

const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
const scheduleFeed: OnCallDutyPolicyScheduleCalendarFeed =
  new OnCallDutyPolicyScheduleCalendarFeed();
const projectFeed: ProjectOnCallCalendarFeed = new ProjectOnCallCalendarFeed();

const SHARED_FEEDS: Array<[string, BaseModel]> = [
  ["OnCallDutyPolicyScheduleCalendarFeed", scheduleFeed],
  ["ProjectOnCallCalendarFeed", projectFeed],
];

describe("OnCallDutyPolicyScheduleCalendarFeed access control", () => {
  test("the schedule model really carries four non-empty lists to copy", () => {
    // Guards the equality assertions against passing on two empty lists.
    expect(schedule.createRecordPermissions.length).toBeGreaterThan(0);
    expect(schedule.readRecordPermissions.length).toBeGreaterThan(0);
    expect(schedule.updateRecordPermissions.length).toBeGreaterThan(0);
    expect(schedule.deleteRecordPermissions.length).toBeGreaterThan(0);
  });

  test.each(SHARED_FEEDS)(
    "%s create list deep-equals the schedule's",
    (_name: string, model: BaseModel) => {
      expect(model.createRecordPermissions).toEqual(
        schedule.createRecordPermissions,
      );
    },
  );

  test.each(SHARED_FEEDS)(
    "%s read list deep-equals the schedule's",
    (_name: string, model: BaseModel) => {
      expect(model.readRecordPermissions).toEqual(
        schedule.readRecordPermissions,
      );
    },
  );

  test.each(SHARED_FEEDS)(
    "%s update list deep-equals the schedule's",
    (_name: string, model: BaseModel) => {
      expect(model.updateRecordPermissions).toEqual(
        schedule.updateRecordPermissions,
      );
    },
  );

  test.each(SHARED_FEEDS)(
    "%s delete list deep-equals the schedule's",
    (_name: string, model: BaseModel) => {
      expect(model.deleteRecordPermissions).toEqual(
        schedule.deleteRecordPermissions,
      );
    },
  );

  test("the copied lists are the verbatim ones from the schedule model, in order", () => {
    /*
     * Written out so a reviewer can see the contract without opening the
     * schedule model: editors publish/rotate, readers (incl. the viewer
     * tiers) copy the link. If OnCallDutyPolicySchedule gains a tier this
     * fails alongside the deep-equal tests above and tells you what changed.
     */
    expect(scheduleFeed.createRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicySchedule,
    ]);
    expect(scheduleFeed.readRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicySchedule,
    ]);
    expect(scheduleFeed.deleteRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.DeleteProjectOnCallDutyPolicySchedule,
    ]);
    expect(scheduleFeed.updateRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.EditProjectOnCallDutyPolicySchedule,
    ]);
  });

  test("no feed list names a permission the schedule does not (no new Permission members)", () => {
    const schedulePermissions: Set<Permission> = new Set<Permission>([
      ...schedule.createRecordPermissions,
      ...schedule.readRecordPermissions,
      ...schedule.updateRecordPermissions,
      ...schedule.deleteRecordPermissions,
    ]);

    for (const [, model] of SHARED_FEEDS) {
      for (const column of model.getTableColumns().columns) {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(column);

        for (const permission of [
          ...(accessControl?.create || []),
          ...(accessControl?.read || []),
          ...(accessControl?.update || []),
        ]) {
          expect(schedulePermissions.has(permission)).toBe(true);
        }
      }
    }
  });

  test("every readable column is readable by the whole schedule read list", () => {
    /*
     * A column readable by ProjectMember but not by OnCallViewer would turn a
     * viewer's list request into a permission error on that field - the
     * failure mode DomainRoleTierCoverage.test.ts exists for. Here it is
     * pinned against the schedule's exact list, not just the tier trio.
     */
    for (const [name, model] of SHARED_FEEDS) {
      for (const column of model.getTableColumns().columns) {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(column);

        if (!accessControl || accessControl.read.length === 0) {
          continue;
        }

        expect({ model: name, column, read: accessControl.read }).toEqual({
          model: name,
          column,
          read: schedule.readRecordPermissions,
        });
      }
    }
  });

  test("every creatable or updatable column uses the schedule's create/update lists", () => {
    for (const [name, model] of SHARED_FEEDS) {
      for (const column of model.getTableColumns().columns) {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(column);

        if (!accessControl) {
          continue;
        }

        if (accessControl.create.length > 0) {
          expect({ model: name, column, create: accessControl.create }).toEqual(
            {
              model: name,
              column,
              create: schedule.createRecordPermissions,
            },
          );
        }

        if (accessControl.update.length > 0) {
          expect({ model: name, column, update: accessControl.update }).toEqual(
            {
              model: name,
              column,
              update: schedule.updateRecordPermissions,
            },
          );
        }
      }
    }
  });
});

describe("OnCallDutyPolicyScheduleCalendarFeed shape", () => {
  test("is registered in the model index", () => {
    expect(
      (AllModelTypes as Array<ModelType>).includes(
        OnCallDutyPolicyScheduleCalendarFeed,
      ),
    ).toBe(true);
  });

  test("is tenant scoped by projectId", () => {
    expect(scheduleFeed.getTenantColumn()).toBe("projectId");
  });

  test("follows the schedule's label scoping through the schedule relation", () => {
    expect(scheduleFeed.canAccessIfCanReadOn).toBe("onCallDutyPolicySchedule");

    // The relation the scoping follows must exist and point at the schedule.
    expect(
      scheduleFeed.getTableColumnMetadata("onCallDutyPolicySchedule").type,
    ).toBe(TableColumnType.Entity);
    expect(
      scheduleFeed.getTableColumnMetadata("onCallDutyPolicySchedule").modelType,
    ).toBe(OnCallDutyPolicySchedule);
    expect(
      scheduleFeed.getTableColumnMetadata("onCallDutyPolicySchedule")
        .manyToOneRelationColumn,
    ).toBe("onCallDutyPolicyScheduleId");
  });

  test("the project feed has no single parent to scope by", () => {
    expect(projectFeed.canAccessIfCanReadOn).toBeFalsy();
    expect(projectFeed.getTableColumns().columns).not.toContain(
      "onCallDutyPolicySchedule",
    );
    expect(projectFeed.getTableColumns().columns).not.toContain(
      "onCallDutyPolicyScheduleId",
    );
  });

  test("is served from its own CRUD route", () => {
    expect(scheduleFeed.getCrudApiPath()?.toString()).toBe(
      "/on-call-duty-policy-schedule-calendar-feed",
    );
    expect(projectFeed.getCrudApiPath()?.toString()).toBe(
      "/project-on-call-calendar-feed",
    );
  });

  test.each(SHARED_FEEDS)(
    "%s is plan gated like the schedule (Growth for every operation)",
    (_name: string, model: BaseModel) => {
      expect(model.getCreateBillingPlan()).toBe(PlanType.Growth);
      expect(model.getReadBillingPlan()).toBe(PlanType.Growth);
      expect(model.getUpdateBillingPlan()).toBe(PlanType.Growth);
      expect(model.getDeleteBillingPlan()).toBe(PlanType.Growth);

      expect(model.getCreateBillingPlan()).toBe(
        schedule.getCreateBillingPlan(),
      );
      expect(model.getReadBillingPlan()).toBe(schedule.getReadBillingPlan());
      expect(model.getUpdateBillingPlan()).toBe(
        schedule.getUpdateBillingPlan(),
      );
      expect(model.getDeleteBillingPlan()).toBe(
        schedule.getDeleteBillingPlan(),
      );
    },
  );

  test.each(SHARED_FEEDS)(
    "%s stays reachable while a subscription is unpaid (links must not go dark)",
    (_name: string, model: BaseModel) => {
      expect(model.allowAccessIfSubscriptionIsUnpaid).toBe(true);
    },
  );

  test.each(SHARED_FEEDS)(
    "%s is not documented (no OpenAPI / Terraform surface for a secret-bearing table)",
    (_name: string, model: BaseModel) => {
      expect(model.enableDocumentation).toBeFalsy();
    },
  );
});
