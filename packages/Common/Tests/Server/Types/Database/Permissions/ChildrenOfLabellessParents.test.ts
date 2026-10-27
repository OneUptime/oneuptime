import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import ReadPermission from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import NetworkSiteStatusTimeline from "../../../../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import SecurityCaseFeed from "../../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseNote from "../../../../../Models/DatabaseModels/SecurityCaseNote";
import SecurityDetection from "../../../../../Models/DatabaseModels/SecurityDetection";
import SecurityPlaybookRun from "../../../../../Models/DatabaseModels/SecurityPlaybookRun";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * THE CHILDREN OF A PARENT THAT CARRIES NO LABELS OF ITS OWN.
 *
 * A record read through another (@CanAccessIfCanReadOn - a security case's
 * notes) keeps to the parents the caller may read: with a read of the
 * parent limited to labels, the records whose parent carries one of them.
 * A security case carries no labels of its own - it carries those of the
 * incident it names, by its own label rule - so read as its labels, it
 * carried none, and the condition matched nothing: a Security Viewer limited
 * to a label opened a case linked to an incident carrying it, and its
 * notes, detections, feed and playbook runs were always empty (a note they
 * added, they could not see). Now the children of such a parent keep to
 * `parentKey IN (the parents its own label rule keeps)`
 * (ReadPermission.getParentLabelsCondition) - here as the SQL the condition
 * writes; the real-Postgres suite (Tests/Server/API
 * /OwnedScopePerTeamPostgres) reads and writes the rows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4e000000-0000-4000-8000-000000000001",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "4e000000-0000-4000-8000-000000000002",
);
const SECURITY: ObjectID = new ObjectID("4e000000-0000-4000-8000-000000000003");

function limitedTo(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [SECURITY],
    isBlockPermission: false,
    scope: PermissionScope.Labels,
  };
}

function memberWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: MEMBER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;
}

interface Child {
  modelType: { new (): BaseModel };
  parentTable: string;
  parentKey: string;
  // A role reading the parent and the child, limited to the label.
  role: Permission;
  // The key, of the parent's, naming the labelled record it takes labels from.
  parentLabelKey: string;
}

const SECURITY_CASE_CHILD: Omit<Child, "modelType"> = {
  parentTable: "SecurityCase",
  parentKey: "securityCaseId",
  role: Permission.SecurityMember,
  parentLabelKey: "incidentId",
};

const CHILDREN: Array<Child> = [
  { modelType: SecurityCaseNote, ...SECURITY_CASE_CHILD },
  { modelType: SecurityCaseFeed, ...SECURITY_CASE_CHILD },
  { modelType: SecurityDetection, ...SECURITY_CASE_CHILD },
  { modelType: SecurityPlaybookRun, ...SECURITY_CASE_CHILD },
  {
    modelType: NetworkSiteStatusTimeline,
    parentTable: "NetworkSite",
    parentKey: "siteId",
    role: Permission.ProjectMember,
    parentLabelKey: "probeId",
  },
];

// The operations a child's role may make on it: a read, and what else it grants.
function operationsOf(child: Child): Array<DatabaseRequestType> {
  return [
    DatabaseRequestType.Read,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ].filter((type: DatabaseRequestType): boolean => {
    return TablePermission.getTablePermission(child.modelType, type).includes(
      child.role,
    );
  });
}

// The SQL a condition on the record's id writes, for a SELECT of the table.
function sqlOf(child: Child, condition: unknown): string {
  expect(condition).toBeInstanceOf(FindOperator);

  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;
  const tableName: string = new child.modelType().tableName as string;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<unknown>)
      .map((each: unknown): string => {
        return sqlOf(child, each);
      })
      .join(" AND ");
  }

  return String(
    (operator.getSql as (alias: string) => string)(`${tableName}._id`),
  );
}

// The values a condition binds, flattened.
function valuesOf(condition: unknown): Array<string> {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<unknown>).flatMap(valuesOf);
  }

  return Object.values(operator.objectLiteralParameters || {})
    .flat()
    .map((value: unknown): string => {
      return String(value).toLowerCase();
    });
}

async function scopeOf(
  child: Child,
  type: DatabaseRequestType,
): Promise<Dictionary<unknown>> {
  return (await BasePermission.addRecordScopeToQuery(
    child.modelType,
    {},
    null,
    memberWith([limitedTo(child.role)]),
    type,
  )) as Dictionary<unknown>;
}

beforeEach(() => {
  withLabelJoinTables();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a read of the parent limited to labels reaches the children of the parents it keeps", () => {
  for (const child of CHILDREN) {
    for (const type of operationsOf(child)) {
      test(`${new child.modelType().tableName}, ${type}: the ${child.parentTable}s kept by their own label rule`, async () => {
        const query: Dictionary<unknown> = await scopeOf(child, type);
        const tableName: string = new child.modelType().tableName as string;
        const sql: string = sqlOf(child, query["_id"]);

        // Before, a parent with no labels of its own matched nothing.
        expect(sql).not.toContain("(FALSE)");

        // The key names a parent its own label rule keeps...
        expect(sql).toMatch(
          new RegExp(
            `"${tableName}"\\."${child.parentKey}" IN \\(SELECT "(record[A-Za-z]+)"\\."_id" FROM "${child.parentTable}" "\\1" WHERE `,
          ),
        );

        // ...one naming no labelled record, or one whose labelled record carries the label.
        expect(sql).toMatch(
          new RegExp(`"record[A-Za-z]+"\\."${child.parentLabelKey}" IS NULL`),
        );
        expect(sql).toMatch(
          new RegExp(
            `"record[A-Za-z]+"\\."${child.parentLabelKey}" IN \\(SELECT `,
          ),
        );
        expect(valuesOf(query["_id"])).toContain(
          SECURITY.toString().toLowerCase(),
        );
      });
    }
  }
});

describe("the parent's own label rule", () => {
  test("a parent kind whose records name no labelled record: any parent at all", () => {
    jest
      .spyOn(ReadPermission, "getGrantedLabelsCondition")
      .mockReturnValue(null);

    const child: Child = CHILDREN[0]!;
    const condition: unknown = ReadPermission.getParentLabelsCondition(
      child.modelType,
      [SECURITY],
    );

    expect(sqlOf(child, condition)).toMatch(
      /^\(\("SecurityCaseNote"\."securityCaseId" IN \(SELECT "(record[A-Za-z]+)"\."_id" FROM "SecurityCase" "\1"\)\)\)$/,
    );
  });

  test("a parent that carries labels is still matched by its own labels", () => {
    const condition: unknown = ReadPermission.getParentLabelsCondition(
      IncidentInternalNote,
      [SECURITY],
    );

    const sql: string = String(
      (
        (condition as FindOperator<unknown>).getSql as (alias: string) => string
      )("IncidentInternalNote._id"),
    );

    expect(sql).toContain('FROM "IncidentLabel"');
    expect(sql).not.toContain('FROM "Incident" ');
  });

  /*
   * A list of parents (an announcement's status pages) is followed through
   * the parents' own labels only. Were a model read through a list of
   * parents with no labels of their own, its rows would reach nothing under
   * a grant limited to labels: none is.
   */
  test("no model is read through a list of parents that carry no labels of their own", () => {
    const listedThroughLabelless: Array<string> = [];

    for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
      const model: BaseModel = new modelType();

      if (!model.canAccessIfCanReadOn) {
        continue;
      }

      const column: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(model.canAccessIfCanReadOn);

      if (
        column?.type === TableColumnType.EntityArray &&
        column.modelType &&
        !new (column.modelType as {
          new (): BaseModel;
        })().getAccessControlColumn()
      ) {
        listedThroughLabelless.push(model.tableName as string);
      }
    }

    expect(listedThroughLabelless).toEqual([]);
  });
});
