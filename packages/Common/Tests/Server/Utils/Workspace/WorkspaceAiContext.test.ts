import WorkspaceAiContext from "../../../../Server/Utils/Workspace/WorkspaceAiContext";
import WorkspacePageAbout from "../../../../Server/Utils/Workspace/WorkspacePageAbout";
import { ObservabilityChatApp } from "../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import { OnCallPageRecordType } from "../../../../Server/Services/OnCallPageService";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import URL from "../../../../Types/API/URL";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT ONEUPTIME AI KNOWS ABOUT WHERE A CHAT QUESTION IS ASKED (#5315's
 * and #5409's follow-ups).
 *
 *   - The chat app's ways to act, as its help types them - "/oneuptime
 *     incident" in Slack (or the command the workspace runs OneUptime
 *     with), "incident" typed to the Microsoft Teams bot, mentioned first
 *     in a channel - and Ask AI in the Dashboard, by its link.
 *   - The incident or alert whose own channel a question was asked in, read
 *     as the person who asked: one they may not read, a channel that is no
 *     record's, or a read that fails is no context at all - never an error.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const RECORD_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
const PROPS: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: PROJECT_ID,
};

beforeEach(() => {
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));
  jest.spyOn(ProductBrandingText, "getProductName").mockReturnValue("OneUptime");
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the chat app's ways to act", () => {
  test("Slack: /oneuptime's commands, and Ask AI in the Dashboard by its link", async () => {
    const app: ObservabilityChatApp = await WorkspaceAiContext.getChatApp({
      workspaceType: WorkspaceType.Slack,
      projectId: PROJECT_ID,
    });

    expect(app).toEqual({
      name: "Slack",
      incidentCommand: "/oneuptime incident",
      pageCommand: "/oneuptime page",
      askAiUrl: `${DASHBOARD_URL}/${PROJECT_ID.toString()}/ai/chat`,
    });
  });

  test("Slack, in a workspace that runs OneUptime with a command of its own", async () => {
    const app: ObservabilityChatApp = await WorkspaceAiContext.getChatApp({
      workspaceType: WorkspaceType.Slack,
      projectId: PROJECT_ID,
      slackCommand: "/irm",
    });

    expect(app.incidentCommand).toBe("/irm incident");
    expect(app.pageCommand).toBe("/irm page");
  });

  test("Microsoft Teams: the words typed to the bot, and how to reach it in a channel", async () => {
    const named: ObservabilityChatApp = await WorkspaceAiContext.getChatApp({
      workspaceType: WorkspaceType.MicrosoftTeams,
      projectId: PROJECT_ID,
      botName: "OneUptime",
    });

    expect(named).toEqual({
      name: "Microsoft Teams",
      incidentCommand: "incident",
      pageCommand: "page",
      commandNote:
        "typed to the OneUptime bot; in a channel or a group chat, mention @OneUptime first",
      askAiUrl: `${DASHBOARD_URL}/${PROJECT_ID.toString()}/ai/chat`,
    });

    const unnamed: ObservabilityChatApp = await WorkspaceAiContext.getChatApp(
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        projectId: PROJECT_ID,
      },
    );

    expect(unnamed.commandNote).toBe(
      "typed to the OneUptime bot; in a channel or a group chat, mention it first",
    );
  });

  test("an installation renamed by its licence says its own name", async () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    const app: ObservabilityChatApp = await WorkspaceAiContext.getChatApp({
      workspaceType: WorkspaceType.MicrosoftTeams,
      projectId: PROJECT_ID,
      botName: "Acme Ops",
    });

    expect(app.commandNote).toBe(
      "typed to the Acme Ops bot; in a channel or a group chat, mention @Acme Ops first",
    );
  });
});

describe("the record of the channel a question was asked in", () => {
  function theChannelIs(
    record: { type: OnCallPageRecordType; id: ObjectID } | null,
  ): ReturnType<typeof jest.spyOn> {
    return jest
      .spyOn(WorkspacePageAbout, "findChannelRecord")
      .mockResolvedValue(record);
  }

  test("an incident's own channel: the incident by its number and title, read as the person", async () => {
    const lookup: ReturnType<typeof jest.spyOn> = theChannelIs({
      type: OnCallPageRecordType.Incident,
      id: RECORD_ID,
    });
    const incident: Incident = new Incident();
    incident._id = RECORD_ID.toString();
    incident.title = "  Checkout is down ";
    incident.incidentNumber = 42;
    incident.incidentNumberWithPrefix = "INC-42";
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);

    const context: AIChatPageContext | undefined =
      await WorkspaceAiContext.getChannelRecord({
        projectId: PROJECT_ID,
        channelId: "C0INC42",
        props: PROPS,
      });

    expect(lookup).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      channelId: "C0INC42",
    });
    expect(context).toEqual({
      type: AIChatPageContextType.Incident,
      entityId: RECORD_ID.toString(),
      entityTitle: "INC-42 Checkout is down",
    });

    const readWith: { id: ObjectID; props: unknown } = read.mock
      .calls[0]![0] as { id: ObjectID; props: unknown };
    expect(readWith.id).toEqual(RECORD_ID);
    expect(readWith.props).toBe(PROPS);
  });

  test("an alert's own channel: the alert, by #number without a prefix", async () => {
    theChannelIs({ type: OnCallPageRecordType.Alert, id: RECORD_ID });
    const alert: Alert = new Alert();
    alert._id = RECORD_ID.toString();
    alert.title = "High memory on test01";
    alert.alertNumber = 7;
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert as never);

    expect(
      await WorkspaceAiContext.getChannelRecord({
        projectId: PROJECT_ID,
        channelId: "C0ALT7",
        props: PROPS,
      }),
    ).toEqual({
      type: AIChatPageContextType.Alert,
      entityId: RECORD_ID.toString(),
      entityTitle: "#7 High memory on test01",
    });
  });

  test("a record with no number yet is named by its title alone", async () => {
    theChannelIs({ type: OnCallPageRecordType.Alert, id: RECORD_ID });
    const alert: Alert = new Alert();
    alert._id = RECORD_ID.toString();
    alert.title = "High memory on test01";
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert as never);

    expect(
      (
        await WorkspaceAiContext.getChannelRecord({
          projectId: PROJECT_ID,
          channelId: "C0ALT7",
          props: PROPS,
        })
      )?.entityTitle,
    ).toBe("High memory on test01");
  });

  test("a record the person may not read is no context: the model is never told of it", async () => {
    theChannelIs({ type: OnCallPageRecordType.Incident, id: RECORD_ID });
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    expect(
      await WorkspaceAiContext.getChannelRecord({
        projectId: PROJECT_ID,
        channelId: "C0INC42",
        props: PROPS,
      }),
    ).toBeUndefined();
  });

  test("a channel that is no record's own is no context, and nothing more is read", async () => {
    theChannelIs(null);
    const incidentRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      IncidentService,
      "findOneById",
    );
    const alertRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AlertService,
      "findOneById",
    );

    expect(
      await WorkspaceAiContext.getChannelRecord({
        projectId: PROJECT_ID,
        channelId: "C0OPS",
        props: PROPS,
      }),
    ).toBeUndefined();
    expect(incidentRead).not.toHaveBeenCalled();
    expect(alertRead).not.toHaveBeenCalled();
  });

  test("no channel at all - a direct message, a chat - is no context, and nothing is looked up", async () => {
    const lookup: ReturnType<typeof jest.spyOn> = jest.spyOn(
      WorkspacePageAbout,
      "findChannelRecord",
    );

    for (const channelId of [undefined, "", "  "]) {
      expect(
        await WorkspaceAiContext.getChannelRecord({
          projectId: PROJECT_ID,
          channelId,
          props: PROPS,
        }),
      ).toBeUndefined();
    }

    expect(lookup).not.toHaveBeenCalled();
  });

  test("a read that fails is no context, never an error between the person and the answer", async () => {
    theChannelIs({ type: OnCallPageRecordType.Incident, id: RECORD_ID });
    jest
      .spyOn(IncidentService, "findOneById")
      .mockRejectedValue(new Error("Database not connected") as never);

    await expect(
      WorkspaceAiContext.getChannelRecord({
        projectId: PROJECT_ID,
        channelId: "C0INC42",
        props: PROPS,
      }),
    ).resolves.toBeUndefined();

    jest
      .spyOn(WorkspacePageAbout, "findChannelRecord")
      .mockRejectedValue(new Error("lookup failed") as never);

    await expect(
      WorkspaceAiContext.getChannelRecord({
        projectId: PROJECT_ID,
        channelId: "C0INC42",
        props: PROPS,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("the chat apps by their names", () => {
  test("Slack and Microsoft Teams", () => {
    expect(WorkspaceAiContext.getChatAppName(WorkspaceType.Slack)).toBe(
      "Slack",
    );
    expect(
      WorkspaceAiContext.getChatAppName(WorkspaceType.MicrosoftTeams),
    ).toBe("Microsoft Teams");
  });
});
