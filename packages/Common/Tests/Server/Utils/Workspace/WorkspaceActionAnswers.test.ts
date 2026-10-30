import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import UserService from "../../../../Server/Services/UserService";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
  WorkspaceLatePress,
} from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import {
  WorkspaceConnectButton,
  WorkspaceConnectRequestAgain,
  WorkspaceConnectRequestAgainKind,
  WorkspacePendingActionKind,
} from "../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import User from "../../../../Models/DatabaseModels/User";
import URL from "../../../../Types/API/URL";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";

/*
 * WHAT A BUTTON IN SLACK OR MICROSOFT TEAMS ANSWERS - WORD FOR WORD.
 *
 * Customer feedback #1: somebody without a connected account pressed
 * Acknowledge and was told, in a direct message they never saw,
 * "unfortunately you cannot acknowledge the Incident INC-2. It has already
 * been acknowledged." and, twice, "Unfortunately your slack account is not
 * connected to OneUptime. Please log into your OneUptime account, click on
 * User Settings and then connect your Slack account."
 *
 * These pin the words that replace them, in both chats: the Connect prompt
 * (what was pressed, and what happens once connected), who got there first
 * and when, and what a press finished after connecting says - plain, short,
 * with no "unfortunately", in the product's own name.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "d0000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "d0000000-0000-4000-8000-000000000002",
);
const SIMON: ObjectID = new ObjectID("d0000000-0000-4000-8000-000000000003");
const JANE: ObjectID = new ObjectID("d0000000-0000-4000-8000-000000000004");

const INCIDENT_LINK: string = `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;

function state<T extends IncidentState | AlertState>(
  model: T,
  data: {
    id: string;
    order: number;
    created?: boolean;
    acknowledged?: boolean;
    resolved?: boolean;
  },
): T {
  model.id = new ObjectID(data.id);
  model.projectId = PROJECT_ID;
  model.name = data.id;
  model.order = data.order;
  model.isCreatedState = Boolean(data.created);
  model.isAcknowledgedState = Boolean(data.acknowledged);
  model.isResolvedState = Boolean(data.resolved);
  return model;
}

const CREATED: string = "d0000000-0000-4000-8000-0000000000a1";
const ACKNOWLEDGED: string = "d0000000-0000-4000-8000-0000000000a2";
const INVESTIGATING: string = "d0000000-0000-4000-8000-0000000000a3";
const RESOLVED: string = "d0000000-0000-4000-8000-0000000000a4";

function incidentStates(): Array<IncidentState> {
  return [
    state(new IncidentState(), { id: CREATED, order: 1, created: true }),
    state(new IncidentState(), {
      id: ACKNOWLEDGED,
      order: 2,
      acknowledged: true,
    }),
    state(new IncidentState(), { id: INVESTIGATING, order: 3 }),
    state(new IncidentState(), { id: RESOLVED, order: 4, resolved: true }),
  ];
}

function incident(currentStateId: string): WorkspaceEventRecord {
  return {
    type: WorkspaceEventType.Incident,
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    currentStateId: new ObjectID(currentStateId),
    number: 2,
    numberWithPrefix: "INC-2",
  };
}

function incidentRow(
  stateId: string,
  startsAt: string,
  createdByUserId?: ObjectID,
): IncidentStateTimeline {
  const row: IncidentStateTimeline = new IncidentStateTimeline();
  row.incidentStateId = new ObjectID(stateId);
  row.startsAt = new Date(startsAt);

  if (createdByUserId) {
    row.createdByUserId = createdByUserId;
  }

  return row;
}

function user(name: string, email?: string): User {
  const found: User = new User();
  found.name = new Name(name);

  if (email) {
    found.email = email as any;
  }

  return found;
}

function useUsers(byId: Map<string, User>): void {
  jest.spyOn(UserService, "findOneBy").mockImplementation((async (data: {
    query: { _id: ObjectID };
  }) => {
    return byId.get(data.query._id.toString()) || null;
  }) as never);
}

beforeEach(() => {
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString(INCIDENT_LINK));
  jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockResolvedValue(incidentStates());
  useUsers(
    new Map<string, User>([
      [SIMON.toString(), user("Simon Lee")],
      [JANE.toString(), user("**Jane** [Doe](https://evil.test)")],
    ]),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Connect prompt", () => {
  test("for a press OneUptime finishes: what was pressed, and that it happens once connected", () => {
    const answer: WorkspaceAnswer = WorkspaceActionAnswers.getConnectPrompt({
      workspaceType: WorkspaceType.Slack,
      purpose: "acknowledge this incident",
      pendingAction: { kind: WorkspacePendingActionKind.Acknowledge },
    });

    expect(answer).toEqual({
      markdown:
        "🔗 **Connect your Slack account to acknowledge this incident.** It takes one click, and OneUptime acknowledges it for you as soon as you're connected.",
      text: "Connect your Slack account to acknowledge this incident",
    });
  });

  test.each([
    [WorkspacePendingActionKind.Resolve, "resolves it"],
    [WorkspacePendingActionKind.MarkAsOngoing, "marks it as ongoing"],
    [WorkspacePendingActionKind.MarkAsComplete, "marks it as complete"],
    // A pin saves the message it is on.
    [WorkspacePendingActionKind.SavePrivateNote, "saves it"],
    [WorkspacePendingActionKind.SavePublicNote, "saves it"],
  ])(
    "%s promises what it does",
    (kind: WorkspacePendingActionKind, phrase: string) => {
      expect(
        WorkspaceActionAnswers.getConnectPrompt({
          workspaceType: WorkspaceType.Slack,
          purpose: "do it",
          pendingAction: { kind: kind },
        }).markdown,
      ).toBe(
        `🔗 **Connect your Slack account to do it.** It takes one click, and OneUptime ${phrase} for you as soon as you're connected.`,
      );
    },
  );

  test("for a button that opens a form: press it again once connected", () => {
    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.Slack,
        purpose: "add a note to this incident",
        again: {
          kind: WorkspaceConnectRequestAgainKind.Button,
          label: "Add Note",
        },
      }),
    ).toEqual({
      markdown:
        "🔗 **Connect your Slack account to add a note to this incident.** It takes one click. Then press **Add Note** again.",
      text: "Connect your Slack account to add a note to this incident",
    });
  });

  test("for an item of a message's menu (⋯): choose it from the menu again - there is no button of that name to press", () => {
    const again: WorkspaceConnectRequestAgain = {
      kind: WorkspaceConnectRequestAgainKind.MenuItem,
      label: "Change Severity",
    };

    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.Slack,
        purpose: "change the severity of this incident",
        again: again,
      }),
    ).toEqual({
      markdown:
        "🔗 **Connect your Slack account to change the severity of this incident.** It takes one click. Then choose **Change Severity** from the menu again.",
      text: "Connect your Slack account to change the severity of this incident",
    });

    expect(
      WorkspaceActionAnswers.getConnectedAnswer({
        workspaceType: WorkspaceType.MicrosoftTeams,
        again: again,
      }),
    ).toEqual({
      markdown:
        "✅ **Your Microsoft Teams account is connected to OneUptime.** Now choose **Change Severity** from the menu again.",
      text: "Your Microsoft Teams account is connected to OneUptime. Now choose Change Severity from the menu again.",
    });
  });

  test("for a command: run it again", () => {
    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.Slack,
        purpose: "declare an incident",
        again: {
          kind: WorkspaceConnectRequestAgainKind.Command,
          label: "/incident",
        },
      }).markdown,
    ).toBe(
      "🔗 **Connect your Slack account to declare an incident.** It takes one click. Then run **/incident** again.",
    );
  });

  test("in Microsoft Teams a command is typed to the bot, not run", () => {
    const again: WorkspaceConnectRequestAgain = {
      kind: WorkspaceConnectRequestAgainKind.Command,
      label: "create incident",
    };

    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.MicrosoftTeams,
        purpose: "declare an incident",
        again: again,
      }).markdown,
    ).toBe(
      "🔗 **Connect your Microsoft Teams account to declare an incident.** It takes one click. Then type **create incident** again.",
    );

    expect(
      WorkspaceActionAnswers.getConnectedAnswer({
        workspaceType: WorkspaceType.MicrosoftTeams,
        again: again,
      }),
    ).toEqual({
      markdown:
        "✅ **Your Microsoft Teams account is connected to OneUptime.** Now type **create incident** again.",
      text: "Your Microsoft Teams account is connected to OneUptime. Now type create incident again.",
    });

    // A Slack command is still run: it is a slash command.
    expect(
      WorkspaceActionAnswers.getConnectedAnswer({
        workspaceType: WorkspaceType.Slack,
        again: {
          kind: WorkspaceConnectRequestAgainKind.Command,
          label: "/incident",
        },
      }).text,
    ).toBe(
      "Your Slack account is connected to OneUptime. Now run /incident again.",
    );

    // Without a label, as without a workspace: "the command".
    expect(
      WorkspaceActionAnswers.getAgainText(
        { kind: WorkspaceConnectRequestAgainKind.Command },
        WorkspaceType.MicrosoftTeams,
      ),
    ).toBe("type the command again");
    expect(
      WorkspaceActionAnswers.getAgainText({
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: "/incident",
      }),
    ).toBe("run /incident again");
  });

  test("for a question to OneUptime AI: ask it again", () => {
    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.MicrosoftTeams,
        purpose: "ask OneUptime AI",
        again: { kind: WorkspaceConnectRequestAgainKind.Question },
      }).markdown,
    ).toBe(
      "🔗 **Connect your Microsoft Teams account to ask OneUptime AI.** It takes one click. Then ask your question again.",
    );
  });

  test("with nothing to finish or press again, it only asks to connect", () => {
    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.Slack,
        purpose: "use OneUptime from Slack",
      }).markdown,
    ).toBe(
      "🔗 **Connect your Slack account to use OneUptime from Slack.** It takes one click.",
    );
  });

  test("names the product as the installation does", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.Slack,
        purpose: "acknowledge this incident",
        pendingAction: { kind: WorkspacePendingActionKind.Acknowledge },
      }).markdown,
    ).toBe(
      "🔗 **Connect your Slack account to acknowledge this incident.** It takes one click, and Acme Ops acknowledges it for you as soon as you're connected.",
    );
  });

  test("when the press could not be kept, the button opens the settings page, and the press is made again", () => {
    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.Slack,
        purpose: "acknowledge this incident",
        pendingAction: { kind: WorkspacePendingActionKind.Acknowledge },
        button: WorkspaceConnectButton.SettingsPage,
      }),
    ).toEqual({
      markdown:
        "🔗 **Connect your Slack account to acknowledge this incident.** Once you're connected, press the button again.",
      text: "Connect your Slack account to acknowledge this incident",
    });

    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.MicrosoftTeams,
        purpose: "declare an incident",
        again: {
          kind: WorkspaceConnectRequestAgainKind.Command,
          label: "create incident",
        },
        button: WorkspaceConnectButton.SettingsPage,
      }).markdown,
    ).toBe(
      "🔗 **Connect your Microsoft Teams account to declare an incident.** Once you're connected, type **create incident** again.",
    );
  });

  test("with no address to link to, it says where the settings are, and to press again", () => {
    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.MicrosoftTeams,
        purpose: "acknowledge this incident",
        pendingAction: { kind: WorkspacePendingActionKind.Acknowledge },
        button: WorkspaceConnectButton.None,
      }),
    ).toEqual({
      markdown:
        "🔗 **Connect your Microsoft Teams account to acknowledge this incident.** In OneUptime, go to **User Settings → Workspace → Microsoft Teams** and press **Connect my account with Microsoft Teams**. Once you're connected, press the button again.",
      text: "Connect your Microsoft Teams account to acknowledge this incident",
    });

    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.Slack,
        purpose: "add a note to this incident",
        again: {
          kind: WorkspaceConnectRequestAgainKind.Button,
          label: "Add Note",
        },
        button: WorkspaceConnectButton.None,
      }).markdown,
    ).toBe(
      "🔗 **Connect your Slack account to add a note to this incident.** In OneUptime, go to **User Settings → Workspace → Slack** and press **Connect my account with Slack**. Once you're connected, press **Add Note** again.",
    );
  });

  test("never says 'unfortunately', and never sends anyone to find User Settings while a button can take them there", () => {
    const answers: Array<WorkspaceAnswer> = [
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.Slack,
        purpose: "acknowledge this incident",
        pendingAction: { kind: WorkspacePendingActionKind.Acknowledge },
      }),
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.MicrosoftTeams,
        purpose: "add a note to this alert",
        again: {
          kind: WorkspaceConnectRequestAgainKind.Button,
          label: "Add Note",
        },
      }),
    ];

    for (const answer of answers) {
      expect(answer.markdown.toLowerCase()).not.toContain("unfortunately");
      expect(answer.markdown).not.toContain("User Settings");
    }
  });

  /*
   * A workspace connected to more than one project: an account is connected
   * in each project on its own, so the prompt names the project - somebody
   * connected in the other one would otherwise be asked to connect an
   * account they connected.
   */
  test("in a workspace connected to several projects, names the project to connect in - in the ask and the notification", () => {
    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.Slack,
        purpose: "acknowledge this incident",
        pendingAction: { kind: WorkspacePendingActionKind.Acknowledge },
        projectName: "IRM Non-Prod",
      }),
    ).toEqual({
      markdown:
        "🔗 **Connect your Slack account in IRM Non-Prod to acknowledge this incident.** It takes one click, and OneUptime acknowledges it for you as soon as you're connected.",
      text: "Connect your Slack account in IRM Non-Prod to acknowledge this incident",
    });

    // Without a button too, and in Microsoft Teams.
    expect(
      WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.MicrosoftTeams,
        purpose: "see who is on call",
        again: {
          kind: WorkspaceConnectRequestAgainKind.Command,
          label: "oncall",
        },
        button: WorkspaceConnectButton.None,
        projectName: "Production",
      }).markdown,
    ).toBe(
      "🔗 **Connect your Microsoft Teams account in Production to see who is on call.** In OneUptime, go to **User Settings → Workspace → Microsoft Teams** and press **Connect my account with Microsoft Teams**. Once you're connected, type **oncall** again.",
    );
  });

  test("no project name - one project connected, or none read - asks as before; a blank one is no name", () => {
    for (const projectName of [undefined, null, "", "   "]) {
      expect(
        WorkspaceActionAnswers.getConnectPrompt({
          workspaceType: WorkspaceType.Slack,
          purpose: "acknowledge this incident",
          pendingAction: { kind: WorkspacePendingActionKind.Acknowledge },
          projectName: projectName,
        }).text,
      ).toBe("Connect your Slack account to acknowledge this incident");
    }
  });

  test("a project name is text in Markdown: it cannot close the bold, link or mention anyone", () => {
    const answer: WorkspaceAnswer = WorkspaceActionAnswers.getConnectPrompt({
      workspaceType: WorkspaceType.Slack,
      purpose: "acknowledge this incident",
      pendingAction: { kind: WorkspacePendingActionKind.Acknowledge },
      projectName: "Prod** [click](https://evil.example) <!channel>",
    });

    expect(answer.markdown).not.toContain("[click](https://evil.example)");
    expect(answer.markdown).not.toContain("<!channel>");
    expect(answer.markdown).not.toContain("Prod** ");
    // The notification is plain text, as typed.
    expect(answer.text).toContain(
      "Prod** [click](https://evil.example) <!channel>",
    );
  });

  test("the Connect button is named for the workspace", () => {
    expect(
      WorkspaceActionAnswers.getConnectButtonTitle(WorkspaceType.Slack),
    ).toBe("Connect Slack account");
    expect(
      WorkspaceActionAnswers.getConnectButtonTitle(
        WorkspaceType.MicrosoftTeams,
      ),
    ).toBe("Connect Microsoft Teams account");
  });
});

describe("what a press asks to be connected for", () => {
  test.each([
    [
      WorkspacePendingActionKind.Acknowledge,
      WorkspaceEventType.Incident,
      "acknowledge this incident",
    ],
    [
      WorkspacePendingActionKind.Resolve,
      WorkspaceEventType.Alert,
      "resolve this alert",
    ],
    [
      WorkspacePendingActionKind.Acknowledge,
      WorkspaceEventType.IncidentEpisode,
      "acknowledge this incident episode",
    ],
    [
      WorkspacePendingActionKind.Resolve,
      WorkspaceEventType.AlertEpisode,
      "resolve this alert episode",
    ],
    [
      WorkspacePendingActionKind.MarkAsOngoing,
      WorkspaceEventType.ScheduledMaintenance,
      "mark this scheduled maintenance event as ongoing",
    ],
    [
      WorkspacePendingActionKind.MarkAsComplete,
      WorkspaceEventType.ScheduledMaintenance,
      "mark this scheduled maintenance event as complete",
    ],
  ])(
    "%s on %s: %s",
    (
      kind: WorkspacePendingActionKind,
      eventType: WorkspaceEventType,
      purpose: string,
    ) => {
      expect(
        WorkspaceActionAnswers.getPendingActionPurpose({
          kind: kind,
          eventType: eventType,
        }),
      ).toBe(purpose);
    },
  );

  /*
   * A pinned message's prompt is not next to it - at the foot of the
   * channel in Slack, at the end of the thread in Microsoft Teams - so it
   * names the message by what the person did, never "this message".
   */
  test.each([
    [
      WorkspacePendingActionKind.SavePrivateNote,
      WorkspaceEventType.Incident,
      WorkspaceType.Slack,
      "save the message you pinned as a private note on this incident",
    ],
    [
      WorkspacePendingActionKind.SavePublicNote,
      WorkspaceEventType.ScheduledMaintenance,
      WorkspaceType.Slack,
      "save the message you reacted to as a public note on this scheduled maintenance event",
    ],
    [
      WorkspacePendingActionKind.SavePrivateNote,
      WorkspaceEventType.AlertEpisode,
      WorkspaceType.Slack,
      "save the message you pinned as a private note on this alert episode",
    ],
    [
      WorkspacePendingActionKind.SavePrivateNote,
      WorkspaceEventType.Incident,
      WorkspaceType.MicrosoftTeams,
      "save the message you reacted to as a private note on this incident",
    ],
    [
      WorkspacePendingActionKind.SavePublicNote,
      WorkspaceEventType.Incident,
      WorkspaceType.MicrosoftTeams,
      "save the message you reacted to as a public note on this incident",
    ],
  ])(
    "%s on %s in %s: %s",
    (
      kind: WorkspacePendingActionKind,
      eventType: WorkspaceEventType,
      workspaceType: WorkspaceType,
      purpose: string,
    ) => {
      const said: string = WorkspaceActionAnswers.getPendingActionPurpose({
        kind: kind,
        eventType: eventType,
        workspaceType: workspaceType,
      });

      expect(said).toBe(purpose);
      expect(said).not.toContain("this message");
    },
  );

  test("a pinned message's prompt without its chat still never says 'this message'", () => {
    expect(
      WorkspaceActionAnswers.getPendingActionPurpose({
        kind: WorkspacePendingActionKind.SavePrivateNote,
        eventType: WorkspaceEventType.Incident,
      }),
    ).toBe(
      "save the message you reacted to as a private note on this incident",
    );
  });

  /*
   * A private incident takes no public notes (Types/StatusPage/
   * PrivateRecordPublicNotes): a 📣 there is saved as a private note, and
   * the prompt to connect says so - never that it goes to the status page.
   */
  test.each([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams])(
    "a 📣 on a private incident, in %s: asked to save it as the private note it becomes",
    (workspaceType: WorkspaceType) => {
      expect(
        WorkspaceActionAnswers.getPendingActionPurpose({
          kind: WorkspacePendingActionKind.SavePublicNote,
          eventType: WorkspaceEventType.Incident,
          workspaceType: workspaceType,
          noteSavedAs: WorkspaceNoteType.Private,
        }),
      ).toBe(
        "save the message you reacted to as a private note on this incident",
      );
    },
  );

  test("a 📣 saved as it asks is a public note, as always; a pin is a private note whatever it is saved as", () => {
    expect(
      WorkspaceActionAnswers.getPendingActionPurpose({
        kind: WorkspacePendingActionKind.SavePublicNote,
        eventType: WorkspaceEventType.Incident,
        workspaceType: WorkspaceType.Slack,
        noteSavedAs: WorkspaceNoteType.Public,
      }),
    ).toBe("save the message you reacted to as a public note on this incident");
    expect(
      WorkspaceActionAnswers.getPendingActionPurpose({
        kind: WorkspacePendingActionKind.SavePrivateNote,
        eventType: WorkspaceEventType.Incident,
        workspaceType: WorkspaceType.Slack,
        noteSavedAs: WorkspaceNoteType.Private,
      }),
    ).toBe("save the message you pinned as a private note on this incident");
  });
});

describe("a press that comes too late says who got there first, and when", () => {
  test("acknowledged by Simon at 6:07 PM - each reader sees it in their own time", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(CREATED, "2026-10-08T17:58:00.000Z"),
        incidentRow(ACKNOWLEDGED, "2026-10-08T18:07:00.000Z", SIMON),
      ]);

    const answer: WorkspaceAnswer =
      await WorkspaceActionAnswers.getAlreadyAnswer({
        event: incident(ACKNOWLEDGED),
        press: WorkspaceLatePress.Acknowledge,
      });

    expect(answer).toEqual({
      markdown: `✅ **[Incident INC-2](${INCIDENT_LINK})** was already acknowledged by **Simon Lee** at {{TIME(2026-10-08T18:07:00Z)}}.`,
      text: "Incident INC-2 was already acknowledged by Simon Lee",
    });
  });

  test("reads the record's own timeline, oldest first, in its project", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([]);

    await WorkspaceActionAnswers.getAlreadyAnswer({
      event: incident(ACKNOWLEDGED),
      press: WorkspaceLatePress.Acknowledge,
    });

    expect(findBy).toHaveBeenCalledTimes(1);
    const call: any = findBy.mock.calls[0]![0];
    expect(call.query.incidentId.toString()).toBe(INCIDENT_ID.toString());
    expect(call.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.sort).toEqual({ startsAt: "ASC" });
  });

  test("a state of the project's own after Acknowledged is acknowledged too: who took it there", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(CREATED, "2026-10-08T17:58:00.000Z"),
        incidentRow(INVESTIGATING, "2026-10-08T18:01:00.000Z", SIMON),
      ]);

    expect(
      (
        await WorkspaceActionAnswers.getAlreadyAnswer({
          event: incident(INVESTIGATING),
          press: WorkspaceLatePress.Acknowledge,
        })
      ).markdown,
    ).toBe(
      `✅ **[Incident INC-2](${INCIDENT_LINK})** was already acknowledged by **Simon Lee** at {{TIME(2026-10-08T18:01:00Z)}}.`,
    );
  });

  test("Acknowledge on a resolved incident says it is resolved - by whom and when", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(CREATED, "2026-10-08T17:58:00.000Z"),
        incidentRow(ACKNOWLEDGED, "2026-10-08T18:07:00.000Z", SIMON),
        incidentRow(RESOLVED, "2026-10-08T18:20:00.000Z", JANE),
      ]);

    const answer: WorkspaceAnswer =
      await WorkspaceActionAnswers.getAlreadyAnswer({
        event: incident(RESOLVED),
        press: WorkspaceLatePress.Acknowledge,
      });

    // Jane's name is text: what she typed, never bold, a link or a mention.
    expect(answer.markdown).toBe(
      `✅ **[Incident INC-2](${INCIDENT_LINK})** was already resolved by **\\*\\*Jane\\*\\* \\[Doe\\](https://evil.test)** at {{TIME(2026-10-08T18:20:00Z)}}.`,
    );
    expect(answer.text).toBe(
      "Incident INC-2 was already resolved by **Jane** [Doe](https://evil.test)",
    );
  });

  test("a record reopened and acknowledged again names the latest acknowledgement", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(CREATED, "2026-10-08T17:00:00.000Z"),
        incidentRow(ACKNOWLEDGED, "2026-10-08T17:10:00.000Z", JANE),
        incidentRow(CREATED, "2026-10-08T17:20:00.000Z"),
        incidentRow(ACKNOWLEDGED, "2026-10-08T17:30:00.000Z", SIMON),
      ]);

    expect(
      (
        await WorkspaceActionAnswers.getAlreadyAnswer({
          event: incident(ACKNOWLEDGED),
          press: WorkspaceLatePress.Acknowledge,
        })
      ).markdown,
    ).toBe(
      `✅ **[Incident INC-2](${INCIDENT_LINK})** was already acknowledged by **Simon Lee** at {{TIME(2026-10-08T17:30:00Z)}}.`,
    );
  });

  test("a change nobody made by hand - a monitor, a workflow - says when, not who", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(CREATED, "2026-10-08T17:58:00.000Z"),
        incidentRow(RESOLVED, "2026-10-08T18:03:00.000Z"),
      ]);

    expect(
      await WorkspaceActionAnswers.getAlreadyAnswer({
        event: incident(RESOLVED),
        press: WorkspaceLatePress.Resolve,
      }),
    ).toEqual({
      markdown: `✅ **[Incident INC-2](${INCIDENT_LINK})** was already resolved at {{TIME(2026-10-08T18:03:00Z)}}.`,
      text: "Incident INC-2 was already resolved",
    });
  });

  test("a person who cannot be read any more is left out, the moment kept", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(
          ACKNOWLEDGED,
          "2026-10-08T18:07:00.000Z",
          ObjectID.generate(),
        ),
      ]);

    expect(
      (
        await WorkspaceActionAnswers.getAlreadyAnswer({
          event: incident(ACKNOWLEDGED),
          press: WorkspaceLatePress.Acknowledge,
        })
      ).markdown,
    ).toBe(
      `✅ **[Incident INC-2](${INCIDENT_LINK})** was already acknowledged at {{TIME(2026-10-08T18:07:00Z)}}.`,
    );
  });

  test("with no timeline to read, it says where the record is", async () => {
    jest.spyOn(IncidentStateTimelineService, "findBy").mockResolvedValue([]);

    expect(
      await WorkspaceActionAnswers.getAlreadyAnswer({
        event: incident(ACKNOWLEDGED),
        press: WorkspaceLatePress.Acknowledge,
      }),
    ).toEqual({
      markdown: `✅ **[Incident INC-2](${INCIDENT_LINK})** is already acknowledged.`,
      text: "Incident INC-2 is already acknowledged",
    });
  });

  test("a timeline that cannot be read never fails the answer", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockRejectedValue(new Error("database is gone"));

    expect(
      (
        await WorkspaceActionAnswers.getAlreadyAnswer({
          event: incident(RESOLVED),
          press: WorkspaceLatePress.Resolve,
        })
      ).markdown,
    ).toBe(`✅ **[Incident INC-2](${INCIDENT_LINK})** is already resolved.`);
  });

  test("Execute On-Call Policy on a resolved incident says nobody was paged", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(RESOLVED, "2026-10-08T18:20:00.000Z", SIMON),
      ]);

    expect(
      await WorkspaceActionAnswers.getAlreadyAnswer({
        event: incident(RESOLVED),
        press: WorkspaceLatePress.ExecuteOnCallPolicy,
      }),
    ).toEqual({
      markdown: `**[Incident INC-2](${INCIDENT_LINK})** was already resolved by **Simon Lee** at {{TIME(2026-10-08T18:20:00Z)}}, so no on-call policy was started.`,
      text: "Incident INC-2 was already resolved by Simon Lee, so no on-call policy was started",
    });
  });

  test("Page Someone, from the incident's menu, on a resolved incident says nobody was paged", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(RESOLVED, "2026-10-08T18:20:00.000Z", SIMON),
      ]);

    expect(
      await WorkspaceActionAnswers.getAlreadyAnswer({
        event: incident(RESOLVED),
        press: WorkspaceLatePress.Page,
      }),
    ).toEqual({
      markdown: `**[Incident INC-2](${INCIDENT_LINK})** was already resolved by **Simon Lee** at {{TIME(2026-10-08T18:20:00Z)}}, so nobody was paged.`,
      text: "Incident INC-2 was already resolved by Simon Lee, so nobody was paged",
    });
  });

  test("Page Someone whose timeline cannot be read says it is resolved, and that nobody was paged", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockRejectedValue(new Error("database is gone"));

    expect(
      (
        await WorkspaceActionAnswers.getAlreadyAnswer({
          event: incident(RESOLVED),
          press: WorkspaceLatePress.Page,
        })
      ).markdown,
    ).toBe(
      `**[Incident INC-2](${INCIDENT_LINK})** is already resolved, so nobody was paged.`,
    );
  });

  test("a record whose link cannot be built is named in bold, without one", async () => {
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockRejectedValue(new Error("no host"));
    jest.spyOn(IncidentStateTimelineService, "findBy").mockResolvedValue([]);

    expect(
      (
        await WorkspaceActionAnswers.getAlreadyAnswer({
          event: incident(ACKNOWLEDGED),
          press: WorkspaceLatePress.Acknowledge,
        })
      ).markdown,
    ).toBe("✅ **Incident INC-2** is already acknowledged.");
  });

  test("an alert is named and read from its own timeline and states", async () => {
    const alertId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/alert"));
    jest.spyOn(AlertStateService, "getAllAlertStates").mockResolvedValue([
      state(new AlertState(), { id: CREATED, order: 1, created: true }),
      state(new AlertState(), {
        id: ACKNOWLEDGED,
        order: 2,
        acknowledged: true,
      }),
      state(new AlertState(), { id: RESOLVED, order: 3, resolved: true }),
    ]);
    const row: AlertStateTimeline = new AlertStateTimeline();
    row.alertStateId = new ObjectID(ACKNOWLEDGED);
    row.startsAt = new Date("2026-10-08T18:07:00.000Z");
    row.createdByUserId = SIMON;
    const findBy: jest.SpyInstance = jest
      .spyOn(AlertStateTimelineService, "findBy")
      .mockResolvedValue([row]);

    const answer: WorkspaceAnswer =
      await WorkspaceActionAnswers.getAlreadyAnswer({
        event: {
          type: WorkspaceEventType.Alert,
          id: alertId,
          projectId: PROJECT_ID,
          currentStateId: new ObjectID(ACKNOWLEDGED),
          number: 5,
          numberWithPrefix: null,
        },
        press: WorkspaceLatePress.Acknowledge,
      });

    expect(answer.markdown).toBe(
      "✅ **[Alert #5](https://oneuptime.test/alert)** was already acknowledged by **Simon Lee** at {{TIME(2026-10-08T18:07:00Z)}}.",
    );
    expect((findBy.mock.calls[0]![0] as any).query.alertId.toString()).toBe(
      alertId.toString(),
    );
  });

  describe("a scheduled maintenance event", () => {
    const SCHEDULED: string = "d0000000-0000-4000-8000-0000000000b1";
    const ONGOING: string = "d0000000-0000-4000-8000-0000000000b2";
    const ENDED: string = "d0000000-0000-4000-8000-0000000000b3";
    const COMPLETED: string = "d0000000-0000-4000-8000-0000000000b4";

    function maintenanceStates(): Array<ScheduledMaintenanceState> {
      return [
        { id: SCHEDULED, order: 1, isScheduledState: true },
        { id: ONGOING, order: 2, isOngoingState: true },
        { id: ENDED, order: 3, isEndedState: true },
        { id: COMPLETED, order: 4, isResolvedState: true },
      ].map(
        (data: {
          id: string;
          order: number;
          isScheduledState?: boolean;
          isOngoingState?: boolean;
          isEndedState?: boolean;
          isResolvedState?: boolean;
        }): ScheduledMaintenanceState => {
          const model: ScheduledMaintenanceState =
            new ScheduledMaintenanceState();
          model.id = new ObjectID(data.id);
          model.order = data.order;
          model.isScheduledState = Boolean(data.isScheduledState);
          model.isOngoingState = Boolean(data.isOngoingState);
          model.isEndedState = Boolean(data.isEndedState);
          model.isResolvedState = Boolean(data.isResolvedState);
          return model;
        },
      );
    }

    function row(
      stateId: string,
      startsAt: string,
      createdByUserId?: ObjectID,
    ): ScheduledMaintenanceStateTimeline {
      const timeline: ScheduledMaintenanceStateTimeline =
        new ScheduledMaintenanceStateTimeline();
      timeline.scheduledMaintenanceStateId = new ObjectID(stateId);
      timeline.startsAt = new Date(startsAt);

      if (createdByUserId) {
        timeline.createdByUserId = createdByUserId;
      }

      return timeline;
    }

    function event(currentStateId: string): WorkspaceEventRecord {
      return {
        type: WorkspaceEventType.ScheduledMaintenance,
        id: ObjectID.generate(),
        projectId: PROJECT_ID,
        currentStateId: new ObjectID(currentStateId),
        number: 4,
        numberWithPrefix: "SM-4",
      };
    }

    beforeEach(() => {
      jest
        .spyOn(
          ScheduledMaintenanceService,
          "getScheduledMaintenanceLinkInDashboard",
        )
        .mockResolvedValue(URL.fromString("https://oneuptime.test/sm"));
      jest
        .spyOn(
          ScheduledMaintenanceStateService,
          "getAllScheduledMaintenanceStates",
        )
        .mockResolvedValue(maintenanceStates());
    });

    test("Mark as Ongoing on an ongoing event: who started it, and when", async () => {
      jest
        .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
        .mockResolvedValue([
          row(SCHEDULED, "2026-10-08T16:00:00.000Z"),
          row(ONGOING, "2026-10-08T17:00:00.000Z", SIMON),
        ]);

      expect(
        (
          await WorkspaceActionAnswers.getAlreadyAnswer({
            event: event(ONGOING),
            press: WorkspaceLatePress.MarkAsOngoing,
          })
        ).markdown,
      ).toBe(
        "✅ **[Scheduled Maintenance SM-4](https://oneuptime.test/sm)** was already marked as ongoing by **Simon Lee** at {{TIME(2026-10-08T17:00:00Z)}}.",
      );
    });

    test("an event the schedule started on its own: when, not who", async () => {
      jest
        .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
        .mockResolvedValue([
          row(SCHEDULED, "2026-10-08T16:00:00.000Z"),
          row(ONGOING, "2026-10-08T17:00:00.000Z"),
        ]);

      expect(
        (
          await WorkspaceActionAnswers.getAlreadyAnswer({
            event: event(ONGOING),
            press: WorkspaceLatePress.MarkAsOngoing,
          })
        ).markdown,
      ).toBe(
        "✅ **[Scheduled Maintenance SM-4](https://oneuptime.test/sm)** was already marked as ongoing at {{TIME(2026-10-08T17:00:00Z)}}.",
      );
    });

    test("Mark as Ongoing or Complete on a completed event: who completed it", async () => {
      jest
        .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
        .mockResolvedValue([
          row(ONGOING, "2026-10-08T17:00:00.000Z", SIMON),
          row(COMPLETED, "2026-10-08T19:00:00.000Z", SIMON),
        ]);

      for (const press of [
        WorkspaceLatePress.MarkAsOngoing,
        WorkspaceLatePress.MarkAsComplete,
      ]) {
        expect(
          (
            await WorkspaceActionAnswers.getAlreadyAnswer({
              event: event(COMPLETED),
              press: press,
            })
          ).markdown,
        ).toBe(
          "✅ **[Scheduled Maintenance SM-4](https://oneuptime.test/sm)** was already completed by **Simon Lee** at {{TIME(2026-10-08T19:00:00Z)}}.",
        );
      }
    });
  });

  test("an episode with no prefix is named by its number", async () => {
    jest
      .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/ep"));
    jest
      .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/aep"));

    expect(
      await WorkspaceActionAnswers.getRecordName({
        type: WorkspaceEventType.IncidentEpisode,
        id: ObjectID.generate(),
        projectId: PROJECT_ID,
        currentStateId: undefined,
        number: 3,
        numberWithPrefix: null,
      }),
    ).toEqual({
      label: "Incident Episode #3",
      link: "https://oneuptime.test/ep",
    });

    expect(
      await WorkspaceActionAnswers.getRecordName({
        type: WorkspaceEventType.AlertEpisode,
        id: ObjectID.generate(),
        projectId: PROJECT_ID,
        currentStateId: undefined,
        number: null,
        numberWithPrefix: null,
      }),
    ).toEqual({ label: "Alert Episode", link: "https://oneuptime.test/aep" });
  });
});

/*
 * ACKNOWLEDGE PRESSED BY SOMEBODY A PERSON'S PAGE PAGED INTO THE RECORD (UI
 * review of block 31). Jane pages Platform from INC-2's channel; Simon had
 * acknowledged INC-2 an hour before; Nitin presses Acknowledge Incident
 * there. That answers Nitin's page (OnCallPersonPageAnswer), and the answer
 * says so first - what his press did - then who is on the incident.
 */
describe("a late Acknowledge that answered the presser's own page", () => {
  test("says the page was acknowledged and paging stopped, then who acknowledged the incident and when", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(CREATED, "2026-10-08T17:58:00.000Z"),
        incidentRow(ACKNOWLEDGED, "2026-10-08T18:07:00.000Z", SIMON),
      ]);

    expect(
      await WorkspaceActionAnswers.getAlreadyAnswer({
        event: incident(ACKNOWLEDGED),
        press: WorkspaceLatePress.Acknowledge,
        answeredPageCount: 1,
      }),
    ).toEqual({
      markdown: `✅ You acknowledged the page for **[Incident INC-2](${INCIDENT_LINK})**, so paging stopped. **Simon Lee** acknowledged the incident at {{TIME(2026-10-08T18:07:00Z)}}.`,
      text: "You acknowledged the page for Incident INC-2, so paging stopped",
    });
  });

  test("an acknowledgement nobody made by hand says when; none to read says nothing more", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(ACKNOWLEDGED, "2026-10-08T18:07:00.000Z"),
      ]);

    expect(
      (
        await WorkspaceActionAnswers.getAlreadyAnswer({
          event: incident(ACKNOWLEDGED),
          press: WorkspaceLatePress.Acknowledge,
          answeredPageCount: 2,
        })
      ).markdown,
    ).toBe(
      `✅ You acknowledged the page for **[Incident INC-2](${INCIDENT_LINK})**, so paging stopped. The incident was acknowledged at {{TIME(2026-10-08T18:07:00Z)}}.`,
    );

    findBy.mockResolvedValue([]);

    expect(
      (
        await WorkspaceActionAnswers.getAlreadyAnswer({
          event: incident(ACKNOWLEDGED),
          press: WorkspaceLatePress.Acknowledge,
          answeredPageCount: 1,
        })
      ).markdown,
    ).toBe(
      `✅ You acknowledged the page for **[Incident INC-2](${INCIDENT_LINK})**, so paging stopped.`,
    );
  });

  test("no page answered: who got there first, as ever", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(ACKNOWLEDGED, "2026-10-08T18:07:00.000Z", SIMON),
      ]);

    expect(
      (
        await WorkspaceActionAnswers.getAlreadyAnswer({
          event: incident(ACKNOWLEDGED),
          press: WorkspaceLatePress.Acknowledge,
          answeredPageCount: 0,
        })
      ).markdown,
    ).toBe(
      `✅ **[Incident INC-2](${INCIDENT_LINK})** was already acknowledged by **Simon Lee** at {{TIME(2026-10-08T18:07:00Z)}}.`,
    );
  });

  test("a record that is resolved is answered as resolved: resolving it ended its pages", async () => {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([
        incidentRow(RESOLVED, "2026-10-08T18:20:00.000Z", SIMON),
      ]);

    expect(
      (
        await WorkspaceActionAnswers.getAlreadyAnswer({
          event: incident(RESOLVED),
          press: WorkspaceLatePress.Acknowledge,
          answeredPageCount: 1,
        })
      ).markdown,
    ).toBe(
      `✅ **[Incident INC-2](${INCIDENT_LINK})** was already resolved by **Simon Lee** at {{TIME(2026-10-08T18:20:00Z)}}.`,
    );
  });
});

describe("a press finished once the account is connected", () => {
  test.each([
    [WorkspacePendingActionKind.Acknowledge, "acknowledged"],
    [WorkspacePendingActionKind.Resolve, "resolved"],
    [WorkspacePendingActionKind.MarkAsOngoing, "marked as ongoing"],
    [WorkspacePendingActionKind.MarkAsComplete, "completed"],
    [
      WorkspacePendingActionKind.SavePrivateNote,
      "saved the message as a private note on",
    ],
    [
      WorkspacePendingActionKind.SavePublicNote,
      "saved the message as a public note on",
    ],
  ])(
    "%s says what was done",
    async (kind: WorkspacePendingActionKind, verb: string) => {
      expect(
        await WorkspaceActionAnswers.getDoneAnswer({
          event: incident(CREATED),
          kind: kind,
        }),
      ).toEqual({
        markdown: `✅ You ${verb} **[Incident INC-2](${INCIDENT_LINK})**.`,
        text: `You ${verb} Incident INC-2`,
      });
    },
  );

  test("the answer opens with the news that the account is connected, then the press", async () => {
    const done: WorkspaceAnswer = await WorkspaceActionAnswers.getDoneAnswer({
      event: incident(CREATED),
      kind: WorkspacePendingActionKind.Acknowledge,
    });

    expect(
      WorkspaceActionAnswers.getConnectedAnswer({
        workspaceType: WorkspaceType.Slack,
        outcome: done,
      }),
    ).toEqual({
      markdown: `✅ **Your Slack account is connected to OneUptime.** You acknowledged **[Incident INC-2](${INCIDENT_LINK})**.`,
      text: "Your Slack account is connected to OneUptime. You acknowledged Incident INC-2",
    });
  });

  test("a press to press again says so", () => {
    expect(
      WorkspaceActionAnswers.getConnectedAnswer({
        workspaceType: WorkspaceType.MicrosoftTeams,
        again: {
          kind: WorkspaceConnectRequestAgainKind.Button,
          label: "Add Note",
        },
      }),
    ).toEqual({
      markdown:
        "✅ **Your Microsoft Teams account is connected to OneUptime.** Now press **Add Note** again.",
      text: "Your Microsoft Teams account is connected to OneUptime. Now press Add Note again.",
    });
  });

  test("with nothing else to say, only that it is connected", () => {
    expect(
      WorkspaceActionAnswers.getConnectedAnswer({
        workspaceType: WorkspaceType.Slack,
      }),
    ).toEqual({
      markdown: "✅ **Your Slack account is connected to OneUptime.**",
      text: "Your Slack account is connected to OneUptime",
    });
  });

  test.each([
    [
      WorkspaceConnectRequestAgainKind.Command,
      "/incident",
      "run /incident again",
    ],
    [
      WorkspaceConnectRequestAgainKind.Command,
      undefined,
      "run the command again",
    ],
    [
      WorkspaceConnectRequestAgainKind.Question,
      undefined,
      "ask your question again",
    ],
    [
      WorkspaceConnectRequestAgainKind.Button,
      undefined,
      "press the button again",
    ],
    [
      WorkspaceConnectRequestAgainKind.MenuItem,
      "Assign Role",
      "choose Assign Role from the menu again",
    ],
    [
      WorkspaceConnectRequestAgainKind.MenuItem,
      undefined,
      "choose it from the menu again",
    ],
  ])(
    "what to press again, as plain text: %s %s",
    (
      kind: WorkspaceConnectRequestAgainKind,
      label: string | undefined,
      text: string,
    ) => {
      expect(
        WorkspaceActionAnswers.getAgainText(
          label ? { kind: kind, label: label } : { kind: kind },
        ),
      ).toBe(text);
    },
  );
});
