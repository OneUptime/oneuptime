import {
  DataSecurityIssueGroupCloudActionJSON,
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupFixStoreJSON,
  DataSecurityIssueGroupLeftOutReason,
  countIssueGroupFixStores,
  getIssueGroupCloudActionList,
  getIssueGroupCloudActions,
  getIssueGroupFixPlanFingerprint,
  getIssueGroupMainAction,
} from "../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import {
  DataSecurityResponseAction,
  describeDataSecurityResponseAction,
  getDataSecurityResponseActionForIssue,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { describe, expect, test } from "@jest/globals";

/*
 * A GROUP'S ONE APPROVAL, KIND BY KIND (#10742), AS DATA.
 *
 * A group's stores share a check and a cloud, not always a kind. The one
 * approval runs each kind's own response action - still one approval - and
 * the plan says, kind by kind, which action runs on which stores:
 * getIssueGroupCloudActions groups them, getIssueGroupMainAction names the
 * one most take, and the plan's fingerprint says which store takes which
 * when they differ - while a plan of one action fingerprints as it always
 * did, so a dialog open across an upgrade still presses.
 */

function store(
  id: string,
  kind: string,
  action?: DataSecurityResponseAction,
): DataSecurityIssueGroupFixStoreJSON {
  return {
    issueId: `issue-${id}`,
    dataStoreId: id,
    name: `store-${id}`,
    kind,
    ...(action ? { action } : {}),
  };
}

const VERSIONING: DataSecurityResponseAction =
  DataSecurityResponseAction.TurnOnVersioning;
const RECOVERY: DataSecurityResponseAction =
  DataSecurityResponseAction.TurnOnPointInTimeRecovery;
const REVOKE: DataSecurityResponseAction =
  DataSecurityResponseAction.RevokeSharing;

describe("the one approval's actions, kind by kind", () => {
  test("stores are grouped by the action they take and their kind, the most stores first", () => {
    const actions: Array<DataSecurityIssueGroupCloudActionJSON> =
      getIssueGroupCloudActions([
        store("t1", DataStoreKind.AwsDynamoDbTable, RECOVERY),
        store("b1", DataStoreKind.AwsS3Bucket, VERSIONING),
        store("b2", DataStoreKind.AwsS3Bucket, VERSIONING),
        store("b3", DataStoreKind.AwsS3Bucket, VERSIONING),
        store("t2", DataStoreKind.AwsDynamoDbTable, RECOVERY),
      ]);

    expect(
      actions.map((entry: DataSecurityIssueGroupCloudActionJSON) => {
        return [entry.action, entry.kind, entry.stores.length];
      }),
    ).toEqual([
      [VERSIONING, DataStoreKind.AwsS3Bucket, 3],
      [RECOVERY, DataStoreKind.AwsDynamoDbTable, 2],
    ]);
    // Each kind keeps its stores in the order they came.
    expect(
      actions[0]!.stores.map((entry: DataSecurityIssueGroupFixStoreJSON) => {
        return entry.dataStoreId;
      }),
    ).toEqual(["b1", "b2", "b3"]);
  });

  test("one action on two kinds is two entries: it says one thing of a snapshot and another of a database", () => {
    const actions: Array<DataSecurityIssueGroupCloudActionJSON> =
      getIssueGroupCloudActions([
        store("s1", DataStoreKind.AwsRdsSnapshot, REVOKE),
        store("d1", DataStoreKind.AwsRdsInstance, REVOKE),
        store("s2", DataStoreKind.AwsRdsSnapshot, REVOKE),
      ]);

    expect(actions).toHaveLength(2);
    expect(actions[0]!.kind).toBe(DataStoreKind.AwsRdsSnapshot);
    expect(actions[1]!.kind).toBe(DataStoreKind.AwsRdsInstance);
    expect(
      describeDataSecurityResponseAction(REVOKE, actions[0]!.kind),
    ).not.toBe(describeDataSecurityResponseAction(REVOKE, actions[1]!.kind));
  });

  test("of two as large, the order is by action then kind, so the same stores always read alike", () => {
    const one: Array<DataSecurityIssueGroupCloudActionJSON> =
      getIssueGroupCloudActions([
        store("t1", DataStoreKind.AwsDynamoDbTable, RECOVERY),
        store("b1", DataStoreKind.AwsS3Bucket, VERSIONING),
      ]);
    const other: Array<DataSecurityIssueGroupCloudActionJSON> =
      getIssueGroupCloudActions([
        store("b1", DataStoreKind.AwsS3Bucket, VERSIONING),
        store("t1", DataStoreKind.AwsDynamoDbTable, RECOVERY),
      ]);

    expect(
      one.map((entry: DataSecurityIssueGroupCloudActionJSON) => {
        return entry.action;
      }),
    ).toEqual(
      other.map((entry: DataSecurityIssueGroupCloudActionJSON) => {
        return entry.action;
      }),
    );
    expect(one[0]!.action).toBe(RECOVERY);
  });

  test("a store with no action is no action's", () => {
    expect(
      getIssueGroupCloudActions([
        store("x", DataStoreKind.AwsS3Bucket),
        store("b1", DataStoreKind.AwsS3Bucket, VERSIONING),
      ]),
    ).toEqual([
      {
        action: VERSIONING,
        kind: DataStoreKind.AwsS3Bucket,
        stores: [store("b1", DataStoreKind.AwsS3Bucket, VERSIONING)],
      },
    ]);
    expect(getIssueGroupCloudActions([])).toEqual([]);
  });

  test("a store with no kind still has its action, of an unnamed kind", () => {
    const actions: Array<DataSecurityIssueGroupCloudActionJSON> =
      getIssueGroupCloudActions([
        {
          issueId: "i",
          dataStoreId: "s",
          name: "s",
          action: VERSIONING,
        },
      ]);

    expect(actions).toEqual([
      expect.objectContaining({ action: VERSIONING, kind: "" }),
    ]);
  });
});

describe("the action most stores take", () => {
  test("is the most common one", () => {
    expect(
      getIssueGroupMainAction([
        { action: RECOVERY },
        { action: VERSIONING },
        { action: VERSIONING },
      ]),
    ).toBe(VERSIONING);
  });

  test("of two as common, the first by name", () => {
    expect(
      getIssueGroupMainAction([{ action: VERSIONING }, { action: RECOVERY }]),
    ).toBe(RECOVERY);
    expect(
      getIssueGroupMainAction([{ action: RECOVERY }, { action: VERSIONING }]),
    ).toBe(RECOVERY);
  });

  test("is none when no store takes one", () => {
    expect(getIssueGroupMainAction([{}, {}])).toBeNull();
    expect(getIssueGroupMainAction([])).toBeNull();
  });
});

describe("the actions of a plan, each once", () => {
  test("in the plan's order", () => {
    expect(
      getIssueGroupCloudActionList({
        action: VERSIONING,
        actions: [
          {
            action: VERSIONING,
            kind: DataStoreKind.AwsS3Bucket,
            stores: [],
          },
          {
            action: RECOVERY,
            kind: DataStoreKind.AwsDynamoDbTable,
            stores: [],
          },
          {
            action: VERSIONING,
            kind: DataStoreKind.GcpStorageBucket,
            stores: [],
          },
        ],
      }),
    ).toEqual([VERSIONING, RECOVERY]);
  });

  test("a plan that names no actions is its one action", () => {
    expect(
      getIssueGroupCloudActionList({ action: REVOKE, actions: [] }),
    ).toEqual([REVOKE]);
    expect(
      getIssueGroupCloudActionList({
        action: REVOKE,
        actions: undefined as never,
      }),
    ).toEqual([REVOKE]);
  });
});

describe("a plan's fingerprint", () => {
  function plan(
    stores: Array<DataSecurityIssueGroupFixStoreJSON>,
    action: DataSecurityResponseAction = VERSIONING,
  ): Omit<DataSecurityIssueGroupFixPlanJSON, "planFingerprint"> {
    return {
      groupId: "GROUP",
      checkId: "deleted-data-not-recoverable",
      cloud: {
        action,
        actions: getIssueGroupCloudActions(stores),
        stores,
      },
      leftOut: [],
    };
  }

  test("a plan of one action reads as it did before stores said their action", () => {
    const withActions: string = getIssueGroupFixPlanFingerprint(
      plan([
        store("b1", DataStoreKind.AwsS3Bucket, VERSIONING),
        store("b2", DataStoreKind.AwsS3Bucket, VERSIONING),
      ]),
    );
    const before: string = getIssueGroupFixPlanFingerprint({
      groupId: "group",
      checkId: "deleted-data-not-recoverable",
      cloud: {
        action: VERSIONING,
        actions: [],
        stores: [
          store("B2", DataStoreKind.AwsS3Bucket),
          store("b1", DataStoreKind.AwsS3Bucket),
        ],
      },
      leftOut: [],
    });

    expect(withActions).toBe(before);
  });

  test("stores of several actions say which takes which: the same stores taking other actions read otherwise", () => {
    const mixed: string = getIssueGroupFixPlanFingerprint(
      plan([
        store("b1", DataStoreKind.AwsS3Bucket, VERSIONING),
        store("t1", DataStoreKind.AwsDynamoDbTable, RECOVERY),
      ]),
    );
    const swapped: string = getIssueGroupFixPlanFingerprint(
      plan([
        store("b1", DataStoreKind.AwsS3Bucket, RECOVERY),
        store("t1", DataStoreKind.AwsDynamoDbTable, VERSIONING),
      ]),
    );
    const allOne: string = getIssueGroupFixPlanFingerprint(
      plan([
        store("b1", DataStoreKind.AwsS3Bucket, VERSIONING),
        store("t1", DataStoreKind.AwsDynamoDbTable, VERSIONING),
      ]),
    );

    expect(mixed).not.toBe(swapped);
    expect(mixed).not.toBe(allOne);
  });

  test("the same stores read the same, in whatever order", () => {
    expect(
      getIssueGroupFixPlanFingerprint(
        plan([
          store("t1", DataStoreKind.AwsDynamoDbTable, RECOVERY),
          store("b1", DataStoreKind.AwsS3Bucket, VERSIONING),
        ]),
      ),
    ).toBe(
      getIssueGroupFixPlanFingerprint(
        plan([
          store("b1", DataStoreKind.AwsS3Bucket, VERSIONING),
          store("t1", DataStoreKind.AwsDynamoDbTable, RECOVERY),
        ]),
      ),
    );
  });
});

describe("how many stores a press fixes", () => {
  test("counts every store of the one approval whatever its action, and those ticked in", () => {
    const stores: Array<DataSecurityIssueGroupFixStoreJSON> = [
      store("b1", DataStoreKind.AwsS3Bucket, VERSIONING),
      store("t1", DataStoreKind.AwsDynamoDbTable, RECOVERY),
    ];

    expect(
      countIssueGroupFixStores(
        {
          cloud: {
            action: VERSIONING,
            actions: getIssueGroupCloudActions(stores),
            stores,
          },
          leftOut: [
            {
              ...store("t2", DataStoreKind.AwsDynamoDbTable, RECOVERY),
              part: DataSecurityIssueGroupFixPart.Cloud,
              reason: DataSecurityIssueGroupLeftOutReason.FixWouldBreak,
              canInclude: true,
            },
          ],
        },
        ["T2"],
      ),
    ).toBe(3);
  });
});

describe("the catalog the one approval reads", () => {
  test("each kind of store takes its own action for a check, where it has one", () => {
    expect(
      getDataSecurityResponseActionForIssue(
        "deleted-data-not-recoverable",
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBe(VERSIONING);
    expect(
      getDataSecurityResponseActionForIssue(
        "deleted-data-not-recoverable",
        DataStoreKind.AzureStorageAccount,
      ),
    ).toBe(DataSecurityResponseAction.TurnOnSoftDelete);
    expect(
      getDataSecurityResponseActionForIssue(
        "deleted-data-not-recoverable",
        DataStoreKind.AwsDynamoDbTable,
      ),
    ).toBeUndefined();
    // One action, several kinds: each kind's own words.
    for (const kind of [
      DataStoreKind.AwsRdsSnapshot,
      DataStoreKind.AwsRdsInstance,
      DataStoreKind.AwsRdsCluster,
      DataStoreKind.AwsDocumentDbCluster,
    ]) {
      expect(
        getDataSecurityResponseActionForIssue("snapshot-public", kind),
      ).toBe(REVOKE);
    }
  });

  test("each action's words say what it changes, what stops working or what it costs", () => {
    expect(
      describeDataSecurityResponseAction(VERSIONING, DataStoreKind.AwsS3Bucket),
    ).toContain("billed");
    expect(
      describeDataSecurityResponseAction(
        RECOVERY,
        DataStoreKind.AwsDynamoDbTable,
      ),
    ).toContain("bills");
    expect(
      describeDataSecurityResponseAction(
        DataSecurityResponseAction.BlockPublicAccess,
        DataStoreKind.AwsS3Bucket,
      ),
    ).toContain("stops working");
  });
});
