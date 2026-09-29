import {
  applyAlertRelatedRecordPrivacyFilter,
  applyAlertSelfPrivacyFilter,
  getAlertRelatedRecordPrivacyRaw,
  getAlertSelfPrivacyRaw,
  shouldBypassAlertPrivacy,
} from "../../../../Server/Utils/Alert/AlertPrivacyFilter";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * AlertPrivacyFilter is the alert-side twin of IncidentPrivacyFilter: private
 * alerts are visible to owners (directly or via team), and to project
 * owners/admins/root. Each branch is pinned against the SQL actually emitted.
 */

const userId: ObjectID = ObjectID.generate();
const tenantId: ObjectID = ObjectID.generate();

const propsWithProjectPermission: (
  permission: Permission,
) => DatabaseCommonInteractionProps = (
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

describe("shouldBypassAlertPrivacy", () => {
  test("root, master-admin, project owner and project admin bypass", () => {
    expect(shouldBypassAlertPrivacy({ isRoot: true })).toBe(true);
    expect(shouldBypassAlertPrivacy({ isMasterAdmin: true })).toBe(true);
    expect(
      shouldBypassAlertPrivacy(
        propsWithProjectPermission(Permission.ProjectOwner),
      ),
    ).toBe(true);
    expect(
      shouldBypassAlertPrivacy(
        propsWithProjectPermission(Permission.ProjectAdmin),
      ),
    ).toBe(true);
  });

  test("an ordinary member, or a permission under another tenant, does not bypass", () => {
    expect(
      shouldBypassAlertPrivacy(
        propsWithProjectPermission(Permission.ProjectMember),
      ),
    ).toBe(false);

    const wrongTenant: DatabaseCommonInteractionProps =
      propsWithProjectPermission(Permission.ProjectOwner);
    wrongTenant.tenantId = ObjectID.generate();
    expect(shouldBypassAlertPrivacy(wrongTenant)).toBe(false);

    expect(shouldBypassAlertPrivacy({})).toBe(false);
  });
});

describe("getAlertSelfPrivacyRaw", () => {
  test("bypassing callers get no clause", () => {
    expect(getAlertSelfPrivacyRaw({ isRoot: true })).toBeUndefined();
  });

  test("anonymous callers only see non-private alerts, no params bound", () => {
    const { sql, params }: RawParts = rawParts(getAlertSelfPrivacyRaw({}));

    expect(sql).toContain("COLUMN IS NULL OR COLUMN = FALSE");
    expect(sql).not.toContain("AlertOwnerUser");
    expect(Object.keys(params)).toHaveLength(0);
  });

  test("a user also sees alerts they own directly or via a team, bound to their id", () => {
    const { sql, params }: RawParts = rawParts(
      getAlertSelfPrivacyRaw({ userId }),
    );

    expect(sql).toContain("AlertOwnerUser");
    expect(sql).toContain("AlertOwnerTeam");
    expect(sql).toContain("TeamMember");
    expect(sql).toContain(`aou."deletedAt" IS NULL`);
    expect(Object.values(params)).toEqual([userId.toString()]);
  });

  test("fresh parameter name per call", () => {
    const first: RawParts = rawParts(getAlertSelfPrivacyRaw({ userId }));
    const second: RawParts = rawParts(getAlertSelfPrivacyRaw({ userId }));
    expect(Object.keys(first.params)).not.toEqual(Object.keys(second.params));
  });
});

describe("getAlertRelatedRecordPrivacyRaw", () => {
  test("anonymous callers are scoped to child rows of non-private alerts", () => {
    const { sql, params }: RawParts = rawParts(
      getAlertRelatedRecordPrivacyRaw({}),
    );

    expect(sql).toContain(`FROM "Alert" a`);
    expect(sql).toContain(`a."isPrivate" IS NULL OR a."isPrivate" = FALSE`);
    expect(Object.keys(params)).toHaveLength(0);
  });

  test("a user's child rows also include alerts they own", () => {
    const { sql, params }: RawParts = rawParts(
      getAlertRelatedRecordPrivacyRaw({ userId }),
    );

    expect(sql).toContain("AlertOwnerUser");
    expect(Object.values(params)).toEqual([userId.toString()]);
  });
});

describe("applyAlertSelfPrivacyFilter / applyAlertRelatedRecordPrivacyFilter", () => {
  test("bypassing callers get their query back untouched", () => {
    const query: { isPrivate?: unknown } = {};
    expect(applyAlertSelfPrivacyFilter(query, { isRoot: true })).toBe(query);
  });

  test("self filter sets isPrivate and keeps other keys", () => {
    const projectId: ObjectID = ObjectID.generate();
    const result: { projectId: ObjectID; isPrivate?: unknown } =
      applyAlertSelfPrivacyFilter({ projectId }, { userId });

    expect(result.projectId).toBe(projectId);
    expect(result.isPrivate).toBeInstanceOf(FindOperator);
  });

  test("self filter ANDs an existing isPrivate value", () => {
    const result: { isPrivate?: unknown } = applyAlertSelfPrivacyFilter(
      { isPrivate: false },
      { userId },
    );
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    expect(String((result.isPrivate as any)._type)).toBe("and");
  });

  test("related filter builds { alertId: clause } and ANDs an existing alertId", () => {
    const created: { alertId?: unknown } = applyAlertRelatedRecordPrivacyFilter(
      undefined as unknown as { alertId?: unknown },
      { userId },
    );
    expect(created.alertId).toBeInstanceOf(FindOperator);

    const alertId: ObjectID = ObjectID.generate();
    const combined: { alertId?: unknown } =
      applyAlertRelatedRecordPrivacyFilter({ alertId }, { userId });
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    expect(String((combined.alertId as any)._type)).toBe("and");
  });
});
