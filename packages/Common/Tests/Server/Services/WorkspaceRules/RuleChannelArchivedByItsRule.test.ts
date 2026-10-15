import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeStateTimeline from "../../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import AlertEpisodeFeedService from "../../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentEpisodeFeedService from "../../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import URL from "../../../../Types/API/URL";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { WorkspacePayloadMarkdown } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceRuleWorld, {
  CRITICAL_SEVERITY_ID,
  INCIDENT_ID,
  makeRule,
  MINOR_SEVERITY_ID,
  OTHER_RULE_ID,
  PROJECT_ID,
  RULE_ID,
} from "./WorkspaceRuleWorld";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
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
 * A RULE'S CHANNEL IS ARCHIVED AS ITS OWN RULE SAYS.
 *
 * "Archive the channel when the incident is resolved" is a promise of the
 * rule that created the channel. It was asked of the rules that matched the
 * incident at its end: a channel opened by a rule for Critical incidents
 * stayed open once the severity was lowered, a rule for acknowledged
 * incidents never archived its channel (the incident is Resolved by then),
 * and one matching rule that archives took every channel of the incident
 * with it, those of rules that keep theirs too. The rule form also offered
 * the switch for incident and alert episodes, and nothing archived theirs.
 */

let world: WorkspaceRuleWorld;

beforeEach(() => {
  world = new WorkspaceRuleWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function channel(data: {
  id: string;
  name: string;
  ruleIds: Array<ObjectID>;
}): NotificationRuleWorkspaceChannel {
  world.addSlackChannel({ id: data.id, name: data.name });

  return {
    id: data.id,
    name: data.name,
    workspaceType: WorkspaceType.Slack,
    notificationRuleId: data.ruleIds[0]!.toString(),
    notificationRuleIds: data.ruleIds.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

async function resolveIncident(): Promise<void> {
  await WorkspaceNotificationRuleService.archiveWorkspaceChannels({
    projectId: PROJECT_ID,
    notificationFor: { incidentId: INCIDENT_ID },
    sendMessageBeforeArchiving: {
      _type: "WorkspacePayloadMarkdown",
      text: "Incident INC-42 is resolved. Archiving channel.",
    },
  });
}

function archived(): Array<string> {
  return world
    .slackRequestsOf("conversations.archive")
    .map((body: { channel?: unknown }): string => {
      return String(body.channel);
    });
}

describe("which of the incident's channels are archived", () => {
  test("only the channel of the rule that archives, not the other rule's", async () => {
    world.rules = [
      makeRule({ archive: true }),
      makeRule({ id: OTHER_RULE_ID, prefix: "war-", archive: false }),
    ];
    world.incident.channels = [
      channel({ id: "C0A", name: "inc-42", ruleIds: [RULE_ID] }),
      channel({ id: "C0B", name: "war-inc-42", ruleIds: [OTHER_RULE_ID] }),
    ];

    await resolveIncident();

    expect(archived()).toEqual(["C0A"]);
    // Said in the channel before it is archived.
    expect(world.slackMessagesIn("C0A")[0]).toContain("Archiving channel");
    expect(world.slackMessagesIn("C0B")).toEqual([]);
  });

  test("REGRESSION: a rule for Critical incidents archives its channel after the severity was lowered", async () => {
    world.rules = [
      makeRule({
        archive: true,
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
            conditionType: ConditionType.ContainsAny,
            value: [CRITICAL_SEVERITY_ID.toString()],
          },
        ],
      }),
    ];
    world.incident.severityId = MINOR_SEVERITY_ID;
    world.incident.channels = [
      channel({ id: "C0A", name: "inc-42", ruleIds: [RULE_ID] }),
    ];

    await resolveIncident();

    expect(archived()).toEqual(["C0A"]);
  });

  test("a channel two rules share is archived when either of them archives", async () => {
    world.rules = [
      makeRule({ archive: false }),
      makeRule({ id: OTHER_RULE_ID, archive: true }),
    ];
    world.incident.channels = [
      channel({ id: "C0A", name: "inc-42", ruleIds: [RULE_ID, OTHER_RULE_ID] }),
    ];

    await resolveIncident();

    expect(archived()).toEqual(["C0A"]);
  });

  test("a channel whose rule was deleted, or does not archive, stays", async () => {
    world.rules = [makeRule({ archive: false })];
    world.incident.channels = [
      channel({ id: "C0A", name: "inc-42", ruleIds: [RULE_ID] }),
      channel({ id: "C0GONE", name: "old-inc-42", ruleIds: [OTHER_RULE_ID] }),
    ];

    await resolveIncident();

    expect(archived()).toEqual([]);
  });

  test("an incident without channels asks Slack nothing", async () => {
    world.rules = [makeRule({ archive: true })];
    world.incident.channels = [];

    await resolveIncident();

    expect(world.slackRequests).toEqual([]);
  });
});

/*
 * An episode's channels: archived when the episode is resolved, by its
 * state timeline - the switch the rule form offered for episodes now does
 * what it says.
 */
describe("an episode's channels are archived when it is resolved", () => {
  const EPISODE_ID: ObjectID = new ObjectID(
    "e7000000-0000-4000-8000-0000000000e1",
  );
  const RESOLVED: ObjectID = new ObjectID(
    "e7000000-0000-4000-8000-0000000000e2",
  );

  // The state the episode was in before: its row is closed by the change.
  const BEFORE_ROW_ID: ObjectID = new ObjectID(
    "e7000000-0000-4000-8000-0000000000e3",
  );

  let archiveCalls: Array<{
    notificationFor: {
      incidentEpisodeId?: ObjectID;
      alertEpisodeId?: ObjectID;
    };
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
  }>;

  beforeEach(() => {
    archiveCalls = [];
    jest
      .spyOn(IncidentEpisodeStateTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertEpisodeStateTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(WorkspaceNotificationRuleService, "archiveWorkspaceChannels")
      .mockImplementation((async (data: {
        notificationFor: {
          incidentEpisodeId?: ObjectID;
          alertEpisodeId?: ObjectID;
        };
        sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
      }): Promise<void> => {
        archiveCalls.push(data);
      }) as never);
  });

  function incidentEpisodeTimeline(
    endsAt?: Date | undefined,
  ): IncidentEpisodeStateTimeline {
    const row: IncidentEpisodeStateTimeline =
      new IncidentEpisodeStateTimeline();
    row.id = ObjectID.generate();
    row.projectId = PROJECT_ID;
    row.incidentEpisodeId = EPISODE_ID;
    row.incidentStateId = RESOLVED;
    row.startsAt = OneUptimeDate.getCurrentDate();
    if (endsAt) {
      row.endsAt = endsAt;
    }
    return row;
  }

  function stubIncidentEpisodeHook(isResolved: boolean): void {
    jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockResolvedValue(isResolved);
    jest
      .spyOn(IncidentStateService, "isAcknowledgedIncidentState")
      .mockResolvedValue(true);
    jest.spyOn(IncidentStateService, "findOneBy").mockResolvedValue(null);
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.episodeNumber = 3;
    episode.episodeNumberWithPrefix = "IE-3";
    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockResolvedValue(episode);
    jest
      .spyOn(IncidentEpisodeService, "updateOneBy")
      .mockResolvedValue(1 as never);
    jest
      .spyOn(IncidentEpisodeService, "cascadeStateToMemberIncidents")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.test/incidents/episodes/3"),
      );
    jest
      .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
      .mockResolvedValue(undefined as never);
  }

  async function changeIncidentEpisodeState(
    row: IncidentEpisodeStateTimeline,
  ): Promise<void> {
    await (
      IncidentEpisodeStateTimelineService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          created: IncidentEpisodeStateTimeline,
        ) => Promise<unknown>;
      }
    ).onCreateSuccess(
      {
        createBy: { data: row, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: { id: BEFORE_ROW_ID },
          statusTimelineAfterThisStatus: null,
          privateNotesToPost: [],
          mutex: null,
        },
      },
      row,
    );
  }

  test("an incident episode resolved: its channels are archived, saying so", async () => {
    stubIncidentEpisodeHook(true);

    await changeIncidentEpisodeState(incidentEpisodeTimeline());

    expect(archiveCalls).toHaveLength(1);
    expect(archiveCalls[0]!.notificationFor).toEqual({
      incidentEpisodeId: EPISODE_ID,
    });
    expect(archiveCalls[0]!.sendMessageBeforeArchiving.text).toContain(
      "Episode IE-3",
    );
    expect(archiveCalls[0]!.sendMessageBeforeArchiving.text).toContain(
      "is resolved. Archiving channel.",
    );
  });

  test("an incident episode moved to a state that is not resolved: nothing is archived", async () => {
    stubIncidentEpisodeHook(false);

    await changeIncidentEpisodeState(incidentEpisodeTimeline());

    expect(archiveCalls).toEqual([]);
  });

  test("a resolved state written into the episode's past: nothing is archived", async () => {
    stubIncidentEpisodeHook(true);

    await changeIncidentEpisodeState(
      incidentEpisodeTimeline(OneUptimeDate.getCurrentDate()),
    );

    expect(archiveCalls).toEqual([]);
  });

  test("an alert episode resolved: its channels are archived, saying so", async () => {
    jest
      .spyOn(AlertStateService, "isResolvedAlertState")
      .mockResolvedValue(true);
    jest
      .spyOn(AlertStateService, "isAcknowledgedAlertState")
      .mockResolvedValue(true);
    jest.spyOn(AlertStateService, "findOneBy").mockResolvedValue(null);
    const episode: AlertEpisode = new AlertEpisode();
    episode.episodeNumber = 4;
    episode.episodeNumberWithPrefix = "AE-4";
    jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue(episode);
    jest
      .spyOn(AlertEpisodeService, "updateOneBy")
      .mockResolvedValue(1 as never);
    jest
      .spyOn(AlertEpisodeService, "cascadeStateToMemberAlerts")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.test/alerts/episodes/4"),
      );
    jest
      .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
      .mockResolvedValue(undefined as never);

    const row: AlertEpisodeStateTimeline = new AlertEpisodeStateTimeline();
    row.id = ObjectID.generate();
    row.projectId = PROJECT_ID;
    row.alertEpisodeId = EPISODE_ID;
    row.alertStateId = RESOLVED;
    row.startsAt = OneUptimeDate.getCurrentDate();

    await (
      AlertEpisodeStateTimelineService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          created: AlertEpisodeStateTimeline,
        ) => Promise<unknown>;
      }
    ).onCreateSuccess(
      {
        createBy: { data: row, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: { id: BEFORE_ROW_ID },
          statusTimelineAfterThisStatus: null,
          privateNotesToPost: [],
          mutex: null,
        },
      },
      row,
    );

    expect(archiveCalls).toHaveLength(1);
    expect(archiveCalls[0]!.notificationFor).toEqual({
      alertEpisodeId: EPISODE_ID,
    });
    expect(archiveCalls[0]!.sendMessageBeforeArchiving.text).toContain(
      "Episode AE-4",
    );
  });
});
