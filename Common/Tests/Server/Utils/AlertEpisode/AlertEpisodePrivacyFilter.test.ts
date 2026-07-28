import {
  applyAlertEpisodeRelatedRecordPrivacyFilter,
  applyAlertEpisodeSelfPrivacyFilter,
  getAlertEpisodeRelatedRecordPrivacyRaw,
  getAlertEpisodeSelfPrivacyRaw,
  shouldBypassAlertEpisodePrivacy,
} from "../../../../Server/Utils/AlertEpisode/AlertEpisodePrivacyFilter";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Alert-episode privacy is the alert-side twin of incident-episode privacy.
 * The emitted SQL is pinned so a wrong table/column or a dropped soft-delete
 * guard is caught.
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

describe("shouldBypassAlertEpisodePrivacy", () => {
  test("root, master-admin, owner and admin bypass; member does not", () => {
    expect(shouldBypassAlertEpisodePrivacy({ isRoot: true })).toBe(true);
    expect(shouldBypassAlertEpisodePrivacy({ isMasterAdmin: true })).toBe(true);
    expect(
      shouldBypassAlertEpisodePrivacy(
        propsWithProjectPermission(Permission.ProjectAdmin),
      ),
    ).toBe(true);
    expect(
      shouldBypassAlertEpisodePrivacy(
        propsWithProjectPermission(Permission.ProjectMember),
      ),
    ).toBe(false);
  });
});

describe("getAlertEpisodeSelfPrivacyRaw", () => {
  test("bypassing callers get no clause", () => {
    expect(getAlertEpisodeSelfPrivacyRaw({ isRoot: true })).toBeUndefined();
  });

  test("anonymous callers only see non-private episodes, no params bound", () => {
    const { sql, params }: RawParts = rawParts(
      getAlertEpisodeSelfPrivacyRaw({}),
    );

    expect(sql).toContain("COLUMN IS NULL OR COLUMN = FALSE");
    expect(sql).not.toContain("AlertEpisodeOwnerUser");
    expect(Object.keys(params)).toHaveLength(0);
  });

  test("a user also sees episodes they own, bound to their id", () => {
    const { sql, params }: RawParts = rawParts(
      getAlertEpisodeSelfPrivacyRaw({ userId }),
    );

    expect(sql).toContain("AlertEpisodeOwnerUser");
    expect(sql).toContain("AlertEpisodeOwnerTeam");
    expect(sql).toContain(`aeou."deletedAt" IS NULL`);
    expect(Object.values(params)).toEqual([userId.toString()]);
  });

  test("fresh parameter name per call", () => {
    const first: RawParts = rawParts(getAlertEpisodeSelfPrivacyRaw({ userId }));
    const second: RawParts = rawParts(
      getAlertEpisodeSelfPrivacyRaw({ userId }),
    );
    expect(Object.keys(first.params)).not.toEqual(Object.keys(second.params));
  });
});

describe("getAlertEpisodeRelatedRecordPrivacyRaw", () => {
  test("anonymous callers are scoped to child rows of non-private episodes", () => {
    const { sql }: RawParts = rawParts(
      getAlertEpisodeRelatedRecordPrivacyRaw({}),
    );

    expect(sql).toContain(`FROM "AlertEpisode" ae`);
    expect(sql).toContain(`ae."isPrivate" IS NULL OR ae."isPrivate" = FALSE`);
  });

  test("a user's child rows include episodes they own", () => {
    const { sql, params }: RawParts = rawParts(
      getAlertEpisodeRelatedRecordPrivacyRaw({ userId }),
    );

    expect(sql).toContain("AlertEpisodeOwnerUser");
    expect(Object.values(params)).toEqual([userId.toString()]);
  });
});

describe("apply* alert-episode filters", () => {
  test("bypassing callers get their query back untouched", () => {
    const query: { isPrivate?: unknown } = {};
    expect(applyAlertEpisodeSelfPrivacyFilter(query, { isRoot: true })).toBe(
      query,
    );
  });

  test("self filter sets isPrivate; related filter builds { alertEpisodeId }", () => {
    const self: { isPrivate?: unknown } = applyAlertEpisodeSelfPrivacyFilter(
      {},
      { userId },
    );
    expect(self.isPrivate).toBeInstanceOf(FindOperator);

    const related: { alertEpisodeId?: unknown } =
      applyAlertEpisodeRelatedRecordPrivacyFilter(
        undefined as unknown as { alertEpisodeId?: unknown },
        { userId },
      );
    expect(related.alertEpisodeId).toBeInstanceOf(FindOperator);
  });

  test("an existing alertEpisodeId filter is ANDed, not replaced", () => {
    const alertEpisodeId: ObjectID = ObjectID.generate();
    const combined: { alertEpisodeId?: unknown } =
      applyAlertEpisodeRelatedRecordPrivacyFilter(
        { alertEpisodeId },
        { userId },
      );
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    expect(String((combined.alertEpisodeId as any)._type)).toBe("and");
  });
});
