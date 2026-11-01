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
  DATA_SECURITY_RESPONSE_ACTION_KINDS,
  DataSecurityResponseAction,
  EXPOSURE_RESPONSE_ACTIONS,
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
  test("are eight, by the names the API and the playbook steps use", () => {
    expect([...ALL_DATA_SECURITY_RESPONSE_ACTIONS]).toEqual([
      "Block public access",
      "Revoke sharing",
      "Turn on versioning",
      "Turn on soft delete",
      "Turn off object ACLs",
      "Turn on uniform access",
      "Require secure transfer",
      "Turn on point-in-time recovery",
    ]);

    for (const action of ALL_DATA_SECURITY_RESPONSE_ACTIONS) {
      expect(isDataSecurityResponseAction(action)).toBe(true);
    }

    for (const value of ["block public access", "Delete", "", null, 1]) {
      expect(isDataSecurityResponseAction(value)).toBe(false);
    }
  });

  test("the two that close an exposure are the ones a playbook runs", () => {
    expect([...EXPOSURE_RESPONSE_ACTIONS]).toEqual([
      DataSecurityResponseAction.BlockPublicAccess,
      DataSecurityResponseAction.RevokeSharing,
    ]);
  });

  test("each hardening action fits the stores whose cloud has the setting", () => {
    expect(
      DATA_SECURITY_RESPONSE_ACTION_KINDS[
        DataSecurityResponseAction.TurnOnVersioning
      ],
    ).toEqual([DataStoreKind.AwsS3Bucket, DataStoreKind.GcpStorageBucket]);
    expect(
      DATA_SECURITY_RESPONSE_ACTION_KINDS[
        DataSecurityResponseAction.TurnOnSoftDelete
      ],
    ).toEqual([DataStoreKind.AzureStorageAccount]);
    expect(
      DATA_SECURITY_RESPONSE_ACTION_KINDS[
        DataSecurityResponseAction.TurnOffObjectAcls
      ],
    ).toEqual([DataStoreKind.AwsS3Bucket]);
    expect(
      DATA_SECURITY_RESPONSE_ACTION_KINDS[
        DataSecurityResponseAction.TurnOnUniformAccess
      ],
    ).toEqual([DataStoreKind.GcpStorageBucket]);
    expect(
      DATA_SECURITY_RESPONSE_ACTION_KINDS[
        DataSecurityResponseAction.RequireSecureTransfer
      ],
    ).toEqual([DataStoreKind.AzureStorageAccount]);
    expect(
      DATA_SECURITY_RESPONSE_ACTION_KINDS[
        DataSecurityResponseAction.TurnOnPointInTimeRecovery
      ],
    ).toEqual([DataStoreKind.AwsDynamoDbTable]);

    // In the catalog's order, whatever the store.
    expect(getDataSecurityResponseActions(DataStoreKind.AwsS3Bucket)).toEqual([
      DataSecurityResponseAction.BlockPublicAccess,
      DataSecurityResponseAction.TurnOnVersioning,
      DataSecurityResponseAction.TurnOffObjectAcls,
    ]);
    expect(
      getDataSecurityResponseActions(DataStoreKind.AzureStorageAccount),
    ).toEqual([
      DataSecurityResponseAction.BlockPublicAccess,
      DataSecurityResponseAction.TurnOnSoftDelete,
      DataSecurityResponseAction.RequireSecureTransfer,
    ]);
    expect(
      getDataSecurityResponseActions(DataStoreKind.GcpStorageBucket),
    ).toEqual([
      DataSecurityResponseAction.BlockPublicAccess,
      DataSecurityResponseAction.TurnOnVersioning,
      DataSecurityResponseAction.TurnOnUniformAccess,
    ]);
    expect(
      getDataSecurityResponseActions(DataStoreKind.AwsDynamoDbTable),
    ).toEqual([DataSecurityResponseAction.TurnOnPointInTimeRecovery]);
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

  test("no store is both blocked and unshared; only a cloud's own stores take any", () => {
    for (const kind of Object.values(DataStoreKind)) {
      const actions: Array<DataSecurityResponseAction> =
        getDataSecurityResponseActions(kind);

      expect(
        actions.includes(DataSecurityResponseAction.BlockPublicAccess) &&
          actions.includes(DataSecurityResponseAction.RevokeSharing),
      ).toBe(false);

      if (actions.length > 0) {
        expect([kind, getDataStoreKindInfo(kind)?.provider]).not.toEqual([
          kind,
          DataStoreProvider.OneUptime,
        ]);
        expect([kind, getDataStoreKindInfo(kind)?.provider]).not.toEqual([
          kind,
          DataStoreProvider.SelfManaged,
        ]);
      }
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

  test("the checks the exposure actions fix are exposure checks", () => {
    for (const action of EXPOSURE_RESPONSE_ACTIONS) {
      for (const checkId of DATA_SECURITY_RESPONSE_ACTION_CHECKS[action]) {
        expect([
          action,
          checkId,
          DATA_SECURITY_CHECKS.find((check: DataSecurityCheckInfo): boolean => {
            return check.id === checkId;
          })?.group,
        ]).toEqual([action, checkId, DataSecurityCheckGroup.Exposure]);
      }
    }
  });

  test("an issue of a store is fixed by one action at most", () => {
    for (const kind of Object.values(DataStoreKind)) {
      const checks: Array<string> = getDataSecurityResponseActions(
        kind,
      ).flatMap((action: DataSecurityResponseAction): Array<string> => {
        return [...DATA_SECURITY_RESPONSE_ACTION_CHECKS[action]];
      });

      expect([kind, new Set(checks).size]).toEqual([kind, checks.length]);
    }
  });

  test("a hardening issue is fixed by its cloud's own setting", () => {
    const fixes: Array<[string, DataStoreKind, DataSecurityResponseAction]> = [
      [
        "deleted-data-not-recoverable",
        DataStoreKind.AwsS3Bucket,
        DataSecurityResponseAction.TurnOnVersioning,
      ],
      [
        "deleted-data-not-recoverable",
        DataStoreKind.GcpStorageBucket,
        DataSecurityResponseAction.TurnOnVersioning,
      ],
      [
        "deleted-data-not-recoverable",
        DataStoreKind.AzureStorageAccount,
        DataSecurityResponseAction.TurnOnSoftDelete,
      ],
      [
        "object-acls-enabled",
        DataStoreKind.AwsS3Bucket,
        DataSecurityResponseAction.TurnOffObjectAcls,
      ],
      [
        "object-acls-enabled",
        DataStoreKind.GcpStorageBucket,
        DataSecurityResponseAction.TurnOnUniformAccess,
      ],
      [
        "encryption-in-transit-not-enforced",
        DataStoreKind.AzureStorageAccount,
        DataSecurityResponseAction.RequireSecureTransfer,
      ],
      [
        "weak-tls",
        DataStoreKind.AzureStorageAccount,
        DataSecurityResponseAction.RequireSecureTransfer,
      ],
      [
        "no-point-in-time-recovery",
        DataStoreKind.AwsDynamoDbTable,
        DataSecurityResponseAction.TurnOnPointInTimeRecovery,
      ],
    ];

    for (const [checkId, kind, action] of fixes) {
      expect([
        checkId,
        kind,
        getDataSecurityResponseActionForIssue(checkId, kind),
      ]).toEqual([checkId, kind, action]);
    }

    // No button for a setting OneUptime may not write: an S3 bucket's TLS is its policy.
    expect(
      getDataSecurityResponseActionForIssue(
        "encryption-in-transit-not-enforced",
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBeUndefined();
    // Nor for one that could reset a database: RDS backups and deletion protection.
    expect(
      getDataSecurityResponseActionForIssue(
        "no-backups",
        DataStoreKind.AwsRdsInstance,
      ),
    ).toBeUndefined();
    expect(
      getDataSecurityResponseActionForIssue(
        "deletion-protection-off",
        DataStoreKind.AwsRdsInstance,
      ),
    ).toBeUndefined();
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

  test("a hardening action says what it costs, or what stops working", () => {
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.TurnOnVersioning,
        DataStoreKind.AwsS3Bucket,
      ),
    ).toContain("Earlier versions are kept, and billed");
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.TurnOnSoftDelete,
        DataStoreKind.AzureStorageAccount,
      ),
    ).toContain("for those 14 days");
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.TurnOffObjectAcls,
        DataStoreKind.AwsS3Bucket,
      ),
    ).toContain("stops working");
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.TurnOnUniformAccess,
        DataStoreKind.GcpStorageBucket,
      ),
    ).toContain("after 90 days it cannot be turned off again");
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.RequireSecureTransfer,
        DataStoreKind.AzureStorageAccount,
      ),
    ).toContain("over HTTP, or with older TLS, stops working");
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.TurnOnPointInTimeRecovery,
        DataStoreKind.AwsDynamoDbTable,
      ),
    ).toContain("AWS bills it by the table's size");
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
