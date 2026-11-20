import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import AIService from "../../../../Server/Services/AIService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../Server/Services/LabelService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import Response from "../../../../Server/Utils/Response";
import MattermostUtil from "../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostActions from "../../../../Server/Utils/Workspace/Mattermost/MattermostActions";
import {
  MattermostPress,
  MattermostRecordType,
} from "../../../../Server/Utils/Workspace/Mattermost/MattermostActionTypes";
import MicrosoftTeamsAlertActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsAlertEpisodeActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/AlertEpisode";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsIncidentEpisodeActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/IncidentEpisode";
import MicrosoftTeamsCardChoices, {
  MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH,
  MicrosoftTeamsCardChoice,
  MicrosoftTeamsCardChoiceList,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import SlackAlertActions from "../../../../Server/Utils/Workspace/Slack/Actions/Alert";
import SlackAlertEpisodeActions from "../../../../Server/Utils/Workspace/Slack/Actions/AlertEpisode";
import SlackActionAnswer from "../../../../Server/Utils/Workspace/Slack/Actions/Answer";
import SlackActionAuthorization from "../../../../Server/Utils/Workspace/Slack/Actions/Authorization";
import SlackIncidentActions from "../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackIncidentEpisodeActions from "../../../../Server/Utils/Workspace/Slack/Actions/IncidentEpisode";
import SlackScheduledMaintenanceActions from "../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceAffectedResources from "../../../../Server/Utils/Workspace/WorkspaceAffectedResources";
import WorkspaceIncidentFromAlert from "../../../../Server/Utils/Workspace/WorkspaceIncidentFromAlert";
import WorkspaceIncidentSubscriberNotification from "../../../../Server/Utils/Workspace/WorkspaceIncidentSubscriberNotification";
import WorkspacePage, {
  WORKSPACE_PAGE_MAX_CHOICE_LABEL_LENGTH,
  WorkspacePageChoice,
  WorkspacePageChoiceGroup,
  WorkspacePageFormPrefill,
  WorkspacePageTargetKind,
} from "../../../../Server/Utils/Workspace/WorkspacePage";
import { WorkspacePageText } from "../../../../Server/Utils/Workspace/WorkspacePageText";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE CHATS' PICKERS TELL TEAMS, LABELS, ON-CALL POLICIES AND SCHEDULES
 * THAT SHARE A NAME APART (#10314).
 *
 * Records named alike before names were held to one record each keep their
 * names, and the Dashboard's pickers tell them apart (#10064). The chats'
 * listed them alike: two "Primary" schedules in Slack's and Microsoft
 * Teams' Page someone form, two "Production" labels in a New Incident form,
 * two "Payments" policies in every chat's Execute On-Call Policy form.
 *
 * Each now reads what tells twins apart with the names it lists, and puts
 * it in the twins' labels, after the name - a chat's option has no line
 * under it - in the words and the zone on the reader's account, cut to what
 * the chat shows of an option. A list with no twins reads as it did, and
 * nothing of the reader is read for it. And a name typed first that two
 * schedules share no longer pages both: the form asks which.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-d0d0-4aaa-8bbb-000000000001",
);
const READER_ID: ObjectID = new ObjectID(
  "0193c0de-d0d0-4aaa-8bbb-0000000000aa",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-d0d0-4aaa-8bbb-0000000000bb",
);

const MARCH: Date = new Date("2024-03-05T09:30:00.000Z");
const NOVEMBER_MORNING: Date = new Date("2026-11-05T09:30:00.000Z");
const NOVEMBER_AFTERNOON: Date = new Date("2026-11-05T15:30:00.000Z");

const READER_PROPS: DatabaseCommonInteractionProps = {
  userId: READER_ID,
  tenantId: PROJECT_ID,
};

type Spy = ReturnType<typeof getJestSpyOn>;

interface Facts {
  id: string;
  name: string;
  description?: string;
  createdAt?: Date;
}

function record<T extends BaseModel>(type: { new (): T }, facts: Facts): T {
  const row: T = new type();
  row._id = facts.id;
  row.setValue("name", facts.name);

  if (facts.description !== undefined) {
    row.setValue("description", facts.description);
  }

  if (facts.createdAt) {
    row.createdAt = facts.createdAt;
  }

  return row;
}

// The reader's account: its language and its zone.
function stubReader(account: { language?: string; timezone?: string }): Spy {
  return getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (): Promise<User> => {
      const user: User = new User();
      user._id = READER_ID.toString();

      if (account.language) {
        user.language = account.language;
      }

      if (account.timezone) {
        (user as unknown as { timezone: string }).timezone = account.timezone;
      }

      return user;
    },
  );
}

interface ListRead {
  service: unknown;
  select: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}

/*
 * What each list a form reads holds, by the service it is read from; any
 * other list is empty. Every read is recorded with what it selects.
 */
function stubLists(lists: Array<[unknown, Array<BaseModel>]>): Array<ListRead> {
  const reads: Array<ListRead> = [];

  getJestSpyOn(WorkspaceActionAuthorization, "findReadable").mockImplementation(
    async (data: {
      service: unknown;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<BaseModel>> => {
      reads.push({
        service: data.service,
        select: data.select,
        props: data.props,
      });

      const list: [unknown, Array<BaseModel>] | undefined = lists.find(
        (entry: [unknown, Array<BaseModel>]): boolean => {
          return entry[0] === data.service;
        },
      );

      return list ? list[1] : [];
    },
  );

  getJestSpyOn(WorkspaceActionAuthorization, "countReadable").mockResolvedValue(
    0,
  );

  return reads;
}

function readOf(reads: Array<ListRead>, service: unknown): ListRead {
  const read: ListRead | undefined = reads.find((entry: ListRead): boolean => {
    return entry.service === service;
  });

  expect(read).toBeDefined();

  return read!;
}

// Each read of one of the four kinds selects what tells its twins apart.
function expectReadsWhatTellsTwinsApart(read: ListRead): void {
  expect(read.select).toMatchObject({
    name: true,
    description: true,
    createdAt: true,
  });
}

// Twin policies, made on different days, and one of another name.
function twinPolicies(): Array<OnCallDutyPolicy> {
  return [
    record(OnCallDutyPolicy, { id: "p1", name: "Payments", createdAt: MARCH }),
    record(OnCallDutyPolicy, {
      id: "p2",
      name: "payments",
      createdAt: NOVEMBER_MORNING,
    }),
    record(OnCallDutyPolicy, {
      id: "p3",
      name: "Database",
      createdAt: MARCH,
    }),
  ];
}

// What the twin policies above read as, for a reader in English and UTC.
const TWIN_POLICY_LABELS: Array<string> = [
  "Payments · Created Mar 5, 2024",
  "payments · Created Nov 5, 2026",
  "Database",
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Page someone form, in Slack and Microsoft Teams (WorkspacePage.getChoices)", () => {
  function choicesOf(
    groups: Array<WorkspacePageChoiceGroup>,
    kind: WorkspacePageTargetKind,
  ): Array<string> {
    return (
      groups
        .find((group: WorkspacePageChoiceGroup): boolean => {
          return group.kind === kind;
        })
        ?.choices.map((choice: WorkspacePageChoice): string => {
          return choice.label;
        }) || []
    );
  }

  function onCall(name: string): User {
    const user: User = new User();
    user._id = ObjectID.generate().toString();
    user.setValue("name", name);
    return user;
  }

  function schedule(
    facts: Facts,
    onCallNow?: string,
  ): OnCallDutyPolicySchedule {
    const row: OnCallDutyPolicySchedule = record(OnCallDutyPolicySchedule, {
      ...facts,
      id: new ObjectID(facts.id).toString(),
    });

    if (onCallNow) {
      row.currentUserOnRoster = onCall(onCallNow);
    }

    return row;
  }

  const SCHEDULE_A: string = "0193c0de-d0d0-4aaa-8bbb-00000000a001";
  const SCHEDULE_B: string = "0193c0de-d0d0-4aaa-8bbb-00000000a002";
  const SCHEDULE_C: string = "0193c0de-d0d0-4aaa-8bbb-00000000a003";
  const TEAM_A: string = "0193c0de-d0d0-4aaa-8bbb-00000000b001";
  const TEAM_B: string = "0193c0de-d0d0-4aaa-8bbb-00000000b002";
  const POLICY_A: string = "0193c0de-d0d0-4aaa-8bbb-00000000c001";
  const POLICY_B: string = "0193c0de-d0d0-4aaa-8bbb-00000000c002";

  function twinLists(): Array<[unknown, Array<BaseModel>]> {
    return [
      [
        OnCallDutyPolicyScheduleService,
        [
          schedule(
            { id: SCHEDULE_A, name: "Primary", createdAt: MARCH },
            "Nawaz Dhandala",
          ),
          schedule({
            id: SCHEDULE_B,
            name: "Primary",
            createdAt: NOVEMBER_MORNING,
          }),
          schedule({ id: SCHEDULE_C, name: "Weekend", createdAt: MARCH }),
        ],
      ],
      [
        TeamService,
        [
          record(Team, {
            id: new ObjectID(TEAM_A).toString(),
            name: "Platform",
            description: "EU on-call engineers",
          }),
          record(Team, {
            id: new ObjectID(TEAM_B).toString(),
            name: "Platform",
            description: "US on-call engineers",
          }),
        ],
      ],
      [
        OnCallDutyPolicyService,
        [
          record(OnCallDutyPolicy, {
            id: new ObjectID(POLICY_A).toString(),
            name: "Escalation",
            createdAt: NOVEMBER_MORNING,
          }),
          record(OnCallDutyPolicy, {
            id: new ObjectID(POLICY_B).toString(),
            name: "Escalation",
            createdAt: NOVEMBER_AFTERNOON,
          }),
        ],
      ],
    ];
  }

  test("twins are told apart in their labels: a schedule by its day beside who is on call, a team by its description, a policy by its moment", async () => {
    const read: Spy = stubReader({});
    stubLists(twinLists());

    const groups: Array<WorkspacePageChoiceGroup> =
      await WorkspacePage.getChoices({
        projectId: PROJECT_ID,
        props: READER_PROPS,
      });

    expect(choicesOf(groups, WorkspacePageTargetKind.Schedule)).toEqual([
      "Primary · Created Mar 5, 2024 (Nawaz Dhandala on call now)",
      "Primary · Created Nov 5, 2026 (nobody on call now)",
      "Weekend (nobody on call now)",
    ]);
    expect(choicesOf(groups, WorkspacePageTargetKind.Team)).toEqual([
      "Platform · EU on-call engineers",
      "Platform · US on-call engineers",
    ]);
    expect(choicesOf(groups, WorkspacePageTargetKind.Policy)).toEqual([
      "Escalation · Created Nov 5, 2026, 9:30 AM UTC",
      "Escalation · Created Nov 5, 2026, 3:30 PM UTC",
    ]);

    // The reader is read once for the whole form, as OneUptime.
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("a twin's name is still what the form matches what was typed with", async () => {
    stubReader({});
    stubLists(twinLists());

    const groups: Array<WorkspacePageChoiceGroup> =
      await WorkspacePage.getChoices({
        projectId: PROJECT_ID,
        props: READER_PROPS,
      });

    expect(
      groups
        .find((group: WorkspacePageChoiceGroup): boolean => {
          return group.kind === WorkspacePageTargetKind.Schedule;
        })!
        .choices.map((choice: WorkspacePageChoice): string => {
          return choice.name;
        }),
    ).toEqual(["Primary", "Primary", "Weekend"]);
  });

  test("each of the three lists reads what tells its twins apart, as the member", async () => {
    stubReader({});
    const reads: Array<ListRead> = stubLists(twinLists());

    await WorkspacePage.getChoices({
      projectId: PROJECT_ID,
      props: READER_PROPS,
    });

    for (const service of [
      OnCallDutyPolicyScheduleService,
      TeamService,
      OnCallDutyPolicyService,
    ]) {
      const read: ListRead = readOf(reads, service);

      expectReadsWhatTellsTwinsApart(read);
      expect(read.props).toBe(READER_PROPS);
    }
  });

  test("in the reader's language and zone: a German reader in Tokyo", async () => {
    stubReader({ language: "de", timezone: "Asia/Tokyo" });
    stubLists(twinLists());

    const groups: Array<WorkspacePageChoiceGroup> =
      await WorkspacePage.getChoices({
        projectId: PROJECT_ID,
        props: READER_PROPS,
      });

    const schedules: Array<string> = choicesOf(
      groups,
      WorkspacePageTargetKind.Schedule,
    );

    expect(schedules[0]).toMatch(
      /^Primary · Erstellt am .*2024 \(Nawaz Dhandala on call now\)$/,
    );
    expect(schedules[1]).toMatch(
      /^Primary · Erstellt am .*2026 \(nobody on call now\)$/,
    );
    // 9:30 and 15:30 UTC are two days in Tokyo: the day, not the moment.
    expect(choicesOf(groups, WorkspacePageTargetKind.Policy)).toEqual([
      expect.stringMatching(/^Escalation · Erstellt am 5\..*2026$/),
      expect.stringMatching(/^Escalation · Erstellt am 6\..*2026$/),
    ]);
  });

  test("a form with no twins reads as it did, and reads nothing of the reader", async () => {
    const read: Spy = stubReader({});
    stubLists([
      [
        OnCallDutyPolicyScheduleService,
        [
          schedule(
            { id: SCHEDULE_A, name: "Primary", createdAt: MARCH },
            "Nawaz Dhandala",
          ),
        ],
      ],
      [
        TeamService,
        [
          record(Team, {
            id: new ObjectID(TEAM_A).toString(),
            name: "Platform",
          }),
        ],
      ],
      [
        OnCallDutyPolicyService,
        [
          record(OnCallDutyPolicy, {
            id: new ObjectID(POLICY_A).toString(),
            name: "Escalation",
          }),
        ],
      ],
    ]);

    const groups: Array<WorkspacePageChoiceGroup> =
      await WorkspacePage.getChoices({
        projectId: PROJECT_ID,
        props: READER_PROPS,
      });

    expect(choicesOf(groups, WorkspacePageTargetKind.Schedule)).toEqual([
      "Primary (Nawaz Dhandala on call now)",
    ]);
    expect(choicesOf(groups, WorkspacePageTargetKind.Team)).toEqual([
      "Platform",
    ]);
    expect(choicesOf(groups, WorkspacePageTargetKind.Policy)).toEqual([
      "Escalation",
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  test("every label fits what Slack shows of an option, and reaches Slack's select whole", async () => {
    stubReader({ timezone: "America/Los_Angeles" });
    const longName: string =
      "Checkout, payments and fraud platform escalation rotation";
    stubLists([
      [
        OnCallDutyPolicyScheduleService,
        [
          schedule(
            { id: SCHEDULE_A, name: longName, createdAt: NOVEMBER_MORNING },
            "Alexandria Ocasio-Cortez",
          ),
          schedule({
            id: SCHEDULE_B,
            name: longName,
            createdAt: NOVEMBER_AFTERNOON,
          }),
        ],
      ],
    ]);

    const groups: Array<WorkspacePageChoiceGroup> =
      await WorkspacePage.getChoices({
        projectId: PROJECT_ID,
        props: READER_PROPS,
      });

    const labels: Array<string> = choicesOf(
      groups,
      WorkspacePageTargetKind.Schedule,
    );

    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(
        WORKSPACE_PAGE_MAX_CHOICE_LABEL_LENGTH,
      );
      // What sets the twin apart survives the cut.
      expect(label).toMatch(/ · Created Nov 5, 2026, \d+:30 AM PST/);
    }

    expect(labels[0]).not.toBe(labels[1]);

    const select: JSONObject = SlackUtil.getDropdownBlock({
      payloadDropdownBlock: {
        _type: "WorkspaceDropdownBlock",
        label: "Who to page",
        blockId: "who",
        placeholder: "Pick",
        options: groups[0]!.choices.map((choice: WorkspacePageChoice) => {
          return { label: choice.label, value: choice.value };
        }),
      },
    });

    expect(
      ((select["element"] as JSONObject)["options"] as Array<JSONObject>).map(
        (option: JSONObject): string => {
          return (option["text"] as JSONObject)["text"] as string;
        },
      ),
    ).toEqual(labels);
  });
});

describe("a name typed first that two of one kind share (WorkspacePage.getPrefill)", () => {
  function group(
    kind: WorkspacePageTargetKind,
    names: Array<[string, string]>,
  ): WorkspacePageChoiceGroup {
    return {
      kind: kind,
      label: kind,
      choices: names.map(
        ([id, name]: [string, string]): WorkspacePageChoice => {
          return { value: `${kind}:${id}`, name: name, label: name };
        },
      ),
    };
  }

  function text(message: string): WorkspacePageText {
    return {
      people: [],
      groups: [],
      unknownNames: [],
      message: message,
    } as unknown as WorkspacePageText;
  }

  function prefill(
    message: string,
    choices: Array<WorkspacePageChoiceGroup>,
  ): WorkspacePageFormPrefill {
    return WorkspacePage.getPrefill({
      text: text(message),
      people: { people: [], notTold: [] },
      choices: choices,
      workspaceType: WorkspaceType.Slack,
    });
  }

  test("picks neither, and says why: the person picks the one they mean, each told apart below", () => {
    const filled: WorkspacePageFormPrefill = prefill(
      "Primary the database is down",
      [
        group(WorkspacePageTargetKind.Schedule, [
          ["a", "Primary"],
          ["b", "Primary"],
        ]),
      ],
    );

    expect(filled.values).toEqual([]);
    expect(filled.notes).toEqual([
      "More than one on-call schedule is called Primary. Pick the one you mean below.",
    ]);
    // The name was who to page, not the message.
    expect(filled.message).toBe("the database is down");
  });

  test.each([
    [WorkspacePageTargetKind.Team, "team"],
    [WorkspacePageTargetKind.Policy, "on-call policy"],
  ])(
    "two %ss of one name: neither is picked",
    (kind: WorkspacePageTargetKind, noun: string) => {
      const filled: WorkspacePageFormPrefill = prefill("Payments: checkout", [
        group(kind, [
          ["a", "Payments"],
          ["b", "payments"],
        ]),
      ]);

      expect(filled.values).toEqual([]);
      expect(filled.notes).toEqual([
        `More than one ${noun} is called Payments. Pick the one you mean below.`,
      ]);
      expect(filled.message).toBe("checkout");
    },
  );

  test("names that read alike only by their spacing are twins too", () => {
    const filled: WorkspacePageFormPrefill = prefill("Primary  On-Call help", [
      group(WorkspacePageTargetKind.Schedule, [
        ["a", "Primary  On-Call"],
        ["b", "primary on-call"],
      ]),
    ]);

    expect(filled.values).toEqual([]);
    expect(filled.notes).toHaveLength(1);
  });

  test("a name one record has is picked as before", () => {
    const filled: WorkspacePageFormPrefill = prefill(
      "Primary the database is down",
      [
        group(WorkspacePageTargetKind.Schedule, [
          ["a", "Primary"],
          ["b", "Secondary"],
        ]),
      ],
    );

    expect(filled.values).toEqual(["schedule:a"]);
    expect(filled.notes).toEqual([]);
    expect(filled.message).toBe("the database is down");
  });

  test("a team and a schedule of one name are each the one of their kind: both picked, as before", () => {
    const filled: WorkspacePageFormPrefill = prefill("Payments checkout", [
      group(WorkspacePageTargetKind.Schedule, [["s", "Payments"]]),
      group(WorkspacePageTargetKind.Team, [["t", "Payments"]]),
    ]);

    expect(filled.values).toEqual(["schedule:s", "team:t"]);
    expect(filled.notes).toEqual([]);
  });

  test("twin schedules and a team of their name: the team is picked, the schedules asked about", () => {
    const filled: WorkspacePageFormPrefill = prefill("Payments checkout", [
      group(WorkspacePageTargetKind.Schedule, [
        ["a", "Payments"],
        ["b", "Payments"],
      ]),
      group(WorkspacePageTargetKind.Team, [["t", "Payments"]]),
    ]);

    expect(filled.values).toEqual(["team:t"]);
    expect(filled.notes).toEqual([
      "More than one on-call schedule is called Payments. Pick the one you mean below.",
    ]);
  });

  test("a message that starts with no name picks nothing and notes nothing", () => {
    const filled: WorkspacePageFormPrefill = prefill("the database is down", [
      group(WorkspacePageTargetKind.Schedule, [
        ["a", "Primary"],
        ["b", "Primary"],
      ]),
    ]);

    expect(filled.values).toEqual([]);
    expect(filled.notes).toEqual([]);
    expect(filled.message).toBe("the database is down");
  });
});

describe("Slack's forms", () => {
  const shown: Array<WorkspaceModalBlock> = [];

  function dropdownOf(
    modal: WorkspaceModalBlock,
    blockId: string,
  ): WorkspaceDropdownBlock {
    const dropdown: WorkspaceMessageBlock | undefined = modal.blocks.find(
      (block: WorkspaceMessageBlock): boolean => {
        return (
          block._type === "WorkspaceDropdownBlock" &&
          (block as WorkspaceDropdownBlock).blockId === blockId
        );
      },
    );

    expect(dropdown).toBeDefined();

    return dropdown as WorkspaceDropdownBlock;
  }

  function labelsOf(dropdown: WorkspaceDropdownBlock): Array<string> {
    return dropdown.options.map((option: { label: string }): string => {
      return option.label;
    });
  }

  function slackRequest(): JSONObject {
    return {
      isAuthorized: true,
      projectId: PROJECT_ID,
      userId: READER_ID,
      slackChannelId: "C0CHANNEL",
    } as unknown as JSONObject;
  }

  beforeEach(() => {
    shown.length = 0;

    for (const answer of [
      "sendJsonObjectResponse",
      "sendTextResponse",
    ] as const) {
      getJestSpyOn(Response, answer).mockImplementation((() => {
        return undefined;
      }) as never);
    }

    getJestSpyOn(SlackActionAuthorization, "authorize").mockResolvedValue(
      READER_PROPS as never,
    );
    getJestSpyOn(SlackActionAnswer, "showModal").mockImplementation(
      (async (data: { modalBlock: WorkspaceModalBlock }) => {
        shown.push(data.modalBlock);
      }) as never,
    );
  });

  test("New Incident: twin policies and twin labels are told apart, and nothing else changes", async () => {
    stubReader({});
    const reads: Array<ListRead> = stubLists([
      [OnCallDutyPolicyService, twinPolicies()],
      [
        LabelService,
        [
          record(Label, {
            id: "l1",
            name: "Production",
            description: "EU workloads",
          }),
          record(Label, {
            id: "l2",
            name: "Production",
            description: "US workloads",
          }),
        ],
      ],
      [
        IncidentSeverityService,
        [
          record(IncidentSeverity, { id: "s1", name: "Critical" }),
          record(IncidentSeverity, { id: "s2", name: "Critical" }),
        ],
      ],
    ]);
    getJestSpyOn(
      WorkspaceIncidentFromAlert,
      "readChannelAlert",
    ).mockResolvedValue(null as never);
    getJestSpyOn(WorkspaceAffectedResources, "isOffered").mockResolvedValue(
      false as never,
    );
    getJestSpyOn(AIService, "isProjectAIEnabled").mockResolvedValue(
      false as never,
    );
    getJestSpyOn(
      WorkspaceIncidentSubscriberNotification,
      "readTickedByDefault",
    ).mockResolvedValue(null as never);

    await SlackIncidentActions.viewNewIncidentModal({
      slackRequest: slackRequest(),
      action: { actionValue: "Checkout is down" },
      req: {},
      res: {},
    } as never);

    expect(shown).toHaveLength(1);
    expect(labelsOf(dropdownOf(shown[0]!, "onCallDutyPolicies"))).toEqual(
      TWIN_POLICY_LABELS,
    );
    expect(labelsOf(dropdownOf(shown[0]!, "labels"))).toEqual([
      "Production · EU workloads",
      "Production · US workloads",
    ]);
    // A severity's name is no team's, label's, policy's or schedule's.
    expect(labelsOf(dropdownOf(shown[0]!, "incidentSeverity"))).toEqual([
      "Critical",
      "Critical",
    ]);

    expectReadsWhatTellsTwinsApart(readOf(reads, OnCallDutyPolicyService));
    expectReadsWhatTellsTwinsApart(readOf(reads, LabelService));
  });

  test("New Maintenance Event: twin labels are told apart", async () => {
    stubReader({});
    const reads: Array<ListRead> = stubLists([
      [
        LabelService,
        [
          record(Label, { id: "l1", name: "Production", createdAt: MARCH }),
          record(Label, {
            id: "l2",
            name: "Production",
            createdAt: NOVEMBER_MORNING,
          }),
          record(Label, { id: "l3", name: "Staging", createdAt: MARCH }),
        ],
      ],
    ]);

    await SlackScheduledMaintenanceActions.viewNewScheduledMaintenanceModal({
      slackRequest: slackRequest(),
      action: { actionValue: "" },
      req: {},
      res: {},
    } as never);

    expect(shown).toHaveLength(1);
    expect(labelsOf(dropdownOf(shown[0]!, "labels"))).toEqual([
      "Production · Created Mar 5, 2024",
      "Production · Created Nov 5, 2026",
      "Staging",
    ]);
    expectReadsWhatTellsTwinsApart(readOf(reads, LabelService));
  });

  test.each([
    ["incident", SlackIncidentActions],
    ["alert", SlackAlertActions],
    ["incident episode", SlackIncidentEpisodeActions],
    ["alert episode", SlackAlertEpisodeActions],
  ])(
    "Execute On-Call Policy, for an %s: twin policies are told apart",
    async (_record: string, actions: unknown) => {
      stubReader({});
      const reads: Array<ListRead> = stubLists([
        [OnCallDutyPolicyService, twinPolicies()],
      ]);

      await (
        actions as {
          viewExecuteOnCallPolicy: (data: unknown) => Promise<void>;
        }
      ).viewExecuteOnCallPolicy({
        slackRequest: slackRequest(),
        action: { actionValue: RECORD_ID.toString() },
        req: {},
        res: {},
      });

      expect(shown).toHaveLength(1);
      expect(labelsOf(dropdownOf(shown[0]!, "onCallPolicy"))).toEqual(
        TWIN_POLICY_LABELS,
      );
      expectReadsWhatTellsTwinsApart(readOf(reads, OnCallDutyPolicyService));
    },
  );

  test("Execute On-Call Policy, in the reader's words: a Persian reader's separator and words", async () => {
    stubReader({ language: "fa" });
    stubLists([[OnCallDutyPolicyService, twinPolicies()]]);

    await SlackIncidentActions.viewExecuteOnCallPolicy({
      slackRequest: slackRequest(),
      action: { actionValue: RECORD_ID.toString() },
      req: {},
      res: {},
    } as never);

    const labels: Array<string> = labelsOf(
      dropdownOf(shown[0]!, "onCallPolicy"),
    );

    expect(labels[0]!.startsWith("Payments • ")).toBe(true);
    expect(labels[0]).not.toContain("Created");
    expect(labels[2]).toBe("Database");
  });

  test("a select's option is cut to Slack's 75 characters, which Slack refuses a form past", () => {
    const longName: string = "x".repeat(90);
    const select: JSONObject = SlackUtil.getDropdownBlock({
      payloadDropdownBlock: {
        _type: "WorkspaceDropdownBlock",
        label: "On-Call Policy",
        blockId: "onCallPolicy",
        placeholder: "Select",
        options: [
          { label: longName, value: "a" },
          { label: "Payments", value: "b" },
        ],
      },
    });

    const options: Array<JSONObject> = (select["element"] as JSONObject)[
      "options"
    ] as Array<JSONObject>;

    expect(((options[0]!["text"] as JSONObject)["text"] as string).length).toBe(
      SlackUtil.MENU_OPTION_TEXT_MAX_LENGTH,
    );
    expect((options[0]!["text"] as JSONObject)["text"]).toBe(
      `${"x".repeat(74)}…`,
    );
    expect(options[1]).toEqual({
      text: { type: "plain_text", text: "Payments" },
      value: "b",
    });
    // A select draws no description: none is sent.
    expect(options[1]).not.toHaveProperty("description");
  });
});

describe("Microsoft Teams' cards", () => {
  test("the New Incident and New Maintenance cards' labels and policies tell twins apart", async () => {
    stubReader({});
    const reads: Array<ListRead> = stubLists([
      [OnCallDutyPolicyService, twinPolicies()],
      [
        LabelService,
        [
          record(Label, { id: "l1", name: "Production", createdAt: MARCH }),
          record(Label, {
            id: "l2",
            name: "Production",
            createdAt: NOVEMBER_MORNING,
          }),
        ],
      ],
    ]);

    const policies: MicrosoftTeamsCardChoiceList =
      await MicrosoftTeamsCardChoices.getOnCallDutyPolicyChoices(
        PROJECT_ID,
        READER_PROPS,
      );
    const labels: MicrosoftTeamsCardChoiceList =
      await MicrosoftTeamsCardChoices.getLabelChoices(PROJECT_ID, READER_PROPS);

    expect(
      policies.choices.map((choice: MicrosoftTeamsCardChoice): string => {
        return choice.title;
      }),
    ).toEqual(TWIN_POLICY_LABELS);
    expect(labels.choices).toEqual([
      { title: "Production · Created Mar 5, 2024", value: "l1" },
      { title: "Production · Created Nov 5, 2026", value: "l2" },
    ]);
    expectReadsWhatTellsTwinsApart(readOf(reads, OnCallDutyPolicyService));
    expectReadsWhatTellsTwinsApart(readOf(reads, LabelService));
  });

  test("a twin's title fits a card's 80 characters with what sets it apart whole; another's long name is cut as before", () => {
    const longName: string =
      "Checkout and payments platform primary escalation for Europe and the Middle East";

    const choices: Array<MicrosoftTeamsCardChoice> =
      MicrosoftTeamsCardChoices.toChoices(
        [
          { _id: "a", name: longName },
          { _id: "b", name: longName },
          { _id: "c", name: `${longName} and Africa` },
        ],
        {
          details: new Map<string, string>([
            ["a", "Created Nov 5, 2026, 9:30 AM UTC"],
            ["b", "Created Nov 5, 2026, 3:30 PM UTC"],
          ]),
          separator: " · ",
        },
      );

    for (const choice of choices) {
      expect(choice.title.length).toBeLessThanOrEqual(
        MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH,
      );
    }

    expect(
      choices[0]!.title.endsWith(" · Created Nov 5, 2026, 9:30 AM UTC"),
    ).toBe(true);
    expect(
      choices[1]!.title.endsWith(" · Created Nov 5, 2026, 3:30 PM UTC"),
    ).toBe(true);
    expect(choices[2]!.title).toBe(
      `${`${longName} and Africa`.slice(0, MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH - 1)}…`,
    );
  });

  test.each([
    ["incident", MicrosoftTeamsIncidentActions, "buildExecuteOnCallPolicyCard"],
    ["alert", MicrosoftTeamsAlertActions, "buildExecuteAlertOnCallPolicyCard"],
    [
      "incident episode",
      MicrosoftTeamsIncidentEpisodeActions,
      "buildExecuteIncidentEpisodeOnCallPolicyCard",
    ],
    [
      "alert episode",
      MicrosoftTeamsAlertEpisodeActions,
      "buildExecuteAlertEpisodeOnCallPolicyCard",
    ],
  ])(
    "Execute On-Call Policy, for an %s: twin policies are told apart on the card",
    async (_record: string, actions: unknown, builder: string) => {
      stubReader({});
      const reads: Array<ListRead> = stubLists([
        [OnCallDutyPolicyService, twinPolicies()],
      ]);

      const card: JSONObject | null = await (
        (actions as Record<string, unknown>)[builder] as (
          recordId: string,
          projectId: ObjectID,
          props: DatabaseCommonInteractionProps,
        ) => Promise<JSONObject | null>
      ).call(actions, RECORD_ID.toString(), PROJECT_ID, READER_PROPS);

      const body: Array<JSONObject> = (card?.["body"] ||
        []) as Array<JSONObject>;
      const choiceSet: JSONObject | undefined = body.find(
        (element: JSONObject): boolean => {
          return element["type"] === "Input.ChoiceSet";
        },
      );

      expect(
        ((choiceSet?.["choices"] || []) as Array<JSONObject>).map(
          (choice: JSONObject): unknown => {
            return choice["title"];
          },
        ),
      ).toEqual(TWIN_POLICY_LABELS);
      expectReadsWhatTellsTwinsApart(readOf(reads, OnCallDutyPolicyService));
    },
  );
});

describe("Mattermost's Execute On-Call Policy dialog", () => {
  test.each([
    MattermostRecordType.Incident,
    MattermostRecordType.Alert,
    MattermostRecordType.IncidentEpisode,
    MattermostRecordType.AlertEpisode,
  ])(
    "for a %s record: twin policies are told apart, within Mattermost's 75 characters",
    async (recordType: MattermostRecordType) => {
      stubReader({});
      const reads: Array<ListRead> = stubLists([
        [OnCallDutyPolicyService, twinPolicies()],
      ]);
      getJestSpyOn(
        WorkspaceActionAuthorization,
        "assertCanCreate",
      ).mockResolvedValue(undefined as never);

      const modalBlock: WorkspaceModalBlock = await (
        MattermostActions as unknown as {
          getForm: (data: unknown) => Promise<WorkspaceModalBlock>;
        }
      ).getForm({
        requester: {
          projectId: PROJECT_ID,
          userId: READER_ID,
          mattermostUserId: "mm-user",
          props: READER_PROPS,
          authToken: "token",
          channelId: "channel",
        },
        spec: {
          recordType: recordType,
          press: MattermostPress.OpenOnCallPolicyForm,
          submitActionId: "submit",
        },
        recordId: RECORD_ID,
      });

      const dropdown: WorkspaceDropdownBlock = modalBlock
        .blocks[0] as WorkspaceDropdownBlock;

      expect(
        dropdown.options.map((option: { label: string }): string => {
          return option.label;
        }),
      ).toEqual(TWIN_POLICY_LABELS);

      const dialog: JSONObject = MattermostUtil.getDialog({
        modalBlock: modalBlock,
        teamId: "abcdefghijklmnopqrstuvwxyz",
      });
      const element: JSONObject = (dialog["elements"] as Array<JSONObject>)[0]!;

      expect(
        ((element["options"] || []) as Array<JSONObject>).map(
          (option: JSONObject): unknown => {
            return option["text"];
          },
        ),
      ).toEqual(TWIN_POLICY_LABELS);
      expectReadsWhatTellsTwinsApart(readOf(reads, OnCallDutyPolicyService));
    },
  );
});
