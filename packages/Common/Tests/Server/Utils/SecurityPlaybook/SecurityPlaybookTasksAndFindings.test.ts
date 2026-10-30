import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseTask from "../../../../Models/DatabaseModels/SecurityCaseTask";
import User from "../../../../Models/DatabaseModels/User";
import SecurityCaseTaskService from "../../../../Server/Services/SecurityCaseTaskService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import ThreatIntelIndicatorService from "../../../../Server/Services/ThreatIntelIndicatorService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import RuleRecordScope from "../../../../Server/Utils/Rules/RuleRecordScope";
import SecurityPlaybookActions, {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { parseSecurityPlaybookSteps } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { testPriorityId } from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";

/*
 * Add tasks seeds the case's checklist - one task a line, handed to a
 * person who is still in the project, never the same task twice however
 * often the playbook runs - and the steps that look something up say
 * whether they found something, which a later step's condition reads.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a",
);
const CASE_ID: ObjectID = new ObjectID("6b6b6b6b-6b6b-46b6-86b6-6b6b6b6b6b6b");
const ALICE_ID: string = "7c7c7c7c-7c7c-47c7-87c7-7c7c7c7c7c7c";

let created: Array<SecurityCaseTask>;
let existingTitles: Array<string>;
let members: Array<User>;

function context(
  action: SecurityPlaybookActionType,
  config: JSONObject,
  entities: Array<{ type: SecurityEntityType; value: string }> = [
    { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
  ],
): PlaybookStepContext {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.caseNumberWithPrefix = "CASE-12";
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Medium,
  );
  securityCase.entities = entities as unknown as JSONArray;

  // The step as the server saves it, so its config is the clean one.
  const [step] = parseSecurityPlaybookSteps([
    { id: "s1", action, config },
  ]);

  return {
    projectId: PROJECT_ID,
    runId: ObjectID.generate(),
    playbookName: "Triage",
    stepNumber: 1,
    securityCase,
    step: step!,
  };
}

function alice(): User {
  const user: User = new User();
  user._id = ALICE_ID;
  user.name = "Alice Analyst" as never;
  return user;
}

beforeEach(() => {
  created = [];
  existingTitles = [];
  members = [alice()];

  stubSecurityCaseValues();

  jest
    .spyOn(SecurityCaseTaskService, "findBy")
    .mockImplementation((async (args: { query: JSONObject }) => {
      expect(args.query["projectId"]).toEqual(PROJECT_ID);
      expect(args.query["securityCaseId"]).toEqual(CASE_ID);

      return existingTitles.map((title: string): SecurityCaseTask => {
        const task: SecurityCaseTask = new SecurityCaseTask();
        task.title = title;
        return task;
      });
    }) as never);

  jest
    .spyOn(SecurityCaseTaskService, "create")
    .mockImplementation((async (args: {
      data: SecurityCaseTask;
      props: JSONObject;
    }) => {
      // As OneUptime, as every step acts.
      expect(args.props).toEqual({ isRoot: true });
      created.push(args.data);
      return args.data;
    }) as never);

  // The project's members: who a task may be handed to.
  jest
    .spyOn(RuleRecordScope, "keepIdsInProject")
    .mockImplementation((async (args: { ids: Array<string> }) => {
      return args.ids.filter((id: string): boolean => {
        return members.some((member: User): boolean => {
          return member.id?.toString() === id;
        });
      });
    }) as never);

  jest
    .spyOn(ProjectScopedReferenceValidator, "getLookupService")
    .mockImplementation((() => {
      return {
        findBy: async (): Promise<Array<User>> => {
          return members;
        },
      };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Add tasks", () => {
  test("adds each task to the case's checklist, handed to the person, who is named", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.AddCaseTasks, {
        tasks: "Confirm the sign-in with the user\nReset the password",
        assigneeUserId: ALICE_ID,
      }),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Added 2 tasks for **Alice Analyst**.",
    );
    // The task service puts each task on the timeline, and tells Alice.
    expect(outcome.hasWrittenOwnFeed).toBe(true);
    expect(
      created.map((task: SecurityCaseTask): JSONObject => {
        return {
          projectId: task.projectId?.toString() || "",
          securityCaseId: task.securityCaseId?.toString() || "",
          title: task.title || "",
          assignedToUserId: task.assignedToUserId?.toString() || "",
        };
      }),
    ).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        securityCaseId: CASE_ID.toString(),
        title: "Confirm the sign-in with the user",
        assignedToUserId: ALICE_ID,
      },
      {
        projectId: PROJECT_ID.toString(),
        securityCaseId: CASE_ID.toString(),
        title: "Reset the password",
        assignedToUserId: ALICE_ID,
      },
    ]);
  });

  test("without a person, the tasks are for whoever works the case", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.AddCaseTasks, {
        tasks: "Check the device",
      }),
    );

    expect(outcome.summary.toString()).toBe("Added 1 task.");
    expect(created).toHaveLength(1);
    expect(created[0]!.assignedToUserId).toBeUndefined();
  });

  test("a person who left the project gets nothing, and the step says so", async () => {
    members = [];

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.AddCaseTasks, {
        tasks: "Check the device",
        assigneeUserId: ALICE_ID,
      }),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Added 1 task. The person this step hands them to is no longer in the project, so they are left for whoever works the case.",
    );
    expect(created[0]!.assignedToUserId).toBeUndefined();
  });

  test("a task the case has already, open or done and whatever its case, is not added again", async () => {
    existingTitles = ["confirm the sign-in with the user"];

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.AddCaseTasks, {
        tasks: "Confirm the sign-in with the user\nReset the password",
      }),
    );

    expect(outcome.summary.toString()).toBe("Added 1 task.");
    expect(
      created.map((task: SecurityCaseTask): string => {
        return task.title || "";
      }),
    ).toEqual(["Reset the password"]);
  });

  test("a playbook that runs again for every new detection adds nothing it added before", async () => {
    existingTitles = ["Confirm the sign-in with the user", "Reset the password"];

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.AddCaseTasks, {
        tasks: "Confirm the sign-in with the user\nReset the password",
      }),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toBe("The case has these tasks already.");
    expect(created).toEqual([]);
  });
});

describe("what the steps that look something up found", () => {
  test("Check threat intel found a known-bad entity", async () => {
    jest
      .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
      .mockResolvedValue([
        {
          indicatorValue: "203.0.113.9",
          feedId: "f1",
          feedName: "Known Bad",
          stixId: "indicator--1",
          indicatorType: "ipv4-addr",
          indicatorName: "C2",
          confidence: 90,
        },
      ] as never);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.CheckThreatIntel, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.found).toBe(true);
    expect(outcome.threatIntelMatched).toBe(true);
  });

  test("Check threat intel found nothing known-bad", async () => {
    jest
      .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
      .mockResolvedValue([] as never);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.CheckThreatIntel, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.found).toBe(false);
    expect(outcome.threatIntelMatched).toBeUndefined();
  });

  test("a case with nothing to look up is skipped: neither found nor found nothing", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.CheckThreatIntel, {}, []),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.found).toBeUndefined();
  });

  test("Look up entity activity found activity, or found none", async () => {
    const activity: jest.SpiedFunction<
      typeof SecurityEventService.findObservableActivity
    > = jest.spyOn(SecurityEventService, "findObservableActivity");

    activity.mockResolvedValueOnce([
      {
        value: "203.0.113.9",
        eventCount: 14,
        findingCount: 1,
        maxSeverityId: 4,
        firstSeen: new Date("2026-10-30T08:00:00.000Z"),
        lastSeen: new Date("2026-10-30T09:00:00.000Z"),
      },
    ]);

    const busy: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.LookUpEntityActivity, {
        lookbackInHours: 24,
      }),
    );

    expect(busy.found).toBe(true);

    activity.mockResolvedValueOnce([]);

    const quiet: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.LookUpEntityActivity, {
        lookbackInHours: 24,
      }),
    );

    expect(quiet.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(quiet.found).toBe(false);
  });
});
