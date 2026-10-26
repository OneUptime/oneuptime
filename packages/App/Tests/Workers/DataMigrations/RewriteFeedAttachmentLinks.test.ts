import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import logger from "Common/Server/Utils/Logger";
import RewriteFeedAttachmentLinks, {
  FEEDS_WITH_NOTE_ATTACHMENTS,
  FEED_ATTACHMENT_LINKS_BATCH_SIZE,
  FeedRow,
  FeedTable,
} from "../../../FeatureSet/Workers/DataMigrations/RewriteFeedAttachmentLinks";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * RewriteFeedAttachmentLinks makes the attachment links of old feed entries
 * work: the download routes took the project id in November 2025 and the
 * feed kept writing the address without it until #4925, so every such link
 * stored before then is a 404. Pinned here:
 *
 *   1. it is registered in DataMigrations/Index.ts (as text), once, before
 *      the last slot AddAuditLogMcpClientColumns claims for itself;
 *   2. it reads the five feeds a note's entry is written to, only entries
 *      that mention "/attachment/", a batch at a time, as root;
 *   3. it writes only entries with an old link - with the entry's own
 *      project id - as root and without hooks, so nothing is posted to a
 *      chat again;
 *   4. one feed's or one entry's failure is logged and the rest go on.
 */

const MIGRATION_NAME: string = "RewriteFeedAttachmentLinks";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const PROJECT_1: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_2: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const NOTE: string = "22222222-2222-4222-8222-222222222222";
const FILE: string = "33333333-3333-4333-8333-333333333333";

const oldLink: (route: string) => string = (route: string): string => {
  return (
    "**Attachments:**\n- [runbook.pdf](/api/" +
    route +
    "/attachment/" +
    NOTE +
    "/" +
    FILE +
    ")\n"
  );
};

const newLink: (route: string, project: ObjectID) => string = (
  route: string,
  project: ObjectID,
): string => {
  return (
    "**Attachments:**\n- [runbook.pdf](/api/" +
    route +
    "/attachment/" +
    project.toString() +
    "/" +
    NOTE +
    "/" +
    FILE +
    ")\n"
  );
};

const row: (id: number, project: ObjectID, markdown: string) => FeedRow = (
  id: number,
  project: ObjectID,
  markdown: string,
): FeedRow => {
  return {
    id: new ObjectID(
      "aaaaaaaa-aaaa-4aaa-8aaa-" + id.toString().padStart(12, "0"),
    ),
    projectId: project,
    feedInfoInMarkdown: markdown,
  };
};

interface FindCall {
  feed: string;
  args: Parameters<FeedTable["service"]["findBy"]>[0];
}

interface UpdateCall {
  feed: string;
  args: Parameters<FeedTable["service"]["updateOneById"]>[0];
}

describe("RewriteFeedAttachmentLinks", () => {
  let rowsByFeed: Map<string, Array<FeedRow>>;
  let findError: Map<string, Error>;
  let updateError: ((id: string) => Error | null) | null;
  let findCalls: Array<FindCall>;
  let updateCalls: Array<UpdateCall>;
  let errorLogs: Array<string>;

  beforeEach(() => {
    rowsByFeed = new Map<string, Array<FeedRow>>();
    findError = new Map<string, Error>();
    updateError = null;
    findCalls = [];
    updateCalls = [];
    errorLogs = [];

    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      errorLogs.push(String(message));
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    // Each feed's two calls, answered from the rows the test keeps.
    const fakeFeed: (feed: FeedTable) => void = (feed: FeedTable): void => {
      jest.spyOn(feed.service, "findBy").mockImplementation(((
        args: FindCall["args"],
      ): Promise<Array<FeedRow>> => {
        findCalls.push({ feed: feed.name, args: args });

        const failure: Error | undefined = findError.get(feed.name);

        if (failure) {
          return Promise.reject(failure);
        }

        const all: Array<FeedRow> = rowsByFeed.get(feed.name) || [];

        return Promise.resolve(all.slice(args.skip, args.skip + args.limit));
      }) as never);

      jest.spyOn(feed.service, "updateOneById").mockImplementation(((
        args: UpdateCall["args"],
      ): Promise<void> => {
        const failure: Error | null = updateError
          ? updateError(args.id.toString())
          : null;

        if (failure) {
          return Promise.reject(failure);
        }

        updateCalls.push({ feed: feed.name, args: args });

        // Kept, as the table would keep it: the next read sees it.
        for (const stored of rowsByFeed.get(feed.name) || []) {
          if (stored.id?.toString() === args.id.toString()) {
            stored.feedInfoInMarkdown = args.data.feedInfoInMarkdown;
          }
        }

        return Promise.resolve();
      }) as never);
    };

    for (const feed of FEEDS_WITH_NOTE_ATTACHMENTS) {
      fakeFeed(feed);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is named after itself, so it runs once", () => {
    expect(new RewriteFeedAttachmentLinks().name).toBe(MIGRATION_NAME);
  });

  test("is registered once, before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const index: string = fs
      .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    /*
     * Above the runbook moves, which keep their places right before the
     * last slot (their own suites assert each neighbour).
     */
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.indexOf("MoveRunbookApprovalsBeforeTheirSteps"),
    );
  });

  test("reads the five feeds a note's entry is written to", () => {
    expect(
      FEEDS_WITH_NOTE_ATTACHMENTS.map((feed: FeedTable): string => {
        return feed.name;
      }),
    ).toEqual([
      "IncidentFeed",
      "AlertFeed",
      "ScheduledMaintenanceFeed",
      "IncidentEpisodeFeed",
      "AlertEpisodeFeed",
    ]);
  });

  test("reads only the entries that mention an attachment, oldest first, as root", async () => {
    await new RewriteFeedAttachmentLinks().migrate();

    expect(findCalls).toHaveLength(5);

    for (const call of findCalls) {
      expect(Object.keys(call.args.query)).toEqual(["feedInfoInMarkdown"]);
      expect(call.args.select).toEqual({
        _id: true,
        projectId: true,
        feedInfoInMarkdown: true,
      });
      expect(call.args.sort).toEqual({ createdAt: SortOrder.Ascending });
      expect(call.args.props).toEqual({ isRoot: true });
      expect(call.args.limit).toBe(FEED_ATTACHMENT_LINKS_BATCH_SIZE);
    }
  });

  test("rewrites each old link with its own entry's project, as root and without hooks", async () => {
    rowsByFeed.set("IncidentFeed", [
      row(1, PROJECT_1, oldLink("incident-internal-note")),
      row(2, PROJECT_2, oldLink("incident-public-note")),
    ]);
    rowsByFeed.set("AlertEpisodeFeed", [
      row(3, PROJECT_1, oldLink("alert-episode-internal-note")),
    ]);

    await new RewriteFeedAttachmentLinks().migrate();

    expect(
      updateCalls.map((call: UpdateCall) => {
        return {
          feed: call.feed,
          id: call.args.id.toString(),
          data: call.args.data,
          props: call.args.props,
        };
      }),
    ).toEqual([
      {
        feed: "IncidentFeed",
        id: row(1, PROJECT_1, "").id!.toString(),
        data: {
          feedInfoInMarkdown: newLink("incident-internal-note", PROJECT_1),
        },
        props: { isRoot: true, ignoreHooks: true },
      },
      {
        feed: "IncidentFeed",
        id: row(2, PROJECT_2, "").id!.toString(),
        data: {
          feedInfoInMarkdown: newLink("incident-public-note", PROJECT_2),
        },
        props: { isRoot: true, ignoreHooks: true },
      },
      {
        feed: "AlertEpisodeFeed",
        id: row(3, PROJECT_1, "").id!.toString(),
        data: { feedInfoInMarkdown: "**Attachments:**\n- runbook.pdf\n" },
        props: { isRoot: true, ignoreHooks: true },
      },
    ]);
  });

  test("writes nothing for an entry with no old link, or with none left", async () => {
    rowsByFeed.set("AlertFeed", [
      row(1, PROJECT_1, newLink("alert-internal-note", PROJECT_1)),
      row(2, PROJECT_1, "See /attachment/ in the runbook."),
      row(3, PROJECT_1, oldLink("alert-internal-note")),
    ]);

    await new RewriteFeedAttachmentLinks().migrate();
    await new RewriteFeedAttachmentLinks().migrate();

    // The third once - the second run finds no old link left in it.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.args.id.toString()).toBe(
      row(3, PROJECT_1, "").id!.toString(),
    );
  });

  test("goes through every page of a feed, and stops after a short one", async () => {
    const many: Array<FeedRow> = [];

    for (let index: number = 0; index < 1203; index++) {
      many.push(row(index, PROJECT_1, oldLink("incident-internal-note")));
    }

    rowsByFeed.set("ScheduledMaintenanceFeed", many);

    await new RewriteFeedAttachmentLinks().migrate();

    expect(
      findCalls
        .filter((call: FindCall): boolean => {
          return call.feed === "ScheduledMaintenanceFeed";
        })
        .map((call: FindCall): number => {
          return call.args.skip;
        }),
    ).toEqual([0, 500, 1000]);
    expect(updateCalls).toHaveLength(1203);
  });

  test("a feed that cannot be read is logged, and the others are rewritten", async () => {
    findError.set("IncidentFeed", new Error("timeout"));
    rowsByFeed.set("AlertFeed", [
      row(1, PROJECT_1, oldLink("alert-internal-note")),
    ]);

    await new RewriteFeedAttachmentLinks().migrate();

    expect(updateCalls).toHaveLength(1);
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toContain("IncidentFeed");
  });

  test("an entry that cannot be written is logged, and the others are rewritten", async () => {
    rowsByFeed.set("IncidentFeed", [
      row(1, PROJECT_1, oldLink("incident-internal-note")),
      row(2, PROJECT_1, oldLink("incident-internal-note")),
    ]);
    updateError = (id: string): Error | null => {
      return id === row(1, PROJECT_1, "").id!.toString()
        ? new Error("write failed")
        : null;
    };

    await new RewriteFeedAttachmentLinks().migrate();

    expect(updateCalls).toHaveLength(1);
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toContain(row(1, PROJECT_1, "").id!.toString());
  });

  test("rolling back changes nothing", async () => {
    await expect(
      new RewriteFeedAttachmentLinks().rollback(),
    ).resolves.toBeUndefined();
  });
});
