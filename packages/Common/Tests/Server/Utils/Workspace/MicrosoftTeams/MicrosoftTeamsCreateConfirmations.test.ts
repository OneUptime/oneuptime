import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: { text: jest.fn(), attachment: jest.fn() },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: { getMembers: jest.fn(), getPagedMembers: jest.fn() },
  };
});

jest.mock("../../../../../Server/Utils/Logger");

import type { SpyInstance } from "jest-mock";
import MicrosoftTeamsIncidentActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackActionAuthorization from "../../../../../Server/Utils/Workspace/Slack/Actions/Authorization";
import SlackScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import { WorkspacePayloadMarkdown } from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT A MICROSOFT TEAMS CREATE IS CONFIRMED WITH.
 *
 * Teams' confirmations named no incident ("✅ Incident created successfully!")
 * and showed the incident's address itself ("View incident: https://..."),
 * which ran past a phone's screen. They now name the record by its number,
 * as Slack's do - "✅ Incident INC-43 created successfully." - with "View
 * incident" as words that link, and the same for a maintenance event.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "f9000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("f9000000-0000-4000-8000-0000000000a1");
const INCIDENT_ID: ObjectID = new ObjectID(
  "f9000000-0000-4000-8000-0000000000e1",
);
const EVENT_ID: ObjectID = new ObjectID("f9000000-0000-4000-8000-0000000000e2");
const INCIDENT_LINK: string = `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;
const EVENT_LINK: string = `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/scheduled-maintenance-events/${EVENT_ID.toString()}`;

beforeEach(() => {
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString(INCIDENT_LINK));
  jest
    .spyOn(
      ScheduledMaintenanceService,
      "getScheduledMaintenanceLinkInDashboard",
    )
    .mockResolvedValue(URL.fromString(EVENT_LINK));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an incident created", () => {
  test("named by its number, as Slack names it, with 'View incident' as words that link", async () => {
    expect(
      await MicrosoftTeamsIncidentActions.getIncidentCreatedMessage({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        incidentNumber: "INC-43",
      }),
    ).toBe(
      `✅ **Incident INC-43** created successfully. [View incident](${INCIDENT_LINK})`,
    );
  });

  test("the address is never the text a phone has to fit", async () => {
    const said: string =
      await MicrosoftTeamsIncidentActions.getIncidentCreatedMessage({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        incidentNumber: "INC-43",
      });

    expect(said).not.toContain(`View incident: ${INCIDENT_LINK}`);
    expect(said.split(INCIDENT_LINK)).toHaveLength(2);
    expect(said).toContain(`](${INCIDENT_LINK})`);
  });

  test("what it is linked to, on a line of its own after it", async () => {
    expect(
      await MicrosoftTeamsIncidentActions.getIncidentCreatedMessage({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        incidentNumber: "INC-43",
        linkedLine: mdText`Linked to **api-1** (Host).`,
      }),
    ).toBe(
      `✅ **Incident INC-43** created successfully. [View incident](${INCIDENT_LINK})\n\nLinked to **api-1** (Host).`,
    );
  });

  test("no number to name it by: created, with its link", async () => {
    for (const incidentNumber of [undefined, null, ""]) {
      expect(
        await MicrosoftTeamsIncidentActions.getIncidentCreatedMessage({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
          incidentNumber: incidentNumber,
        }),
      ).toBe(
        `✅ Incident created successfully. [View incident](${INCIDENT_LINK})`,
      );
    }
  });

  test("no link to it - no id, or none can be built: named, and nothing else", async () => {
    expect(
      await MicrosoftTeamsIncidentActions.getIncidentCreatedMessage({
        projectId: PROJECT_ID,
        incidentNumber: "INC-43",
      }),
    ).toBe("✅ **Incident INC-43** created successfully.");

    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockRejectedValue(new Error("no dashboard address"));

    expect(
      await MicrosoftTeamsIncidentActions.getIncidentCreatedMessage({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        incidentNumber: "INC-43",
      }),
    ).toBe("✅ **Incident INC-43** created successfully.");
  });

  test("a number prefix is text: Markdown in it is shown, never read", async () => {
    const said: string =
      await MicrosoftTeamsIncidentActions.getIncidentCreatedMessage({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        incidentNumber: "*OPS_INC*-7",
      });

    expect(said).toBe(
      `✅ **Incident ${mdText`${"*OPS_INC*-7"}`.toString()}** created successfully. [View incident](${INCIDENT_LINK})`,
    );
    expect(said).not.toContain("**Incident *OPS_INC*-7**");
  });
});

describe("a maintenance event created", () => {
  function event(data: {
    prefixed?: string | undefined;
    number?: number | undefined;
    id?: ObjectID | undefined;
  }): ScheduledMaintenance {
    const created: ScheduledMaintenance = new ScheduledMaintenance();

    if (data.id) {
      created.id = data.id;
    }

    created.projectId = PROJECT_ID;

    if (data.prefixed) {
      created.scheduledMaintenanceNumberWithPrefix = data.prefixed;
    }

    if (data.number !== undefined) {
      created.scheduledMaintenanceNumber = data.number;
    }

    return created;
  }

  async function confirmed(created: ScheduledMaintenance): Promise<string> {
    return await MicrosoftTeamsScheduledMaintenanceActions.getScheduledMaintenanceCreatedMessage(
      {
        scheduledMaintenance: created,
        projectId: PROJECT_ID,
        startsAt: new Date("2026-11-08T22:00:00.000Z"),
        endsAt: new Date("2026-11-09T01:00:00.000Z"),
        timezone: { timezone: "Europe/London", label: "Europe/London" },
      },
    );
  }

  test("named by its number, when it starts and ends, and 'View maintenance event' as words that link", async () => {
    expect(
      await confirmed(event({ prefixed: "SM-7", number: 7, id: EVENT_ID })),
    ).toBe(
      `✅ **Maintenance Event SM-7** created successfully.\n\n**Starts:** Nov 8, 2026, 22:00 (Europe/London)\n\n**Ends:** Nov 9, 2026, 01:00 (Europe/London)\n\n[View maintenance event](${EVENT_LINK})`,
    );
  });

  test("a number without the project's prefix reads '#7'; none, no number", async () => {
    expect(await confirmed(event({ number: 7, id: EVENT_ID }))).toContain(
      "✅ **Maintenance Event #7** created successfully.",
    );
    expect(await confirmed(event({ id: EVENT_ID }))).toContain(
      "✅ Maintenance event created successfully.",
    );
  });

  test("no id: no link, and no address anywhere", async () => {
    const said: string = await confirmed(event({ prefixed: "SM-7" }));

    expect(said).not.toContain("View maintenance event");
    expect(said).not.toContain("https://");
  });

  /*
   * Slack's confirmation of the same event, from Slack's own create: the
   * two name it with the same words. Teams' said "Scheduled maintenance
   * SM-7" where Slack's said "Maintenance Event SM-7" (#7822).
   */
  async function slackConfirmed(
    created: ScheduledMaintenance,
  ): Promise<string> {
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {});
    jest
      .spyOn(SlackActionAuthorization, "authorize")
      .mockResolvedValue({ userId: USER_ID, tenantId: PROJECT_ID });
    jest
      .spyOn(ScheduledMaintenanceService, "create")
      .mockResolvedValue(created);
    const sent: SpyInstance<typeof SlackUtil.sendMessage> = jest
      .spyOn(SlackUtil, "sendMessage")
      .mockResolvedValue({ threads: [], workspaceType: WorkspaceType.Slack });

    await SlackScheduledMaintenanceActions.submitNewScheduledMaintenance({
      slackRequest: {
        isAuthorized: true,
        userId: USER_ID,
        projectId: PROJECT_ID,
        projectAuthToken: "xoxb-project",
        botUserId: "B123",
        slackUserId: "U0MEMBER",
        slackUsername: "someone",
        viewValues: {
          scheduledMaintenanceTitle: "Database upgrade",
          scheduledMaintenanceDescription: "Upgrading the primary",
          startDate: "2099-01-01T10:00:00.000Z",
          endDate: "2099-01-01T11:00:00.000Z",
        },
      },
      // Opened in a channel: confirmed there.
      action: {
        actionType: SlackActionType.SubmitNewScheduledMaintenance,
        actionValue: "C0OPS",
      },
      req: {} as ExpressRequest,
      res: {} as ExpressResponse,
    });

    expect(sent).toHaveBeenCalledTimes(1);

    return (
      sent.mock.calls[0]![0].workspaceMessagePayload
        .messageBlocks[0] as WorkspacePayloadMarkdown
    ).text;
  }

  // The record as a confirmation names it: "**<name>** created successfully."
  const NAMED_AS: RegExp = /\*\*([^*]+)\*\* created successfully\./;

  function nameIn(confirmation: string): string | undefined {
    return NAMED_AS.exec(confirmation)?.[1];
  }

  test.each<[string, { prefixed?: string; number: number }]>([
    ["SM-7", { prefixed: "SM-7", number: 7 }],
    ["#7", { number: 7 }],
  ])(
    "Slack and Microsoft Teams name it alike: Maintenance Event %s",
    async (
      number: string,
      numbering: { prefixed?: string; number: number },
    ) => {
      const created: ScheduledMaintenance = event({
        ...numbering,
        id: EVENT_ID,
      });

      const slack: string = await slackConfirmed(created);
      const teams: string = await confirmed(created);

      expect(nameIn(slack)).toBe(`Maintenance Event ${number}`);
      expect(nameIn(teams)).toBe(nameIn(slack));
    },
  );

  test("Slack and Microsoft Teams name it alike with no number: 'Maintenance event created successfully.'", async () => {
    const created: ScheduledMaintenance = event({ id: EVENT_ID });

    expect(await slackConfirmed(created)).toMatch(
      /^Maintenance event created successfully\. /,
    );
    expect(await confirmed(created)).toMatch(
      /^✅ Maintenance event created successfully\.\n/,
    );
  });
});
