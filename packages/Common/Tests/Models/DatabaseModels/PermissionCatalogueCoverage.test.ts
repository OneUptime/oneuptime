import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test: every permission a model gates CRUD on must exist in the
 * permission catalogue, and a model must not gate its own columns on another
 * model's permission.
 *
 * The case that prompted this: ScheduledMaintenanceTemplateOwnerUser gated its
 * required, non-nullable scheduledMaintenanceTemplateId column on the *Team*
 * create permission. It was invisible only because the two enum values happened
 * to collide, so both names resolved to one string. The moment that collision
 * was fixed the mis-key became a hard BadDataException on every create, on a
 * column the dashboard always sends — a latent break sitting behind an
 * unrelated bug.
 *
 * Sweeping every model rather than asserting on a list is the point: a mis-key
 * in a model nobody is looking at fails here instead of in production. The
 * sweep found twenty-one more of them, listed below; they are recorded as a
 * baseline rather than fixed, because each needs its own judgement about which
 * permission was meant.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

/*
 * The only two permissions a model may reference without a PermissionProps
 * entry. Both are internal markers rather than capabilities an administrator
 * hands out — AuthenticatedRequest marks "some authenticated principal made
 * this call" and UnAuthorizedSsoUser marks a user who has not yet passed the
 * project's SSO. Neither belongs in the picker, so neither has props.
 *
 * Anything else appearing here means a permission is referenced by a live model
 * but cannot be granted on its own, which is a bug, not a policy.
 */
const PERMISSIONS_WITHOUT_PROPS_BY_DESIGN: Array<string> = [
  "AuthenticatedRequest",
  "UnAuthorizedSsoUser",
];

/*
 * Columns whose create list requires a granular permission the table's own
 * create list never accepts. Each is a pre-existing copy-paste mis-key of the
 * same family as the ScheduledMaintenanceTemplateOwnerUser one this test was
 * written for — MonitorFeed asking for CreateScheduledMaintenanceFeed,
 * MetricType asking for CreateProjectIncident, and so on. They are recorded
 * rather than fixed here because each needs its own judgement about which
 * permission was intended, and because a required column gated this way cannot
 * be set by a granular-only holder at all.
 *
 * This list must only ever shrink. A new entry means a new mis-key.
 */
const KNOWN_CROSS_MODEL_COLUMN_GATES: Array<string> = [
  "IncidentFeed.postedAt requires CreateScheduledMaintenanceFeed",
  "IncidentFeed.user requires CreateScheduledMaintenanceFeed",
  "IncidentFeed.userId requires CreateScheduledMaintenanceFeed",
  "MetricType.services requires CreateProjectIncident",
  "Monitor.currentMonitorStatusId requires CreateProjectIncident",
  "MonitorFeed.postedAt requires CreateScheduledMaintenanceFeed",
  "MonitorFeed.user requires CreateScheduledMaintenanceFeed",
  "MonitorFeed.userId requires CreateScheduledMaintenanceFeed",
  "MonitorSecret.monitors requires ReadMonitorSecret",
  "OnCallDutyPolicyFeed.postedAt requires CreateScheduledMaintenanceFeed",
  "OnCallDutyPolicyFeed.user requires CreateScheduledMaintenanceFeed",
  "OnCallDutyPolicyFeed.userId requires CreateScheduledMaintenanceFeed",
  "Project.businessDetails requires ManageProjectBilling",
  "Project.businessDetailsCountry requires ManageProjectBilling",
  "Project.createdByUser requires CurrentUser",
  "Project.createdByUserId requires CurrentUser",
  "Project.financeAccountingEmail requires ManageProjectBilling",
  "Project.paymentProviderPlanId requires CurrentUser",
  "Project.sendInvoicesByEmail requires ManageProjectBilling",
  "RunbookSecret.runners requires ReadRunbookSecret",
  "ScheduledMaintenance.subscriberNotificationStatusMessage requires CreateIncidentPublicNote",
];

function modelName(modelType: ModelType): string {
  return modelType.name;
}

function tableLevelPermissions(model: BaseModel): Array<Permission> {
  return [
    ...(model.createRecordPermissions || []),
    ...(model.readRecordPermissions || []),
    ...(model.updateRecordPermissions || []),
    ...(model.deleteRecordPermissions || []),
  ];
}

function columnLevelPermissions(model: BaseModel): Array<Permission> {
  const permissions: Array<Permission> = [];

  for (const column of model.getTableColumns().columns) {
    const accessControl: ReturnType<BaseModel["getColumnAccessControlFor"]> =
      model.getColumnAccessControlFor(column);

    if (!accessControl) {
      continue;
    }

    permissions.push(
      ...(accessControl.create || []),
      ...(accessControl.read || []),
      ...(accessControl.update || []),
    );
  }

  return permissions;
}

describe("Permission catalogue coverage across database models", () => {
  test("every model-referenced permission is a real enum member", () => {
    const validValues: Set<string> = new Set(Object.values(Permission));
    const unknown: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      for (const permission of [
        ...tableLevelPermissions(model),
        ...columnLevelPermissions(model),
      ]) {
        if (!validValues.has(permission as unknown as string)) {
          unknown.push(`${modelName(modelType)} -> ${permission}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });

  test("every model-referenced permission resolves to a props entry", () => {
    const withProps: Set<string> = new Set(
      PermissionHelper.getAllPermissionProps().map((props: PermissionProps) => {
        return props.permission.toString();
      }),
    );

    const allowed: Set<string> = new Set(PERMISSIONS_WITHOUT_PROPS_BY_DESIGN);

    const missing: Set<string> = new Set<string>();

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      for (const permission of [
        ...tableLevelPermissions(model),
        ...columnLevelPermissions(model),
      ]) {
        const value: string = permission.toString();

        if (withProps.has(value) || allowed.has(value)) {
          continue;
        }

        missing.add(`${modelName(modelType)} -> ${value}`);
      }
    }

    expect(Array.from(missing).sort()).toEqual([]);
  });

  test("the by-design exemptions really have no props", () => {
    /*
     * If somebody gives one of these a props entry, the exemption must go too —
     * otherwise it keeps excusing a permission that no longer needs it, and the
     * next genuinely-missing one hides behind it.
     */
    const withProps: Set<string> = new Set(
      PermissionHelper.getAllPermissionProps().map((props: PermissionProps) => {
        return props.permission.toString();
      }),
    );

    const stale: Array<string> = PERMISSIONS_WITHOUT_PROPS_BY_DESIGN.filter(
      (permission: string) => {
        return withProps.has(permission);
      },
    );

    expect(stale).toEqual([]);
  });

  test("no column is gated on a granular permission its table does not accept", () => {
    /*
     * A column's create list must not require a granular permission that the
     * table's own create list never accepts — the caller would pass the table
     * gate and then fail on the column, which for a required column means the
     * record can never be created by that permission at all. Roles are excluded
     * because they legitimately appear in different combinations.
     */
    const rolePermissions: Set<string> = new Set(
      PermissionHelper.getRolePermissionProps().map(
        (props: PermissionProps) => {
          return props.permission.toString();
        },
      ),
    );

    const offenders: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      const tableCreate: Set<string> = new Set(
        (model.createRecordPermissions || []).map((permission: Permission) => {
          return permission.toString();
        }),
      );

      if (tableCreate.size === 0) {
        continue;
      }

      for (const column of model.getTableColumns().columns) {
        const accessControl: ReturnType<
          BaseModel["getColumnAccessControlFor"]
        > = model.getColumnAccessControlFor(column);

        for (const permission of accessControl?.create || []) {
          const value: string = permission.toString();

          if (rolePermissions.has(value) || tableCreate.has(value)) {
            continue;
          }

          offenders.push(`${modelName(modelType)}.${column} requires ${value}`);
        }
      }
    }

    expect(offenders.sort()).toEqual(
      KNOWN_CROSS_MODEL_COLUMN_GATES.slice().sort(),
    );
  });
});
