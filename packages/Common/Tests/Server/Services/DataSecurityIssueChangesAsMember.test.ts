import DataSecurityIssueFeedService from "../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import * as DataSecurityJobs from "../../../Server/Utils/DataSecurity/DataSecurityJobs";
import logger from "../../../Server/Utils/Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT A PERSON DOES TO A DATA SECURITY ISSUE, through the whole update.
 *
 * Accept the risk, Mark Resolved, Not an issue and Open again are a person's
 * changes of an issue's status, made from its page and the Issues list.
 * Each records something about the change itself - who accepted the risk,
 * when it was marked resolved and asked to be checked again - in columns
 * that are OneUptime's (update: []). Those were written in onBeforeUpdate,
 * and DatabaseService holds what that hook leaves to the caller's column
 * permissions: every Accept and Mark Resolved was refused, for the project
 * owner too ("User is not allowed to update on acceptedByUserId column").
 * They are written in onUpdatePermitted now; this suite runs the whole
 * update, as each person the table lets edit an issue.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ISSUE_ID: string = "22222222-2222-4222-8222-222222222222";
const STORE_ID: string = "33333333-3333-4333-8333-333333333333";

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the update to be refused, but it went through.");
}

// Who may change an issue: the model's update list.
const EDITORS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a security admin", [Permission.SecurityAdmin]],
  ["a security member", [Permission.SecurityMember]],
  [
    "someone holding Edit Data Security Issue",
    [Permission.EditDataSecurityIssue, Permission.ReadDataSecurityIssue],
  ],
];

interface UpdateHooks {
  onBeforeUpdate(updateBy: UpdateBy<BaseModel>): Promise<OnUpdate<BaseModel>>;
  onUpdatePermitted(updateBy: UpdateBy<BaseModel>): Promise<void>;
}

describe("changing a data security issue", () => {
  const service: DatabaseService<BaseModel> =
    DataSecurityIssueService as unknown as DatabaseService<BaseModel>;
  let table: InMemoryTable;
  let feedSpy: jest.SpiedFunction<
    typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
  >;
  let evaluationSpy: jest.SpiedFunction<
    typeof DataSecurityJobs.queueDataSecurityEvaluation
  >;

  function stored(column: string): unknown {
    return table.get(ISSUE_ID)?.[column];
  }

  async function change(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    await service.updateOneById({
      id: new ObjectID(ISSUE_ID),
      data: data as never,
      props: props,
    });
  }

  function inAMonth(): Date {
    return OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), 30);
  }

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});

    feedSpy = jest
      .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
      .mockResolvedValue(undefined as never);
    evaluationSpy = jest
      .spyOn(DataSecurityJobs, "queueDataSecurityEvaluation")
      .mockResolvedValue(undefined);

    table = useInMemoryTable(service, [
      {
        _id: ISSUE_ID,
        projectId: PROJECT_ID.toString(),
        dataStoreId: STORE_ID,
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        severity: SecuritySeverity.Critical,
        status: DataSecurityIssueStatus.Open,
        riskScore: 92,
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(EDITORS)(
    "%s accepts the risk: the reason, the expiry and who accepted it are kept",
    async (_who: string, permissions: Array<Permission>) => {
      const props: DatabaseCommonInteractionProps = member(permissions);
      const until: Date = inAMonth();

      await change(
        {
          status: DataSecurityIssueStatus.Accepted,
          acceptedReason: "  The bucket serves the public website.  ",
          acceptedUntil: until,
        },
        props,
      );

      expect(stored("status")).toBe(DataSecurityIssueStatus.Accepted);
      expect(stored("acceptedReason")).toBe(
        "The bucket serves the public website.",
      );
      expect((stored("acceptedUntil") as Date).getTime()).toBe(
        until.getTime(),
      );
      expect(String(stored("acceptedByUserId"))).toBe(
        props.userId!.toString(),
      );
      expect(feedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: DataSecurityIssueFeedEventType.Accepted,
          userId: props.userId,
        }),
      );
    },
  );

  test.each(EDITORS)(
    "%s marks it resolved: it is checked again at once",
    async (_who: string, permissions: Array<Permission>) => {
      await change(
        { status: DataSecurityIssueStatus.Resolved },
        member(permissions),
      );

      expect(stored("status")).toBe(DataSecurityIssueStatus.Resolved);
      expect(stored("resolvedAt")).toBeInstanceOf(Date);
      expect(stored("recheckRequestedAt")).toBeInstanceOf(Date);
      expect(evaluationSpy).toHaveBeenCalledWith(PROJECT_ID);
      expect(feedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: DataSecurityIssueFeedEventType.RecheckRequested,
        }),
      );
    },
  );

  test.each(EDITORS)(
    "%s says it is not an issue",
    async (_who: string, permissions: Array<Permission>) => {
      await change(
        { status: DataSecurityIssueStatus.NotAnIssue },
        member(permissions),
      );

      expect(stored("status")).toBe(DataSecurityIssueStatus.NotAnIssue);
      expect(stored("resolvedAt")).toBeUndefined();
      expect(feedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: DataSecurityIssueFeedEventType.StatusChanged,
        }),
      );
    },
  );

  test("opening an accepted issue again clears what the acceptance said, and who made it", async () => {
    const owner: DatabaseCommonInteractionProps = member([
      Permission.ProjectOwner,
    ]);

    await change(
      {
        status: DataSecurityIssueStatus.Accepted,
        acceptedReason: "Known and tracked.",
        acceptedUntil: inAMonth(),
      },
      owner,
    );
    await change({ status: DataSecurityIssueStatus.Open }, owner);

    expect(stored("status")).toBe(DataSecurityIssueStatus.Open);
    expect(stored("acceptedReason")).toBeNull();
    expect(stored("acceptedUntil")).toBeNull();
    expect(stored("acceptedByUserId")).toBeNull();
    expect(evaluationSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test.each([
    ["a security viewer", [Permission.SecurityViewer]],
    ["a project member", [Permission.ProjectMember]],
    [
      "someone who may only read issues",
      [Permission.ReadDataSecurityIssue],
    ],
  ])(
    "%s may not change it, and nothing changes",
    async (_who: string, permissions: Array<Permission>) => {
      const error: unknown = await refusalOf(
        change(
          { status: DataSecurityIssueStatus.Resolved },
          member(permissions as Array<Permission>),
        ),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(stored("status")).toBe(DataSecurityIssueStatus.Open);
      expect(stored("resolvedAt")).toBeUndefined();
    },
  );

  test("who accepted a risk is OneUptime's to say: someone else named in the request is not recorded", async () => {
    const owner: DatabaseCommonInteractionProps = member([
      Permission.ProjectOwner,
    ]);
    const somebodyElse: ObjectID = ObjectID.generate();

    await change(
      {
        status: DataSecurityIssueStatus.Accepted,
        acceptedReason: "Mine to decide.",
        acceptedUntil: inAMonth(),
        acceptedByUserId: somebodyElse,
      },
      owner,
    );

    expect(String(stored("acceptedByUserId"))).toBe(owner.userId!.toString());
  });

  test("when it was resolved is OneUptime's to write: a person who sends it is refused", async () => {
    const error: unknown = await refusalOf(
      change(
        {
          status: DataSecurityIssueStatus.Resolved,
          resolvedAt: OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -10,
          ),
        },
        member([Permission.ProjectOwner]),
      ),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe(
      "resolvedAt",
    );
    expect(stored("status")).toBe(DataSecurityIssueStatus.Open);
  });

  test("an acceptance without a reason, or without a future expiry, is refused before anything is written", async () => {
    const owner: DatabaseCommonInteractionProps = member([
      Permission.ProjectOwner,
    ]);

    await expect(
      change(
        {
          status: DataSecurityIssueStatus.Accepted,
          acceptedReason: "   ",
          acceptedUntil: inAMonth(),
        },
        owner,
      ),
    ).rejects.toThrow(BadDataException);
    await expect(
      change(
        {
          status: DataSecurityIssueStatus.Accepted,
          acceptedReason: "Known.",
          acceptedUntil: OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -1,
          ),
        },
        owner,
      ),
    ).rejects.toThrow("An accepted risk expires in the future.");
    await expect(
      change(
        {
          status: DataSecurityIssueStatus.Accepted,
          acceptedReason: "Known.",
          acceptedUntil: OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            400,
          ),
        },
        owner,
      ),
    ).rejects.toThrow("A risk can be accepted for at most a year");

    expect(stored("status")).toBe(DataSecurityIssueStatus.Open);
    expect(stored("acceptedByUserId")).toBeUndefined();
  });

  test("OneUptime's own reconciliation writes as root, and the hooks leave its data alone", async () => {
    const resolvedAt: Date = OneUptimeDate.getCurrentDate();

    await change(
      { status: DataSecurityIssueStatus.Resolved, resolvedAt },
      { isRoot: true },
    );

    expect(stored("status")).toBe(DataSecurityIssueStatus.Resolved);
    expect((stored("resolvedAt") as Date).getTime()).toBe(
      resolvedAt.getTime(),
    );
    expect(stored("recheckRequestedAt")).toBeUndefined();
  });

  describe("the order of the hooks", () => {
    const hooks: UpdateHooks = service as unknown as UpdateHooks;

    function updateOf(
      data: Record<string, unknown>,
      props: DatabaseCommonInteractionProps,
    ): UpdateBy<BaseModel> {
      return {
        id: new ObjectID(ISSUE_ID),
        query: { _id: ISSUE_ID },
        data: data,
        props: props,
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<BaseModel>;
    }

    test("onBeforeUpdate, which runs before the permission checks, writes none of OneUptime's columns", async () => {
      for (const status of [
        DataSecurityIssueStatus.Accepted,
        DataSecurityIssueStatus.Resolved,
      ]) {
        const updateBy: UpdateBy<BaseModel> = updateOf(
          {
            status,
            acceptedReason: "Known.",
            acceptedUntil: inAMonth(),
          },
          member([Permission.SecurityMember]),
        );

        await hooks.onBeforeUpdate(updateBy);

        const data: Record<string, unknown> =
          updateBy.data as unknown as Record<string, unknown>;

        for (const column of [
          "acceptedByUserId",
          "resolvedAt",
          "recheckRequestedAt",
        ]) {
          expect([status, column, data[column]]).toEqual([
            status,
            column,
            undefined,
          ]);
        }
      }
    });

    test("onUpdatePermitted writes them, once the change has passed every check", async () => {
      const props: DatabaseCommonInteractionProps = member([
        Permission.SecurityMember,
      ]);
      const accept: UpdateBy<BaseModel> = updateOf(
        { status: DataSecurityIssueStatus.Accepted },
        props,
      );
      const resolve: UpdateBy<BaseModel> = updateOf(
        { status: DataSecurityIssueStatus.Resolved },
        props,
      );
      const assign: UpdateBy<BaseModel> = updateOf(
        { assignedToUserId: ObjectID.generate() },
        props,
      );

      await hooks.onUpdatePermitted(accept);
      await hooks.onUpdatePermitted(resolve);
      await hooks.onUpdatePermitted(assign);

      const accepted: Record<string, unknown> = accept.data as unknown as Record<
        string,
        unknown
      >;
      const resolved: Record<string, unknown> =
        resolve.data as unknown as Record<string, unknown>;

      expect(accepted["acceptedByUserId"]).toBe(props.userId);
      expect(accepted["resolvedAt"]).toBeUndefined();
      expect(resolved["acceptedByUserId"]).toBeNull();
      expect(resolved["resolvedAt"]).toBeInstanceOf(Date);
      expect(resolved["recheckRequestedAt"]).toBeInstanceOf(Date);
      // A change that is not of the status records nothing about one.
      expect(Object.keys(assign.data as unknown as object)).toEqual([
        "assignedToUserId",
      ]);
    });
  });
});
