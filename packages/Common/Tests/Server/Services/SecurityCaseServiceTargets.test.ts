import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import ProjectService from "../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SecurityCaseNotifications from "../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import { securityCaseGroupingKey } from "../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityCaseSourceAlerts from "../../../Server/Utils/SecurityCase/SecurityCaseSourceAlerts";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SETUP_TEST_SOURCE_IP } from "../../../Types/SecurityEvent/SecuritySetupTest";
import {
  TEST_PRIORITY_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestPrioritiesWithTargets,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A SECURITY CASE'S RESPONSE TARGETS, AS ITS SERVICE WRITES THEM.
 *
 * The rules are Common/Utils/SecurityCase/SecurityCaseTargets (pinned in
 * its own suite); here, that the case's hooks apply them where a case is
 * written, as the server runs them:
 *
 *   - a new case gets its due times from its priority, its next due time
 *     and when the every-minute check looks first - none for a priority
 *     without targets, for a target met as it opens, or for the setup
 *     test's case;
 *   - a change moves them: a rise or a fall of its priority, a person
 *     taking it on (acknowledged: the next target is contain), closing it
 *     (nothing left), reopening one never contained (contain starts again);
 *   - a project made before targets - none on its priorities - writes none,
 *     and a case written before targets existed keeps working.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const CASE_ID: ObjectID = new ObjectID("34343434-3434-4434-8434-343434343434");
const PERSON_ID: ObjectID = new ObjectID(
  "56565656-5656-4656-8656-565656565656",
);
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE);
}

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

let stamps: Array<JSONObject>;

function useTargets(): void {
  stubSecurityCaseValues({
    priorities: buildDefaultTestPrioritiesWithTargets(),
  });
}

beforeEach(() => {
  stamps = [];

  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });

  stubProjectDirectory({});
  useTargets();

  jest
    .spyOn(ProjectService, "incrementAndGetSecurityCaseCounter")
    .mockResolvedValue(7 as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { data: JSONObject }) => {
      stamps.push(data.data);
    }) as never);
  jest
    .spyOn(SecurityCaseSourceAlerts, "caseClosed")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseNotifications, "caseReachedPriority")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseNotifications, "caseAssigned")
    .mockResolvedValue(undefined as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    const user: User = new User();
    user.name = "Maya Chen" as never;
    return user;
  }) as never);
  jest.spyOn(TeamService, "findOneById").mockImplementation((async () => {
    const team: Team = new Team();
    team.name = "SOC Tier 2";
    return team;
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function create(overrides: Partial<SecurityCase>): Promise<SecurityCase> {
  const model: SecurityCase = new SecurityCase();
  model.projectId = PROJECT_ID;
  model.title = "Password spray against Okta";
  Object.assign(model, overrides);

  return (
    await service.onBeforeCreate({
      data: model,
      props: { isRoot: true },
    } as CreateBy<SecurityCase>)
  ).createBy.data;
}

// The case as it stood before a change, as the update hook reads it.
function caseBefore(fields: Partial<SecurityCase>): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.createdAt = NOW;
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.High,
  );
  Object.assign(securityCase, fields);

  return securityCase;
}

// One change, through both of the case's update hooks, by a person.
async function change(
  before: SecurityCase,
  data: JSONObject,
): Promise<JSONObject> {
  jest
    .spyOn(SecurityCaseService, "findRowsAndHoldUpdateToThem")
    .mockResolvedValue([before] as never);

  const onUpdate: OnUpdate<SecurityCase> = await service.onBeforeUpdate({
    query: { _id: CASE_ID },
    data: { ...data },
    props: { userId: PERSON_ID, tenantId: PROJECT_ID },
  } as unknown as UpdateBy<SecurityCase>);

  await service.onUpdateSuccess(onUpdate, [CASE_ID]);

  return Object.assign({}, ...stamps) as JSONObject;
}

describe("a new case", () => {
  test("a High case is due to be acknowledged in an hour and contained in a day, checked first at the start of its last fifth", async () => {
    const created: SecurityCase = await create({
      securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.High),
    });

    expect(created.acknowledgeDueAt).toEqual(at(60));
    expect(created.containDueAt).toEqual(at(24 * 60));
    expect(created.nextDueAt).toEqual(at(60));
    // 48 minutes in: the last fifth of an hour.
    expect(created.nextTargetCheckAt).toEqual(at(48));
  });

  test("a Critical case: 15 minutes and 4 hours", async () => {
    const created: SecurityCase = await create({
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Critical,
      ),
    });

    expect(created.acknowledgeDueAt).toEqual(at(15));
    expect(created.containDueAt).toEqual(at(240));
    expect(created.nextTargetCheckAt).toEqual(at(12));
  });

  test("a case opened by a person starts at Medium: 12 hours and 3 days", async () => {
    const created: SecurityCase = await create({});

    expect(created.securityCasePriorityId?.toString()).toBe(
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Medium],
    );
    expect(created.acknowledgeDueAt).toEqual(at(12 * 60));
    expect(created.containDueAt).toEqual(at(3 * 24 * 60));
  });

  test("an Informational case has no targets, and nothing to check", async () => {
    const created: SecurityCase = await create({
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Informational,
      ),
    });

    expect(created.acknowledgeDueAt).toBeUndefined();
    expect(created.containDueAt).toBeUndefined();
    expect(created.nextDueAt).toBeUndefined();
    expect(created.nextTargetCheckAt).toBeUndefined();
  });

  test("opened assigned to somebody, it is acknowledged already: only contain is due", async () => {
    const created: SecurityCase = await create({
      securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.High),
      assignedToUserId: PERSON_ID,
    });

    expect(created.acknowledgedAt).toEqual(NOW);
    expect(created.acknowledgeDueAt).toBeUndefined();
    expect(created.containDueAt).toEqual(at(24 * 60));
    expect(created.nextDueAt).toEqual(at(24 * 60));
  });

  test("opened straight into a closed status, nothing is due", async () => {
    const created: SecurityCase = await create({
      securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
    });

    expect(created.acknowledgeDueAt).toBeUndefined();
    expect(created.containDueAt).toBeUndefined();
    expect(created.nextTargetCheckAt).toBeUndefined();
  });

  test("a project made before targets - none on its priorities - gives its cases none", async () => {
    stubSecurityCaseValues({ priorities: buildDefaultTestPriorities() });

    const created: SecurityCase = await create({
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Critical,
      ),
    });

    expect(created.acknowledgeDueAt).toBeUndefined();
    expect(created.containDueAt).toBeUndefined();
    expect(created.nextTargetCheckAt).toBeUndefined();
  });

  test("the setup test's case is a rehearsal: no targets", async () => {
    const created: SecurityCase = await create({
      securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.High),
      groupingKey: securityCaseGroupingKey({
        groupValue: SETUP_TEST_SOURCE_IP,
        fingerprint: "",
      }),
    });

    expect(created.acknowledgeDueAt).toBeUndefined();
    expect(created.nextTargetCheckAt).toBeUndefined();
  });
});

describe("a case changed", () => {
  const openHigh: Partial<SecurityCase> = {
    acknowledgeDueAt: at(60),
    containDueAt: at(24 * 60),
    nextDueAt: at(60),
    nextTargetCheckAt: at(48),
  };

  test("taken on by a person: acknowledged, and contain is what is due next", async () => {
    jest.setSystemTime(at(20));

    const written: JSONObject = await change(caseBefore(openHigh), {
      assignedToUserId: PERSON_ID.toString(),
    });

    expect(written["acknowledgedAt"]).toEqual(at(20));
    expect(written["nextDueAt"]).toEqual(at(24 * 60));
    // The last fifth of a day: 19 hours 12 minutes in.
    expect(written["nextTargetCheckAt"]).toEqual(at(24 * 60 - 288));
    // The due times themselves do not move.
    expect(written["acknowledgeDueAt"]).toBeUndefined();
    expect(written["containDueAt"]).toBeUndefined();
  });

  test("moved on from New: acknowledged, the same way", async () => {
    jest.setSystemTime(at(5));

    const written: JSONObject = await change(caseBefore(openHigh), {
      securityCaseStatusId: testStatusId(
        SecurityCaseStage.Acknowledged,
      ).toString(),
    });

    expect(written["acknowledgedAt"]).toEqual(at(5));
    expect(written["nextDueAt"]).toEqual(at(24 * 60));
  });

  test("closed: nothing is left to check", async () => {
    jest.setSystemTime(at(30));

    const written: JSONObject = await change(
      caseBefore({ ...openHigh, acknowledgedAt: at(5) }),
      {
        securityCaseStatusId: testStatusId(SecurityCaseStage.Closed).toString(),
        verdict: "False Positive",
      },
    );

    expect(written["closedAt"]).toEqual(at(30));
    expect(written["nextDueAt"]).toBeNull();
    expect(written["nextTargetCheckAt"]).toBeNull();
  });

  test("raised to Critical half an hour in: its targets come closer, from the rise", async () => {
    jest.setSystemTime(at(30));

    const written: JSONObject = await change(caseBefore(openHigh), {
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Critical,
      ).toString(),
    });

    expect(written["acknowledgeDueAt"]).toEqual(at(45));
    expect(written["containDueAt"]).toEqual(at(270));
    // Nothing was said about the old due time: nothing to clear.
    expect(written["acknowledgeWarnedAt"]).toBeUndefined();
    expect(written["nextDueAt"]).toEqual(at(45));
    expect(written["nextTargetCheckAt"]).toEqual(at(42));
  });

  test("raised after it was warned about: the closer due time is warned about again", async () => {
    jest.setSystemTime(at(1200));

    const written: JSONObject = await change(
      caseBefore({
        securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.Low),
        acknowledgeDueAt: at(1440),
        acknowledgeWarnedAt: at(1152),
        containDueAt: at(7 * 24 * 60),
        nextDueAt: at(1440),
        nextTargetCheckAt: at(1440),
      }),
      {
        securityCasePriorityId: testPriorityId(
          SecurityCasePriorityLevel.Critical,
        ).toString(),
      },
    );

    expect(written["acknowledgeDueAt"]).toEqual(at(1215));
    expect(written["acknowledgeWarnedAt"]).toBeNull();
    // Its last fifth, of 15 minutes: three minutes before.
    expect(written["nextTargetCheckAt"]).toEqual(at(1212));
  });

  test("raised late in its hour: never more time than it had", async () => {
    jest.setSystemTime(at(55));

    const written: JSONObject = await change(caseBefore(openHigh), {
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Critical,
      ).toString(),
    });

    // 55 + 15 would be later than its 60: acknowledge stays due at 60.
    expect(written["acknowledgeDueAt"]).toBeUndefined();
    expect(written["containDueAt"]).toEqual(at(55 + 240));
  });

  test("lowered to Low: its targets move out, counted from when it opened", async () => {
    jest.setSystemTime(at(10));

    const written: JSONObject = await change(caseBefore(openHigh), {
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Low,
      ).toString(),
    });

    expect(written["acknowledgeDueAt"]).toEqual(at(24 * 60));
    expect(written["containDueAt"]).toEqual(at(7 * 24 * 60));
    expect(written["nextDueAt"]).toEqual(at(24 * 60));
  });

  test("lowered to Informational, which has none: its targets are taken away", async () => {
    jest.setSystemTime(at(10));

    const written: JSONObject = await change(caseBefore(openHigh), {
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Informational,
      ).toString(),
    });

    expect(written["acknowledgeDueAt"]).toBeNull();
    expect(written["containDueAt"]).toBeNull();
    expect(written["nextDueAt"]).toBeNull();
    expect(written["nextTargetCheckAt"]).toBeNull();
  });

  test("a missed target stays missed when the priority falls", async () => {
    jest.setSystemTime(at(90));

    const written: JSONObject = await change(
      caseBefore({
        ...openHigh,
        acknowledgeMissedAt: at(60),
        acknowledgeWarnedAt: at(48),
      }),
      {
        securityCasePriorityId: testPriorityId(
          SecurityCasePriorityLevel.Low,
        ).toString(),
      },
    );

    expect(written["acknowledgeDueAt"]).toBeUndefined();
    expect(written["acknowledgeMissedAt"]).toBeUndefined();
    // Contain was neither met nor missed: it moves out.
    expect(written["containDueAt"]).toEqual(at(7 * 24 * 60));
  });

  test("reopened, never contained: the contain target starts again from the reopening", async () => {
    jest.setSystemTime(at(600));

    const written: JSONObject = await change(
      caseBefore({
        ...openHigh,
        nextDueAt: null as unknown as Date,
        nextTargetCheckAt: null as unknown as Date,
        securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
        acknowledgedAt: at(5),
        closedAt: at(30),
      }),
      {
        securityCaseStatusId: testStatusId(
          SecurityCaseStage.Acknowledged,
        ).toString(),
      },
    );

    expect(written["closedAt"]).toBeNull();
    expect(written["containDueAt"]).toEqual(at(600 + 24 * 60));
    expect(written["nextDueAt"]).toEqual(at(600 + 24 * 60));
  });

  test("reopened after it was contained: contain stays met", async () => {
    jest.setSystemTime(at(600));

    const written: JSONObject = await change(
      caseBefore({
        ...openHigh,
        securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
        acknowledgedAt: at(5),
        containedAt: at(20),
        closedAt: at(30),
      }),
      {
        securityCaseStatusId: testStatusId(
          SecurityCaseStage.Acknowledged,
        ).toString(),
      },
    );

    expect(written["containDueAt"]).toBeUndefined();
    expect(written["nextDueAt"]).toBeNull();
  });

  test("a project made before targets, a case written before them: a change writes no target columns", async () => {
    stubSecurityCaseValues({ priorities: buildDefaultTestPriorities() });

    const written: JSONObject = await change(caseBefore({}), {
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Critical,
      ).toString(),
    });

    for (const column of [
      "acknowledgeDueAt",
      "containDueAt",
      "nextDueAt",
      "nextTargetCheckAt",
    ]) {
      expect([column, written[column]]).toEqual([column, undefined]);
    }
  });

  test("an older case without due times gets its new priority's targets from the change", async () => {
    jest.setSystemTime(at(100));

    const written: JSONObject = await change(caseBefore({}), {
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Critical,
      ).toString(),
    });

    expect(written["acknowledgeDueAt"]).toEqual(at(115));
    expect(written["containDueAt"]).toEqual(at(340));
  });

  test("the setup test's case: a change gives it no targets", async () => {
    const written: JSONObject = await change(
      caseBefore({
        groupingKey: securityCaseGroupingKey({
          groupValue: SETUP_TEST_SOURCE_IP,
          fingerprint: "",
        }),
      }),
      {
        securityCasePriorityId: testPriorityId(
          SecurityCasePriorityLevel.Critical,
        ).toString(),
      },
    );

    expect(written["acknowledgeDueAt"]).toBeUndefined();
    expect(written["nextTargetCheckAt"]).toBeUndefined();
  });

  test("a change that moves nothing writes nothing of the targets", async () => {
    const written: JSONObject = await change(caseBefore(openHigh), {
      assignedToTeamId: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a",
    });

    expect(written["nextDueAt"]).toBeUndefined();
    expect(written["nextTargetCheckAt"]).toBeUndefined();
  });
});

describe("the priorities' targets reach the case's service", () => {
  test("a project's priorities carry their targets as the service reads them", () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPrioritiesWithTargets();

    expect(
      priorities.map((priority: SecurityCasePriority) => {
        return [
          priority.name,
          priority.acknowledgeWithinInMinutes,
          priority.containWithinInMinutes,
        ];
      }),
    ).toEqual([
      ["Critical", 15, 240],
      ["High", 60, 1440],
      ["Medium", 720, 4320],
      ["Low", 1440, 10080],
      ["Informational", undefined, undefined],
    ]);
  });
});
