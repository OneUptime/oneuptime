import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import FeedApiKeyActorUtil, {
  FeedApiKeyActor,
  UNNAMED_API_KEY_NAME,
} from "../../../Server/Utils/Feed/FeedApiKeyActor";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../Types/Database/ColumnLength";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../../Server/Utils/Logger");

/*
 * WHO AN INCIDENT FEED ITEM IS BY WHEN NO PERSON MADE THE CHANGE: THE
 * PROJECT API KEY THAT DID (IncidentFeed.apiKeyId and apiKeyName, through
 * Server/Utils/Feed/FeedApiKeyActor).
 *
 * An incident Jira Automation opens with a project API key, the notes it
 * posts and the states it sets read in the incident's feed with the key's
 * name, as the audit log already shows them; a person's change still shows
 * the person. The item keeps the name the key had then.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4f000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "4f000000-0000-4000-8000-000000000002",
);
const API_KEY_ID: ObjectID = new ObjectID(
  "4f000000-0000-4000-8000-000000000003",
);
const USER_ID: ObjectID = new ObjectID("4f000000-0000-4000-8000-000000000004");

const keyRequest: (
  extra?: Partial<DatabaseCommonInteractionProps>,
) => DatabaseCommonInteractionProps = (
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps => {
  return {
    tenantId: PROJECT_ID,
    apiKeyId: API_KEY_ID,
    apiKeyName: "Jira Automation",
    ...extra,
  };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FeedApiKeyActorUtil.fromProps", () => {
  test("a project API key's request is by the key, with its name", () => {
    expect(FeedApiKeyActorUtil.fromProps(keyRequest())).toEqual({
      apiKeyId: API_KEY_ID,
      apiKeyName: "Jira Automation",
    });
  });

  test("a person's request is by the person, whose name the feed already shows", () => {
    expect(
      FeedApiKeyActorUtil.fromProps(keyRequest({ userId: USER_ID })),
    ).toEqual({});
    expect(
      FeedApiKeyActorUtil.fromProps({ tenantId: PROJECT_ID, userId: USER_ID }),
    ).toEqual({});
  });

  test("the master API key acts for a server admin, and names no project key", () => {
    expect(
      FeedApiKeyActorUtil.fromProps({
        userId: USER_ID,
        apiKeyName: "Master API Key",
      }),
    ).toEqual({});
    expect(FeedApiKeyActorUtil.fromProps({ apiKeyName: "Master" })).toEqual({});
  });

  test("an MCP client acts for the member who connected it", () => {
    expect(
      FeedApiKeyActorUtil.fromProps({
        userId: USER_ID,
        mcpClientName: "Some Client",
      }),
    ).toEqual({});
  });

  test("OneUptime's own write, with nothing behind it, is by no one", () => {
    expect(FeedApiKeyActorUtil.fromProps({ isRoot: true })).toEqual({});
    expect(FeedApiKeyActorUtil.fromProps(null)).toEqual({});
    expect(FeedApiKeyActorUtil.fromProps(undefined)).toEqual({});
  });

  test.each([undefined, "", "   "])(
    "a key with no name (%p) is called what a key is",
    (name: string | undefined) => {
      expect(
        FeedApiKeyActorUtil.fromProps(keyRequest({ apiKeyName: name })),
      ).toEqual({ apiKeyId: API_KEY_ID, apiKeyName: UNNAMED_API_KEY_NAME });
    },
  );

  test("the name is trimmed, and cut to what the column holds", () => {
    expect(
      FeedApiKeyActorUtil.fromProps(keyRequest({ apiKeyName: "  CI key  " }))
        .apiKeyName,
    ).toBe("CI key");

    const long: string = "k".repeat(ColumnLength.ShortText + 40);
    expect(
      FeedApiKeyActorUtil.fromProps(keyRequest({ apiKeyName: long }))
        .apiKeyName,
    ).toHaveLength(ColumnLength.ShortText);
  });
});

describe("FeedApiKeyActorUtil.toProps", () => {
  test("carries the key, and only the key, to a write OneUptime makes for it", () => {
    expect(
      FeedApiKeyActorUtil.toProps({
        apiKeyId: API_KEY_ID,
        apiKeyName: "Jira Automation",
      }),
    ).toEqual({ apiKeyId: API_KEY_ID, apiKeyName: "Jira Automation" });
  });

  test("carries nothing without a key", () => {
    expect(FeedApiKeyActorUtil.toProps({})).toEqual({});
    expect(FeedApiKeyActorUtil.toProps({ apiKeyName: "orphan" })).toEqual({});
    expect(FeedApiKeyActorUtil.toProps(null)).toEqual({});
    expect(FeedApiKeyActorUtil.toProps(undefined)).toEqual({});
  });

  test("goes back and forth: the follow-on write's feed item names the same key", () => {
    const actor: FeedApiKeyActor = FeedApiKeyActorUtil.fromProps(keyRequest());

    expect(
      FeedApiKeyActorUtil.fromProps({
        isRoot: true,
        ...FeedApiKeyActorUtil.toProps(actor),
      }),
    ).toEqual(actor);
  });
});

describe("the incident feed's columns", () => {
  const feed: IncidentFeed = new IncidentFeed();

  test("API Key ID is an id, and API Key Name short text, both optional", () => {
    expect(feed.getTableColumnMetadata("apiKeyId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(feed.getTableColumnMetadata("apiKeyId").required).not.toBe(true);
    expect(feed.getTableColumnMetadata("apiKeyName").type).toBe(
      TableColumnType.ShortText,
    );
    expect(feed.getTableColumnMetadata("apiKeyName").required).not.toBe(true);
  });

  test.each(["apiKeyId", "apiKeyName"])(
    "%s is written by OneUptime only: no one can create or change it",
    (column: string) => {
      const access: {
        read: Array<Permission>;
        create: Array<Permission>;
        update: Array<Permission>;
      } = feed.getColumnAccessControlFor(column)!;

      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
    },
  );

  test.each(["apiKeyId", "apiKeyName"])(
    "%s is read by whoever reads the feed item",
    (column: string) => {
      expect(feed.getColumnAccessControlFor(column)!.read).toEqual(
        feed.getColumnAccessControlFor("feedInfoInMarkdown")!.read,
      );
    },
  );
});

describe("IncidentFeedService.createIncidentFeedItem", () => {
  async function createWith(
    data: Partial<
      Parameters<typeof IncidentFeedService.createIncidentFeedItem>[0]
    >,
  ): Promise<IncidentFeed> {
    const create: jest.SpiedFunction<typeof IncidentFeedService.create> = jest
      .spyOn(IncidentFeedService, "create")
      .mockResolvedValue(new IncidentFeed());

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      incidentFeedEventType: IncidentFeedEventType.PublicNote,
      feedInfoInMarkdown: "posted a public note",
      ...data,
    });

    const createCall: CreateBy<IncidentFeed> = create.mock.calls[0]![0];
    expect(createCall.props).toEqual({ isRoot: true });
    return createCall.data;
  }

  test("keeps the key's id and name on an item no person made", async () => {
    const row: IncidentFeed = await createWith({
      apiKeyActor: { apiKeyId: API_KEY_ID, apiKeyName: "Jira Automation" },
    });

    expect(row.apiKeyId).toEqual(API_KEY_ID);
    expect(row.apiKeyName).toBe("Jira Automation");
    expect(row.userId).toBeUndefined();
  });

  test("a person who made the change is the author, and no key is kept", async () => {
    const row: IncidentFeed = await createWith({
      userId: USER_ID,
      apiKeyActor: { apiKeyId: API_KEY_ID, apiKeyName: "Jira Automation" },
    });

    expect(row.userId).toEqual(USER_ID);
    expect(row.apiKeyId).toBeUndefined();
    expect(row.apiKeyName).toBeUndefined();
  });

  test("a key given with no name is called what a key is", async () => {
    const row: IncidentFeed = await createWith({
      apiKeyActor: { apiKeyId: API_KEY_ID },
    });

    expect(row.apiKeyName).toBe(UNNAMED_API_KEY_NAME);
  });

  test("no key, no author: as every item was before", async () => {
    for (const apiKeyActor of [undefined, {}, { apiKeyName: "orphan" }]) {
      jest.restoreAllMocks();
      const row: IncidentFeed = await createWith({ apiKeyActor });

      expect(row.apiKeyId).toBeUndefined();
      expect(row.apiKeyName).toBeUndefined();
    }
  });
});

describe("a public note posted with an API key", () => {
  async function postedWith(
    props: DatabaseCommonInteractionProps,
  ): Promise<Record<string, unknown>> {
    const feedItem: jest.SpiedFunction<
      typeof IncidentFeedService.createIncidentFeedItem
    > = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(new IncidentFeed());
    jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
      number: 12,
      numberWithPrefix: "INC-12",
    });
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.example/inc/12"));
    jest
      .spyOn(
        IncidentPublicNoteService as unknown as {
          getAttachmentsMarkdown: () => Promise<string>;
        },
        "getAttachmentsMarkdown",
      )
      .mockResolvedValue("");

    const note: IncidentPublicNote = new IncidentPublicNote();
    note.id = ObjectID.generate();
    note.incidentId = INCIDENT_ID;
    note.projectId = PROJECT_ID;
    note.note = "We are looking into it.";

    if (props.userId) {
      note.createdByUserId = props.userId;
    }

    await IncidentPublicNoteService.onCreateSuccess(
      {
        createBy: { data: note, props: props },
        carryForward: null,
      } as OnCreate<IncidentPublicNote>,
      note,
    );

    expect(feedItem).toHaveBeenCalledTimes(1);
    return feedItem.mock.calls[0]![0] as unknown as Record<string, unknown>;
  }

  test("its feed item names the key", async () => {
    const item: Record<string, unknown> = await postedWith(keyRequest());

    expect(item["apiKeyActor"]).toEqual({
      apiKeyId: API_KEY_ID,
      apiKeyName: "Jira Automation",
    });
    expect(item["userId"]).toBeUndefined();
  });

  test("a person's note names the person, not a key", async () => {
    const item: Record<string, unknown> = await postedWith({
      tenantId: PROJECT_ID,
      userId: USER_ID,
    });

    expect(item["apiKeyActor"]).toEqual({});
    expect(item["userId"]).toEqual(USER_ID);
  });
});

describe("every change a request makes to an incident hands its feed item the key", () => {
  const SERVICES: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Server",
    "Services",
  );

  // Without comments, collapsed to one line.
  const readSource: (file: string) => string = (file: string): string => {
    return fs
      .readFileSync(path.join(SERVICES, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/\s+/g, " ");
  };

  // The calls of createIncidentFeedItem in a file, each with its argument.
  const feedCalls: (source: string) => Array<string> = (
    source: string,
  ): Array<string> => {
    const calls: Array<string> = [];
    const marker: string = "IncidentFeedService.createIncidentFeedItem(";
    let at: number = source.indexOf(marker);

    while (at !== -1) {
      let depth: number = 0;
      let end: number = at + marker.length - 1;

      for (; end < source.length; end++) {
        if (source[end] === "(") {
          depth++;
        } else if (source[end] === ")") {
          depth--;

          if (depth === 0) {
            break;
          }
        }
      }

      calls.push(source.slice(at, end + 1));
      at = source.indexOf(marker, end);
    }

    return calls;
  };

  test.each([
    "IncidentPublicNoteService.ts",
    "IncidentInternalNoteService.ts",
    "IncidentOwnerUserService.ts",
    "IncidentOwnerTeamService.ts",
    "IncidentMemberService.ts",
    "IncidentStateTimelineService.ts",
    "IncidentEpisodeMemberService.ts",
    "IncidentAlertService.ts",
    "IncidentService.ts",
  ])("%s", (file: string) => {
    const calls: Array<string> = feedCalls(readSource(file));

    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      expect([file, call.includes("apiKeyActor")]).toEqual([file, true]);
    }
  });

  test("an incident's first state, which OneUptime writes for the request that opened it, carries the key", () => {
    const source: string = readSource("IncidentService.ts");

    expect(source).toContain("...FeedApiKeyActorUtil.toProps(apiKeyActor)");
  });
});
