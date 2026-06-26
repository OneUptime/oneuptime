import { applyIncidentRelatedRecordPrivacyFilter } from "../../../Server/Utils/Incident/IncidentPrivacyFilter";
import { combineWithPrivacyClause } from "../../../Server/Utils/PrivacyFilterUtil";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { FindOperator, Raw } from "typeorm";

type FindOperatorType = FindOperator<any>;

function makePrivacyClause(): FindOperatorType {
  return Raw((alias: string): string => {
    return `(${alias} IS NOT NULL)`;
  }) as FindOperatorType;
}

describe("combineWithPrivacyClause", () => {
  it("returns the privacy clause when there is no existing value", () => {
    const clause: FindOperatorType = makePrivacyClause();
    expect(combineWithPrivacyClause(undefined, clause as any)).toBe(clause);
    expect(combineWithPrivacyClause(null, clause as any)).toBe(clause);
  });

  it("ANDs an existing ObjectID equality with the privacy clause", () => {
    const incidentId: ObjectID = ObjectID.generate();
    const clause: FindOperatorType = makePrivacyClause();

    const combined: any = combineWithPrivacyClause(incidentId, clause as any);

    expect(combined).toBeInstanceOf(FindOperator);
    expect(combined.type).toBe("and");
    const children: Array<FindOperatorType> = combined.value;
    expect(children).toHaveLength(2);
    expect(children[0]!.type).toBe("equal");
    expect(children[0]!.value).toBe(incidentId.toString());
    expect(children[1]).toBe(clause);
  });

  it("ANDs an existing string equality with the privacy clause", () => {
    const clause: FindOperatorType = makePrivacyClause();
    const combined: any = combineWithPrivacyClause("some-id", clause as any);

    expect(combined.type).toBe("and");
    expect(combined.value[0].type).toBe("equal");
    expect(combined.value[0].value).toBe("some-id");
  });

  it("ANDs an existing boolean equality with the privacy clause", () => {
    const clause: FindOperatorType = makePrivacyClause();
    const combined: any = combineWithPrivacyClause(true, clause as any);

    expect(combined.type).toBe("and");
    expect(combined.value[0].type).toBe("equal");
    expect(combined.value[0].value).toBe(true);
  });

  it("ANDs an existing Includes operator as IN with the privacy clause", () => {
    const idA: ObjectID = ObjectID.generate();
    const idB: ObjectID = ObjectID.generate();
    const clause: FindOperatorType = makePrivacyClause();

    const combined: any = combineWithPrivacyClause(
      new Includes([idA, idB]),
      clause as any,
    );

    expect(combined.type).toBe("and");
    // QueryHelper.any builds a parameterized Raw IN clause.
    expect(combined.value[0].type).toBe("raw");
    expect(Object.values(combined.value[0].objectLiteralParameters)).toEqual([
      [idA.toString(), idB.toString()],
    ]);
    expect(combined.value[1]).toBe(clause);
  });

  it("ANDs an existing FindOperator with the privacy clause", () => {
    const existing: FindOperatorType = makePrivacyClause();
    const clause: FindOperatorType = makePrivacyClause();

    const combined: any = combineWithPrivacyClause(existing, clause as any);

    expect(combined.type).toBe("and");
    expect(combined.value[0]).toBe(existing);
    expect(combined.value[1]).toBe(clause);
  });
});

describe("applyIncidentRelatedRecordPrivacyFilter", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();

  function makeMemberProps(): DatabaseCommonInteractionProps {
    // A ProjectMember does not bypass incident privacy.
    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    };

    return {
      userId,
      tenantId: projectId,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
    };
  }

  it("preserves the caller's incidentId scoping for non-admin users", () => {
    const incidentId: ObjectID = ObjectID.generate();
    const query: any = { incidentId, projectId };

    const filtered: any = applyIncidentRelatedRecordPrivacyFilter(
      query,
      makeMemberProps(),
    );

    /*
     * Regression: the privacy clause used to overwrite incidentId, which
     * leaked private notes / feed items across incidents for project
     * members. The incident scoping must survive as part of an AND.
     */
    expect(filtered.incidentId).toBeInstanceOf(FindOperator);
    expect(filtered.incidentId.type).toBe("and");
    expect(filtered.incidentId.value[0].type).toBe("equal");
    expect(filtered.incidentId.value[0].value).toBe(incidentId.toString());
    expect(filtered.projectId).toBe(projectId);
  });

  it("applies only the privacy clause when the query has no incidentId", () => {
    const filtered: any = applyIncidentRelatedRecordPrivacyFilter(
      { projectId } as any,
      makeMemberProps(),
    );

    expect(filtered.incidentId).toBeInstanceOf(FindOperator);
    expect(filtered.incidentId.type).toBe("raw");
  });

  it("leaves the query untouched for project admins", () => {
    const incidentId: ObjectID = ObjectID.generate();
    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectAdmin,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    };

    const filtered: any = applyIncidentRelatedRecordPrivacyFilter(
      { incidentId } as any,
      {
        userId,
        tenantId: projectId,
        userTenantAccessPermission: {
          [projectId.toString()]: tenantPermission,
        },
      },
    );

    expect(filtered.incidentId).toBe(incidentId);
  });
});
