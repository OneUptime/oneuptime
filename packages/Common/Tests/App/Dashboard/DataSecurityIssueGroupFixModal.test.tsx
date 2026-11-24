import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import IssueGroupFixModal, {
  ISSUE_GROUP_FIX_TEST_ID,
  getCloudActions,
  getCloudOutcomes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueGroupFixModal";
import {
  CLOUD_ACTION_STORES,
  CLOUD_PART_KINDS_SENTENCE,
  CLOUD_PART_ONE_KIND_SENTENCE,
  GROUP_FIX_SERVER_SENTENCES,
  getIssueRowsGroupFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueGroupsCopy";
import {
  DataSecurityIssueGroupCause,
  DataSecurityIssueGroupJSON,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import {
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupFixResultJSON,
  DataSecurityIssueGroupFixStoreJSON,
  getIssueGroupCloudActions,
  getIssueGroupMainAction,
} from "../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import {
  DataSecurityResponseAction,
  describeDataSecurityResponseAction,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import Toast from "../../../UI/Utils/Toast";
import type { Mock, SpyInstance } from "jest-mock";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * THE ONE APPROVAL SAYS WHAT EACH KIND OF STORE'S CHANGE DOES (#10742), and
 * the Issues list keeps a reader's issues of groups they are not shown
 * (#10739).
 *
 * A group's one approval ran one action on every store, so a group of S3
 * buckets and DynamoDB tables offered the buckets' action alone. Each kind
 * of store now takes its own, and Fix the cause lists them kind by kind -
 * the action, how many stores, the kind, and what it does, what stops
 * working and what it costs, in the very words Fix it from here confirms it
 * with - then one approval runs them all, and says what each did.
 */

const GROUP_ID: string = "10742000-0000-4000-8000-0000000000c1";
const VERSIONING: DataSecurityResponseAction =
  DataSecurityResponseAction.TurnOnVersioning;
const RECOVERY: DataSecurityResponseAction =
  DataSecurityResponseAction.TurnOnPointInTimeRecovery;
const BLOCK: DataSecurityResponseAction =
  DataSecurityResponseAction.BlockPublicAccess;

const GROUP: DataSecurityIssueGroupJSON = {
  groupId: GROUP_ID,
  checkId: "deleted-data-not-recoverable",
  cause: DataSecurityIssueGroupCause.Creator,
  facts: {
    cause: DataSecurityIssueGroupCause.Creator,
    checkId: "deleted-data-not-recoverable",
    creator: "role/orders-provisioner",
  },
  issueCount: 5,
  openIssueCount: 5,
  fixedIssueCount: 0,
};

let next: number = 0;

function store(
  name: string,
  kind: DataStoreKind,
  action: DataSecurityResponseAction,
): DataSecurityIssueGroupFixStoreJSON {
  next++;

  return {
    issueId: `10742000-0000-4000-8000-${next.toString(16).padStart(12, "0")}`,
    dataStoreId: `10742000-0000-4000-9000-${next.toString(16).padStart(12, "0")}`,
    name,
    kind,
    region: "us-east-1",
    action,
  };
}

// A plan of the one approval over these stores, as the server makes it.
function cloudPlan(
  stores: Array<DataSecurityIssueGroupFixStoreJSON>,
  options: { withActions?: boolean } = {},
): DataSecurityIssueGroupFixPlanJSON {
  return {
    groupId: GROUP_ID,
    checkId: GROUP.checkId,
    cloud: {
      action: getIssueGroupMainAction(stores)!,
      actions:
        options.withActions === false ? [] : getIssueGroupCloudActions(stores),
      stores,
    },
    leftOut: [],
    planFingerprint: "fingerprint-1",
  };
}

function bucketsAndTables(): Array<DataSecurityIssueGroupFixStoreJSON> {
  return [
    store("orders-exports", DataStoreKind.AwsS3Bucket, VERSIONING),
    store("orders-invoices", DataStoreKind.AwsS3Bucket, VERSIONING),
    store("orders-archive", DataStoreKind.AwsS3Bucket, VERSIONING),
    store("orders-table", DataStoreKind.AwsDynamoDbTable, RECOVERY),
    store("orders-carts", DataStoreKind.AwsDynamoDbTable, RECOVERY),
  ];
}

let planSpy: SpyInstance<typeof DataSecurityApi.getIssueGroupFixPlan>;
let fixSpy: SpyInstance<typeof DataSecurityApi.fixIssueGroup>;
let successSpy: SpyInstance<typeof Toast.success>;
let errorSpy: SpyInstance<typeof Toast.error>;
let onClose: Mock<() => void>;
let onFixed: Mock<() => void>;

function plans(plan: DataSecurityIssueGroupFixPlanJSON): void {
  planSpy.mockResolvedValue(plan);
}

async function open(): Promise<HTMLElement> {
  render(
    <MemoryRouter>
      <IssueGroupFixModal group={GROUP} onClose={onClose} onFixed={onFixed} />
    </MemoryRouter>,
  );

  return await screen.findByTestId(`${ISSUE_GROUP_FIX_TEST_ID}-cloud`);
}

function rows(): Array<HTMLElement> {
  return screen.getAllByTestId(`${ISSUE_GROUP_FIX_TEST_ID}-cloud-action`);
}

// How a count reads in English: the template's form for it, filled in.
function countOf(
  template: { one: string; other: string },
  count: number,
): string {
  return (count === 1 ? template.one : template.other).replace(
    "{{count}}",
    String(count),
  );
}

beforeEach(() => {
  next = 0;
  planSpy = jest.spyOn(DataSecurityApi, "getIssueGroupFixPlan");
  fixSpy = jest.spyOn(DataSecurityApi, "fixIssueGroup");
  successSpy = jest.spyOn(Toast, "success").mockReturnValue("toast");
  errorSpy = jest.spyOn(Toast, "error").mockReturnValue("toast");
  onClose = jest.fn<() => void>();
  onFixed = jest.fn<() => void>();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the one approval, kind by kind (#10742)", () => {
  test("lists each kind's own change: the action, how many stores, the kind, what it does and costs, and its stores", async () => {
    plans(cloudPlan(bucketsAndTables()));

    const part: HTMLElement = await open();

    expect(part).toHaveTextContent(countOf(CLOUD_PART_KINDS_SENTENCE, 5));

    const [buckets, tables] = rows();

    expect(rows()).toHaveLength(2);
    // The most stores first.
    expect(buckets).toHaveAttribute("data-action", VERSIONING);
    expect(buckets).toHaveAttribute("data-kind", DataStoreKind.AwsS3Bucket);
    expect(buckets).toHaveTextContent("Turn On Versioning");
    expect(buckets).toHaveTextContent(countOf(CLOUD_ACTION_STORES, 3));
    expect(buckets).toHaveTextContent(DataStoreKind.AwsS3Bucket);
    expect(
      within(buckets!).getByTestId(
        `${ISSUE_GROUP_FIX_TEST_ID}-cloud-action-effect`,
      ),
    ).toHaveTextContent(
      describeDataSecurityResponseAction(VERSIONING, DataStoreKind.AwsS3Bucket),
    );
    expect(buckets).toHaveTextContent("orders-exports");
    expect(buckets).toHaveTextContent("orders-archive");
    expect(buckets).not.toHaveTextContent("orders-carts");

    expect(tables).toHaveAttribute("data-action", RECOVERY);
    expect(tables).toHaveTextContent("Turn On Point-in-Time Recovery");
    expect(tables).toHaveTextContent(countOf(CLOUD_ACTION_STORES, 2));
    expect(tables).toHaveTextContent(DataStoreKind.AwsDynamoDbTable);
    // What it costs, as Fix it from here says it.
    expect(
      within(tables!).getByTestId(
        `${ISSUE_GROUP_FIX_TEST_ID}-cloud-action-effect`,
      ),
    ).toHaveTextContent("AWS bills it by the table's size.");
    expect(tables).toHaveTextContent("orders-carts");
    expect(tables).not.toHaveTextContent("orders-exports");
  });

  test("one kind reads as one change on every store: what stops working, said once", async () => {
    plans(
      cloudPlan([
        store("acme-exports-1", DataStoreKind.AwsS3Bucket, BLOCK),
        store("acme-exports-2", DataStoreKind.AwsS3Bucket, BLOCK),
      ]),
    );

    const part: HTMLElement = await open();

    expect(part).toHaveTextContent(countOf(CLOUD_PART_ONE_KIND_SENTENCE, 2));
    expect(part).not.toHaveTextContent(countOf(CLOUD_PART_KINDS_SENTENCE, 2));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Block Public Access");
    expect(rows()[0]).toHaveTextContent(
      "Anything that reads it publicly - a website, a download link - stops working.",
    );
  });

  test("a server that named one action only still reads as its one change, over every store", async () => {
    plans(
      cloudPlan(
        [
          store("acme-exports-1", DataStoreKind.AwsS3Bucket, BLOCK),
          store("acme-exports-2", DataStoreKind.AwsS3Bucket, BLOCK),
          store("acme-exports-3", DataStoreKind.AwsS3Bucket, BLOCK),
        ],
        { withActions: false },
      ),
    );

    await open();

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveAttribute("data-action", BLOCK);
    expect(rows()[0]).toHaveTextContent(countOf(CLOUD_ACTION_STORES, 3));
    expect(rows()[0]).toHaveTextContent("acme-exports-3");
  });

  test("one press runs them all, and says what each kind's change did", async () => {
    plans(cloudPlan(bucketsAndTables()));
    fixSpy.mockResolvedValue({
      cloud: {
        action: VERSIONING,
        actions: [
          { action: VERSIONING, changed: 2, unchanged: 1, failed: 0 },
          { action: RECOVERY, changed: 2, unchanged: 0, failed: 0 },
        ],
        changed: 4,
        unchanged: 1,
        failed: [],
      },
      leftOut: 0,
    } as DataSecurityIssueGroupFixResultJSON);

    await open();
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(fixSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: GROUP_ID,
        planFingerprint: "fingerprint-1",
      }),
    );

    const said: Array<string> = successSpy.mock.calls.map(
      (call: Array<unknown>): string => {
        return String(call[0]);
      },
    );

    expect(said).toHaveLength(2);
    expect(said[0]).toContain("Turn On Versioning");
    expect(said[0]).toContain("3");
    expect(said[1]).toContain("Turn On Point-in-Time Recovery");
    expect(said[1]).toContain("2");
    expect(onFixed).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("a kind whose change did nothing says nothing; a failure is said once", async () => {
    plans(cloudPlan(bucketsAndTables()));
    fixSpy.mockResolvedValue({
      cloud: {
        action: VERSIONING,
        actions: [
          { action: VERSIONING, changed: 3, unchanged: 0, failed: 0 },
          { action: RECOVERY, changed: 0, unchanged: 0, failed: 2 },
        ],
        changed: 3,
        unchanged: 0,
        failed: [
          {
            dataStoreId: "x",
            name: "orders-table",
            message: "AccessDenied: dynamodb:UpdateContinuousBackups",
          },
          {
            dataStoreId: "y",
            name: "orders-carts",
            message: "AccessDenied: dynamodb:UpdateContinuousBackups",
          },
        ],
      },
      leftOut: 0,
    } as DataSecurityIssueGroupFixResultJSON);

    await open();
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
    expect(successSpy).toHaveBeenCalledTimes(1);
    expect(String(successSpy.mock.calls[0]![0])).toContain(
      "Turn On Versioning",
    );
    expect(String(errorSpy.mock.calls[0]![0])).toContain(
      "dynamodb:UpdateContinuousBackups",
    );
  });

  test("the kinds read from a plan, and the outcomes from a result - or the one action of an older server", () => {
    const stores: Array<DataSecurityIssueGroupFixStoreJSON> =
      bucketsAndTables();

    expect(
      getCloudActions(cloudPlan(stores).cloud!).map(
        (entry: { action: string; kind: string; stores: Array<unknown> }) => {
          return [entry.action, entry.kind, entry.stores.length];
        },
      ),
    ).toEqual([
      [VERSIONING, DataStoreKind.AwsS3Bucket, 3],
      [RECOVERY, DataStoreKind.AwsDynamoDbTable, 2],
    ]);
    expect(
      getCloudActions(cloudPlan(stores, { withActions: false }).cloud!),
    ).toEqual([
      { action: VERSIONING, kind: DataStoreKind.AwsS3Bucket, stores },
    ]);

    expect(
      getCloudOutcomes({
        action: BLOCK,
        changed: 4,
        unchanged: 1,
        failed: [{ dataStoreId: "x", name: "x", message: "No." }],
      } as NonNullable<DataSecurityIssueGroupFixResultJSON["cloud"]>),
    ).toEqual([{ action: BLOCK, changed: 4, unchanged: 1, failed: 1 }]);
    expect(
      getCloudOutcomes({
        action: VERSIONING,
        actions: [
          { action: VERSIONING, changed: 1, unchanged: 0, failed: 0 },
          { action: RECOVERY, changed: 0, unchanged: 1, failed: 0 },
        ],
        changed: 1,
        unchanged: 1,
        failed: [],
      }),
    ).toHaveLength(2);
  });
});

describe("a reader held to labels (#10739)", () => {
  test("the server's word for a group's fix they may not ask for is one the Dashboard translates", () => {
    expect(GROUP_FIX_SERVER_SENTENCES).toContain(
      "Asking for a group's fix takes permission to read Data Security issues across the whole project.",
    );
  });

  test("the rows grouped by cause are the issues in no group drawn: one whose group is not shown stays", () => {
    // Not grouped: every issue.
    expect(
      getIssueRowsGroupFilter({
        isGroupedByCause: false,
        isMembersRead: true,
        drawnGroupIds: ["A"],
        memberGroupIds: ["A", "B"],
      }),
    ).toEqual({ kind: "all" });

    // Until the groups' issues are read: the issues in no group.
    expect(
      getIssueRowsGroupFilter({
        isGroupedByCause: true,
        isMembersRead: false,
        drawnGroupIds: [],
        memberGroupIds: [],
      }),
    ).toEqual({ kind: "inNoGroup" });

    // Every group of an issue they read is drawn - most readers: the issues in no group.
    expect(
      getIssueRowsGroupFilter({
        isGroupedByCause: true,
        isMembersRead: true,
        drawnGroupIds: ["a", "b"],
        memberGroupIds: ["B", "A"],
      }),
    ).toEqual({ kind: "inNoGroup" });

    // A group they are not shown: its issue is listed with the rest.
    expect(
      getIssueRowsGroupFilter({
        isGroupedByCause: true,
        isMembersRead: true,
        drawnGroupIds: ["B", "a"],
        memberGroupIds: ["a", "b", "c"],
      }),
    ).toEqual({ kind: "inNoneOf", groupIds: ["a", "b"] });

    // No group drawn at all: every issue is a row.
    expect(
      getIssueRowsGroupFilter({
        isGroupedByCause: true,
        isMembersRead: true,
        drawnGroupIds: [],
        memberGroupIds: ["c"],
      }),
    ).toEqual({ kind: "all" });
  });
});
