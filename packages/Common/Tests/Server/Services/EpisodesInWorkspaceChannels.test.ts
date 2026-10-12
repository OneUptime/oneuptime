import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import AlertEpisodeWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/AlertEpisode";
import IncidentEpisodeWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/IncidentEpisode";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * EPISODES IN SLACK AND MICROSOFT TEAMS.
 *
 * - An episode's first state is no longer posted on its own
 *   (WorkspaceStateChangePosting) - and its created message never named
 *   it. Now the created message names the episode's state and severity, as
 *   an incident's and an alert's do, so a channel still reads them.
 * - Matching a workspace rule for an ALERT episode threw "NotificationFor is
 *   not supported": no alert episode channel was ever created, and nothing
 *   about an alert episode reached Slack or Teams, even in channels its rules
 *   named. Its rules match now, on the episode's title, description,
 *   severity, state and labels.
 */

type Hook = (...args: Array<unknown>) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  return (service as Record<string, Hook>)[name]!.bind(service);
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const EPISODE_ID: ObjectID = ObjectID.generate();

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an episode's created message names its state and severity", () => {
  let posted: Array<string>;

  beforeEach(() => {
    posted = [];

    jest
      .spyOn(
        AlertEpisodeWorkspaceMessages,
        "getAlertEpisodeCreateMessageBlocks",
      )
      .mockResolvedValue([]);
    jest
      .spyOn(
        IncidentEpisodeWorkspaceMessages,
        "getIncidentEpisodeCreateMessageBlocks",
      )
      .mockResolvedValue([]);
    jest
      .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
      .mockImplementation((async (data: {
        feedInfoInMarkdown: string;
      }): Promise<void> => {
        posted.push(data.feedInfoInMarkdown);
      }) as never);
    jest
      .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
      .mockImplementation((async (data: {
        feedInfoInMarkdown: string;
      }): Promise<void> => {
        posted.push(data.feedInfoInMarkdown);
      }) as never);
  });

  function alertEpisode(): AlertEpisode {
    const episode: AlertEpisode = new AlertEpisode();
    episode.id = EPISODE_ID;
    episode.projectId = PROJECT_ID;
    episode.episodeNumberWithPrefix = "AE-3";
    episode.title = "Checkout errors";
    return episode;
  }

  function incidentEpisode(): IncidentEpisode {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.id = EPISODE_ID;
    episode.projectId = PROJECT_ID;
    episode.episodeNumberWithPrefix = "IE-3";
    episode.title = "Checkout outage";
    return episode;
  }

  test("an alert episode: its state and severity, as plain text", async () => {
    const stored: AlertEpisode = alertEpisode();
    const state: AlertState = new AlertState();
    state.name = "Active *now*";
    stored.currentAlertState = state;
    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "Critical";
    stored.alertSeverity = severity;

    jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue(stored);

    await hookOf(
      AlertEpisodeService,
      "createEpisodeCreatedFeed",
    )(alertEpisode());

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("🔴 **Episode State**: Active \\*now\\*");
    expect(posted[0]).toContain("⚠️ **Severity**: Critical");
  });

  test("an incident episode: its state and severity", async () => {
    const stored: IncidentEpisode = incidentEpisode();
    const state: IncidentState = new IncidentState();
    state.name = "Identified";
    stored.currentIncidentState = state;
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Major Incident";
    stored.incidentSeverity = severity;

    jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue(stored);

    await hookOf(
      IncidentEpisodeService,
      "createEpisodeCreatedFeed",
    )(incidentEpisode());

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("🔴 **Episode State**: Identified");
    expect(posted[0]).toContain("⚠️ **Severity**: Major Incident");
  });

  test("a state that cannot be read leaves the lines out - the created message still goes out", async () => {
    jest
      .spyOn(AlertEpisodeService, "findOneById")
      .mockRejectedValue(new Error("database is down"));
    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockRejectedValue(new Error("database is down"));

    await hookOf(
      AlertEpisodeService,
      "createEpisodeCreatedFeed",
    )(alertEpisode());
    await hookOf(
      IncidentEpisodeService,
      "createEpisodeCreatedFeed",
    )(incidentEpisode());

    expect(posted).toHaveLength(2);
    expect(posted[0]).toContain("Episode AE-3 Created");
    expect(posted[0]).not.toContain("Episode State");
    expect(posted[1]).toContain("Episode IE-3 Created");
    expect(posted[1]).not.toContain("Episode State");
  });
});

describe("an alert episode's workspace rules match", () => {
  function rule(
    checkOn: NotificationRuleConditionCheckOn,
    conditionType: ConditionType,
    value: string | Array<string>,
  ): WorkspaceNotificationRule {
    const model: WorkspaceNotificationRule = new WorkspaceNotificationRule();
    model.id = ObjectID.generate();
    model.workspaceType = WorkspaceType.Slack;
    model.eventType = NotificationRuleEventType.AlertEpisode;
    model.notificationRule = {
      _type: "AlertEpisodeNotificationRule",
      filterCondition: FilterCondition.All,
      filters: [{ checkOn, conditionType, value }],
      shouldPostToExistingChannel: true,
      existingChannelNames: "alerts",
    } as never;
    return model;
  }

  const SEVERITY_ID: ObjectID = ObjectID.generate();
  const STATE_ID: ObjectID = ObjectID.generate();
  const LABEL_ID: ObjectID = ObjectID.generate();

  beforeEach(() => {
    const episode: AlertEpisode = new AlertEpisode();
    episode.id = EPISODE_ID;
    episode.title = "Checkout errors";
    episode.description = "Five alerts on checkout";
    const severity: AlertSeverity = new AlertSeverity();
    severity._id = SEVERITY_ID.toString();
    episode.alertSeverity = severity;
    const state: AlertState = new AlertState();
    state._id = STATE_ID.toString();
    episode.currentAlertState = state;
    const label: Label = new Label();
    label._id = LABEL_ID.toString();
    episode.labels = [label];

    jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue(episode);
  });

  async function matching(
    rules: Array<WorkspaceNotificationRule>,
  ): Promise<Array<WorkspaceNotificationRule>> {
    jest
      .spyOn(WorkspaceNotificationRuleService, "findBy")
      .mockResolvedValue(rules);

    return await WorkspaceNotificationRuleService.getMatchingNotificationRules({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      notificationRuleEventType: NotificationRuleEventType.AlertEpisode,
      notificationFor: { alertEpisodeId: EPISODE_ID },
    });
  }

  test("REGRESSION: matching no longer throws 'NotificationFor is not supported'", async () => {
    await expect(matching([])).resolves.toEqual([]);
  });

  test("on the episode's title, description, severity, state and labels", async () => {
    const byTitle: WorkspaceNotificationRule = rule(
      NotificationRuleConditionCheckOn.AlertEpisodeTitle,
      ConditionType.Contains,
      "Checkout",
    );
    const byDescription: WorkspaceNotificationRule = rule(
      NotificationRuleConditionCheckOn.AlertEpisodeDescription,
      ConditionType.Contains,
      "Five alerts",
    );
    const bySeverity: WorkspaceNotificationRule = rule(
      NotificationRuleConditionCheckOn.AlertEpisodeSeverity,
      ConditionType.ContainsAny,
      [SEVERITY_ID.toString()],
    );
    const byState: WorkspaceNotificationRule = rule(
      NotificationRuleConditionCheckOn.AlertEpisodeState,
      ConditionType.ContainsAny,
      [STATE_ID.toString()],
    );
    const byLabel: WorkspaceNotificationRule = rule(
      NotificationRuleConditionCheckOn.AlertEpisodeLabels,
      ConditionType.ContainsAny,
      [LABEL_ID.toString()],
    );
    const noMatch: WorkspaceNotificationRule = rule(
      NotificationRuleConditionCheckOn.AlertEpisodeTitle,
      ConditionType.Contains,
      "Database",
    );

    const matched: Array<WorkspaceNotificationRule> = await matching([
      byTitle,
      byDescription,
      bySeverity,
      byState,
      byLabel,
      noMatch,
    ]);

    expect(
      matched.map((model: WorkspaceNotificationRule): string => {
        return model.id!.toString();
      }),
    ).toEqual(
      [byTitle, byDescription, bySeverity, byState, byLabel].map(
        (model: WorkspaceNotificationRule): string => {
          return model.id!.toString();
        },
      ),
    );
  });

  test("an episode that no longer exists is refused, as for every other record", async () => {
    jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue(null);

    await expect(matching([])).rejects.toThrow("Alert Episode ID not found");
  });
});
