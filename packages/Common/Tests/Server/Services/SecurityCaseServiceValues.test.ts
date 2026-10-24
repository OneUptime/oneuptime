import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import ProjectService from "../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SecurityCaseNotifications from "../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import SecurityCaseSourceAlerts from "../../../Server/Utils/SecurityCase/SecurityCaseSourceAlerts";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestStatuses,
  buildTestStatus,
  testPriorityId,
} from "../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A security case's status and priority, as the case service writes them:
 * the project's own, by id, read through what each counts as
 * (Common/Utils/SecurityCase/SecurityCaseStatuses) - never by name.
 *
 *   - a new case starts in the project's new status and, opened by a
 *     person, at its medium priority; one created in a status further on
 *     records what that status counts as, as if it had moved there;
 *   - a case always has both: clearing either is refused;
 *   - moving a case stamps each moment once - acknowledged, contained,
 *     closed with a verdict - by what the status counts as, so a team's own
 *     "Eradicating" (after Contained) contains a case and its "Closed -
 *     Duplicate" (after Closed) closes it; moving between two closed
 *     statuses neither reopens nor closes again; reopening clears the close.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const CASE_ID: ObjectID = new ObjectID("34343434-3434-4434-8434-343434343434");
const PERSON_ID: ObjectID = new ObjectID(
  "56565656-5656-4656-8656-565656565656",
);

const ERADICATING_ID: string = "c2000000-0000-4000-8000-0000000000a2";
const DUPLICATE_ID: string = "c2000000-0000-4000-8000-0000000000a3";

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<SecurityCase>,
  ) => Promise<OnCreate<SecurityCase>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<SecurityCase>,
  ) => Promise<OnUpdate<SecurityCase>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<SecurityCase>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<SecurityCase>>;
};

const service: Hooks = SecurityCaseService as unknown as Hooks;

// New, Investigating, Contained, Eradicating, Closed, Closed - Duplicate.
function teamStatuses(): Array<SecurityCaseStatus> {
  const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
  statuses[3]!.order = 5; // Closed

  return [
    ...statuses,
    buildTestStatus({ id: ERADICATING_ID, name: "Eradicating", order: 4 }),
    buildTestStatus({
      id: DUPLICATE_ID,
      name: "Closed - Duplicate",
      order: 6,
    }),
  ];
}

let feed: Array<string>;
let stamps: Array<JSONObject>;
let caseClosed: Array<unknown>;

beforeEach(() => {
  feed = [];
  stamps = [];
  caseClosed = [];

  stubProjectDirectory({});
  stubSecurityCaseValues({ statuses: teamStatuses() });

  jest
    .spyOn(ProjectService, "incrementAndGetSecurityCaseCounter")
    .mockResolvedValue(42 as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (data: { feedInfoInMarkdown: string }) => {
      feed.push(data.feedInfoInMarkdown);
    }) as never);
  jest
    .spyOn(SecurityCaseService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { data: JSONObject }) => {
      stamps.push(data.data);
    }) as never);
  jest
    .spyOn(SecurityCaseSourceAlerts, "caseClosed")
    .mockImplementation((async (data: unknown) => {
      caseClosed.push(data);
    }) as never);
  jest
    .spyOn(SecurityCaseNotifications, "caseReachedPriority")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseNotifications, "caseAssigned")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function newCase(overrides: Partial<SecurityCase> = {}): SecurityCase {
  const model: SecurityCase = new SecurityCase();
  model.projectId = PROJECT_ID;
  model.title = "Brute force against admin";
  Object.assign(model, overrides);
  return model;
}

async function create(
  model: SecurityCase,
  isRoot: boolean = false,
): Promise<SecurityCase> {
  return (
    await service.onBeforeCreate({
      data: model,
      props: isRoot
        ? { isRoot: true }
        : { userId: PERSON_ID, tenantId: PROJECT_ID },
    } as CreateBy<SecurityCase>)
  ).createBy.data;
}

async function move(data: {
  fromStatusId: string;
  change: JSONObject;
  verdict?: SecurityCaseVerdict | undefined;
}): Promise<void> {
  await service.onUpdateSuccess(
    {
      updateBy: {
        query: { _id: CASE_ID },
        data: data.change,
        props: { userId: PERSON_ID, tenantId: PROJECT_ID },
      } as unknown as UpdateBy<SecurityCase>,
      carryForward: new Map([
        [
          CASE_ID.toString(),
          {
            id: CASE_ID.toString(),
            projectId: PROJECT_ID,
            statusId: data.fromStatusId,
            priorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
            verdict: data.verdict,
            assignedToUserId: undefined,
            assignedToTeamId: undefined,
            acknowledgedAt: undefined,
            containedAt: undefined,
          },
        ],
      ]),
    },
    [CASE_ID],
  );
}

describe("a new case", () => {
  test("starts in the project's new status and, opened by a person, at its medium priority", async () => {
    const created: SecurityCase = await create(newCase());

    expect(created.securityCaseStatusId?.toString()).toBe(
      TEST_STATUS_IDS[SecurityCaseStage.New],
    );
    expect(created.securityCasePriorityId?.toString()).toBe(
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Medium],
    );
    expect(created.source).toBe(SecurityDetectionSource.Manual);
    expect(created.acknowledgedAt).toBeUndefined();
    expect(created.verdict).toBeUndefined();
    expect(created.caseNumber).toBe(42);
  });

  test("keeps the status and priority it was opened with, named by id or by relation", async () => {
    const created: SecurityCase = await create(
      newCase({
        securityCasePriority: {
          _id: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
        } as never,
      }),
      true,
    );

    expect(created.securityCasePriorityId?.toString()).toBe(
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
    );
    // The ingest names its own source.
    expect(created.source).toBeUndefined();
  });

  test("created in the project's own Eradicating, it counts as acknowledged and contained", async () => {
    const created: SecurityCase = await create(
      newCase({ securityCaseStatusId: new ObjectID(ERADICATING_ID) }),
    );

    expect(created.acknowledgedAt).toBeInstanceOf(Date);
    expect(created.containedAt).toBeInstanceOf(Date);
    expect(created.closedAt).toBeUndefined();
  });

  test("created in Closed - Duplicate, it is closed: a close time, a verdict and who closed it", async () => {
    const created: SecurityCase = await create(
      newCase({ securityCaseStatusId: new ObjectID(DUPLICATE_ID) }),
    );

    expect(created.closedAt).toBeInstanceOf(Date);
    expect(created.verdict).toBe(SecurityCaseVerdict.Undetermined);
    expect(created.closedByUserId?.toString()).toBe(PERSON_ID.toString());
    // Closing a false positive straight away acknowledges it, never contains it.
    expect(created.acknowledgedAt).toBeInstanceOf(Date);
    expect(created.containedAt).toBeUndefined();
  });

  test("an open case keeps no verdict it was sent with", async () => {
    const created: SecurityCase = await create(
      newCase({ verdict: SecurityCaseVerdict.TruePositive }),
    );

    expect(created.verdict).toBeUndefined();
  });

  test("a project with no new status refuses the case, and says where to add one", async () => {
    stubSecurityCaseValues({ statuses: [] });

    await expect(create(newCase())).rejects.toThrow(
      new BadDataException(
        "This project has no case status to open a case at. Add one under Security Events > Settings.",
      ),
    );
  });
});

describe("a case always has a status and a priority", () => {
  test.each([
    ["securityCaseStatusId", "status"],
    ["securityCaseStatus", "status"],
    ["securityCasePriorityId", "priority"],
    ["securityCasePriority", "priority"],
  ])("clearing %s is refused", async (key: string, what: string) => {
    await expect(
      service.onBeforeUpdate({
        query: { _id: CASE_ID },
        data: { [key]: null },
        props: { userId: PERSON_ID, tenantId: PROJECT_ID },
      } as unknown as UpdateBy<SecurityCase>),
    ).rejects.toThrow(
      `A case always has a ${what}: choose another one instead of clearing it.`,
    );
  });
});

describe("moving a case between the project's statuses", () => {
  test("to Eradicating, after Contained: acknowledged and contained, once each", async () => {
    await move({
      fromStatusId: TEST_STATUS_IDS[SecurityCaseStage.New],
      change: { securityCaseStatusId: ERADICATING_ID },
    });

    expect(stamps).toHaveLength(1);
    expect(Object.keys(stamps[0]!).sort()).toEqual([
      "acknowledgedAt",
      "containedAt",
    ]);
    expect(feed[0]).toContain("New");
    expect(feed[0]).toContain("Eradicating");
    expect(caseClosed).toEqual([]);
  });

  test("to Closed - Duplicate: closed with the verdict sent, by the person, and its alerts closed where they came from", async () => {
    await move({
      fromStatusId: ERADICATING_ID,
      change: {
        securityCaseStatusId: DUPLICATE_ID,
        verdict: SecurityCaseVerdict.FalsePositive,
      },
    });

    expect(stamps[0]).toMatchObject({
      verdict: SecurityCaseVerdict.FalsePositive,
      closedByUserId: PERSON_ID,
    });
    expect(stamps[0]!["closedAt"]).toBeInstanceOf(Date);
    expect(caseClosed).toEqual([
      { projectId: PROJECT_ID, securityCaseId: CASE_ID },
    ]);
  });

  test("from Closed to Closed - Duplicate: still closed, with its verdict, and nothing closed again", async () => {
    await move({
      fromStatusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
      change: { securityCaseStatusId: DUPLICATE_ID },
      verdict: SecurityCaseVerdict.TruePositive,
    });

    for (const stamp of stamps) {
      expect(stamp).not.toHaveProperty("closedAt");
      expect(stamp).not.toHaveProperty("verdict");
    }
    expect(caseClosed).toEqual([]);
    expect(feed[0]).toContain("True Positive");
  });

  test("from Closed - Duplicate back to Investigating: reopened, the close and verdict cleared", async () => {
    await move({
      fromStatusId: DUPLICATE_ID,
      change: {
        securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      },
      verdict: SecurityCaseVerdict.FalsePositive,
    });

    expect(stamps[0]).toMatchObject({
      verdict: null,
      closedAt: null,
      closedByUserId: null,
    });
  });

  test("a rise in the project's order tells people; a fall does not", async () => {
    const reached: jest.SpiedFunction<
      typeof SecurityCaseNotifications.caseReachedPriority
    > = jest
      .spyOn(SecurityCaseNotifications, "caseReachedPriority")
      .mockResolvedValue(undefined as never);

    await move({
      fromStatusId: TEST_STATUS_IDS[SecurityCaseStage.New],
      change: {
        securityCasePriorityId: testPriorityId(
          SecurityCasePriorityLevel.Critical,
        ).toString(),
      },
    });
    await move({
      fromStatusId: TEST_STATUS_IDS[SecurityCaseStage.New],
      change: {
        securityCasePriorityId: testPriorityId(
          SecurityCasePriorityLevel.Low,
        ).toString(),
      },
    });

    expect(reached).toHaveBeenCalledTimes(1);
    expect(feed).toHaveLength(2);
  });

  test("a status that is none of the project's records nothing but the move", async () => {
    await move({
      fromStatusId: TEST_STATUS_IDS[SecurityCaseStage.New],
      change: { securityCaseStatusId: "c2000000-0000-4000-8000-0000000000ff" },
    });

    expect(stamps).toEqual([]);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toContain("an earlier one");
  });
});
