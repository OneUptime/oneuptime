import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import ChatCarriedRecords, {
  MAX_CHAT_MESSAGES_READ,
} from "../../../../Server/Utils/AI/Chat/ChatCarriedRecords";
import PrivateRecordPermission from "../../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIChatPageContextType from "../../../../Types/AI/AIChatPageContext";
import {
  AIChatCitation,
  AIChatCitationTargetType,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";
import { CarriedRecordIds } from "../../../../Types/AI/CarriedRecords";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT A PULL REQUEST A CHAT OPENS CARRIES (#9186): the chat's subject - the
 * incident or alert whose AI conversation it is, or the one Ask AI was asked
 * about - read as OneUptime.
 */

const CONVERSATION_ID: ObjectID = new ObjectID(
  "8c2e3f40-5162-4a73-8c84-9da5eb6f7081",
);
const INCIDENT: string = "8c2e3f40-5162-4a73-8c84-9da5eb6f7082";
const ALERT: string = "8c2e3f40-5162-4a73-8c84-9da5eb6f7083";
const OTHER_INCIDENT: string = "8c2e3f40-5162-4a73-8c84-9da5eb6f7084";

function conversation(values: {
  incidentId?: string | undefined;
  alertId?: string | undefined;
}): AIConversation {
  const row: AIConversation = new AIConversation();
  row._id = CONVERSATION_ID.toString();

  if (values.incidentId) {
    row.incidentId = new ObjectID(values.incidentId);
  }

  if (values.alertId) {
    row.alertId = new ObjectID(values.alertId);
  }

  return row;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a chat's pull request carries", () => {
  test("the incident whose AI conversation it is", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(conversation({ incidentId: INCIDENT }));

    expect(
      await ChatCarriedRecords.ofChat({ conversationId: CONVERSATION_ID }),
    ).toEqual({ incidentIds: [INCIDENT], alertIds: [] });

    // Read as OneUptime: what the chat is about, not what the person may read.
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CONVERSATION_ID,
        props: { isRoot: true },
      }),
    );
  });

  test("the alert whose AI conversation it is", async () => {
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(conversation({ alertId: ALERT }));

    expect(
      await ChatCarriedRecords.ofChat({ conversationId: CONVERSATION_ID }),
    ).toEqual({ incidentIds: [], alertIds: [ALERT] });
  });

  test.each([
    [AIChatPageContextType.Incident, { incidentIds: [INCIDENT], alertIds: [] }],
    [AIChatPageContextType.Alert, { incidentIds: [], alertIds: [INCIDENT] }],
  ])(
    "the %s Ask AI was asked about, with no conversation of a record's",
    async (type: AIChatPageContextType, carried: CarriedRecordIds) => {
      jest
        .spyOn(AIConversationService, "findOneById")
        .mockResolvedValue(conversation({}));

      expect(
        await ChatCarriedRecords.ofChat({
          conversationId: CONVERSATION_ID,
          pageContext: { type, entityId: INCIDENT },
        }),
      ).toEqual(carried);
    },
  );

  test("both, each once: the conversation's subject and the page it was asked from", async () => {
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(conversation({ incidentId: INCIDENT }));

    expect(
      await ChatCarriedRecords.ofChat({
        conversationId: CONVERSATION_ID,
        pageContext: {
          type: AIChatPageContextType.Incident,
          entityId: INCIDENT.toUpperCase(),
        },
      }),
    ).toEqual({ incidentIds: [INCIDENT], alertIds: [] });

    expect(
      await ChatCarriedRecords.ofChat({
        conversationId: CONVERSATION_ID,
        pageContext: {
          type: AIChatPageContextType.Incident,
          entityId: OTHER_INCIDENT,
        },
      }),
    ).toEqual({ incidentIds: [OTHER_INCIDENT, INCIDENT], alertIds: [] });
  });

  test.each([
    [AIChatPageContextType.Monitor],
    [AIChatPageContextType.Exception],
    [AIChatPageContextType.IncidentsList],
    [AIChatPageContextType.LogsExplorer],
  ])(
    "nothing for a chat about a %s page and no record's conversation",
    async (type: AIChatPageContextType) => {
      jest
        .spyOn(AIConversationService, "findOneById")
        .mockResolvedValue(conversation({}));

      expect(
        await ChatCarriedRecords.ofChat({
          conversationId: CONVERSATION_ID,
          pageContext: { type, entityId: INCIDENT },
        }),
      ).toEqual({ incidentIds: [], alertIds: [] });
    },
  );

  test("nothing, and no read, with no chat to read", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AIConversationService,
      "findOneById",
    );

    expect(await ChatCarriedRecords.ofChat({})).toEqual({
      incidentIds: [],
      alertIds: [],
    });
    expect(read).not.toHaveBeenCalled();
  });

  test("a conversation that is gone carries what the page says, and nothing more", async () => {
    jest.spyOn(AIConversationService, "findOneById").mockResolvedValue(null);

    expect(
      await ChatCarriedRecords.ofChat({
        conversationId: CONVERSATION_ID,
        pageContext: { type: AIChatPageContextType.Alert, entityId: ALERT },
      }),
    ).toEqual({ incidentIds: [], alertIds: [ALERT] });
  });

  test("a chat that cannot be read stops the pull request: the error reaches the tool", async () => {
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockRejectedValue(new Error("Postgres is down"));

    await expect(
      ChatCarriedRecords.ofChat({ conversationId: CONVERSATION_ID }),
    ).rejects.toThrow("Postgres is down");
  });
});

/*
 * #9242: what the chat read, besides its subject - every incident and alert
 * it opened one by one, and those of its lists the pull request quotes -
 * read from its newest messages, as OneUptime.
 */
describe("a chat's pull request also carries what the chat read", () => {
  const OPENED_INCIDENT: string = "8c2e3f40-5162-4a73-8c84-9da5eb6f7085";
  const OPENED_ALERT: string = "8c2e3f40-5162-4a73-8c84-9da5eb6f7086";
  const LISTED_INCIDENT: string = "8c2e3f40-5162-4a73-8c84-9da5eb6f7087";
  const QUOTED_INCIDENT: string = "8c2e3f40-5162-4a73-8c84-9da5eb6f7088";

  function opened(
    type: AIChatCitationTargetType,
    params: Record<string, string>,
    rowCount: number = 1,
  ): AIChatCitation {
    return {
      id: "C1",
      toolName: "get_incident",
      label: "Incident #12",
      queryArguments: params,
      rowCount,
      target: { type, params },
    };
  }

  function message(values: {
    citations?: Array<AIChatCitation>;
    widgets?: Array<AIChatWidget>;
  }): AIConversationMessage {
    const row: AIConversationMessage = new AIConversationMessage();

    if (values.citations) {
      row.citations = values.citations;
    }

    if (values.widgets) {
      row.widgets = values.widgets;
    }

    return row;
  }

  function incidentList(
    items: Array<{ id: string; title: string }>,
  ): AIChatWidget {
    return {
      id: "W1",
      type: AIChatWidgetType.IncidentList,
      title: "Incidents",
      data: { items },
    };
  }

  test("every incident and alert it opened one by one, in any answer, with its subject", async () => {
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(conversation({ incidentId: INCIDENT }));
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AIConversationMessageService, "findBy")
      .mockResolvedValue([
        message({
          citations: [
            opened(AIChatCitationTargetType.IncidentView, {
              incidentId: OPENED_INCIDENT,
            }),
          ],
        }),
        message({
          citations: [
            opened(AIChatCitationTargetType.AlertView, {
              alertId: OPENED_ALERT.toUpperCase(),
            }),
          ],
        }),
      ]);

    expect(
      await ChatCarriedRecords.ofPullRequest({
        conversationId: CONVERSATION_ID,
        title: "fix: retry the charge",
        description: "Retries the charge once.",
      }),
    ).toEqual({
      incidentIds: [INCIDENT, OPENED_INCIDENT],
      alertIds: [OPENED_ALERT],
    });

    // Read as OneUptime, newest first, a bound of messages: what the chat read.
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { conversationId: CONVERSATION_ID },
        select: { _id: true, citations: true, widgets: true },
        limit: MAX_CHAT_MESSAGES_READ,
        props: { isRoot: true },
      }),
    );
    expect(MAX_CHAT_MESSAGES_READ).toBeGreaterThanOrEqual(40);
  });

  test("a list's rows only when the pull request quotes one's title", async () => {
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(conversation({}));
    jest.spyOn(AIConversationMessageService, "findBy").mockResolvedValue([
      message({
        widgets: [
          incidentList([
            { id: LISTED_INCIDENT, title: "Search is slow for everyone" },
            { id: QUOTED_INCIDENT, title: "Checkout fails for EU cards" },
          ]),
        ],
      }),
    ]);

    expect(
      await ChatCarriedRecords.ofPullRequest({
        conversationId: CONVERSATION_ID,
        title: "fix: guard the card",
        description:
          "This fixes what was behind CHECKOUT  FAILS for EU cards last week.",
      }),
    ).toEqual({ incidentIds: [QUOTED_INCIDENT], alertIds: [] });
  });

  test("a chat that opened none and quotes none carries only its subject", async () => {
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(conversation({}));
    jest.spyOn(AIConversationMessageService, "findBy").mockResolvedValue([
      message({
        citations: [
          // A list names no one record.
          {
            id: "C1",
            toolName: "query_incidents",
            label: "Incidents",
            queryArguments: {},
            rowCount: 12,
            target: { type: AIChatCitationTargetType.Incidents },
          },
          // A record it looked for and did not find.
          opened(
            AIChatCitationTargetType.IncidentView,
            { incidentId: OPENED_INCIDENT },
            0,
          ),
        ],
        widgets: [
          incidentList([
            { id: LISTED_INCIDENT, title: "Search is slow for everyone" },
          ]),
        ],
      }),
    ]);

    expect(
      await ChatCarriedRecords.ofPullRequest({
        conversationId: CONVERSATION_ID,
        title: "fix: cache the search",
        description: "Caches the search results.",
      }),
    ).toEqual({ incidentIds: [], alertIds: [] });
  });

  test("no chat: no messages are read, only the page's subject", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AIConversationMessageService,
      "findBy",
    );

    expect(
      await ChatCarriedRecords.ofPullRequest({
        pageContext: { type: AIChatPageContextType.Alert, entityId: ALERT },
        title: "fix",
        description: "why",
      }),
    ).toEqual({ incidentIds: [], alertIds: [ALERT] });
    expect(read).not.toHaveBeenCalled();
  });

  test("messages that cannot be read stop the pull request", async () => {
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(conversation({}));
    jest
      .spyOn(AIConversationMessageService, "findBy")
      .mockRejectedValue(new Error("Postgres is down"));

    await expect(
      ChatCarriedRecords.ofPullRequest({
        conversationId: CONVERSATION_ID,
        title: "fix",
        description: "why",
      }),
    ).rejects.toThrow("Postgres is down");
  });
});

/*
 * A conversation that names a private record of a kind the pull request
 * would not carry would leave that record out of the rule: every key of a
 * conversation naming a record that can be private is one ofChat reads.
 */
describe("every record a chat can be about", () => {
  test("is a kind the pull request carries", () => {
    const model: AIConversation = new AIConversation();
    const named: Array<string> = [];

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      if (metadata?.type !== TableColumnType.Entity || !metadata.modelType) {
        continue;
      }

      const tableName: string = new metadata.modelType().tableName as string;

      if (PrivateRecordPermission.getKind(tableName)) {
        named.push(`${metadata.manyToOneRelationColumn} -> ${tableName}`);
      }
    }

    expect(named.sort()).toEqual(
      ["alertId -> Alert", "incidentId -> Incident"].sort(),
    );
  });
});
