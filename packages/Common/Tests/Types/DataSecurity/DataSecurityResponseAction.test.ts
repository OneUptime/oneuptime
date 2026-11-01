import {
  DATA_SECURITY_CHECKS,
  DataSecurityCheckGroup,
  DataSecurityCheckInfo,
  checkAppliesToKind,
  getDataSecurityCheck,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  ALL_DATA_SECURITY_RESPONSE_ACTIONS,
  BLOCKABLE_DATA_STORE_KINDS,
  CLUSTER_SNAPSHOT_DATA_STORE_KINDS,
  DATA_SECURITY_RESPONSE_ACTION_CHECKS,
  DataSecurityResponseAction,
  SHAREABLE_DATA_STORE_KINDS,
  describeDataSecurityResponseAction,
  getDataSecurityResponseActionForIssue,
  getDataSecurityResponseActions,
  isDataSecurityResponseAction,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
import {
  DataStoreKind,
  DataStoreProvider,
  getDataStoreKindInfo,
} from "../../../Types/DataSecurity/DataStoreKind";
import { describe, expect, test } from "@jest/globals";

/*
 * Which store can take which response action, and which issues each one
 * fixes - the one list the server, the issue page and the playbook steps
 * read (Types/DataSecurity/DataSecurityResponseAction).
 */

describe("the response actions", () => {
  test("are the two, by the names the API and the playbook steps use", () => {
    expect([...ALL_DATA_SECURITY_RESPONSE_ACTIONS]).toEqual([
      "Block public access",
      "Revoke sharing",
    ]);
    expect(isDataSecurityResponseAction("Block public access")).toBe(true);
    expect(isDataSecurityResponseAction("Revoke sharing")).toBe(true);

    for (const value of ["block public access", "Delete", "", null, 1]) {
      expect(isDataSecurityResponseAction(value)).toBe(false);
    }
  });

  test("Block public access fits each cloud's object store, and nothing else", () => {
    expect([...BLOCKABLE_DATA_STORE_KINDS]).toEqual([
      DataStoreKind.AwsS3Bucket,
      DataStoreKind.AzureStorageAccount,
      DataStoreKind.GcpStorageBucket,
    ]);

    for (const kind of BLOCKABLE_DATA_STORE_KINDS) {
      expect(getDataStoreKindInfo(kind)?.provider).not.toBe(
        DataStoreProvider.OneUptime,
      );
    }
  });

  test("Revoke sharing fits AWS's databases and their snapshots, whose sharing AWS keeps per snapshot", () => {
    expect([...SHAREABLE_DATA_STORE_KINDS]).toEqual([
      DataStoreKind.AwsRdsSnapshot,
      DataStoreKind.AwsRdsInstance,
      DataStoreKind.AwsRdsCluster,
      DataStoreKind.AwsDocumentDbCluster,
    ]);

    for (const kind of SHAREABLE_DATA_STORE_KINDS) {
      expect(getDataStoreKindInfo(kind)?.provider).toBe(DataStoreProvider.Aws);
    }

    // A cluster's snapshots are cluster snapshots: another AWS call.
    for (const kind of CLUSTER_SNAPSHOT_DATA_STORE_KINDS) {
      expect(SHAREABLE_DATA_STORE_KINDS).toContain(kind);
    }
  });

  test("no store takes both, and every other kind takes neither", () => {
    for (const kind of Object.values(DataStoreKind)) {
      const actions: Array<DataSecurityResponseAction> =
        getDataSecurityResponseActions(kind);

      expect(actions.length).toBeLessThanOrEqual(1);
      expect(actions.length === 1).toBe(
        BLOCKABLE_DATA_STORE_KINDS.includes(kind) ||
          SHAREABLE_DATA_STORE_KINDS.includes(kind),
      );
    }

    expect(getDataSecurityResponseActions(undefined)).toEqual([]);
    expect(
      getDataSecurityResponseActions("A kind from a later release"),
    ).toEqual([]);
  });
});

describe("the issues each action fixes", () => {
  test("every check named is in the catalog, and applies to a store the action fits", () => {
    for (const action of ALL_DATA_SECURITY_RESPONSE_ACTIONS) {
      const kinds: Array<DataStoreKind> = Object.values(DataStoreKind).filter(
        (kind: DataStoreKind): boolean => {
          return getDataSecurityResponseActions(kind).includes(action);
        },
      );

      for (const checkId of DATA_SECURITY_RESPONSE_ACTION_CHECKS[action]) {
        const check: DataSecurityCheckInfo | undefined =
          getDataSecurityCheck(checkId);

        expect([action, checkId, Boolean(check)]).toEqual([
          action,
          checkId,
          true,
        ]);
        expect(
          kinds.some((kind: DataStoreKind): boolean => {
            return checkAppliesToKind(check!, kind);
          }),
        ).toBe(true);
      }
    }
  });

  test("a public bucket is blocked; a shared snapshot's sharing is revoked", () => {
    expect(
      getDataSecurityResponseActionForIssue(
        "public-read",
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBe(DataSecurityResponseAction.BlockPublicAccess);
    expect(
      getDataSecurityResponseActionForIssue(
        "public-access-not-blocked",
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBe(DataSecurityResponseAction.BlockPublicAccess);
    expect(
      getDataSecurityResponseActionForIssue(
        "public-write",
        DataStoreKind.GcpStorageBucket,
      ),
    ).toBe(DataSecurityResponseAction.BlockPublicAccess);
    expect(
      getDataSecurityResponseActionForIssue(
        "snapshot-public",
        DataStoreKind.AwsRdsSnapshot,
      ),
    ).toBe(DataSecurityResponseAction.RevokeSharing);
    expect(
      getDataSecurityResponseActionForIssue(
        "snapshot-shared-externally",
        DataStoreKind.AwsRdsInstance,
      ),
    ).toBe(DataSecurityResponseAction.RevokeSharing);
  });

  test("an issue no action fixes - or on a store the action does not fit - offers none", () => {
    // Encryption is a change of how data is kept: no button flips it.
    expect(
      getDataSecurityResponseActionForIssue(
        "not-encrypted-at-rest",
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBeUndefined();
    // A public RDS database is reached over its network, not shared.
    expect(
      getDataSecurityResponseActionForIssue(
        "public-read",
        DataStoreKind.AwsRdsInstance,
      ),
    ).toBeUndefined();
    expect(
      getDataSecurityResponseActionForIssue(
        "snapshot-public",
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBeUndefined();
    expect(
      getDataSecurityResponseActionForIssue(
        undefined,
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBeUndefined();
    expect(
      getDataSecurityResponseActionForIssue("public-read", undefined),
    ).toBeUndefined();
  });

  test("the checks the actions fix are exposure checks", () => {
    const named: Array<string> = ALL_DATA_SECURITY_RESPONSE_ACTIONS.flatMap(
      (action: DataSecurityResponseAction): Array<string> => {
        return [...DATA_SECURITY_RESPONSE_ACTION_CHECKS[action]];
      },
    );

    expect(new Set(named).size).toBe(named.length);

    for (const checkId of named) {
      expect(
        DATA_SECURITY_CHECKS.find((check: DataSecurityCheckInfo): boolean => {
          return check.id === checkId;
        })?.group,
      ).toBe(DataSecurityCheckGroup.Exposure);
    }
  });
});

// "No object is changed.", "The snapshot itself is not changed."
const SAYS_WHAT_IS_LEFT: RegExp = /(?:is|are) (?:not )?changed\.$/;

describe("what a person is told before they confirm", () => {
  test("each cloud's bucket by its own words, and what stops working", () => {
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.BlockPublicAccess,
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBe(
      "Turns on the bucket's four Block Public Access settings, so nobody on the internet can read it. Anything that reads it publicly - a website, a download link - stops working. No object is changed.",
    );
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.BlockPublicAccess,
        DataStoreKind.AzureStorageAccount,
      ),
    ).toContain("anonymous blob access");
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.BlockPublicAccess,
        DataStoreKind.GcpStorageBucket,
      ),
    ).toContain("public access prevention");
  });

  test("a snapshot, or a database's snapshots - never its data", () => {
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.RevokeSharing,
        DataStoreKind.AwsRdsSnapshot,
      ),
    ).toContain("The snapshot itself is not changed.");
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.RevokeSharing,
        DataStoreKind.AwsRdsCluster,
      ),
    ).toContain("No snapshot or database is changed.");
  });

  test("every sentence says what is left untouched", () => {
    for (const kind of Object.values(DataStoreKind)) {
      for (const action of getDataSecurityResponseActions(kind)) {
        expect(describeDataSecurityResponseAction(action, kind)).toMatch(
          SAYS_WHAT_IS_LEFT,
        );
      }
    }
  });
});
