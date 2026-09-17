import {
  applyIncidentRelatedRecordPrivacyFilter,
  applyIncidentSelfPrivacyFilter,
  getIncidentRelatedRecordPrivacyRaw,
  getIncidentSelfPrivacyRaw,
  shouldBypassIncidentPrivacy,
} from "../../../../Server/Utils/Incident/IncidentPrivacyFilter";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * IncidentPrivacyFilter decides who may see a private incident. Getting it
 * wrong either leaks private incidents to every project member, or hides an
 * owner's own incidents from them - so each branch is pinned here against the
 * SQL the Raw clause actually emits, not just its presence.
 */

const userId: ObjectID = ObjectID.generate();
const tenantId: ObjectID = ObjectID.generate();

type MakePermFunction = (
  permission: Permission,
) => DatabaseCommonInteractionProps;

// A logged-in project member holding exactly the one permission named.
const propsWithProjectPermission: MakePermFunction = (
  permission: Permission,
): DatabaseCommonInteractionProps => {
  const userPermission: UserPermission = {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
  };

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: tenantId,
    permissions: [userPermission],
  };

  return {
    userId: userId,
    tenantId: tenantId,
    userTenantAccessPermission: {
      [tenantId.toString()]: tenantPermission,
    },
  };
};

// Pull the SQL + bound params out of a typeorm Raw() FindOperator.
/* eslint-disable @typescript-eslint/no-explicit-any */
type RawParts = { sql: string; params: Record<string, string> };

const rawParts: (clause: unknown) => RawParts = (clause: unknown): RawParts => {
  const operator: any = clause as any;

  return {
    sql: String(operator._getSql("COLUMN")),
    params: (operator._objectLiteralParameters || {}) as Record<string, string>,
  };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("shouldBypassIncidentPrivacy", () => {
  test("root and master-admin contexts see everything", () => {
    expect(shouldBypassIncidentPrivacy({ isRoot: true })).toBe(true);
    expect(shouldBypassIncidentPrivacy({ isMasterAdmin: true })).toBe(true);
  });

  test("project owners and admins bypass the filter", () => {
    expect(
      shouldBypassIncidentPrivacy(
        propsWithProjectPermission(Permission.ProjectOwner),
      ),
    ).toBe(true);
    expect(
      shouldBypassIncidentPrivacy(
        propsWithProjectPermission(Permission.ProjectAdmin),
      ),
    ).toBe(true);
  });

  test("an ordinary project member does NOT bypass", () => {
    expect(
      shouldBypassIncidentPrivacy(
        propsWithProjectPermission(Permission.ProjectMember),
      ),
    ).toBe(false);
  });

  test("an admin permission carried under a DIFFERENT tenant does not count", () => {
    const props: DatabaseCommonInteractionProps = propsWithProjectPermission(
      Permission.ProjectOwner,
    );

    // Caller now claims a tenant they hold no permission entry for.
    props.tenantId = ObjectID.generate();

    expect(shouldBypassIncidentPrivacy(props)).toBe(false);
  });

  test("no tenant / no permissions is not a bypass", () => {
    expect(shouldBypassIncidentPrivacy({ userId: userId })).toBe(false);
    expect(shouldBypassIncidentPrivacy({})).toBe(false);
  });
});

describe("getIncidentSelfPrivacyRaw", () => {
  test("returns undefined for a caller who bypasses the filter", () => {
    expect(getIncidentSelfPrivacyRaw({ isRoot: true })).toBeUndefined();
    expect(
      getIncidentSelfPrivacyRaw(
        propsWithProjectPermission(Permission.ProjectAdmin),
      ),
    ).toBeUndefined();
  });

  test("an anonymous caller only ever sees non-private incidents, with no bound params", () => {
    const clause: unknown = getIncidentSelfPrivacyRaw({});

    expect(clause).toBeInstanceOf(FindOperator);

    const { sql, params }: RawParts = rawParts(clause);

    // Non-private rows only: NULL or FALSE. No owner escape hatch.
    expect(sql).toContain("COLUMN IS NULL OR COLUMN = FALSE");
    expect(sql).not.toContain("IncidentOwnerUser");
    expect(Object.keys(params)).toHaveLength(0);
  });

  test("a logged-in user also sees private incidents they own directly or via a team", () => {
    const clause: unknown = getIncidentSelfPrivacyRaw({ userId: userId });

    const { sql, params }: RawParts = rawParts(clause);

    expect(sql).toContain("COLUMN IS NULL OR COLUMN = FALSE");
    expect(sql).toContain("IncidentOwnerUser");
    expect(sql).toContain("IncidentOwnerTeam");
    expect(sql).toContain("TeamMember");
    // Soft-deleted ownership rows must not grant visibility.
    expect(sql).toContain(`iou."deletedAt" IS NULL`);
    expect(sql).toContain(`tm."deletedAt" IS NULL`);

    // The clause is bound to exactly this user, once.
    const values: Array<string> = Object.values(params);
    expect(values).toEqual([userId.toString()]);
  });

  test("uses a fresh parameter name per call so two clauses cannot collide", () => {
    const first: RawParts = rawParts(getIncidentSelfPrivacyRaw({ userId }));
    const second: RawParts = rawParts(getIncidentSelfPrivacyRaw({ userId }));

    expect(Object.keys(first.params)).not.toEqual(Object.keys(second.params));
  });
});

describe("getIncidentRelatedRecordPrivacyRaw", () => {
  test("returns undefined for a bypassing caller", () => {
    expect(
      getIncidentRelatedRecordPrivacyRaw({ isRoot: true }),
    ).toBeUndefined();
  });

  test("anonymous callers are scoped to child rows of non-private incidents only", () => {
    const clause: unknown = getIncidentRelatedRecordPrivacyRaw({});

    const { sql, params }: RawParts = rawParts(clause);

    // Child rows are gated on the parent Incident being non-private.
    expect(sql).toContain(`FROM "Incident" i`);
    expect(sql).toContain(`i."isPrivate" IS NULL OR i."isPrivate" = FALSE`);
    expect(sql).not.toContain("IncidentOwnerUser");
    expect(Object.keys(params)).toHaveLength(0);
  });

  test("a logged-in user's child rows also include incidents they own", () => {
    const clause: unknown = getIncidentRelatedRecordPrivacyRaw({ userId });

    const { sql, params }: RawParts = rawParts(clause);

    expect(sql).toContain("IncidentOwnerUser");
    expect(sql).toContain("IncidentOwnerTeam");
    expect(Object.values(params)).toEqual([userId.toString()]);
  });
});

describe("applyIncidentSelfPrivacyFilter", () => {
  test("returns the query untouched for a bypassing caller", () => {
    const query: { projectId: ObjectID } = { projectId: tenantId };
    const result: { projectId: ObjectID; isPrivate?: unknown } =
      applyIncidentSelfPrivacyFilter(query, { isRoot: true });

    expect(result).toBe(query);
    expect(result.isPrivate).toBeUndefined();
  });

  test("builds a fresh query object when none is supplied", () => {
    const result: { isPrivate?: unknown } = applyIncidentSelfPrivacyFilter(
      undefined as unknown as { isPrivate?: unknown },
      { userId },
    );

    expect(result.isPrivate).toBeInstanceOf(FindOperator);
  });

  test("sets the privacy clause on isPrivate while leaving other keys intact", () => {
    const projectId: ObjectID = ObjectID.generate();
    const result: { projectId: ObjectID; isPrivate?: unknown } =
      applyIncidentSelfPrivacyFilter({ projectId }, { userId });

    expect(result.projectId).toBe(projectId);
    expect(result.isPrivate).toBeInstanceOf(FindOperator);
  });

  test("ANDs an existing isPrivate value together with the forced clause", () => {
    const result: { isPrivate?: unknown } = applyIncidentSelfPrivacyFilter(
      { isPrivate: false },
      { userId },
    );

    // combineWithPrivacyClause wraps the caller value + clause in And(...).
    const rendered: unknown = result.isPrivate;
    expect(rendered).toBeInstanceOf(FindOperator);
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    expect(String((rendered as any)._type)).toBe("and");
  });
});

describe("applyIncidentRelatedRecordPrivacyFilter", () => {
  test("returns the query untouched for a bypassing caller", () => {
    const query: { incidentId: ObjectID } = { incidentId: ObjectID.generate() };
    const result: { incidentId: unknown } =
      applyIncidentRelatedRecordPrivacyFilter(query, { isMasterAdmin: true });

    expect(result).toBe(query);
  });

  test("builds { incidentId: clause } when no query is supplied", () => {
    const result: { incidentId?: unknown } =
      applyIncidentRelatedRecordPrivacyFilter(
        undefined as unknown as { incidentId?: unknown },
        { userId },
      );

    expect(result.incidentId).toBeInstanceOf(FindOperator);
  });

  test("ANDs an existing incidentId filter so a per-incident query cannot widen", () => {
    const incidentId: ObjectID = ObjectID.generate();
    const result: { incidentId?: unknown } =
      applyIncidentRelatedRecordPrivacyFilter({ incidentId }, { userId });

    const rendered: unknown = result.incidentId;
    expect(rendered).toBeInstanceOf(FindOperator);
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    expect(String((rendered as any)._type)).toBe("and");
  });
});
