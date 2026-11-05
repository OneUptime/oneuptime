import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import OpenStackCloudFeedService from "../../../../Server/Services/OpenStackCloudFeedService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import {
  OpenStackFix,
  OpenStackFixOutcome,
  buildOpenStackFixChangeEntries,
  describeOpenStackFixForFeed,
} from "../../../../Server/Utils/OpenStack/OpenStackFixChangeEntries";
import { ParsedChangeEventEntry } from "../../../../Server/Utils/Telemetry/ChangeEventRow";
import OwnChangeRecorder from "../../../../Server/Utils/Telemetry/ChangeDetection/OwnChangeRecorder";
import TelemetryFanInWriter from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { OpenStackCloudFeedEventType } from "../../../../Models/DatabaseModels/OpenStackCloudFeed";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { readOpenStackChange } from "../../../../Utils/AiRemediation/Resource/OpenStackCommandPolicy";
import {
  OpenStackChangeReach,
  buildOpenStackChangeReach,
  renderOpenStackChangeReach,
} from "../../../../Utils/AiRemediation/Resource/OpenStackChangeReach";
import { tokenizeResourceCommand } from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { OPENSTACK_CLOUD_LOG_ATTRIBUTE } from "../../../../Utils/OpenStack/OpenStackLogs";
import {
  OpenStackPartLogFacts,
  getOpenStackPartChangeAttributes,
} from "../../../../Utils/OpenStack/OpenStackPartLogFacts";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
  ChangeEventType,
} from "../../../../Utils/Telemetry/ChangeEventFields";

/*
 * EVERY FIX IS A CHANGE EVENT, ON THE PART'S FEED, WITH WHO APPROVED IT.
 *
 * A part's Feed tab finds its changes by attributes alone
 * (getOpenStackPartChangeAttributes), so what is held here is that each entry a fix
 * makes carries exactly what the tab of each part it touched asks for: the real
 * function asks, for each kind, and the entry answers.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000001",
);
const JOB_ID: ObjectID = new ObjectID("5e7a1b30-0000-4000-8000-000000000002");
const CLOUD_ID: ObjectID = new ObjectID("5e7a1b30-0000-4000-8000-000000000003");
const USER_ID: ObjectID = new ObjectID("5e7a1b30-0000-4000-8000-000000000004");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000005",
);
const RUN_ID: ObjectID = new ObjectID("5e7a1b30-0000-4000-8000-000000000006");
const INCIDENT_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000007",
);
const SERVER: string = "358ee736-ba74-40ba-a354-7ead413c5df6";
const OTHER: string = "4d955c70-df91-45ae-be57-044f4bcaefec";
const AGENT: string = "f1fe06bd-337d-4ee0-b1df-3284823c1490";
const PROJECT: string = "9aee824cac87464292adffc328de1662";
const TIME: Date = new Date("2026-11-05T10:00:00.000Z");

function reachOf(command: string): OpenStackChangeReach {
  return buildOpenStackChangeReach({
    route: command,
    kind: "changes",
    instances: [
      {
        id: SERVER,
        name: "web-1",
        projectId: PROJECT,
        projectName: "payments",
        host: "compute-01.example.internal",
        status: "ACTIVE",
      },
      {
        id: OTHER,
        name: "web-2",
        projectId: PROJECT,
        projectName: "payments",
        host: "compute-01.example.internal",
        status: "ACTIVE",
      },
    ],
    projectNames: new Map<string, string>(),
    hosts: [],
    leftBehind: [],
    isComplete: true,
    problems: [],
    wouldBeRefused: null,
  });
}

function fixOf(
  command: string,
  overrides: Partial<OpenStackFix> = {},
): OpenStackFix {
  return {
    jobId: JOB_ID,
    cloudId: CLOUD_ID,
    cloudName: "prod-eu",
    command,
    change: readOpenStackChange(
      tokenizeResourceCommand(command).argv,
    ) as OpenStackFix["change"],
    reach: reachOf(command),
    outcome: OpenStackFixOutcome.Accepted,
    time: TIME,
    approval: { name: "Jane Doe", userId: USER_ID, from: "Slack" },
    isRollback: false,
    ...overrides,
  };
}

// Whether a part's Feed tab would ask for what this entry says.
function isOnFeedOf(
  entry: ParsedChangeEventEntry,
  part: OpenStackPartLogFacts,
): boolean {
  const asked: Record<string, string> | null =
    getOpenStackPartChangeAttributes(part);

  return (
    asked !== null &&
    Object.entries(asked).every(([key, value]: [string, string]): boolean => {
      return entry.attributes[key] === value;
    })
  );
}

const EVACUATE: string = `openstack server evacuate ${SERVER} ${OTHER}`;
const START: string = `openstack server start ${SERVER}`;
const ENABLE: string =
  "openstack compute service set --enable compute-01 nova-compute";
const AGENT_OFF: string = `openstack network agent set --disable ${AGENT}`;

describe("on each part's feed", () => {
  test("an instance's says it, by its ID", () => {
    const [entry] = buildOpenStackFixChangeEntries(fixOf(START)) as [
      ParsedChangeEventEntry,
    ];

    expect(
      isOnFeedOf(entry, {
        kind: OpenStackResourceKind.Instance,
        externalId: SERVER,
      }),
    ).toBe(true);
    expect(
      isOnFeedOf(entry, {
        kind: OpenStackResourceKind.Instance,
        externalId: OTHER,
      }),
    ).toBe(false);
  });

  test("and so does the hypervisor it was on, however that names itself", () => {
    const [entry] = buildOpenStackFixChangeEntries(fixOf(START)) as [
      ParsedChangeEventEntry,
    ];

    for (const hypervisorName of [
      "compute-01",
      "compute-01.example.internal",
    ]) {
      expect(
        isOnFeedOf(entry, {
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "h",
          hypervisorName,
        }),
      ).toBe(true);
    }

    expect(
      isOnFeedOf(entry, {
        kind: OpenStackResourceKind.Hypervisor,
        externalId: "h",
        hypervisorName: "compute-02",
      }),
    ).toBe(false);
  });

  test("an evacuation is one entry per instance, each on that instance's feed", () => {
    const entries: Array<ParsedChangeEventEntry> =
      buildOpenStackFixChangeEntries(fixOf(EVACUATE));

    expect(entries.length).toBe(2);
    expect(
      isOnFeedOf(entries[0]!, {
        kind: OpenStackResourceKind.Instance,
        externalId: SERVER,
      }),
    ).toBe(true);
    expect(
      isOnFeedOf(entries[1]!, {
        kind: OpenStackResourceKind.Instance,
        externalId: OTHER,
      }),
    ).toBe(true);
    expect(entries[0]?.title).toContain("web-1");
    expect(entries[1]?.title).toContain("web-2");
  });

  test("a compute service's and its host's, short name or full", () => {
    const [entry] = buildOpenStackFixChangeEntries(
      fixOf(ENABLE, { reach: null }),
    ) as [ParsedChangeEventEntry];

    expect(
      isOnFeedOf(entry, {
        kind: OpenStackResourceKind.Service,
        externalId: "s",
        name: "nova-compute",
        workerHost: "compute-01",
      }),
    ).toBe(true);
    expect(
      isOnFeedOf(entry, {
        kind: OpenStackResourceKind.Service,
        externalId: "s",
        name: "nova-scheduler",
        workerHost: "compute-01",
      }),
    ).toBe(false);
    expect(
      isOnFeedOf(entry, {
        kind: OpenStackResourceKind.Hypervisor,
        externalId: "h",
        hypervisorName: "compute-01.example.internal",
      }),
    ).toBe(true);
  });

  test("a Neutron agent's, by the binary and host the agent read", () => {
    const [entry] = buildOpenStackFixChangeEntries(
      fixOf(AGENT_OFF, {
        reach: {
          ...reachOf(AGENT_OFF),
          kind: "on-host",
          agent: {
            id: AGENT,
            binary: "neutron-ovs-agent",
            host: "net-01.example.internal",
          },
        },
      }),
    ) as [ParsedChangeEventEntry];

    expect(
      isOnFeedOf(entry, {
        kind: OpenStackResourceKind.Service,
        externalId: AGENT,
        name: "neutron-ovs-agent",
        workerHost: "net-01",
      }),
    ).toBe(true);
    expect(entry.title).toContain("neutron-ovs-agent");
  });

  test("every entry is on the cloud's own, under the attribute a part's feed reads it by", () => {
    for (const command of [START, EVACUATE, ENABLE, AGENT_OFF]) {
      for (const entry of buildOpenStackFixChangeEntries(fixOf(command))) {
        expect(entry.attributes[OPENSTACK_CLOUD_LOG_ATTRIBUTE]).toBe("prod-eu");
        expect(entry.attributes[ChangeEventAttribute.ResourceType]).toBe(
          AiResourceType.OpenStackCloud,
        );
        expect(entry.attributes[ChangeEventAttribute.ResourceId]).toBe(
          CLOUD_ID.toString(),
        );
      }
    }
  });
});

describe("who approved it", () => {
  test("its title and its who say the person, and where", () => {
    const [entry] = buildOpenStackFixChangeEntries(fixOf(START)) as [
      ParsedChangeEventEntry,
    ];

    expect(entry.title).toBe(
      "OneUptime AI ran server start on web-1, approved by Jane Doe from Slack",
    );
    expect(entry.attributes[ChangeEventAttribute.CloudActor]).toBe("Jane Doe");
    expect(entry.attributes[ChangeEventAttribute.ApprovedBy]).toBe("Jane Doe");
    expect(entry.attributes[ChangeEventAttribute.ApprovedByUserId]).toBe(
      USER_ID.toString(),
    );
    expect(entry.attributes[ChangeEventAttribute.ApprovedFrom]).toBe("Slack");
    expect(entry.description).toContain(START);
    expect(entry.description).toContain("approved by Jane Doe");
  });

  test("a change nobody was asked about says so, and names nobody", () => {
    const [entry] = buildOpenStackFixChangeEntries(
      fixOf(START, { approval: null }),
    ) as [ParsedChangeEventEntry];

    expect(entry.title).toContain("on its own: nobody was asked");
    expect(entry.attributes[ChangeEventAttribute.CloudActor]).toBe(
      "OneUptime AI",
    );
    expect(entry.attributes[ChangeEventAttribute.ApprovedBy]).toBeUndefined();
    expect(
      entry.attributes[ChangeEventAttribute.ApprovedByUserId],
    ).toBeUndefined();
  });

  test("the approver's attributes are ones a pipeline cannot post", () => {
    for (const key of [
      ChangeEventAttribute.ApprovedBy,
      ChangeEventAttribute.ApprovedByUserId,
      ChangeEventAttribute.ApprovedFrom,
    ]) {
      expect(key.startsWith("oneuptime.")).toBe(true);
    }
  });
});

describe("what happened", () => {
  test.each([
    [
      OpenStackFixOutcome.Accepted,
      ChangeEventStatus.Succeeded,
      "OneUptime AI ran server start on web-1",
    ],
    [
      OpenStackFixOutcome.Failed,
      ChangeEventStatus.Failed,
      "OneUptime AI's server start on web-1 failed, and may have changed something",
    ],
    [
      OpenStackFixOutcome.DidNotRun,
      ChangeEventStatus.Cancelled,
      "OneUptime AI's server start on web-1 did not run, and changed nothing",
    ],
  ])(
    "%s",
    (
      outcome: OpenStackFixOutcome,
      status: ChangeEventStatus,
      title: string,
    ) => {
      const [entry] = buildOpenStackFixChangeEntries(
        fixOf(START, { outcome, failure: "Nova said no" }),
      ) as [ParsedChangeEventEntry];

      expect(entry.title.startsWith(title)).toBe(true);
      expect(entry.attributes[ChangeEventAttribute.Status]).toBe(status);
      expect(entry.eventType).toBe(ChangeEventType.Remediation);
      expect(entry.attributes[ChangeEventAttribute.Source]).toBe(
        ChangeEventSource.OneUptimeAi,
      );

      if (outcome !== OpenStackFixOutcome.Accepted) {
        expect(entry.description).toContain("Nova said no");
      }
    },
  );

  test("a rollback says it is one", () => {
    const [entry] = buildOpenStackFixChangeEntries(
      fixOf(ENABLE, { isRollback: true, reach: null }),
    ) as [ParsedChangeEventEntry];

    expect(entry.eventType).toBe(ChangeEventType.Rollback);
    expect(entry.title).toContain("rolled back with");
    expect(entry.attributes[ChangeEventAttribute.AiStep]).toBe("rollback");
  });

  test("long words are held to what a change event may hold", () => {
    const command: string = `openstack server evacuate ${Array.from(
      { length: 50 },
      (_value: unknown, index: number) => {
        return `${index.toString(16).padStart(8, "0")}-ba74-40ba-a354-7ead413c5df6`;
      },
    ).join(" ")}`;
    const entries: Array<ParsedChangeEventEntry> =
      buildOpenStackFixChangeEntries(
        fixOf(command, {
          approval: { name: "x".repeat(5000), userId: USER_ID, from: null },
          failure: "y".repeat(100000),
          reach: null,
        }),
      );

    expect(entries.length).toBe(50);

    for (const entry of entries) {
      expect(entry.title.length).toBeLessThanOrEqual(500);
      expect(entry.description.length).toBeLessThanOrEqual(5000);
      expect(
        entry.attributes[ChangeEventAttribute.Command]?.length,
      ).toBeLessThanOrEqual(500);
    }
  });

  test("the cloud's feed line counts what it can't name", () => {
    expect(describeOpenStackFixForFeed(fixOf(EVACUATE))).toBe(
      "OneUptime AI ran server evacuate on 2 instances, approved by Jane Doe from Slack.",
    );
    expect(describeOpenStackFixForFeed(fixOf(ENABLE))).toBe(
      "OneUptime AI ran compute service set --enable on compute-01, approved by Jane Doe from Slack.",
    );
  });
});

describe("the recorder", () => {
  let rows: Array<JSONObject>;
  let dedupTokens: Array<string | undefined>;
  let feedItems: Array<JSONObject>;
  let claimed: Set<string>;

  function job(overrides: JSONObject = {}): JSONObject {
    return {
      _id: JOB_ID.toString(),
      projectId: PROJECT_ID,
      origin: RunnerJobOrigin.AiRemediation,
      stepType: RunbookStepType.ResourceCommand,
      status: RunnerJobStatus.Succeeded,
      resourceType: AiResourceType.OpenStackCloud,
      resourceId: CLOUD_ID,
      autoRemediationSuggestionId: SUGGESTION_ID,
      stepId: "ai-approved-1",
      aiRunId: RUN_ID,
      exitCode: 0,
      output: renderOpenStackChangeReach(reachOf(START)),
      payload: { displayCommand: START, tier: "SafeWrite" },
      startedAt: TIME,
      ...overrides,
    };
  }

  beforeEach(() => {
    rows = [];
    dedupTokens = [];
    feedItems = [];
    claimed = new Set<string>();

    jest
      .spyOn(RunnerJobService, "findOneById")
      .mockResolvedValue(job() as never);
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue({ triggeredByIncidentId: INCIDENT_ID } as never);
    jest
      .spyOn(OpenStackCloudService, "findOneById")
      .mockResolvedValue({ name: "prod-eu" } as never);
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue({
        approvedByUserId: USER_ID,
        approvedFrom: "MicrosoftTeams",
        approvedByUser: { name: "Jane Doe" },
      } as never);
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(async (namespace: string, key: string) => {
        const full: string = `${namespace}-${key}`;

        if (claimed.has(full)) {
          return false;
        }

        claimed.add(full);
        return true;
      });
    jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
      _target: unknown,
      submitted: Array<JSONObject>,
      options?: { dedupToken?: string | undefined },
    ) => {
      rows.push(...submitted);
      dedupTokens.push(options?.dedupToken);
      return { flushed: Promise.resolve() };
    }) as never);
    jest
      .spyOn(OpenStackCloudFeedService, "createOpenStackCloudFeedItem")
      .mockImplementation((async (item: JSONObject) => {
        feedItems.push(item);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function attributes(row: JSONObject): Dictionary<string> {
    return row["attributes"] as Dictionary<string>;
  }

  test("an approved fix is a change event, and a line on the cloud's feed, with who", async () => {
    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(rows.length).toBe(1);

    const row: JSONObject = rows[0] as JSONObject;

    expect(row["title"]).toBe(
      "OneUptime AI ran server start on web-1, approved by Jane Doe from MicrosoftTeams",
    );
    expect(attributes(row)[ChangeEventAttribute.CloudResourceId]).toBe(SERVER);
    expect(attributes(row)[OPENSTACK_CLOUD_LOG_ATTRIBUTE]).toBe("prod-eu");
    expect(attributes(row)[ChangeEventAttribute.IncidentId]).toBe(
      INCIDENT_ID.toString(),
    );
    expect(
      attributes(row)[ChangeEventAttribute.AutoRemediationSuggestionId],
    ).toBe(SUGGESTION_ID.toString());
    expect(feedItems.length).toBe(1);
    expect(feedItems[0]?.["openStackCloudFeedEventType"]).toBe(
      OpenStackCloudFeedEventType.AiFix,
    );
    expect(String(feedItems[0]?.["feedInfoInMarkdown"])).toContain("Jane Doe");
    expect(feedItems[0]?.["openStackCloudId"]).toEqual(CLOUD_ID);
    expect(feedItems[0]?.["projectId"]).toEqual(PROJECT_ID);
  });

  test("a change a run made on its own names nobody", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue({ approvedByUserId: null } as never);

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(rows[0]?.["title"]).toContain("nobody was asked");
    expect(
      attributes(rows[0] as JSONObject)[ChangeEventAttribute.ApprovedBy],
    ).toBeUndefined();
  });

  test("an evacuation is an event per instance, in one insert", async () => {
    jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue(
      job({
        payload: { displayCommand: EVACUATE, tier: "RiskyWrite" },
        output: renderOpenStackChangeReach(reachOf(EVACUATE)),
      }) as never,
    );

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(rows.length).toBe(2);
    expect(dedupTokens).toEqual([`own-change:job:${JOB_ID.toString()}`]);
    expect(feedItems.length).toBe(1);
  });

  test("a change the agent refused changed nothing, and says that", async () => {
    jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue(
      job({
        status: RunnerJobStatus.Failed,
        exitCode: undefined,
        output: "",
        errorMessage:
          "Refused by the OpenStack AI agent: it is protected by project:abc",
      }) as never,
    );

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(rows[0]?.["title"]).toContain("did not run, and changed nothing");
    expect(attributes(rows[0] as JSONObject)[ChangeEventAttribute.Status]).toBe(
      ChangeEventStatus.Cancelled,
    );
    expect(String(rows[0]?.["description"])).toContain("protected by");
  });

  test("a change that ran and failed may have changed something", async () => {
    jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue(
      job({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: "...",
        errorMessage: "Exit code 1: Nova answered 409",
      }) as never,
    );

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(rows[0]?.["title"]).toContain("failed, and may have changed");
    expect(attributes(rows[0] as JSONObject)[ChangeEventAttribute.Status]).toBe(
      ChangeEventStatus.Failed,
    );
    expect(feedItems[0]?.["displayColor"]).toBeDefined();
  });

  test("a rollback's job reads as one", async () => {
    jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue(
      job({
        stepId: "ai-rollback-1",
        payload: { displayCommand: ENABLE, tier: "SafeWrite" },
      }) as never,
    );

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(rows[0]?.["title"]).toContain("rolled back with");
  });

  test("a read is no change: the dry run that came before writes nothing", async () => {
    jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue(
      job({
        payload: {
          displayCommand: `openstack dry-run server start ${SERVER}`,
          tier: "Read",
        },
      }) as never,
    );

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(rows.length).toBe(0);
    expect(feedItems.length).toBe(0);
  });

  test("a result that arrives twice is said once on the feed", async () => {
    await OwnChangeRecorder.recordAiCommand(JOB_ID);
    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(feedItems.length).toBe(1);
    // The change event's own token drops the second insert.
    expect(new Set(dedupTokens).size).toBe(1);
  });

  test("another resource's job is untouched", async () => {
    jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue(
      job({
        resourceType: AiResourceType.ProxmoxCluster,
        payload: {
          displayCommand: "pvesh create /nodes/pve1/qemu/100/status/start",
          tier: "SafeWrite",
        },
      }) as never,
    );

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(rows.length).toBe(1);
    expect(rows[0]?.["title"]).toContain("OneUptime AI ran pvesh");
    expect(feedItems.length).toBe(0);
  });
});
