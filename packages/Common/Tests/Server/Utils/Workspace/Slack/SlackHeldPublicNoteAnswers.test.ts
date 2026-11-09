import IncidentEpisodePublicNote from "../../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenancePublicNote from "../../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import IncidentEpisodePublicNoteService from "../../../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentInternalNoteService from "../../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../../Server/Services/IncidentPublicNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import PublicNoteApprovalEngine from "../../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import { PublicNoteApprovalWaitingFor } from "../../../../../Server/Utils/Notes/PublicNoteApprovalFeed";
import PublicNoteApprovalPolicy from "../../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import Response from "../../../../../Server/Utils/Response";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackActionAnswer from "../../../../../Server/Utils/Workspace/Slack/Actions/Answer";
import { SlackRequest } from "../../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackActionAuthorization from "../../../../../Server/Utils/Workspace/Slack/Actions/Authorization";
import SlackIncidentActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackIncidentEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/IncidentEpisode";
import SlackIncidentMoreActions from "../../../../../Server/Utils/Workspace/Slack/Actions/IncidentMoreActions";
import SlackScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceActionAnswers from "../../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "../../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspaceNoteForm from "../../../../../Server/Utils/Workspace/WorkspaceNoteForm";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import { WorkspaceNoteType } from "../../../../../Types/Workspace/WorkspaceNoteReaction";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * SLACK: A PUBLIC NOTE THAT WAITS FOR APPROVAL SAYS SO (#6254).
 *
 * The Add Note form of an incident's, an episode's or a scheduled
 * maintenance event's message, sent while the project asks for public
 * notes to be approved: the note is held, posted to no channel until it is
 * approved, so the person who sent it is told - in a message only they
 * see, where they opened the form - that it waits, and for whom. A note
 * published as it was posted is answered as before. The forms' public
 * option says the note is posted once approved while approval is on.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const RECORD_ID: ObjectID = ObjectID.generate();
const SLACK_USER_ID: string = "U0MEMBER";

const PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

const WAITING_FOR: PublicNoteApprovalWaitingFor = {
  position: {
    step: { id: "s1", name: "Support", order: 1, userIds: [], teamIds: [] },
    number: 1,
    count: 2,
    isFinal: false,
    isAskedAgain: false,
  },
  approverNames: ["Bob", "Platform"],
};

interface NoteKind {
  name: string;
  type: WorkspaceEventType;
  label: string;
  service:
    | typeof IncidentPublicNoteService
    | typeof IncidentEpisodePublicNoteService
    | typeof ScheduledMaintenancePublicNoteService;
  makeNote: () =>
    | IncidentPublicNote
    | IncidentEpisodePublicNote
    | ScheduledMaintenancePublicNote;
  submit: (args: HandlerArgs) => Promise<void>;
  submitType: SlackActionType;
  view: (args: HandlerArgs) => Promise<void>;
  viewType: SlackActionType;
}

interface HandlerArgs {
  slackRequest: SlackRequest;
  action: { actionType: SlackActionType; actionValue: string };
  req: ExpressRequest;
  res: ExpressResponse;
}

const KINDS: Array<NoteKind> = [
  {
    name: "incident",
    type: WorkspaceEventType.Incident,
    label: "Incident INC-42",
    service: IncidentPublicNoteService,
    makeNote: () => {
      return new IncidentPublicNote();
    },
    submit: (args: HandlerArgs) => {
      return SlackIncidentActions.submitIncidentNote(args);
    },
    submitType: SlackActionType.SubmitIncidentNote,
    view: (args: HandlerArgs) => {
      return SlackIncidentActions.viewAddIncidentNote(args);
    },
    viewType: SlackActionType.ViewAddIncidentNote,
  },
  {
    name: "incident episode",
    type: WorkspaceEventType.IncidentEpisode,
    label: "Incident Episode #3",
    service: IncidentEpisodePublicNoteService,
    makeNote: () => {
      return new IncidentEpisodePublicNote();
    },
    submit: (args: HandlerArgs) => {
      return SlackIncidentEpisodeActions.submitIncidentEpisodeNote(args);
    },
    submitType: SlackActionType.SubmitIncidentEpisodeNote,
    view: (args: HandlerArgs) => {
      return SlackIncidentEpisodeActions.viewAddIncidentEpisodeNote(args);
    },
    viewType: SlackActionType.ViewAddIncidentEpisodeNote,
  },
  {
    name: "scheduled maintenance event",
    type: WorkspaceEventType.ScheduledMaintenance,
    label: "Scheduled Maintenance #7",
    service: ScheduledMaintenancePublicNoteService,
    makeNote: () => {
      return new ScheduledMaintenancePublicNote();
    },
    submit: (args: HandlerArgs) => {
      return SlackScheduledMaintenanceActions.submitScheduledMaintenanceNote(
        args,
      );
    },
    submitType: SlackActionType.SubmitScheduledMaintenanceNote,
    view: (args: HandlerArgs) => {
      return SlackScheduledMaintenanceActions.viewAddScheduledMaintenanceNote(
        args,
      );
    },
    viewType: SlackActionType.ViewAddScheduledMaintenanceNote,
  },
];

function handlerArgs(
  actionType: SlackActionType,
  viewValues?: Record<string, string>,
): HandlerArgs {
  return {
    slackRequest: {
      isAuthorized: true,
      userId: USER_ID,
      projectId: PROJECT_ID,
      projectAuthToken: "xoxb-project-token",
      botUserId: "B0BOT",
      slackUserId: SLACK_USER_ID,
      slackUsername: "member",
      slackChannelId: "C0CHANNEL",
      triggerId: "trigger-1",
      viewValues: viewValues,
    } as SlackRequest,
    action: { actionType: actionType, actionValue: RECORD_ID.toString() },
    req: {} as ExpressRequest,
    res: {} as ExpressResponse,
  };
}

let ephemeralSpy: jest.SpyInstance;
let doneIfPrivateSpy: jest.SpyInstance;

// What the member was told: each message only they see, in the channel.
function answerTexts(): Array<string> {
  return ephemeralSpy.mock.calls.map((call: Array<unknown>): string => {
    const sent: {
      channelId: string;
      userId: string;
      messageBlocks: Array<WorkspaceMessageBlock>;
    } = call[0] as never;

    expect(sent.channelId).toBe("C0CHANNEL");
    expect(sent.userId).toBe(SLACK_USER_ID);

    return (sent.messageBlocks[0] as WorkspacePayloadMarkdown).text;
  });
}

function stubNoteWritten(
  kind: NoteKind,
  isPublished: boolean,
): jest.SpyInstance {
  const note: IncidentPublicNote = kind.makeNote() as IncidentPublicNote;
  note.projectId = PROJECT_ID;
  note.isPublished = isPublished;

  return getJestSpyOn(kind.service, "addNote").mockResolvedValue(note as never);
}

beforeEach(() => {
  getJestSpyOn(Response, "sendJsonObjectResponse").mockImplementation(
    (() => {}) as never,
  );
  getJestSpyOn(Response, "sendTextResponse").mockImplementation(
    (() => {}) as never,
  );
  getJestSpyOn(Response, "sendErrorResponse").mockImplementation(
    (() => {}) as never,
  );
  getJestSpyOn(SlackActionAuthorization, "authorize").mockResolvedValue(PROPS);
  getJestSpyOn(WorkspaceNoteForm, "getSubmittedNote").mockResolvedValue({
    noteType: WorkspaceNoteType.Public,
    isPublicAskedOnPrivateRecord: false,
  });
  getJestSpyOn(WorkspaceNoteForm, "isPrivateRecord").mockResolvedValue(false);
  getJestSpyOn(PublicNoteApprovalEngine, "getWaitingForNote").mockResolvedValue(
    WAITING_FOR,
  );
  getJestSpyOn(WorkspaceMemberActions, "findEventForMember").mockResolvedValue({
    record: {},
    event: {
      type: WorkspaceEventType.Incident,
      id: RECORD_ID,
      projectId: PROJECT_ID,
      currentStateId: undefined,
      number: 42,
      numberWithPrefix: "INC-42",
    },
  } as never);
  ephemeralSpy = getJestSpyOn(
    SlackUtil,
    "sendEphemeralMessageToChannel",
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(SlackUtil, "sendDirectMessageToUser").mockResolvedValue(
    undefined as never,
  );
  doneIfPrivateSpy = getJestSpyOn(
    SlackIncidentMoreActions,
    "answerDoneIfPrivate",
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("Slack: a public note on an $name", (kind: NoteKind) => {
  test("held for approval, the person is told, to them alone, that it waits and for whom", async () => {
    getJestSpyOn(WorkspaceActionAnswers, "getRecordName").mockResolvedValue({
      label: kind.label,
      link: "https://oneuptime.example/record",
    });
    const addSpy: jest.SpyInstance = stubNoteWritten(kind, false);

    await kind.submit(
      handlerArgs(kind.submitType, {
        noteType: "public",
        note: "We are rolling back the deploy.",
      }),
    );

    // Written as the member, as the Dashboard writes it for them.
    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({ props: PROPS }),
    );
    // The answer's Markdown, which Slack's sender writes as mrkdwn.
    expect(answerTexts()).toEqual([
      `⏳ Sent for approval: your public note on **[${kind.label}](https://oneuptime.example/record)** is published on status pages once it is approved. It waits for step 1 of 2 (Support): Bob, Platform.`,
    ]);
    // Not told it was added, as if it were on the status page.
    expect(doneIfPrivateSpy).not.toHaveBeenCalled();
  });

  test("published as it was posted, it is answered as it always was", async () => {
    stubNoteWritten(kind, true);
    const waitingSpy: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "getWaitingForNote",
    );

    await kind.submit(
      handlerArgs(kind.submitType, {
        noteType: "public",
        note: "We are rolling back the deploy.",
      }),
    );

    expect(waitingSpy).not.toHaveBeenCalled();
    // No answer of its own: the record's channels say it was posted.
    expect(
      answerTexts().filter((text: string): boolean => {
        return text.includes("approval");
      }),
    ).toEqual([]);
  });

  test("who it waits for that cannot be read is left out, and the person is still told it waits", async () => {
    getJestSpyOn(WorkspaceActionAnswers, "getRecordName").mockResolvedValue({
      label: kind.label,
      link: "https://oneuptime.example/record",
    });
    getJestSpyOn(
      PublicNoteApprovalEngine,
      "getWaitingForNote",
    ).mockRejectedValue(new Error("steps could not be read"));
    stubNoteWritten(kind, false);

    await kind.submit(
      handlerArgs(kind.submitType, {
        noteType: "public",
        note: "We are rolling back the deploy.",
      }),
    );

    expect(answerTexts()).toEqual([
      `⏳ Sent for approval: your public note on **[${kind.label}](https://oneuptime.example/record)** is published on status pages once it is approved.`,
    ]);
  });

  test.each([
    [true, "Public Note (Posted on Status Page once approved)"],
    [false, "Public Note (Will be posted on Status Page)"],
  ])(
    "its form, while approval is %s, offers the public note as '%s'",
    async (isRequired: boolean, label: string) => {
      const isRequiredSpy: jest.SpyInstance = getJestSpyOn(
        PublicNoteApprovalPolicy,
        "isRequired",
      ).mockResolvedValue(isRequired);
      const showModalSpy: jest.SpyInstance = getJestSpyOn(
        SlackActionAnswer,
        "showModal",
      ).mockResolvedValue(undefined as never);

      await kind.view(handlerArgs(kind.viewType));

      expect(isRequiredSpy).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID }),
      );

      const modal: WorkspaceModalBlock = (
        showModalSpy.mock.calls[0]![0] as { modalBlock: WorkspaceModalBlock }
      ).modalBlock;
      const noteType: WorkspaceDropdownBlock = modal.blocks.find(
        (block: WorkspaceMessageBlock): boolean => {
          return block._type === "WorkspaceDropdownBlock";
        },
      ) as WorkspaceDropdownBlock;

      expect(noteType.options[0]).toEqual({ label: label, value: "public" });
    },
  );
});

describe("Slack: a private note, or a public one saved privately, is answered as before", () => {
  test("a private note on an incident gets no approval answer", async () => {
    getJestSpyOn(WorkspaceNoteForm, "getSubmittedNote").mockResolvedValue({
      noteType: WorkspaceNoteType.Private,
      isPublicAskedOnPrivateRecord: false,
    });
    const internalNoteSpy: jest.SpyInstance = getJestSpyOn(
      IncidentPublicNoteService,
      "addNote",
    );

    getJestSpyOn(IncidentInternalNoteService, "addNote").mockResolvedValue(
      undefined as never,
    );

    await SlackIncidentActions.submitIncidentNote(
      handlerArgs(SlackActionType.SubmitIncidentNote, {
        noteType: "private",
        note: "Rolled back 4.2.1.",
      }),
    );

    expect(internalNoteSpy).not.toHaveBeenCalled();
    expect(
      answerTexts().filter((text: string): boolean => {
        return text.includes("approval");
      }),
    ).toEqual([]);
    expect(doneIfPrivateSpy).toHaveBeenCalled();
  });
});
