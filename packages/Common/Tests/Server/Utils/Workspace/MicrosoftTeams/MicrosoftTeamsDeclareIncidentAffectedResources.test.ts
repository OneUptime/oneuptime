import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Project from "../../../../../Models/DatabaseModels/Project";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import AIService from "../../../../../Server/Services/AIService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import { LinkedAffectedResource } from "../../../../../Server/Utils/AI/Toolbox/AffectedResourceLinks";
import logger from "../../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import { MicrosoftTeamsIncidentActionType } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsIncidentActions, {
  MicrosoftTeamsNewIncidentFormChoices,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import { MicrosoftTeamsCardChoiceList } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import MicrosoftTeamsCommands from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCommands";
import MicrosoftTeamsCreateCommands from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCreateCommands";
import { MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceAffectedResources, {
  WorkspaceAffectedResourcePicks,
  WorkspaceAffectedResourcesToLink,
} from "../../../../../Server/Utils/Workspace/WorkspaceAffectedResources";
import WorkspaceIncidentFromAlert, {
  WorkspaceAlertNotLinked,
  WorkspaceAlertToLink,
  WorkspaceDeclaringAlert,
} from "../../../../../Server/Utils/Workspace/WorkspaceIncidentFromAlert";
import URL from "../../../../../Types/API/URL";
import { AiAffectedResourceKind } from "../../../../../Types/AI/AiAffectedResources";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { INCIDENT_ALERT_IDS_TO_LINK_KEY } from "../../../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * MICROSOFT TEAMS' CREATE NEW INCIDENT CARD, LINKED TO WHAT THE INCIDENT IS
 * ABOUT (#5303 follow-up, and #5409's alert channels).
 *
 *   - The card: Affected Resources right after the severity, a typeahead
 *     that names the card's project - or none, for a member who may read no
 *     resource or a project with none; the Monitors input says what a pick
 *     there does; declared in an alert's own channel, the card says so,
 *     starts from the alert's title and resources, and its button carries
 *     the alert. Every card fits Teams' size budget all the same.
 *   - The command: what the card is drawn with is read as the sender, in
 *     the project, in the channel it was typed in.
 *   - The submit: the picks read again as whoever submits it, each in its
 *     kind's list; the alert linked when they may link it, and the
 *     incident private like a private alert; the confirmation says what it
 *     is linked to, and what was picked and not linked is said in a reply
 *     that mentions them.
 *   - Status page subscribers (#7606): the card asks nothing about them, so
 *     the incident is declared as the project starts Notify Status Page
 *     Subscribers on Declare New Incident - without notifying them where the
 *     project starts it unticked, as always everywhere else.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7ea60000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("7ea60000-0000-4000-8000-000000000002");
const CREATED_ID: ObjectID = new ObjectID(
  "7ea60000-0000-4000-8000-000000000003",
);
const ALERT_ID: ObjectID = new ObjectID("7ea60000-0000-4000-8000-000000000004");
const SEVERITY_ID: string = "7ea60000-0000-4000-8000-0000000000c1";
const MONITOR_ID: string = "7ea60000-0000-4000-8000-0000000000c2";
const HOST_ID: string = "7ea60000-0000-4000-8000-0000000000a1";
const SERVICE_ID: string = "7ea60000-0000-4000-8000-0000000000b1";
const CHANNEL_ID: string = "19:alt-3@thread.tacv2";

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const INCIDENT_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${CREATED_ID.toString()}`;
const ALERT_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}`;

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

const API_HOST: LinkedAffectedResource = {
  kind: AiAffectedResourceKind.Host,
  id: HOST_ID,
  name: "api-1",
};
const CHECKOUT: LinkedAffectedResource = {
  kind: AiAffectedResourceKind.Service,
  id: SERVICE_ID,
  name: "checkout",
};

const DECLARING_ALERT: WorkspaceDeclaringAlert = {
  alertId: ALERT_ID,
  name: { label: "Alert ALT-3", link: ALERT_LINK },
  title: "Disk almost full",
  isPrivate: false,
  resources: [API_HOST],
  linkRefusal: null,
};

function listOf(
  choices: Array<{ title: string; value: string }>,
): MicrosoftTeamsCardChoiceList {
  return { choices: choices, totalCount: choices.length };
}

function choices(
  monitorCount: number = 1,
): MicrosoftTeamsNewIncidentFormChoices {
  const monitors: Array<{ title: string; value: string }> = [];

  for (let index: number = 0; index < monitorCount; index++) {
    monitors.push({
      title: `Production HTTP Monitor ${String(index).padStart(6, "0")}`,
      value: index === 0 ? MONITOR_ID : ObjectID.generate().toString(),
    });
  }

  return {
    severities: listOf([{ title: "Critical", value: SEVERITY_ID }]),
    monitors: { choices: monitors, totalCount: monitorCount },
    monitorStatuses: listOf([]),
    labels: listOf([]),
    onCallDutyPolicies: listOf([]),
  };
}

function bodyOf(card: JSONObject): Array<JSONObject> {
  return card["body"] as Array<JSONObject>;
}

// Each element of a card as one word: its input id, or its text.
function outlineOf(card: JSONObject): Array<string> {
  return bodyOf(card).map((element: JSONObject): string => {
    return element["id"]
      ? String(element["id"])
      : `${String(element["type"])}: ${String(element["text"])}`;
  });
}

function submitDataOf(card: JSONObject): JSONObject {
  const submit: JSONObject | undefined = (
    card["actions"] as Array<JSONObject>
  ).find((action: JSONObject): boolean => {
    return action["type"] === "Action.Submit";
  });

  expect(submit).toBeDefined();
  return submit!["data"] as JSONObject;
}

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the card", () => {
  test("Affected Resources right after the severity, naming the card's project; the Monitors input says what a pick there does", () => {
    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: choices(),
        budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
        affectedResources: { projectId: PROJECT_ID, isAiEnabled: true },
      });

    expect(outlineOf(card)).toEqual([
      "TextBlock: Create New Incident",
      "incidentTitle",
      "incidentDescription",
      "incidentSeverity",
      "affectedResources",
      "TextBlock: OneUptime AI investigates what you pick here, and can fix it.",
      "incidentMonitors",
      "TextBlock: A monitor you pick here pauses its checks until the incident is resolved.",
    ]);

    const input: JSONObject = bodyOf(card)[4]!;
    expect(input["choices.data"]).toEqual({
      type: "Data.Query",
      dataset: `oneuptime.affectedResources:${PROJECT_ID.toString()}`,
    });
    expect(input["choices"]).toEqual([]);
    expect(input["isMultiSelect"]).toBe(true);
    // Optional: only the title, the description and the severity are required.
    expect(input["isRequired"]).toBeUndefined();

    expect(submitDataOf(card)).toEqual({
      action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
    });
  });

  test("no Affected Resources asked for - a member who may read none, a project with none: the card as it was, but for the Monitors line", () => {
    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: choices(),
        budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
      });

    expect(outlineOf(card)).toEqual([
      "TextBlock: Create New Incident",
      "incidentTitle",
      "incidentDescription",
      "incidentSeverity",
      "incidentMonitors",
      "TextBlock: A monitor you pick here pauses its checks until the incident is resolved.",
    ]);
    expect(JSON.stringify(card)).not.toContain("Data.Query");
  });

  test("a project with no monitors: no Monitors input, and no line about one", () => {
    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: choices(0),
        budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
        affectedResources: { projectId: PROJECT_ID, isAiEnabled: true },
      });

    expect(outlineOf(card)).not.toContain("incidentMonitors");
    expect(JSON.stringify(card)).not.toContain("pauses its checks");
  });

  test("declared in an alert's own channel: it says so, starts from the alert's title and resources, and its button carries the alert", () => {
    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: choices(),
        budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
        affectedResources: { projectId: PROJECT_ID, isAiEnabled: true },
        declaringAlert: DECLARING_ALERT,
      });

    // The alert by its number: its title is the card's title already.
    expect(bodyOf(card)[1]).toEqual({
      type: "TextBlock",
      text: `This incident will be linked to **[Alert ALT-3](${ALERT_LINK})**.`,
      wrap: true,
    });
    expect(bodyOf(card)[2]!["value"]).toBe("Disk almost full");

    const input: JSONObject = bodyOf(card).find((element: JSONObject) => {
      return element["id"] === "affectedResources";
    })!;
    expect(input["choices"]).toEqual([
      { title: "api-1 (Host)", value: `Host:${HOST_ID}` },
    ]);
    expect(input["value"]).toBe(`Host:${HOST_ID}`);

    // Its monitor is never picked for the person.
    const monitors: JSONObject = bodyOf(card).find((element: JSONObject) => {
      return element["id"] === "incidentMonitors";
    })!;
    expect(monitors["value"]).toBeUndefined();

    expect(submitDataOf(card)).toEqual({
      action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      declaredFrom: `alert:${ALERT_ID.toString()}`,
    });
  });

  test("an alert the asker may not link: the card says it will not be linked, and why - and its button still names the alert, for whoever submits it to be asked again", () => {
    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: choices(),
        budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
        affectedResources: { projectId: PROJECT_ID, isAiEnabled: true },
        declaringAlert: {
          ...DECLARING_ALERT,
          isPrivate: true,
          linkRefusal:
            "You do not have permission to link alerts to incidents in this project.",
        },
      });

    expect(bodyOf(card)[1]!["text"]).toBe(
      `This incident will not be linked to **[Alert ALT-3](${ALERT_LINK})**. You do not have permission to link alerts to incidents in this project. Like the alert, it will be private.`,
    );
    expect(submitDataOf(card)["declaredFrom"]).toBe(
      `alert:${ALERT_ID.toString()}`,
    );
  });

  test("a project with AI off: Affected Resources with no line about AI", () => {
    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: choices(),
        budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
        affectedResources: { projectId: PROJECT_ID, isAiEnabled: false },
      });

    expect(outlineOf(card)).toEqual([
      "TextBlock: Create New Incident",
      "incidentTitle",
      "incidentDescription",
      "incidentSeverity",
      "affectedResources",
      "incidentMonitors",
      "TextBlock: A monitor you pick here pauses its checks until the incident is resolved.",
    ]);
  });

  test("a title typed with the command is the title", () => {
    const card: JSONObject =
      MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
        choices: choices(),
        budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
        initialTitle: "Disk full on api-1",
        declaringAlert: DECLARING_ALERT,
      });

    expect(
      bodyOf(card).find((element: JSONObject) => {
        return element["id"] === "incidentTitle";
      })!["value"],
    ).toBe("Disk full on api-1");
  });

  test("whatever the project, the card with Affected Resources fits Teams' first budget", () => {
    for (const monitorCount of [0, 50, 500, 5000]) {
      const card: JSONObject =
        MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
          choices: choices(monitorCount),
          budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
          affectedResources: { projectId: PROJECT_ID, isAiEnabled: true },
          declaringAlert: {
            ...DECLARING_ALERT,
            resources: Array.from(
              { length: 50 },
              (_value: unknown, index: number): LinkedAffectedResource => {
                return {
                  kind: AiAffectedResourceKind.Host,
                  id: ObjectID.generate().toString(),
                  name: `rack-a-host-${String(index).padStart(3, "0")}`,
                };
              },
            ),
          },
        });

      expect({
        monitorCount,
        fits:
          JSON.stringify(card).length * 2 <=
          MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
        hasInput: outlineOf(card).includes("affectedResources"),
      }).toEqual({ monitorCount, fits: true, hasInput: true });
    }
  });
});

describe("the command draws the card as the sender, in the channel it was typed in", () => {
  type ReadChannelAlert = typeof WorkspaceIncidentFromAlert.readChannelAlert;
  type IsOffered = typeof WorkspaceAffectedResources.isOffered;
  type IsProjectAIEnabled = typeof AIService.isProjectAIEnabled;

  let sentCards: Array<JSONObject>;
  let readChannelAlertSpy: SpyInstance<ReadChannelAlert>;
  let isOfferedSpy: SpyInstance<IsOffered>;
  let isAiEnabledSpy: SpyInstance<IsProjectAIEnabled>;

  beforeEach(() => {
    sentCards = [];

    jest
      .spyOn(MicrosoftTeamsCommands, "authorizeSender")
      .mockResolvedValue(MEMBER_PROPS);
    jest
      .spyOn(MicrosoftTeamsIncidentActions, "getNewIncidentFormChoices")
      .mockResolvedValue(choices());
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
    readChannelAlertSpy = jest
      .spyOn(WorkspaceIncidentFromAlert, "readChannelAlert")
      .mockResolvedValue(null);
    isOfferedSpy = jest
      .spyOn(WorkspaceAffectedResources, "isOffered")
      .mockResolvedValue(true);
    isAiEnabledSpy = jest
      .spyOn(AIService, "isProjectAIEnabled")
      .mockResolvedValue(true);
    jest
      .spyOn(MicrosoftTeamsReplies, "sendCardWithinSizeLimit")
      .mockImplementation(
        async (data: {
          buildCard: (budgetInBytes: number) => JSONObject;
        }): Promise<void> => {
          sentCards.push(
            data.buildCard(MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!),
          );
        },
      );
  });

  function activityIn(channelId: string | null): JSONObject {
    return {
      type: "message",
      id: "msg-1",
      from: { id: "29:1jane", name: "Jane", aadObjectId: "aad-jane" },
      channelData: {
        tenant: { id: "tenant" },
        ...(channelId ? { channel: { id: channelId } } : {}),
      },
    };
  }

  async function run(channelId: string | null): Promise<JSONObject> {
    await MicrosoftTeamsCreateCommands.handleCreateIncidentCommand({
      turnContext: {} as TurnContext,
      activity: activityIn(channelId),
      projectId: PROJECT_ID,
    });

    expect(sentCards).toHaveLength(1);
    return sentCards[0]!;
  }

  test("asked whether to offer the field, and about the alert of the channel, as the sender, in the project", async () => {
    const card: JSONObject = await run(CHANNEL_ID);

    expect(isOfferedSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: MEMBER_PROPS,
    });
    expect(readChannelAlertSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      channelId: CHANNEL_ID,
      props: MEMBER_PROPS,
    });
    expect(isAiEnabledSpy).toHaveBeenCalledWith(PROJECT_ID);
    expect(outlineOf(card)).toContain("affectedResources");
    expect(outlineOf(card)).toContain(
      "TextBlock: OneUptime AI investigates what you pick here, and can fix it.",
    );
  });

  test("the project's AI is off: the field, with no line about AI", async () => {
    isAiEnabledSpy.mockResolvedValue(false);

    const outline: Array<string> = outlineOf(await run(CHANNEL_ID));

    expect(outline).toContain("affectedResources");
    expect(outline.join("\n")).not.toContain("OneUptime AI");
  });

  test("in a chat, no channel is asked about", async () => {
    await run(null);

    expect(readChannelAlertSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      channelId: undefined,
      props: MEMBER_PROPS,
    });
  });

  test("nothing to offer: no field", async () => {
    isOfferedSpy.mockResolvedValue(false);

    expect(outlineOf(await run(CHANNEL_ID))).not.toContain("affectedResources");
  });

  test("nothing else to offer, but the alert's resources: the field, with them picked", async () => {
    isOfferedSpy.mockResolvedValue(false);
    readChannelAlertSpy.mockResolvedValue(DECLARING_ALERT);

    const card: JSONObject = await run(CHANNEL_ID);
    const input: JSONObject = bodyOf(card).find((element: JSONObject) => {
      return element["id"] === "affectedResources";
    })!;

    expect(input["value"]).toBe(`Host:${HOST_ID}`);
    expect(submitDataOf(card)["declaredFrom"]).toBe(
      `alert:${ALERT_ID.toString()}`,
    );
  });

  test("a sender who may not declare an incident gets no card, and nothing is read for one", async () => {
    jest
      .spyOn(MicrosoftTeamsCommands, "authorizeSender")
      .mockResolvedValue(null);

    await MicrosoftTeamsCreateCommands.handleCreateIncidentCommand({
      turnContext: {} as TurnContext,
      activity: activityIn(CHANNEL_ID),
      projectId: PROJECT_ID,
    });

    expect(sentCards).toEqual([]);
    expect(isOfferedSpy).not.toHaveBeenCalled();
    expect(readChannelAlertSpy).not.toHaveBeenCalled();
  });
});

describe("the submit", () => {
  type ReadPicked = typeof WorkspaceAffectedResources.readPicked;
  type CheckLink = typeof WorkspaceIncidentFromAlert.checkLink;

  interface Sent {
    kind: "reply" | "answer";
    text: string;
  }

  let sent: Array<Sent>;
  let deleted: Array<string>;
  let created: Array<{
    data: Incident;
    miscDataProps: JSONObject | undefined;
    props: DatabaseCommonInteractionProps;
  }>;
  let readPickedSpy: SpyInstance<ReadPicked>;
  let checkLinkSpy: SpyInstance<CheckLink>;
  let toLink: WorkspaceAffectedResourcesToLink;
  let alertLink: WorkspaceAlertToLink | WorkspaceAlertNotLinked;
  /*
   * The project's Notify status page subscribers by default (Incidents >
   * Settings > Subscriber Notifications), and every read of it.
   */
  let notifiesByDefault: boolean;
  let projectReads: Array<JSONObject>;

  beforeEach(() => {
    sent = [];
    deleted = [];
    created = [];
    notifiesByDefault = true;
    projectReads = [];
    toLink = { linked: [API_HOST, CHECKOUT], notLinkedCount: 0 };
    alertLink = {
      miscDataProps: {
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID.toString()],
      },
      name: { label: "Alert ALT-3", link: ALERT_LINK },
      isPrivate: false,
    };

    jest
      .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
      .mockResolvedValue(undefined);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
    readPickedSpy = jest
      .spyOn(WorkspaceAffectedResources, "readPicked")
      .mockImplementation(async () => {
        return toLink;
      });
    checkLinkSpy = jest
      .spyOn(WorkspaceIncidentFromAlert, "checkLink")
      .mockImplementation(async () => {
        return alertLink;
      });
    jest.spyOn(ProjectService, "findOneById").mockImplementation((async (
      findOneById: JSONObject,
    ) => {
      projectReads.push(findOneById);

      const project: Project = new Project();
      project.id = findOneById["id"] as ObjectID;
      project.notifyStatusPageSubscribersOfNewIncidentsByDefault =
        notifiesByDefault;
      return project;
    }) as never);
    jest.spyOn(IncidentService, "create").mockImplementation((async (create: {
      data: Incident;
      miscDataProps?: JSONObject;
      props: DatabaseCommonInteractionProps;
    }) => {
      created.push({
        data: create.data,
        miscDataProps: create.miscDataProps,
        props: create.props,
      });

      const incident: Incident = new Incident();
      incident.id = CREATED_ID;
      incident.incidentNumber = 43;
      incident.incidentNumberWithPrefix = "INC-43";
      return incident;
    }) as never);
  });

  function turnContext(): TurnContext {
    return {
      activity: {
        type: "message",
        id: "submit-1",
        replyToId: "form-1",
        from: { id: "29:1jane", name: "Jane Doe", aadObjectId: "aad-jane" },
      },
      sendActivity: async (reply: unknown): Promise<{ id: string }> => {
        if (typeof reply === "string") {
          sent.push({ kind: "reply", text: reply });
        } else {
          const card: JSONObject = (
            (reply as JSONObject)["attachments"] as Array<JSONObject>
          )[0]!["content"] as JSONObject;
          sent.push({
            kind: "answer",
            text: String(bodyOf(card)[0]!["text"]),
          });
        }

        return { id: `reply-${sent.length}` };
      },
      deleteActivity: async (activityId: string): Promise<void> => {
        deleted.push(activityId);
      },
    } as unknown as TurnContext;
  }

  async function submit(value: JSONObject): Promise<void> {
    await MicrosoftTeamsIncidentActions.handleBotIncidentAction({
      actionType: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      actionValue: "",
      value: {
        action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
        incidentTitle: "Checkout is slow",
        incidentDescription: "Requests time out.",
        incidentSeverity: SEVERITY_ID,
        ...value,
      },
      projectId: PROJECT_ID,
      oneUptimeUserId: USER_ID,
      databaseProps: MEMBER_PROPS,
      turnContext: turnContext(),
    });
  }

  function ids(models: Array<DatabaseBaseModel> | undefined): Array<string> {
    return (models || []).map((model: DatabaseBaseModel): string => {
      return model.id!.toString();
    });
  }

  test("the picks, read again as whoever submits it, each in its kind's list; the confirmation says what it is linked to", async () => {
    await submit({
      affectedResources: `Host:${HOST_ID},Service:${SERVICE_ID}`,
    });

    // Teams' one string of picks, read as the member in the card's project.
    const read: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      picks: WorkspaceAffectedResourcePicks;
    } = readPickedSpy.mock.calls[0]![0] as never;
    expect(read.projectId).toBe(PROJECT_ID);
    expect(read.props).toBe(MEMBER_PROPS);
    expect(read.picks).toEqual({
      refs: [
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.Service, id: SERVICE_ID },
      ],
      leftOutCount: 0,
    });

    expect(created).toHaveLength(1);
    expect(ids(created[0]!.data.hosts)).toEqual([HOST_ID]);
    expect(ids(created[0]!.data.services)).toEqual([SERVICE_ID]);
    expect(created[0]!.props).toBe(MEMBER_PROPS);
    // No card names an alert: none is linked, none asked about.
    expect(created[0]!.miscDataProps).toBeUndefined();
    expect(checkLinkSpy).not.toHaveBeenCalled();

    expect(sent).toEqual([
      {
        kind: "reply",
        text: `✅ **Incident INC-43** created successfully. [View incident](${INCIDENT_LINK})\n\nLinked to **api-1** (Host) and **checkout** (Service).`,
      },
    ]);
    expect(deleted).toEqual(["form-1"]);
  });

  test("nothing picked: the confirmation as it always was", async () => {
    toLink = { linked: [], notLinkedCount: 0 };

    await submit({});

    expect(created[0]!.data.hosts).toBeUndefined();
    expect(sent).toEqual([
      {
        kind: "reply",
        text: `✅ **Incident INC-43** created successfully. [View incident](${INCIDENT_LINK})`,
      },
    ]);
  });

  test("a pick not linked: declared all the same, and a reply to whoever submitted it says so", async () => {
    toLink = { linked: [API_HOST], notLinkedCount: 1 };

    await submit({
      affectedResources: `Host:${HOST_ID},Host:${SERVICE_ID}`,
    });

    expect(created).toHaveLength(1);
    expect(sent).toEqual([
      {
        kind: "reply",
        text: `✅ **Incident INC-43** created successfully. [View incident](${INCIDENT_LINK})\n\nLinked to **api-1** (Host).`,
      },
      {
        kind: "answer",
        // It opens with words: the mention never runs into a link or a number.
        text: `<at>Jane Doe</at> The incident **[INC-43](${INCIDENT_LINK})** is not linked to 1 resource you picked: it was deleted or archived, or you may no longer view it.`,
      },
    ]);
  });

  test("declared from an alert's channel: linked to the alert, as one declared from it in the Dashboard, and the confirmation says so", async () => {
    await submit({
      affectedResources: `Host:${HOST_ID}`,
      declaredFrom: `alert:${ALERT_ID.toString()}`,
    });

    expect(checkLinkSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      props: MEMBER_PROPS,
    });
    expect(created[0]!.miscDataProps).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID.toString()],
    });
    expect(created[0]!.data.isPrivate).toBeUndefined();
    // The alert first, then the resources.
    expect(sent[0]!.text).toBe(
      `✅ **Incident INC-43** created successfully. [View incident](${INCIDENT_LINK})\n\nLinked to **[Alert ALT-3](${ALERT_LINK})**, **api-1** (Host) and **checkout** (Service).`,
    );
  });

  test("a private alert: the incident is private too", async () => {
    alertLink = { ...(alertLink as WorkspaceAlertToLink), isPrivate: true };

    await submit({ declaredFrom: `alert:${ALERT_ID.toString()}` });

    expect(created[0]!.data.isPrivate).toBe(true);
  });

  test("an alert they may not link: declared without it, and told why in a reply that mentions them", async () => {
    toLink = { linked: [], notLinkedCount: 0 };
    alertLink = {
      name: { label: "Alert ALT-3", link: ALERT_LINK },
      reason:
        "You do not have permission to link alerts to incidents in this project.",
      isPrivate: false,
    };

    await submit({ declaredFrom: `alert:${ALERT_ID.toString()}` });

    expect(created[0]!.miscDataProps).toBeUndefined();
    expect(created[0]!.data.isPrivate).toBeUndefined();
    expect(sent).toEqual([
      {
        kind: "reply",
        text: `✅ **Incident INC-43** created successfully. [View incident](${INCIDENT_LINK})`,
      },
      {
        kind: "answer",
        text: `<at>Jane Doe</at> The incident **[INC-43](${INCIDENT_LINK})** is not linked to **[Alert ALT-3](${ALERT_LINK})**. You do not have permission to link alerts to incidents in this project.`,
      },
    ]);
  });

  test("a private alert they may not link: declared without the link, private all the same - its title and resources never land in a public incident - and they are told", async () => {
    toLink = { linked: [], notLinkedCount: 0 };
    alertLink = {
      name: { label: "Alert ALT-3", link: ALERT_LINK },
      reason:
        "The alert is private, and none of your teams that own it may link it to an incident.",
      isPrivate: true,
    };

    await submit({ declaredFrom: `alert:${ALERT_ID.toString()}` });

    expect(created[0]!.miscDataProps).toBeUndefined();
    expect(created[0]!.data.isPrivate).toBe(true);
    expect(sent[1]).toEqual({
      kind: "answer",
      text: `<at>Jane Doe</at> The incident **[INC-43](${INCIDENT_LINK})** is not linked to **[Alert ALT-3](${ALERT_LINK})**. The alert is private, and none of your teams that own it may link it to an incident. Like the alert, it is private.`,
    });
  });

  test("a value that names no alert is no alert: nothing is asked about one", async () => {
    await submit({ declaredFrom: "C0OPS" });

    expect(checkLinkSpy).not.toHaveBeenCalled();
    expect(created[0]!.miscDataProps).toBeUndefined();
  });

  test("a submit missing its title is refused before anything is read", async () => {
    await submit({ incidentTitle: "  " });

    expect(readPickedSpy).not.toHaveBeenCalled();
    expect(created).toEqual([]);
    expect(projectReads).toEqual([]);
  });

  /*
   * The card asks nothing about status page subscribers. Where the project
   * starts Notify Status Page Subscribers unticked on Declare New Incident,
   * an incident declared here tells them nothing either; anywhere else it is
   * declared exactly as before, the column not written at all.
   */
  describe("status page subscribers, as the project starts Notify Status Page Subscribers", () => {
    test("a project that starts the box unticked: declared without notifying them, the project read as OneUptime for that one column", async () => {
      notifiesByDefault = false;

      await submit({});

      expect(created).toHaveLength(1);
      expect(
        created[0]!.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ).toBe(false);
      // Still declared as the member, and confirmed as always.
      expect(created[0]!.props).toBe(MEMBER_PROPS);
      expect(sent).toEqual([
        {
          kind: "reply",
          text: `✅ **Incident INC-43** created successfully. [View incident](${INCIDENT_LINK})\n\nLinked to **api-1** (Host) and **checkout** (Service).`,
        },
      ]);
      expect(projectReads).toEqual([
        {
          id: PROJECT_ID,
          select: { notifyStatusPageSubscribersOfNewIncidentsByDefault: true },
          props: { isRoot: true },
        },
      ]);
    });

    test("a project that keeps it on: declared as always - the column is not written, so the incident notifies them", async () => {
      await submit({});

      expect(
        created[0]!.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ).toBeUndefined();
      expect(projectReads).toHaveLength(1);
    });

    test("a project that cannot be read: declared all the same, as always", async () => {
      jest.spyOn(logger, "warn").mockImplementation((): void => {});
      jest
        .spyOn(ProjectService, "findOneById")
        .mockImplementation((async () => {
          throw new Error("the database is not connected");
        }) as never);

      await submit({});

      expect(created).toHaveLength(1);
      expect(
        created[0]!.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ).toBeUndefined();
      expect(sent).toHaveLength(1);
    });

    test("declared from a private alert in a project that starts it unticked: private, and not notifying", async () => {
      notifiesByDefault = false;
      alertLink = { ...(alertLink as WorkspaceAlertToLink), isPrivate: true };

      await submit({ declaredFrom: `alert:${ALERT_ID.toString()}` });

      expect(created[0]!.data.isPrivate).toBe(true);
      expect(
        created[0]!.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ).toBe(false);
    });
  });
});
