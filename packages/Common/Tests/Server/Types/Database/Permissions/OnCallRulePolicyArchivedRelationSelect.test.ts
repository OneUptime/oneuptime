import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import AlertOnCallRule from "../../../../../Models/DatabaseModels/AlertOnCallRule";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentOnCallRule from "../../../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * THE BUG.
 *
 * The website-down guided setup counts the incident and alert on-call rules
 * that run a policy in service (#8433), so it reads each rule with its
 * policies:
 *
 *   modelType: IncidentOnCallRule (and AlertOnCallRule)
 *   select: { onCallDutyPolicies: { _id, isArchived } }
 *
 * A policy's isArchived had no canReadOnRelationQuery, and
 * QueryPermission.checkRelationQueryPermission throws on the first unflagged
 * column a relation select names:
 *
 *   Column isArchived on On-Call Policy does not support read on relation
 *   query.
 *
 * Both reads failed for everyone, the setup caught it as counts it could not
 * read, and told every project it would page the monitor's owner - the
 * #8433 fix never ran. These pin the selects the setup sends
 * (Components/GuidedSetup/WebsiteDown/WebsiteDownApi.ts), that the flag is
 * all that moved, and why it is safe: the column is read by those who may
 * read the policy's name, which a relation reads already.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

/*
 * Fresh props per check: DatabaseCommonInteractionPropsUtil adds the
 * auto-granted permissions to what it is handed.
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

type RuleModelType = typeof IncidentOnCallRule | typeof AlertOnCallRule;

function checkRelationSelect(
  modelType: RuleModelType,
  select: Select<BaseModel>,
): void {
  QueryPermission.checkRelationQueryPermission(
    modelType as unknown as { new (): BaseModel },
    {} as Query<BaseModel>,
    select,
    makeProps([Permission.ProjectMember]),
  );
}

// The select WebsiteDownApi.loadWhoIsToldFacts sends, for both rule tables.
const RULES_WITH_THEIR_POLICIES: Select<BaseModel> = {
  _id: true,
  onCallDutyPolicies: { _id: true, isArchived: true },
} as unknown as Select<BaseModel>;

const RULE_MODELS: Array<[string, RuleModelType]> = [
  ["IncidentOnCallRule", IncidentOnCallRule],
  ["AlertOnCallRule", AlertOnCallRule],
];

describe("the website-down setup reads the on-call rules with their policies", () => {
  test.each(RULE_MODELS)(
    "%s's policies are read with whether each is archived",
    (_name: string, modelType: RuleModelType) => {
      expect(() => {
        checkRelationSelect(modelType, RULES_WITH_THEIR_POLICIES);
      }).not.toThrow();
    },
  );

  test.each(RULE_MODELS)(
    "%s's policies still refuse a column a relation may not read",
    (_name: string, modelType: RuleModelType) => {
      const select: Select<BaseModel> = {
        _id: true,
        onCallDutyPolicies: { _id: true, description: true },
      } as unknown as Select<BaseModel>;

      expect(() => {
        checkRelationSelect(modelType, select);
      }).toThrow(
        new BadDataException(
          "Column description on On-Call Policy does not support read on relation query.",
        ),
      );
    },
  );
});

describe("a policy's isArchived on a relation", () => {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();

  test("is marked readable through one", () => {
    expect(
      policy.getTableColumnMetadata("isArchived").canReadOnRelationQuery,
    ).toBe(true);
  });

  test("is read by those who may read the policy's name, which a relation reads already", () => {
    expect(policy.getTableColumnMetadata("name").canReadOnRelationQuery).toBe(
      true,
    );
    expect(
      [...(policy.getColumnAccessControlFor("isArchived")?.read || [])].sort(),
    ).toEqual(
      [...(policy.getColumnAccessControlFor("name")?.read || [])].sort(),
    );
    expect(
      policy.getColumnAccessControlFor("isArchived")?.read.length,
    ).toBeGreaterThan(0);
  });
});
