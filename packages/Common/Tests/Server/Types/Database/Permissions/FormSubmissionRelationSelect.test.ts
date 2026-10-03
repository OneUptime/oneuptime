import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import FormSubmission from "../../../../../Models/DatabaseModels/FormSubmission";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";

/*
 * THE BUG.
 *
 * Forms > Submissions, and every form's own Submissions page, failed to load
 * for everyone with
 *
 *   Column scheduledMaintenanceNumber on Scheduled Maintenance Event does not
 *   support read on relation query.
 *
 * Their Created column links each submission to what it made, by number, and
 * reads both possible targets across the relation in one select: the
 * incident's and the scheduled maintenance event's. The incident's number
 * columns carry canReadOnRelationQuery; the event's did not, and
 * QueryPermission.checkRelationQueryPermission throws on the first unflagged
 * inner key - so the whole list failed, whatever each row had created. The
 * list's unit tests mock the API and never reach this gate; the Forms e2e
 * spec (D1) is what found it.
 *
 * WHAT THESE TESTS PIN.
 *
 * The select the lists send, verbatim, for every role that may read a
 * submission; that the two number columns are flagged like the incident's;
 * and that nothing else on the event was opened with them.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

/*
 * Fresh props per assertion: DatabaseCommonInteractionPropsUtil mutates what
 * it is handed, so a shared object would carry state between tests.
 */
function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function checkRelationSelect(
  select: Select<FormSubmission>,
  props: DatabaseCommonInteractionProps,
): void {
  QueryPermission.checkRelationQueryPermission(
    FormSubmission,
    {} as Query<FormSubmission>,
    select,
    props,
  );
}

/*
 * The Created column's select, copied out of
 * App/FeatureSet/Dashboard/src/Components/FormBuilder/Submissions/FormSubmissionsTable.tsx.
 * Kept as a literal rather than imported, so that changing the table without
 * changing the models surfaces here as a failure.
 */
const CREATED_COLUMN_SELECT: Select<FormSubmission> = {
  incident: {
    _id: true,
    incidentNumber: true,
    incidentNumberWithPrefix: true,
  },
  scheduledMaintenance: {
    _id: true,
    scheduledMaintenanceNumber: true,
    scheduledMaintenanceNumberWithPrefix: true,
  },
} as Select<FormSubmission>;

describe("Form submission relation select - the reported failure", () => {
  it("accepts the submissions lists' Created column for every reader", () => {
    // FormSubmission's read list: owners, admins and Read Form Submission.
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadFormSubmission,
    ]) {
      expect(() => {
        return checkRelationSelect(
          CREATED_COLUMN_SELECT,
          makeProps([permission]),
        );
      }).not.toThrow();
    }
  });

  it("accepts a scheduled maintenance event's number on its own", () => {
    expect(() => {
      return checkRelationSelect(
        {
          scheduledMaintenance: {
            scheduledMaintenanceNumberWithPrefix: true,
          },
        } as Select<FormSubmission>,
        makeProps([Permission.ReadFormSubmission]),
      );
    }).not.toThrow();
  });
});

describe("Form submission relation select - the model flags", () => {
  const event: BaseModel = new ScheduledMaintenance();
  const incident: BaseModel = new Incident();

  it("lets a scheduled maintenance event's number be read through a relation, like an incident's", () => {
    for (const [model, columnName] of [
      [event, "scheduledMaintenanceNumber"],
      [event, "scheduledMaintenanceNumberWithPrefix"],
      [incident, "incidentNumber"],
      [incident, "incidentNumberWithPrefix"],
    ] as Array<[BaseModel, string]>) {
      expect({
        columnName: columnName,
        canReadOnRelationQuery: Boolean(
          model.getTableColumnMetadata(columnName).canReadOnRelationQuery,
        ),
      }).toEqual({ columnName: columnName, canReadOnRelationQuery: true });
    }
  });

  it("leaves the rest of the event's columns closed to relation reads", () => {
    /*
     * The fix is a label on a joined row, not a widening of the model: what
     * the event says, and when, still needs the event's own read access.
     */
    for (const columnName of [
      "description",
      "startsAt",
      "endsAt",
      "createdByUserId",
    ]) {
      expect(event.getTableColumnMetadata(columnName)).toBeTruthy();
      expect({
        columnName: columnName,
        canReadOnRelationQuery: Boolean(
          event.getTableColumnMetadata(columnName).canReadOnRelationQuery,
        ),
      }).toEqual({ columnName: columnName, canReadOnRelationQuery: false });
    }
  });
});

describe("Form submission relation select - what still refuses", () => {
  it("refuses another column of the event that was never flagged", () => {
    expect(() => {
      return checkRelationSelect(
        {
          scheduledMaintenance: {
            scheduledMaintenanceNumber: true,
            description: true,
          },
        } as Select<FormSubmission>,
        makeProps([Permission.ProjectOwner]),
      );
    }).toThrow(
      "Column description on Scheduled Maintenance Event does not support read on relation query.",
    );
  });

  it("refuses a deep relation through the event", () => {
    expect(() => {
      return checkRelationSelect(
        {
          scheduledMaintenance: {
            currentScheduledMaintenanceState: { name: true },
          },
        } as unknown as Select<FormSubmission>,
        makeProps([Permission.ProjectOwner]),
      );
    }).toThrow(BadDataException);
  });
});
