import crypto from "crypto";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { PublicNoteKind } from "../../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import TokenSigningKey from "../../../../../Server/Utils/TokenSigningKey";
import MattermostUtil from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostActionContext, {
  MattermostPressedAction,
} from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActionContext";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsMessageSize, {
  MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import {
  WorkspaceConnectRequestAgainKind,
  WorkspacePendingActionKind,
  WorkspacePressDescription,
} from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { WorkspaceEventType } from "../../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspacePublicNoteApproval, {
  PUBLIC_NOTE_REJECT_REASON_FIELD,
  PublicNoteApprovalAsk,
  PublicNoteApprovalButtonValue,
  WorkspaceDirectMessage,
} from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApproval";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
  PublicNoteApprovalStepRule,
} from "../../../../../Types/StatusPage/PublicNoteApproval";
import {
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { generatedTexts } from "../../../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";

/*
 * THE MESSAGE AN APPROVER GETS IN CHAT, AND WHAT ITS BUTTONS CARRY (#6289).
 *
 *  - The value Approve and Reject carry is signed: read back exactly, and
 *    refused when it is anything this installation did not sign - another
 *    button's value, a character changed, a field added, another key's
 *    signature.
 *  - The message is the Dashboard's and the feed's words, its names and
 *    titles text, its note the author's Markdown - and held to what each
 *    chat takes, whatever its note's length, with the lines around the note
 *    and the buttons whole.
 *  - Reject's form asks the Dashboard's question, required and at most the
 *    longest reason kept.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const NOTES_URL: string =
  "https://oneuptime.example/dashboard/p/incidents/i/public-notes";
const TEAM_ID: string = "t3amt3amt3amt3amt3amt3amt3";
const CHANNEL_ID: string = "dmdmdmdmdmdmdmdmdmdmdmdmdm";

const SUPPORT: PublicNoteApprovalStepRule = {
  id: "5e000000-0000-4000-8000-000000000001",
  name: "Support",
  order: 1,
  userIds: [],
  teamIds: [],
};

function value(
  overrides: Partial<PublicNoteApprovalButtonValue> = {},
): PublicNoteApprovalButtonValue {
  return {
    kind: PublicNoteKind.Incident,
    projectId: PROJECT_ID,
    recordId: INCIDENT_ID,
    noteId: NOTE_ID,
    submittedAt: "2026-11-07T09:00:00.000Z",
    stepId: SUPPORT.id,
    isFinal: false,
    isEdit: false,
    textDigest: WorkspacePublicNoteApproval.getTextDigest("The note."),
    ...overrides,
  };
}

function ask(
  overrides: Partial<PublicNoteApprovalAsk> = {},
): PublicNoteApprovalAsk {
  return {
    recordLabel: "Incident INC-42",
    recordTitle: "Checkout is down",
    notesUrl: NOTES_URL,
    note: "We are **looking into** the checkout errors.",
    isEdit: false,
    sentBy: "Alice",
    waitingFor: {
      position: {
        step: SUPPORT,
        number: 1,
        count: 2,
        isFinal: false,
        isAskedAgain: false,
      },
      approverNames: ["Bob", "Platform"],
    },
    value: value(),
    ...overrides,
  };
}

function markdownOf(message: WorkspaceDirectMessage, index: number): string {
  return (message.messageBlocks[index] as WorkspacePayloadMarkdown).text;
}

function buttonsOf(
  message: WorkspaceDirectMessage,
): Array<WorkspaceMessagePayloadButton> {
  return (
    message.messageBlocks[
      message.messageBlocks.length - 1
    ] as WorkspacePayloadButtons
  ).buttons;
}

// A value with one of its parts changed, its signature kept.
function withPayload(encoded: string, fields: Array<unknown>): string {
  const parts: Array<string> = encoded.split(".");

  return `${parts[0]}.${Buffer.from(JSON.stringify(fields), "utf8").toString(
    "base64url",
  )}.${parts[2]}`;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the value Approve and Reject carry", () => {
  test.each([
    PublicNoteKind.Incident,
    PublicNoteKind.IncidentEpisode,
    PublicNoteKind.ScheduledMaintenance,
  ])("reads back exactly, for a %s note", (kind: PublicNoteKind) => {
    for (const isFinal of [true, false]) {
      for (const isEdit of [true, false]) {
        const written: PublicNoteApprovalButtonValue = value({
          kind,
          isFinal,
          isEdit,
        });

        expect(
          WorkspacePublicNoteApproval.readValue(
            WorkspacePublicNoteApproval.encodeValue(written),
          ),
        ).toEqual(written);
      }
    }
  });

  test("is short enough for every chat's button: Slack's and Mattermost's take 2,000 characters", () => {
    const encoded: string = WorkspacePublicNoteApproval.encodeValue(
      value({ stepId: "s".repeat(100) }),
    );

    expect(encoded.length).toBeLessThan(600);
  });

  test("anything that is not a value this installation signed is refused", () => {
    const encoded: string = WorkspacePublicNoteApproval.encodeValue(value());
    const [prefix, payload, signature] = encoded.split(".") as [
      string,
      string,
      string,
    ];

    for (const forged of [
      undefined,
      null,
      42,
      {},
      [encoded],
      "",
      NOTE_ID.toString(),
      `${NOTE_ID.toString()}:fingerprint`,
      `${prefix}.${payload}`,
      `${prefix}.${payload}.${signature}.extra`,
      `pna2.${payload}.${signature}`,
      `${prefix}.${payload}x.${signature}`,
      `${prefix}.${payload}.${signature.slice(0, -1)}`,
      `${prefix}.${payload}.${signature.slice(1)}A`,
      `${prefix}..${signature}`,
      `${prefix}.${payload}.`,
      `${encoded}${"a".repeat(1024)}`,
    ]) {
      expect(WorkspacePublicNoteApproval.readValue(forged)).toBeNull();
    }
  });

  test("a value whose fields were changed under its signature is refused", () => {
    const encoded: string = WorkspacePublicNoteApproval.encodeValue(value());
    const original: Array<unknown> = JSON.parse(
      Buffer.from(encoded.split(".")[1]!, "base64url").toString("utf8"),
    ) as Array<unknown>;

    for (let index: number = 0; index < original.length; index++) {
      const changed: Array<unknown> = [...original];
      changed[index] =
        typeof changed[index] === "number"
          ? 1 - (changed[index] as number)
          : `${String(changed[index])}0`;

      expect(
        WorkspacePublicNoteApproval.readValue(withPayload(encoded, changed)),
      ).toBeNull();
    }

    expect(
      WorkspacePublicNoteApproval.readValue(
        withPayload(encoded, [...original, "more"]),
      ),
    ).toBeNull();
  });

  test("a value signed with another installation's key is refused", () => {
    const encoded: string = WorkspacePublicNoteApproval.encodeValue(value());

    jest
      .spyOn(TokenSigningKey, "deriveKey")
      .mockReturnValue(crypto.randomBytes(32));

    expect(WorkspacePublicNoteApproval.readValue(encoded)).toBeNull();
  });

  test("a correctly signed value with a field of the wrong kind is refused", () => {
    const sign: (fields: Array<unknown>) => string = (
      fields: Array<unknown>,
    ): string => {
      const payload: string = Buffer.from(
        JSON.stringify(fields),
        "utf8",
      ).toString("base64url");
      const signature: string = crypto
        .createHmac(
          "sha256",
          TokenSigningKey.deriveKey("workspace-public-note-approval-button"),
        )
        .update(payload, "utf8")
        .digest("base64url");

      return `pna1.${payload}.${signature}`;
    };

    const good: Array<unknown> = [
      PublicNoteKind.Incident,
      PROJECT_ID.toString(),
      INCIDENT_ID.toString(),
      NOTE_ID.toString(),
      "2026-11-07T09:00:00.000Z",
      SUPPORT.id,
      0,
      0,
      WorkspacePublicNoteApproval.getTextDigest("x"),
    ];

    expect(WorkspacePublicNoteApproval.readValue(sign(good))).not.toBeNull();

    for (const [index, wrong] of [
      [0, "Alert"],
      [1, "not-an-id"],
      [2, 3],
      [3, ""],
      [4, ""],
      [4, "x".repeat(65)],
      [5, ""],
      [5, "s".repeat(101)],
      [6, 2],
      [6, true],
      [7, "1"],
      [8, "short"],
    ] as Array<[number, unknown]>) {
      const fields: Array<unknown> = [...good];
      fields[index] = wrong;

      expect(WorkspacePublicNoteApproval.readValue(sign(fields))).toBeNull();
    }
  });

  test("the text's digest: the same for the same text, different for any other", () => {
    const digest: string = WorkspacePublicNoteApproval.getTextDigest("A note");

    expect(digest).toHaveLength(22);
    expect(WorkspacePublicNoteApproval.getTextDigest("A note")).toBe(digest);
    expect(WorkspacePublicNoteApproval.getTextDigest("A note.")).not.toBe(
      digest,
    );
    expect(WorkspacePublicNoteApproval.getTextDigest(null)).toBe(
      WorkspacePublicNoteApproval.getTextDigest(""),
    );
  });
});

describe("the message an approver gets", () => {
  test("the record, who sent it, who it waits for, the note, what approving does, and Approve, Reject and the link", () => {
    const message: WorkspaceDirectMessage =
      WorkspacePublicNoteApproval.getAskMessage(ask());

    expect(message.messageBlocks).toHaveLength(4);
    expect(markdownOf(message, 0)).toBe(
      [
        `📝 **Approval needed: public note on [Incident INC-42](${NOTES_URL}) - Checkout is down**`,
        "**Alice** sent it for approval. It waits for step 1 of 2 (Support): Bob, Platform.",
        "It is not on status pages and no subscriber is told about it until it is approved.",
      ].join("\n\n"),
    );
    // The note is its author's Markdown.
    expect(markdownOf(message, 1)).toBe(
      "We are **looking into** the checkout errors.",
    );
    expect(markdownOf(message, 2)).toBe(
      "Once you approve it, it waits for the next approval step before it is published.",
    );
    expect(message.notificationText).toBe(
      "Approval needed: public note on Incident INC-42 - Checkout is down",
    );

    const buttons: Array<WorkspaceMessagePayloadButton> = buttonsOf(message);

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return [button.title, button.actionId, Boolean(button.isPrimary)];
      }),
    ).toEqual([
      ["Approve", SlackActionType.ApprovePublicNote, true],
      ["Reject", SlackActionType.ViewRejectPublicNote, false],
      ["View in OneUptime", SlackActionType.OpenInOneUptime, false],
    ]);
    expect(buttons[2]!.url?.toString()).toBe(NOTES_URL);
    expect(WorkspacePublicNoteApproval.readValue(buttons[0]!.value)).toEqual(
      value(),
    );
    expect(buttons[1]!.value).toBe(buttons[0]!.value);
  });

  test("on the last step, Approve and publish, and what that does", () => {
    const message: WorkspaceDirectMessage =
      WorkspacePublicNoteApproval.getAskMessage(
        ask({ value: value({ isFinal: true }) }),
      );

    expect(buttonsOf(message)[0]!.title).toBe("Approve and publish");
    expect(markdownOf(message, 2)).toBe(
      "Once you approve it, it will be published on status pages right away, and subscribers will be told about it if the note says to notify them.",
    );
  });

  test("an edit of a published note says so, and that status pages keep the note as approved", () => {
    const message: WorkspaceDirectMessage =
      WorkspacePublicNoteApproval.getAskMessage(
        ask({ isEdit: true, value: value({ isFinal: true, isEdit: true }) }),
      );

    expect(markdownOf(message, 0)).toContain(
      "**Approval needed: edit of a public note on [Incident INC-42]",
    );
    expect(markdownOf(message, 0)).toContain(
      "Status pages keep showing the note as it was approved until the edit is approved.",
    );
    expect(markdownOf(message, 2)).toBe(
      "Once you approve it, status pages will show the edited note right away.",
    );
    expect(message.notificationText).toBe(
      "Approval needed: edit of a public note on Incident INC-42 - Checkout is down",
    );
  });

  test("a note OneUptime sent names no sender; a record with no title, no dash; an empty note, no block", () => {
    const message: WorkspaceDirectMessage =
      WorkspacePublicNoteApproval.getAskMessage(
        ask({ sentBy: null, recordTitle: "", note: "   " }),
      );

    expect(markdownOf(message, 0)).toBe(
      [
        `📝 **Approval needed: public note on [Incident INC-42](${NOTES_URL})**`,
        "It waits for step 1 of 2 (Support): Bob, Platform.",
        "It is not on status pages and no subscriber is told about it until it is approved.",
      ].join("\n\n"),
    );
    expect(message.messageBlocks).toHaveLength(3);
  });

  test("names and titles are text: no link, mention or emphasis of theirs acts", () => {
    const message: WorkspaceDirectMessage =
      WorkspacePublicNoteApproval.getAskMessage(
        ask({
          recordLabel: "Incident [INC-42](https://evil.example)",
          recordTitle:
            "**down** <!channel> @here ![x](https://evil.example/x.png)",
          sentBy: "<@U012> *Mallory*",
          waitingFor: {
            position: {
              step: { ...SUPPORT, name: "[Legal](https://evil.example)" },
              number: 1,
              count: 2,
              isFinal: false,
              isAskedAgain: false,
            },
            approverNames: ["_Bob_", "`Platform`"],
          },
        }),
      );

    const intro: string = markdownOf(message, 0);

    // Each bracket, star and underscore of theirs is escaped: none opens anything.
    expect(intro).not.toMatch(/(?<!\\)\]\(https:\/\/evil\.example/);
    expect(intro).not.toMatch(/(?<!\\)!\[x/);
    expect(intro).not.toMatch(/(?<!\\)\*\*down/);
    expect(intro).not.toMatch(/(?<!\\)\*Mallory/);
    expect(intro).not.toMatch(/(?<!\\)_Bob_/);
    expect(intro).not.toMatch(/(?<!\\)`Platform/);
    // Mentions are broken: Slack reads none of them.
    expect(intro).not.toContain("<!channel>");
    expect(intro).not.toContain("<@U012>");
    // The one link is the record's, to its public notes.
    expect(intro).toContain(`](${NOTES_URL})`);
    expect(intro.match(/(?<!\\)\]\(/g)).toHaveLength(1);
  });

  test("an image a data: URL carries in the note is its alt text: a chat shows no such image", () => {
    const message: WorkspaceDirectMessage =
      WorkspacePublicNoteApproval.getAskMessage(
        ask({
          note: `Before ![the screenshot](data:image/png;base64,${"A".repeat(4000)}) after`,
        }),
      );

    expect(markdownOf(message, 1)).not.toContain("data:image");
    expect(markdownOf(message, 1)).toContain("the screenshot");
  });
});

describe("held to what each chat takes, whatever the note", () => {
  // Pieces of notes and names: Markdown, mentions, wide characters, long words.
  const PIECES: ReadonlyArray<string> = [
    "a",
    " ",
    "\n",
    "\n\n",
    "**",
    "_",
    "`",
    "```\n",
    "[",
    "](",
    ")",
    "<!channel>",
    "@here",
    "|",
    "😀",
    "中文",
    "word ".repeat(40),
    "x".repeat(700),
    "- item\n",
    "> quote\n",
  ];

  const random: SeededRandom = seededRandom(6289);
  const texts: Array<string> = generatedTexts(60, 6289, PIECES, 60);

  test.each(
    texts.map((text: string, index: number): [number, string] => {
      return [index, text];
    }),
  )(
    "generated note %i: Slack, Teams and Mattermost each take the message, with its buttons",
    (_index: number, text: string) => {
      // Some notes far longer than any chat shows.
      const note: string =
        random(4) === 0 ? text.repeat(1 + random(400)) : text;
      const name: string = text.slice(0, 1 + random(300));

      const message: WorkspaceDirectMessage =
        WorkspacePublicNoteApproval.getAskMessage(
          ask({
            note: note,
            recordTitle: name,
            sentBy: name || null,
            value: value({ isFinal: random(2) === 0 }),
          }),
        );

      // Slack: at most 50 blocks, sections of at most 3,000 characters, and the buttons.
      const slackBlocks: Array<JSONObject> =
        SlackUtil.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: message.messageBlocks,
        });

      expect(slackBlocks.length).toBeLessThanOrEqual(
        SlackUtil.MAX_BLOCKS_PER_MESSAGE,
      );

      for (const block of slackBlocks) {
        const blockText: unknown = (block["text"] as JSONObject | undefined)?.[
          "text"
        ];

        if (typeof blockText === "string") {
          expect(blockText.length).toBeLessThanOrEqual(
            SlackUtil.SECTION_TEXT_MAX_LENGTH,
          );
        }
      }

      const slackActions: JSONObject | undefined = slackBlocks.find(
        (block: JSONObject): boolean => {
          return block["type"] === "actions";
        },
      );

      expect(
        ((slackActions?.["elements"] as Array<JSONObject>) || []).map(
          (element: JSONObject) => {
            return element["action_id"];
          },
        ),
      ).toEqual([
        SlackActionType.ApprovePublicNote,
        SlackActionType.ViewRejectPublicNote,
        SlackActionType.OpenInOneUptime,
      ]);

      // Microsoft Teams: within its budget, with Approve and Reject on it.
      const card: JSONObject =
        MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
          messageBlocks: message.messageBlocks,
        });

      expect(
        MicrosoftTeamsMessageSize.getSizeInBytes(card),
      ).toBeLessThanOrEqual(MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES);
      expect(
        ((card["actions"] as Array<JSONObject>) || []).map(
          (action: JSONObject) => {
            return (
              (action["data"] as JSONObject | undefined)?.["action"] || "url"
            );
          },
        ),
      ).toEqual([
        SlackActionType.ApprovePublicNote,
        SlackActionType.ViewRejectPublicNote,
        "url",
      ]);

      // Mattermost: at most a post's length, the buttons signed for the direct message.
      const post: JSONObject = MattermostUtil.toPost({
        blocks: MattermostUtil.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: message.messageBlocks,
        }),
        teamId: TEAM_ID,
        directMessageChannelId: CHANNEL_ID,
      });

      expect((post["message"] as string).length).toBeLessThanOrEqual(
        MattermostUtil.MESSAGE_MAX_LENGTH,
      );

      const actions: Array<JSONObject> = (
        ((post["props"] as JSONObject)["attachments"] as Array<JSONObject>)[0]![
          "actions"
        ] as Array<JSONObject>
      ).filter((action: JSONObject): boolean => {
        return action["type"] === "button";
      });

      expect(actions).toHaveLength(2);

      for (const action of actions) {
        const press: MattermostPressedAction | null =
          MattermostActionContext.readPress({
            context: (action["integration"] as JSONObject)["context"],
            teamId: "",
            channelId: CHANNEL_ID,
          });

        expect(press?.channelId).toBe(CHANNEL_ID);
        expect(
          WorkspacePublicNoteApproval.readValue(press?.value),
        ).not.toBeNull();
      }
    },
  );

  test("a note longer than a chat shows ends with the note that it was cut, and the lines around it stay whole", () => {
    const message: WorkspaceDirectMessage =
      WorkspacePublicNoteApproval.getAskMessage(
        ask({ note: "A long note. ".repeat(20000) }),
      );

    const slackText: string = SlackUtil.getBlocksFromWorkspaceMessagePayload({
      messageBlocks: message.messageBlocks,
    })
      .map((block: JSONObject): string => {
        return String(
          (block["text"] as JSONObject | undefined)?.["text"] || "",
        );
      })
      .join("\n");

    expect(slackText).toContain("truncated");
    expect(slackText).toContain("Approval needed");
    expect(slackText).toContain("Once you approve it");

    const post: JSONObject = MattermostUtil.toPost({
      blocks: MattermostUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: message.messageBlocks,
      }),
      teamId: TEAM_ID,
      directMessageChannelId: CHANNEL_ID,
    });

    expect(post["message"] as string).toContain("Approval needed");
    expect((post["message"] as string).length).toBeLessThanOrEqual(
      MattermostUtil.MESSAGE_MAX_LENGTH,
    );
  });
});

describe("Reject's form", () => {
  test.each([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams])(
    "in %s: the Dashboard's question and help, required, at most the longest reason",
    (workspaceType: WorkspaceType) => {
      const form: ReturnType<typeof WorkspacePublicNoteApproval.getRejectForm> =
        WorkspacePublicNoteApproval.getRejectForm({
          value: "v",
          workspaceType: workspaceType,
        });

      expect(form.title).toBe("Reject this public note?");
      expect(form.title.length).toBeLessThanOrEqual(24);
      expect(form.submitButtonTitle).toBe("Reject");
      expect(form.cancelButtonTitle).toBe("Cancel");
      expect(form.actionId).toBe(SlackActionType.SubmitRejectPublicNote);
      expect(form.actionValue).toBe("v");
      expect((form.blocks[0] as WorkspacePayloadMarkdown).text).toBe(
        "It will not be published. Its author sees your reason and can change the note and send it again.",
      );

      const reason: WorkspaceTextAreaBlock = form
        .blocks[1] as WorkspaceTextAreaBlock;

      expect(reason).toEqual({
        _type: "WorkspaceTextAreaBlock",
        label: "Why are you rejecting it?",
        blockId: PUBLIC_NOTE_REJECT_REASON_FIELD,
        placeholder:
          "e.g. Please do not name the vendor until legal has reviewed the wording.",
        description: "The author sees this.",
        optional: false,
        maxLength: PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
      });
    },
  );

  test("in Mattermost, its label fits the 24 characters a dialog's label takes", () => {
    const form: ReturnType<typeof WorkspacePublicNoteApproval.getRejectForm> =
      WorkspacePublicNoteApproval.getRejectForm({
        value: "v",
        workspaceType: WorkspaceType.Mattermost,
        recordLabel: "Incident INC-42",
        recordTitle: "**Checkout**",
      });

    const reason: WorkspaceTextAreaBlock = form
      .blocks[1] as WorkspaceTextAreaBlock;

    expect(reason.label.length).toBeLessThanOrEqual(
      MattermostUtil.DIALOG_LABEL_MAX_LENGTH,
    );
    expect(reason.description).toBe(
      "Why are you rejecting it? The author sees this.",
    );
    // The record is named, its title as text.
    expect((form.blocks[0] as WorkspacePayloadMarkdown).text).toContain(
      "Public note on **Incident INC-42** - ",
    );
    expect((form.blocks[0] as WorkspacePayloadMarkdown).text).not.toContain(
      "**Checkout**",
    );

    const dialog: JSONObject = MattermostUtil.getDialog({
      modalBlock: form,
      teamId: TEAM_ID,
      directMessageChannelId: CHANNEL_ID,
    });
    const element: JSONObject = (dialog["elements"] as Array<JSONObject>)[0]!;

    expect(element["display_name"]).toBe("Reason");
    expect(element["optional"]).toBe(false);
    expect(element["max_length"]).toBe(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH);
    expect(
      MattermostActionContext.readDialogState({
        state: dialog["state"],
        teamId: "",
        channelId: CHANNEL_ID,
      })?.actionId,
    ).toBe(SlackActionType.SubmitRejectPublicNote);
  });
});

describe("what a press asks to be connected for", () => {
  test("Approve, with a value this installation signed, is decided once connected", () => {
    const encoded: string = WorkspacePublicNoteApproval.encodeValue(value());
    const description: WorkspacePressDescription | null =
      WorkspacePublicNoteApproval.describePress({
        actionType: SlackActionType.ApprovePublicNote,
        actionValue: encoded,
      });

    expect(description).toEqual({
      purpose: "approve this public note",
      pendingAction: {
        kind: WorkspacePendingActionKind.ApprovePublicNote,
        eventType: WorkspaceEventType.Incident,
        eventId: INCIDENT_ID,
        publicNoteApproval: encoded,
      },
    });
  });

  test("Approve with any other value is only asked for: nothing is kept to finish", () => {
    expect(
      WorkspacePublicNoteApproval.describePress({
        actionType: SlackActionType.ApprovePublicNote,
        actionValue: NOTE_ID.toString(),
      }),
    ).toEqual({ purpose: "approve this public note" });
  });

  test("Reject, which asks why in a form, is pressed again", () => {
    for (const actionType of [
      SlackActionType.ViewRejectPublicNote,
      SlackActionType.SubmitRejectPublicNote,
    ]) {
      expect(
        WorkspacePublicNoteApproval.describePress({
          actionType: actionType,
          actionValue: WorkspacePublicNoteApproval.encodeValue(value()),
        }),
      ).toEqual({
        purpose: "reject this public note",
        again: {
          kind: WorkspaceConnectRequestAgainKind.Button,
          label: "Reject",
        },
      });
    }
  });

  test("any other press is not one of these", () => {
    expect(
      WorkspacePublicNoteApproval.describePress({
        actionType: SlackActionType.AcknowledgeIncident,
        actionValue: INCIDENT_ID.toString(),
      }),
    ).toBeNull();
  });
});

describe("the project a press is read in", () => {
  test("the one its value was signed for; nothing for a value not signed, or another press", () => {
    const encoded: string = WorkspacePublicNoteApproval.encodeValue(value());

    expect(
      WorkspacePublicNoteApproval.getSignedProjectId([
        { actionType: SlackActionType.AcknowledgeIncident, actionValue: "x" },
        { actionType: SlackActionType.ApprovePublicNote, actionValue: encoded },
      ]),
    ).toBe(PROJECT_ID.toString());

    expect(
      WorkspacePublicNoteApproval.getSignedProjectId([
        {
          actionType: SlackActionType.ApprovePublicNote,
          actionValue: "forged",
        },
        {
          actionType: SlackActionType.AcknowledgeIncident,
          actionValue: encoded,
        },
      ]),
    ).toBeUndefined();
  });

  test("the record a kind of note is on", () => {
    expect(
      WorkspacePublicNoteApproval.getEventType(PublicNoteKind.Incident),
    ).toBe(WorkspaceEventType.Incident);
    expect(
      WorkspacePublicNoteApproval.getEventType(PublicNoteKind.IncidentEpisode),
    ).toBe(WorkspaceEventType.IncidentEpisode);
    expect(
      WorkspacePublicNoteApproval.getEventType(
        PublicNoteKind.ScheduledMaintenance,
      ),
    ).toBe(WorkspaceEventType.ScheduledMaintenance);
  });

  test("which presses are an approval's", () => {
    for (const actionType of [
      SlackActionType.ApprovePublicNote,
      SlackActionType.ViewRejectPublicNote,
      SlackActionType.SubmitRejectPublicNote,
    ]) {
      expect(WorkspacePublicNoteApproval.isApprovalAction(actionType)).toBe(
        true,
      );
    }

    for (const actionType of [
      SlackActionType.ViewApproveRemediation,
      SlackActionType.OpenInOneUptime,
      undefined,
      "",
    ]) {
      expect(WorkspacePublicNoteApproval.isApprovalAction(actionType)).toBe(
        false,
      );
    }
  });
});

/*
 * THE MESSAGE IN PLACE OF ONE THAT ASKED (#6317): what happened, and View in
 * OneUptime - no Approve, no Reject - with the line a notification or a
 * screen reader shows.
 */
describe("the message that replaces an approval message", () => {
  const ANSWER: { markdown: string; text: string } = {
    markdown:
      "✅ This public note on [Incident INC-42](https://oneuptime.example/notes) was approved by **Bob**.",
    text: "This public note was approved",
  };

  test("says what happened, and keeps View in OneUptime to the note's record", () => {
    const message: WorkspaceDirectMessage =
      WorkspacePublicNoteApproval.getReplacementMessage({
        answer: ANSWER,
        notesUrl: "https://oneuptime.example/notes",
      });

    expect(message.notificationText).toBe("This public note was approved");
    expect(message.messageBlocks).toHaveLength(2);
    expect((message.messageBlocks[0] as WorkspacePayloadMarkdown).text).toBe(
      ANSWER.markdown,
    );

    const buttons: Array<WorkspaceMessagePayloadButton> = (
      message.messageBlocks[1] as WorkspacePayloadButtons
    ).buttons;

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return [button.title, button.actionId, button.url?.toString()];
      }),
    ).toEqual([
      [
        "View in OneUptime",
        SlackActionType.OpenInOneUptime,
        "https://oneuptime.example/notes",
      ],
    ]);
  });

  test("with no record left to open - or none that is a web address - it is the words alone", () => {
    for (const notesUrl of [undefined, "", "not a web address"]) {
      const message: WorkspaceDirectMessage =
        WorkspacePublicNoteApproval.getReplacementMessage({
          answer: ANSWER,
          notesUrl: notesUrl,
        });

      expect(message.messageBlocks).toHaveLength(1);
      expect(message.messageBlocks[0]!._type).toBe("WorkspacePayloadMarkdown");
    }
  });

  test("nothing on it asks: no Approve, no Reject, in any chat", () => {
    const message: WorkspaceDirectMessage =
      WorkspacePublicNoteApproval.getReplacementMessage({
        answer: ANSWER,
        notesUrl: "https://oneuptime.example/notes",
      });

    const slack: string = JSON.stringify(
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: message.messageBlocks,
      }),
    );
    const teams: string = JSON.stringify(
      MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
        messageBlocks: message.messageBlocks,
      }),
    );

    for (const sent of [slack, teams]) {
      expect(sent).not.toContain(SlackActionType.ApprovePublicNote);
      expect(sent).not.toContain(SlackActionType.ViewRejectPublicNote);
    }
  });
});
