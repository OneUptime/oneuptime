import { describe, expect, test } from "@jest/globals";
import type { WorkspaceMarkdownNotification } from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceMarkdownNotificationJSON, {
  STORED_MESSAGE_FIELDS,
  STORED_WORKSPACE_NOTIFICATION_FIELDS,
} from "../../../../Server/Utils/Workspace/WorkspaceMarkdownNotificationJSON";
import BadDataException from "../../../../Types/Exception/BadDataException";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { NotificationRuleUpdateKind } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import { WorkspaceMessageBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

/*
 * WHAT ANOTHER APP SERVER POSTS A HELD MESSAGE FROM (#11235).
 *
 * A message about a record being created waits in Valkey for the record's
 * Created message, stored with what it says, so another App server posts it
 * should the one that made it be killed before its turn
 * (WorkspaceCreatedMessageFirst). Here, what is stored of it: every field
 * a message is posted with, as it was sent, and nothing else - no token,
 * no function of the server that made it - read back exactly as it was,
 * and a stored message that is not one refused rather than posted where it
 * should not be.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11235000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "11235000-0000-4000-8000-000000000002",
);
const AUTHOR_ID: ObjectID = new ObjectID(
  "11235000-0000-4000-8000-000000000003",
);

// A message about an incident, with every field it can be posted with.
function everyField(): WorkspaceMarkdownNotification {
  return {
    projectId: PROJECT_ID,
    notificationFor: { incidentId: INCIDENT_ID },
    feedInfoInMarkdown: "👤 Added **Valeria** to the Incident as **Incident Commander**.",
    notificationText: "Added Valeria as Incident Commander",
    markdownByWorkspaceType: {
      [WorkspaceType.Slack]: "Added <@U0VALERIA> as Incident Commander",
      [WorkspaceType.MicrosoftTeams]: "Added <at>Valeria</at> as Incident Commander",
    },
    mentionsByWorkspaceType: {
      [WorkspaceType.Slack]: [
        { text: "<@U0VALERIA>", workspaceUserId: "U0VALERIA", name: "valeria" },
      ],
      [WorkspaceType.MicrosoftTeams]: [
        {
          text: "<at>Valeria</at>",
          workspaceUserId: "00000000-aaaa-4bbb-8ccc-000000000001",
          name: "Valeria",
        },
      ],
    },
    workspaceNotification: {
      authorUserId: AUTHOR_ID,
      authorApiKeyName: "Terraform",
      sendWorkspaceNotification: true,
      appendMessageBlocks: [
        {
          workspaceType: WorkspaceType.Slack,
          messageBlocks: [
            {
              _type: "WorkspacePayloadButtons",
              buttons: [
                {
                  _type: "WorkspaceMessagePayloadButton",
                  title: "Join the call",
                  value: "join",
                  actionId: "join-call",
                  url: URL.fromString("https://meet.example.com/inc-42"),
                  isPrimary: true,
                },
              ],
            } as WorkspaceMessageBlock,
            {
              _type: "WorkspaceDateTimePickerBlock",
              label: "Resolve by",
              blockId: "resolve-by",
              initialDateTime: new Date("2026-11-27T10:15:00.000Z"),
            } as WorkspaceMessageBlock,
          ],
        },
      ],
      keepPostsAs: "incident-commander:11235",
      exceptChannel: {
        workspaceType: WorkspaceType.Slack,
        channelId: "C0EXIST",
      },
      updateKinds: [NotificationRuleUpdateKind.Owners],
      alsoWantedUpdateKinds: [NotificationRuleUpdateKind.StateChanges],
      notWantedUpdateKinds: [NotificationRuleUpdateKind.PrivateNotes],
      mentioning: true,
    },
  };
}

// What is stored, as Valkey keeps it: JSON text, read back.
function throughValkey(message: WorkspaceMarkdownNotification): JSONObject {
  return JSON.parse(
    JSON.stringify(WorkspaceMarkdownNotificationJSON.toJSON(message)),
  ) as JSONObject;
}

function readBack(
  message: WorkspaceMarkdownNotification,
): WorkspaceMarkdownNotification {
  return WorkspaceMarkdownNotificationJSON.fromJSON(throughValkey(message));
}

// A stored message with one field of its own changed.
function storedWith(
  change: (stored: JSONObject) => void,
  message: WorkspaceMarkdownNotification = everyField(),
): JSONObject {
  const stored: JSONObject = throughValkey(message);
  change(stored["workspaceMarkdownNotification"] as JSONObject);
  return stored;
}

describe("every field of a message is decided on", () => {
  test("the message's own fields: all stored", () => {
    expect(STORED_MESSAGE_FIELDS).toEqual({
      projectId: true,
      notificationFor: true,
      feedInfoInMarkdown: true,
      notificationText: true,
      markdownByWorkspaceType: true,
      mentionsByWorkspaceType: true,
      workspaceNotification: true,
    });
  });

  test("how it is posted: all stored but the function that is told where it went, and the flag a kept message never has", () => {
    expect(STORED_WORKSPACE_NOTIFICATION_FIELDS).toEqual({
      authorUserId: true,
      authorApiKeyName: true,
      sendWorkspaceNotification: true,
      appendMessageBlocks: true,
      keepPostsAs: true,
      exceptChannel: true,
      updateKinds: true,
      alsoWantedUpdateKinds: true,
      notWantedUpdateKinds: true,
      mentioning: true,
      onPosted: false,
      announcesRecord: false,
    });
  });
});

describe("a stored message reads back as it was sent", () => {
  test("with every field it can be posted with", () => {
    expect(readBack(everyField())).toEqual(everyField());
  });

  test("its ids are ids again, its links links and its times times", () => {
    const message: WorkspaceMarkdownNotification = readBack(everyField());

    expect(message.projectId).toBeInstanceOf(ObjectID);
    expect(message.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(message.notificationFor.incidentId).toBeInstanceOf(ObjectID);
    expect(message.workspaceNotification.authorUserId).toBeInstanceOf(ObjectID);

    const blocks: Array<JSONObject> = message.workspaceNotification
      .appendMessageBlocks![0]!.messageBlocks as unknown as Array<JSONObject>;
    const button: JSONObject = (blocks[0]!["buttons"] as Array<JSONObject>)[0]!;

    expect(button["url"]).toBeInstanceOf(URL);
    expect(String(button["url"])).toBe("https://meet.example.com/inc-42");
    expect(blocks[1]!["initialDateTime"]).toBeInstanceOf(Date);
    expect((blocks[1]!["initialDateTime"] as Date).toISOString()).toBe(
      "2026-11-27T10:15:00.000Z",
    );
  });

  test("with only the fields every message has", () => {
    const message: WorkspaceMarkdownNotification = {
      projectId: PROJECT_ID,
      notificationFor: { incidentId: INCIDENT_ID },
      feedInfoInMarkdown: "Added team Platform to the Incident as the owner.",
      workspaceNotification: { sendWorkspaceNotification: true },
    };

    expect(readBack(message)).toEqual(message);
  });

  test.each([
    ["an incident", { incidentId: INCIDENT_ID }],
    ["an alert", { alertId: INCIDENT_ID }],
    ["an incident episode", { incidentEpisodeId: INCIDENT_ID }],
    ["an alert episode", { alertEpisodeId: INCIDENT_ID }],
    ["a maintenance event", { scheduledMaintenanceId: INCIDENT_ID }],
    ["a monitor", { monitorId: INCIDENT_ID }],
    ["an on-call policy", { onCallDutyPolicyId: INCIDENT_ID }],
  ])(
    "about %s, as every kind of record its create holds messages for",
    (_kind: string, notificationFor: JSONObject) => {
      const message: WorkspaceMarkdownNotification = {
        ...everyField(),
        notificationFor:
          notificationFor as unknown as WorkspaceMarkdownNotification["notificationFor"],
      };

      expect(readBack(message).notificationFor).toEqual(notificationFor);
    },
  );

  test("text in any script, and Markdown, stays as it was", () => {
    const message: WorkspaceMarkdownNotification = {
      ...everyField(),
      feedInfoInMarkdown:
        "📝 **Note** by Zoë: `kubectl rollout undo` — 東京 eu-west-1 \"quoted\" \\ back\\slash\nsecond line",
    };

    expect(readBack(message).feedInfoInMarkdown).toBe(
      message.feedInfoInMarkdown,
    );
  });
});

describe("nothing more than the message is stored", () => {
  test("its fields, under one key that says what it is", () => {
    const stored: JSONObject = throughValkey(everyField());

    expect(Object.keys(stored)).toEqual(["workspaceMarkdownNotification"]);
    expect(
      Object.keys(stored["workspaceMarkdownNotification"] as JSONObject).sort(),
    ).toEqual(
      [
        "feedInfoInMarkdown",
        "markdownByWorkspaceType",
        "mentionsByWorkspaceType",
        "notificationFor",
        "notificationText",
        "projectId",
        "workspaceNotification",
      ].sort(),
    );
  });

  test("the function that is told where it was posted is not stored, nor the flag a Created message has", () => {
    const message: WorkspaceMarkdownNotification = everyField();
    message.workspaceNotification.onPosted = (): void => {
      // told on the server that made it
    };
    message.workspaceNotification.announcesRecord = true;

    const stored: JSONObject = throughValkey(message);
    const workspaceNotification: JSONObject = (
      stored["workspaceMarkdownNotification"] as JSONObject
    )["workspaceNotification"] as JSONObject;

    expect(Object.keys(workspaceNotification)).not.toContain("onPosted");
    expect(Object.keys(workspaceNotification)).not.toContain("announcesRecord");
    expect(readBack(message)).toEqual(everyField());
  });

  test("a field a message does not have is not stored: a token, a password, anything", () => {
    const message: WorkspaceMarkdownNotification = everyField();

    // Fields no message has, as a caller might hand them along by mistake.
    (message as unknown as JSONObject)["authToken"] = "xoxb-a-slack-bot-token";
    (message.workspaceNotification as unknown as JSONObject)["password"] =
      "the database password";

    const text: string = JSON.stringify(
      WorkspaceMarkdownNotificationJSON.toJSON(message),
    );

    expect(text).not.toContain("xoxb-a-slack-bot-token");
    expect(text).not.toContain("the database password");
    expect(readBack(message)).toEqual(everyField());
  });

  test("the person it is from is stored as their id, not as who they are", () => {
    const stored: JSONObject = throughValkey(everyField());
    const workspaceNotification: JSONObject = (
      stored["workspaceMarkdownNotification"] as JSONObject
    )["workspaceNotification"] as JSONObject;

    expect(workspaceNotification["authorUserId"]).toEqual({
      _type: "ObjectID",
      value: AUTHOR_ID.toString(),
    });
  });

  test("what is stored is plain JSON: Valkey keeps it as text", () => {
    const stored: JSONObject = WorkspaceMarkdownNotificationJSON.toJSON(
      everyField(),
    );

    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });
});

describe("a stored message that is not one is refused, not posted", () => {
  test.each([
    ["nothing at all", {}],
    ["another kind of stored message", { somethingElse: { feedInfoInMarkdown: "x" } }],
    ["a list", { workspaceMarkdownNotification: [] as unknown as JSONObject }],
    ["text", { workspaceMarkdownNotification: "a message" }],
  ])("%s", (_what: string, stored: JSONObject) => {
    expect(() => {
      return WorkspaceMarkdownNotificationJSON.fromJSON(stored);
    }).toThrow(BadDataException);
  });

  test.each([
    [
      "no project",
      (message: JSONObject): void => {
        delete message["projectId"];
      },
    ],
    [
      "a project that is not an id",
      (message: JSONObject): void => {
        message["projectId"] = "11235000-0000-4000-8000-000000000001";
      },
    ],
    [
      "no text",
      (message: JSONObject): void => {
        delete message["feedInfoInMarkdown"];
      },
    ],
    [
      "text that is not text",
      (message: JSONObject): void => {
        message["feedInfoInMarkdown"] = 42;
      },
    ],
    [
      "no record",
      (message: JSONObject): void => {
        delete message["notificationFor"];
      },
    ],
    [
      "a record whose id is not an id",
      (message: JSONObject): void => {
        message["notificationFor"] = { incidentId: "INC-42" };
      },
    ],
    [
      "nothing on how it is posted",
      (message: JSONObject): void => {
        delete message["workspaceNotification"];
      },
    ],
    [
      "no word on whether it is posted",
      (message: JSONObject): void => {
        delete (message["workspaceNotification"] as JSONObject)[
          "sendWorkspaceNotification"
        ];
      },
    ],
    [
      "notification text that is not text",
      (message: JSONObject): void => {
        message["notificationText"] = { text: "x" };
      },
    ],
    [
      "text by workspace that is a list",
      (message: JSONObject): void => {
        message["markdownByWorkspaceType"] = ["x"];
      },
    ],
    [
      "mentions by workspace that are text",
      (message: JSONObject): void => {
        message["mentionsByWorkspaceType"] = "x";
      },
    ],
  ])("%s", (_what: string, change: (message: JSONObject) => void) => {
    expect(() => {
      return WorkspaceMarkdownNotificationJSON.fromJSON(storedWith(change));
    }).toThrow(BadDataException);
  });

  test.each([
    ["authorUserId", "not an id"],
    ["authorApiKeyName", 7],
    ["sendWorkspaceNotification", "yes"],
    ["appendMessageBlocks", { workspaceType: "Slack" }],
    ["keepPostsAs", { key: "x" }],
    ["exceptChannel", "C0EXIST"],
    ["updateKinds", "Owners"],
    ["alsoWantedUpdateKinds", "StateChanges"],
    ["notWantedUpdateKinds", 1],
    ["mentioning", "true"],
  ])(
    "how it is posted, with a %s that is not what it holds: it could post where it should not",
    (field: string, value: unknown) => {
      expect(() => {
        return WorkspaceMarkdownNotificationJSON.fromJSON(
          storedWith((message: JSONObject): void => {
            (message["workspaceNotification"] as JSONObject)[field] =
              value as JSONObject;
          }),
        );
      }).toThrow(BadDataException);
    },
  );

  test("a field it does not store, found in what was stored, is not passed on", () => {
    const stored: JSONObject = storedWith((message: JSONObject): void => {
      (message["workspaceNotification"] as JSONObject)["announcesRecord"] = true;
      (message["workspaceNotification"] as JSONObject)["onPosted"] = "a function";
      (message["workspaceNotification"] as JSONObject)["somethingNew"] = 1;
    });

    const message: WorkspaceMarkdownNotification =
      WorkspaceMarkdownNotificationJSON.fromJSON(stored);

    expect(message.workspaceNotification.announcesRecord).toBeUndefined();
    expect(message.workspaceNotification.onPosted).toBeUndefined();
    expect(
      Object.keys(message.workspaceNotification as unknown as JSONObject),
    ).not.toContain("somethingNew");
    expect(message).toEqual(everyField());
  });
});
