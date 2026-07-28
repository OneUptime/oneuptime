import {
  applyIncidentEpisodeRelatedRecordPrivacyFilter,
  applyIncidentEpisodeSelfPrivacyFilter,
  getIncidentEpisodeRelatedRecordPrivacyRaw,
  getIncidentEpisodeSelfPrivacyRaw,
  shouldBypassIncidentEpisodePrivacy,
} from "../../../../Server/Utils/IncidentEpisode/IncidentEpisodePrivacyFilter";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Incident-episode privacy mirrors incident privacy: an episode is private when
 * its incident is, and only owners (plus project owners/admins/root) may see
 * private episodes. The emitted SQL is pinned so a wrong table/column or a
 * dropped soft-delete guard is caught.
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

describe("shouldBypassIncidentEpisodePrivacy", () => {
  test("root, master-admin, owner and admin bypass; member does not", () => {
    expect(shouldBypassIncidentEpisodePrivacy({ isRoot: true })).toBe(true);
    expect(shouldBypassIncidentEpisodePrivacy({ isMasterAdmin: true })).toBe(
      true,
    );
    expect(
      shouldBypassIncidentEpisodePrivacy(
        propsWithProjectPermission(Permission.ProjectOwner),
      ),
    ).toBe(true);
    expect(
      shouldBypassIncidentEpisodePrivacy(
        propsWithProjectPermission(Permission.ProjectMember),
      ),
    ).toBe(false);
  });
});

describe("getIncidentEpisodeSelfPrivacyRaw", () => {
  test("bypassing callers get no clause", () => {
    expect(getIncidentEpisodeSelfPrivacyRaw({ isRoot: true })).toBeUndefined();
  });

  test("anonymous callers only see non-private episodes, no params bound", () => {
    const { sql, params }: RawParts = rawParts(
      getIncidentEpisodeSelfPrivacyRaw({}),
    );

    expect(sql).toContain("COLUMN IS NULL OR COLUMN = FALSE");
    expect(sql).not.toContain("IncidentEpisodeOwnerUser");
    expect(Object.keys(params)).toHaveLength(0);
  });

  test("a user also sees episodes they own, bound to their id", () => {
    const { sql, params }: RawParts = rawParts(
      getIncidentEpisodeSelfPrivacyRaw({ userId }),
    );

    expect(sql).toContain("IncidentEpisodeOwnerUser");
    expect(sql).toContain("IncidentEpisodeOwnerTeam");
    expect(sql).toContain(`ieou."deletedAt" IS NULL`);
    expect(Object.values(params)).toEqual([userId.toString()]);
  });

  test("fresh parameter name per call", () => {
    const first: RawParts = rawParts(
      getIncidentEpisodeSelfPrivacyRaw({ userId }),
    );
    const second: RawParts = rawParts(
      getIncidentEpisodeSelfPrivacyRaw({ userId }),
    );
    expect(Object.keys(first.params)).not.toEqual(Object.keys(second.params));
  });
});

describe("getIncidentEpisodeRelatedRecordPrivacyRaw", () => {
  test("anonymous callers are scoped to child rows of non-private episodes", () => {
    const { sql }: RawParts = rawParts(
      getIncidentEpisodeRelatedRecordPrivacyRaw({}),
    );

    expect(sql).toContain(`FROM "IncidentEpisode" ie`);
    expect(sql).toContain(`ie."isPrivate" IS NULL OR ie."isPrivate" = FALSE`);
  });

  test("a user's child rows include episodes they own", () => {
    const { sql, params }: RawParts = rawParts(
      getIncidentEpisodeRelatedRecordPrivacyRaw({ userId }),
    );

    expect(sql).toContain("IncidentEpisodeOwnerUser");
    expect(Object.values(params)).toEqual([userId.toString()]);
  });
});

describe("apply* incident-episode filters", () => {
  test("bypassing callers get their query back untouched", () => {
    const query: { isPrivate?: unknown } = {};
    expect(applyIncidentEpisodeSelfPrivacyFilter(query, { isRoot: true })).toBe(
      query,
    );
  });

  test("self filter sets isPrivate; related filter builds { incidentEpisodeId }", () => {
    const self: { isPrivate?: unknown } = applyIncidentEpisodeSelfPrivacyFilter(
      {},
      { userId },
    );
    expect(self.isPrivate).toBeInstanceOf(FindOperator);

    const related: { incidentEpisodeId?: unknown } =
      applyIncidentEpisodeRelatedRecordPrivacyFilter(
        undefined as unknown as { incidentEpisodeId?: unknown },
        { userId },
      );
    expect(related.incidentEpisodeId).toBeInstanceOf(FindOperator);
  });

  test("an existing incidentEpisodeId filter is ANDed, not replaced", () => {
    const incidentEpisodeId: ObjectID = ObjectID.generate();
    const combined: { incidentEpisodeId?: unknown } =
      applyIncidentEpisodeRelatedRecordPrivacyFilter(
        { incidentEpisodeId },
        { userId },
      );
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    expect(String((combined.incidentEpisodeId as any)._type)).toBe("and");
  });
});
