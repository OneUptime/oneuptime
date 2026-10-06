import PublishedImages, {
  extractImageAccessTokens,
  HIDE_UNSHOWN_FILES_SQL,
  PUBLISHED_MARKDOWN,
  PUBLISH_SHOWN_IMAGES_SQL,
  PublishedMarkdown,
  SENT_MARKDOWN,
  STILL_SHOWN_SQL,
} from "../../../../Server/Utils/File/PublishedImages";
import * as InlineImageAccessTokenSync from "../../../../Server/Utils/InlineImageAccessTokenSync";
import FileService from "../../../../Server/Services/FileService";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import fs from "fs";
import path from "path";

jest.mock("../../../../Server/Utils/Logger");

/*
 * PUBLISHED RECORDS SHOW THEIR IMAGES - EXACTLY WHILE THEY SHOW THEM.
 *
 * An image in what a record shows to everyone - on a status page, and in
 * the emails its subscribers get - is public while the record shows it:
 * an incident's, an episode's and a maintenance event's description while
 * the record is shown on status pages, a postmortem once it is published
 * too, public notes, announcements and the status page's own texts always.
 * A record that stops showing an image (its switch turned off, the image
 * edited out, the record deleted) makes it private again, unless another
 * record of the project still shows it. Only images of the record's own
 * project, and best-effort: a write never fails over an image.
 *
 * No database: the image visibility each case asks for is recorded, and
 * the still-shown query answers from a stub.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const image: (token: string) => string = (token: string): string => {
  return `![shot](https://oneuptime.example/file/image/access-token/${token})`;
};

type SetImageVisibilityMock = Mock<
  (
    token: string,
    isPublic: boolean,
    projectId: ObjectID | null | undefined,
  ) => Promise<void>
>;

let setImageVisibility: SetImageVisibilityMock;

// What each image was set to, in order: "aaa:public", "bbb:private".
function visibilityAsked(): Array<string> {
  return setImageVisibility.mock.calls.map(
    (call: [string, boolean, ObjectID | null | undefined]): string => {
      expect(String(call[2])).toBe(PROJECT_ID.toString());
      return `${call[0]}:${call[1] ? "public" : "private"}`;
    },
  );
}

beforeEach(() => {
  setImageVisibility = jest.fn(async (): Promise<void> => {
    return;
  });

  jest
    .spyOn(InlineImageAccessTokenSync, "setImageVisibility")
    .mockImplementation(setImageVisibility as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function modelOf(tableName: string): BaseModel {
  const modelType: { new (): BaseModel } | undefined = AllModelTypes.find(
    (candidate: { new (): BaseModel }): boolean => {
      return new candidate().tableName === tableName;
    },
  );

  expect(modelType).toBeDefined();

  return new modelType!();
}

function columnType(model: BaseModel, column: string): TableColumnType {
  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(column);

  expect(metadata).toBeDefined();

  return metadata!.type;
}

describe("PUBLISHED_MARKDOWN: what records show to everyone, and when", () => {
  test.each(
    [...PUBLISHED_MARKDOWN, ...SENT_MARKDOWN].map(
      (source: PublishedMarkdown) => {
        return { ...source, columns: source.markdownColumns.join(", ") };
      },
    ),
  )(
    "$tableName ($columns) is a project's record, its markdown and its switches columns of it",
    (source: PublishedMarkdown) => {
      const model: BaseModel = modelOf(source.tableName);

      // Images are held to the record's project: it must have one.
      expect(model.getTenantColumn()).toBe("projectId");

      for (const column of source.markdownColumns) {
        expect([TableColumnType.Markdown, TableColumnType.JSON]).toContain(
          columnType(model, column),
        );
      }

      for (const column of source.shownWhen) {
        expect(columnType(model, column)).toBe(TableColumnType.Boolean);
      }
    },
  );

  test("names every record a status page shows what people write in", () => {
    expect(
      PUBLISHED_MARKDOWN.map((source: PublishedMarkdown): string => {
        return `${source.tableName}.${source.markdownColumns.join("+")} when ${
          source.shownWhen.join(" and ") || "always"
        }`;
      }),
    ).toEqual([
      "Incident.description when isVisibleOnStatusPage",
      "Incident.postmortemNote when isVisibleOnStatusPage and showPostmortemOnStatusPage",
      "IncidentPublicNote.note when always",
      "IncidentEpisode.description when isVisibleOnStatusPage",
      "IncidentEpisodePublicNote.note when always",
      "ScheduledMaintenance.description when isVisibleOnStatusPage",
      "ScheduledMaintenancePublicNote.note when always",
      "StatusPageAnnouncement.description when always",
      "StatusPage.overviewPageDescription when always",
      "StatusPageGroup.description when always",
      "StatusPageResource.displayDescription when always",
    ]);
  });
});

/*
 * GUARD: every Markdown column of every record the status page API reads
 * is either shown to everyone (PUBLISHED_MARKDOWN) or named here as one it
 * never shows. A Markdown column added to any of them later fails here
 * until someone decides which it is - an image in a column the page shows
 * but PublishedImages does not know of would stay private, and broken, for
 * every visitor.
 */
describe("GUARD: every Markdown column a status page could show is classified", () => {
  const NOT_ON_STATUS_PAGES: Record<string, string> = {
    "Incident.rootCause": "investigation notes for the team",
    "Incident.remediationNotes": "investigation notes for the team",
    "IncidentEpisode.rootCause": "investigation notes for the team",
    "IncidentEpisode.remediationNotes": "investigation notes for the team",
    "IncidentEpisode.postmortemNote":
      "an episode's postmortem is not on status pages",
    "IncidentStateTimeline.rootCause": "the page shows states, not causes",
    "IncidentEpisodeStateTimeline.rootCause":
      "the page shows states, not causes",
    "StatusPageSubscriber.internalNote": "the project's note on a subscriber",
  };

  const statusPageApi: string = fs.readFileSync(
    path.resolve(__dirname, "../../../../Server/API/StatusPageAPI.ts"),
    "utf8",
  );

  // Every model the status page API reads, by the services it reads through.
  const readModels: Array<BaseModel> = Array.from(
    new Set<string>(
      Array.from(
        statusPageApi.matchAll(
          /([A-Za-z]+)Service\.(?:findBy|findOneBy|findOneById|findAllBy)\(/g,
        ),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      }),
    ),
  ).map((name: string): BaseModel => {
    const modelPath: string = path.resolve(
      __dirname,
      `../../../../Models/DatabaseModels/${name}.ts`,
    );

    expect(fs.existsSync(modelPath)).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const modelType: { new (): BaseModel } = require(modelPath).default;

    return new modelType();
  });

  const published: Set<string> = new Set<string>(
    PUBLISHED_MARKDOWN.flatMap((source: PublishedMarkdown): Array<string> => {
      return source.markdownColumns.map((column: string): string => {
        return `${source.tableName}.${column}`;
      });
    }),
  );

  test("reads the models the page shows", () => {
    expect(
      readModels.map((model: BaseModel): string => {
        return model.tableName || "";
      }),
    ).toEqual(
      expect.arrayContaining([
        "StatusPage",
        "StatusPageGroup",
        "StatusPageResource",
        "StatusPageAnnouncement",
        "Incident",
        "IncidentPublicNote",
        "IncidentEpisode",
        "IncidentEpisodePublicNote",
        "ScheduledMaintenance",
        "ScheduledMaintenancePublicNote",
      ]),
    );
  });

  test("every Markdown column of them is shown to everyone or named as never shown", () => {
    const unclassified: Array<string> = [];

    for (const model of readModels) {
      for (const column of model.getTableColumns().columns) {
        if (
          model.getTableColumnMetadata(column)?.type !==
          TableColumnType.Markdown
        ) {
          continue;
        }

        const name: string = `${model.tableName}.${column}`;

        if (!published.has(name) && !NOT_ON_STATUS_PAGES[name]) {
          unclassified.push(name);
        }
      }
    }

    expect(unclassified).toEqual([]);
  });

  test("the page selects every published column, and none of those it never shows", () => {
    for (const name of published) {
      expect(statusPageApi).toContain(`${name.split(".")[1]}: true`);
    }

    const publishedColumnNames: Set<string> = new Set<string>(
      Array.from(published).map((name: string): string => {
        return name.split(".")[1]!;
      }),
    );

    for (const name of Object.keys(NOT_ON_STATUS_PAGES)) {
      const column: string = name.split(".")[1]!;

      if (publishedColumnNames.has(column)) {
        // A name the page selects for another record: nothing to tell apart.
        continue;
      }

      expect(statusPageApi).not.toContain(`${column}: true`);
    }
  });
});

describe("PublishedImages.getColumns / isWrittenBy", () => {
  test("a table's markdown and switches, each once", () => {
    expect(PublishedImages.getColumns("Incident").sort()).toEqual(
      [
        "description",
        "isVisibleOnStatusPage",
        "postmortemNote",
        "showPostmortemOnStatusPage",
      ].sort(),
    );
    expect(PublishedImages.getColumns("IncidentPublicNote")).toEqual(["note"]);
    expect(PublishedImages.getColumns("Monitor")).toEqual([]);
    expect(PublishedImages.getColumns(undefined)).toEqual([]);
  });

  test("a write of the markdown or a switch can change what a record shows; nothing else can", () => {
    expect(PublishedImages.isWrittenBy("Incident", ["description"])).toBe(true);
    expect(
      PublishedImages.isWrittenBy("Incident", ["isVisibleOnStatusPage"]),
    ).toBe(true);
    expect(
      PublishedImages.isWrittenBy("Incident", ["showPostmortemOnStatusPage"]),
    ).toBe(true);
    expect(PublishedImages.isWrittenBy("Incident", ["title", "rootCause"])).toBe(
      false,
    );
    expect(PublishedImages.isWrittenBy("Monitor", ["description"])).toBe(
      false,
    );
  });
});

describe("PublishedImages.getShownTokens: what a record shows to everyone", () => {
  test("an incident's description while it is shown on status pages", () => {
    const row: Record<string, unknown> = {
      description: `${image("aaa111")} and ${image("bbb222")}`,
      isVisibleOnStatusPage: true,
    };

    expect(Array.from(PublishedImages.getShownTokens("Incident", row))).toEqual([
      "aaa111",
      "bbb222",
    ]);

    for (const isVisibleOnStatusPage of [false, null, undefined, "true"]) {
      expect(
        PublishedImages.getShownTokens("Incident", {
          ...row,
          isVisibleOnStatusPage,
        }).size,
      ).toBe(0);
    }
  });

  test("a postmortem only once it is published on a shown incident", () => {
    const postmortem: string = image("ccc333");

    expect(
      Array.from(
        PublishedImages.getShownTokens("Incident", {
          postmortemNote: postmortem,
          isVisibleOnStatusPage: true,
          showPostmortemOnStatusPage: true,
        }),
      ),
    ).toEqual(["ccc333"]);
    expect(
      PublishedImages.getShownTokens("Incident", {
        postmortemNote: postmortem,
        isVisibleOnStatusPage: true,
        showPostmortemOnStatusPage: false,
      }).size,
    ).toBe(0);
    expect(
      PublishedImages.getShownTokens("Incident", {
        postmortemNote: postmortem,
        isVisibleOnStatusPage: false,
        showPostmortemOnStatusPage: true,
      }).size,
    ).toBe(0);
  });

  test("public notes, announcements and the status page's own texts, always", () => {
    for (const [tableName, column] of [
      ["IncidentPublicNote", "note"],
      ["IncidentEpisodePublicNote", "note"],
      ["ScheduledMaintenancePublicNote", "note"],
      ["StatusPageAnnouncement", "description"],
      ["StatusPage", "overviewPageDescription"],
      ["StatusPageGroup", "description"],
      ["StatusPageResource", "displayDescription"],
    ] as Array<[string, string]>) {
      expect(
        Array.from(
          PublishedImages.getShownTokens(tableName, {
            [column]: image("ddd444"),
          }),
        ),
      ).toEqual(["ddd444"]);
    }
  });

  test("nothing a status page does not show", () => {
    expect(
      PublishedImages.getShownTokens("IncidentInternalNote", {
        note: image("eee555"),
      }).size,
    ).toBe(0);
    expect(
      PublishedImages.getShownTokens("Incident", {
        rootCause: image("eee555"),
        isVisibleOnStatusPage: true,
      }).size,
    ).toBe(0);
    expect(PublishedImages.getShownTokens("Incident", null).size).toBe(0);
  });
});

describe("PublishedImages.afterCreate", () => {
  test("a new record shown to everyone makes its images public", async () => {
    const readStored: Mock<() => Promise<null>> = jest.fn(async () => {
      return null;
    });

    await PublishedImages.afterCreate({
      tableName: "Incident",
      row: {
        projectId: PROJECT_ID,
        description: image("aaa111"),
        isVisibleOnStatusPage: true,
      },
      readStored: readStored,
    });

    expect(visibilityAsked()).toEqual(["aaa111:public"]);
    expect(readStored).not.toHaveBeenCalled();
  });

  test("a new record not shown on status pages leaves its images private", async () => {
    await PublishedImages.afterCreate({
      tableName: "Incident",
      row: {
        projectId: PROJECT_ID,
        description: image("aaa111"),
        isVisibleOnStatusPage: false,
      },
      readStored: async () => {
        return null;
      },
    });

    expect(visibilityAsked()).toEqual([]);
  });

  test("a switch left to its column's default is read as stored", async () => {
    const readStored: Mock<
      (columns: Array<string>) => Promise<Record<string, unknown> | null>
    > = jest.fn(async (): Promise<Record<string, unknown> | null> => {
      return { isVisibleOnStatusPage: true, showPostmortemOnStatusPage: false };
    });

    await PublishedImages.afterCreate({
      tableName: "Incident",
      row: { projectId: PROJECT_ID, description: image("aaa111") },
      readStored: readStored,
    });

    expect(visibilityAsked()).toEqual(["aaa111:public"]);
    // Only the switch the image's markdown is shown by.
    expect(readStored.mock.calls[0]![0]).toEqual(["isVisibleOnStatusPage"]);
  });

  test("a switch given on the create is not read again", async () => {
    const readStored: Mock<
      (columns: Array<string>) => Promise<Record<string, unknown> | null>
    > = jest.fn(async (): Promise<Record<string, unknown> | null> => {
      return { isVisibleOnStatusPage: true, showPostmortemOnStatusPage: true };
    });

    await PublishedImages.afterCreate({
      tableName: "Incident",
      row: {
        projectId: PROJECT_ID,
        postmortemNote: image("bbb222"),
        isVisibleOnStatusPage: false,
      },
      readStored: readStored,
    });

    // The postmortem's other switch is read; the one given is kept: hidden.
    expect(readStored.mock.calls[0]![0].sort()).toEqual([
      "isVisibleOnStatusPage",
      "showPostmortemOnStatusPage",
    ]);
    expect(visibilityAsked()).toEqual([]);
  });

  test("asks nothing of a record with no images, or of a table that shows nothing", async () => {
    const readStored: Mock<() => Promise<null>> = jest.fn(async () => {
      return null;
    });

    await PublishedImages.afterCreate({
      tableName: "Incident",
      row: { projectId: PROJECT_ID, description: "No pictures." },
      readStored: readStored,
    });
    await PublishedImages.afterCreate({
      tableName: "IncidentInternalNote",
      row: { projectId: PROJECT_ID, note: image("aaa111") },
      readStored: readStored,
    });

    expect(readStored).not.toHaveBeenCalled();
    expect(visibilityAsked()).toEqual([]);
  });

  test("never fails the create it follows", async () => {
    setImageVisibility.mockRejectedValue(new Error("db down"));

    await expect(
      PublishedImages.afterCreate({
        tableName: "IncidentPublicNote",
        row: { projectId: PROJECT_ID, note: image("aaa111") },
        readStored: async () => {
          return null;
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("PublishedImages.afterUpdate", () => {
  const SHOWN_INCIDENT: Record<string, unknown> = {
    projectId: PROJECT_ID,
    description: image("aaa111"),
    postmortemNote: image("bbb222"),
    isVisibleOnStatusPage: true,
    showPostmortemOnStatusPage: true,
  };

  test("hiding a record from status pages makes every image it showed private", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [SHOWN_INCIDENT],
      written: { isVisibleOnStatusPage: false },
    });

    expect(visibilityAsked()).toEqual(["aaa111:private", "bbb222:private"]);
  });

  test("showing it again makes them public", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [{ ...SHOWN_INCIDENT, isVisibleOnStatusPage: false }],
      written: { isVisibleOnStatusPage: true },
    });

    expect(visibilityAsked()).toEqual(["aaa111:public", "bbb222:public"]);
  });

  test("taking the postmortem off the page makes only its images private", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [SHOWN_INCIDENT],
      written: { showPostmortemOnStatusPage: false },
    });

    expect(visibilityAsked()).toEqual(["aaa111:public", "bbb222:private"]);
  });

  test("an image edited out becomes private, one added becomes public", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [SHOWN_INCIDENT],
      written: { description: `${image("ccc333")} only` },
    });

    expect(visibilityAsked()).toEqual([
      "ccc333:public",
      "bbb222:public",
      "aaa111:private",
    ]);
  });

  test("an image moved from the description to the postmortem stays public", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [SHOWN_INCIDENT],
      written: {
        description: "Moved below.",
        postmortemNote: `${image("aaa111")} ${image("bbb222")}`,
      },
    });

    expect(visibilityAsked()).toEqual(["aaa111:public", "bbb222:public"]);
  });

  test("clearing the description makes its images private", async () => {
    await PublishedImages.afterUpdate({
      tableName: "IncidentPublicNote",
      rowsBefore: [{ projectId: PROJECT_ID, note: image("aaa111") }],
      written: { note: null },
    });

    expect(visibilityAsked()).toEqual(["aaa111:private"]);
  });

  test("an update of nothing a record shows leaves its images alone", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [SHOWN_INCIDENT],
      written: { title: "Renamed", rootCause: image("zzz999") },
    });

    expect(visibilityAsked()).toEqual([]);
  });

  test("each row is answered for itself, in its own project", async () => {
    const otherProject: ObjectID = new ObjectID(
      "22222222-2222-4222-8222-222222222222",
    );

    await PublishedImages.afterUpdate({
      tableName: "ScheduledMaintenance",
      rowsBefore: [
        {
          projectId: PROJECT_ID,
          description: image("aaa111"),
          isVisibleOnStatusPage: false,
        },
        {
          projectId: otherProject,
          description: image("bbb222"),
          isVisibleOnStatusPage: false,
        },
      ],
      written: { isVisibleOnStatusPage: true },
    });

    expect(
      setImageVisibility.mock.calls.map(
        (call: [string, boolean, ObjectID | null | undefined]): string => {
          return `${call[0]}:${String(call[2])}`;
        },
      ),
    ).toEqual([
      `aaa111:${PROJECT_ID.toString()}`,
      `bbb222:${otherProject.toString()}`,
    ]);
  });

  test("a row with no project changes nothing", async () => {
    await PublishedImages.afterUpdate({
      tableName: "IncidentPublicNote",
      rowsBefore: [{ note: image("aaa111") }],
      written: { note: image("bbb222") },
    });

    expect(setImageVisibility).not.toHaveBeenCalled();
  });

  test("never fails the update it follows", async () => {
    setImageVisibility.mockRejectedValue(new Error("db down"));

    await expect(
      PublishedImages.afterUpdate({
        tableName: "Incident",
        rowsBefore: [SHOWN_INCIDENT],
        written: { isVisibleOnStatusPage: false },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("PublishedImages.afterDelete", () => {
  test("a deleted record's shown images become private", async () => {
    await PublishedImages.afterDelete({
      tableName: "IncidentEpisode",
      rowsDeleted: [
        {
          projectId: PROJECT_ID,
          description: image("aaa111"),
          isVisibleOnStatusPage: true,
        },
        {
          projectId: PROJECT_ID,
          description: image("bbb222"),
          isVisibleOnStatusPage: false,
        },
      ],
    });

    expect(visibilityAsked()).toEqual(["aaa111:private"]);
  });

  test("a deleted record of a table that shows nothing changes nothing", async () => {
    await PublishedImages.afterDelete({
      tableName: "AlertInternalNote",
      rowsDeleted: [{ projectId: PROJECT_ID, note: image("aaa111") }],
    });

    expect(setImageVisibility).not.toHaveBeenCalled();
  });
});

describe("PublishedImages.isStillShown", () => {
  type QueryMock = Mock<
    (sql: string, parameters: Array<unknown>) => Promise<unknown>
  >;

  function stubQuery(answer: () => Promise<unknown>): QueryMock {
    const query: QueryMock = jest.fn(answer);

    jest.spyOn(FileService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);

    return query;
  }

  test("asks the database once, for the project and the image's address", async () => {
    const query: QueryMock = stubQuery(async () => {
      return [{ shown: 1 }];
    });

    await expect(
      PublishedImages.isStillShown({ projectId: PROJECT_ID, token: "abc123" }),
    ).resolves.toBe(true);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toBe(STILL_SHOWN_SQL);
    expect(query.mock.calls[0]![1]).toEqual([
      PROJECT_ID.toString(),
      "%/file/image/access-token/abc123%",
    ]);
  });

  test("no published record of the project shows it: not shown", async () => {
    stubQuery(async () => {
      return [];
    });

    await expect(
      PublishedImages.isStillShown({ projectId: PROJECT_ID, token: "abc123" }),
    ).resolves.toBe(false);
  });

  test("an image is never made private on a guess", async () => {
    const query: QueryMock = stubQuery(async () => {
      throw new Error("db down");
    });

    await expect(
      PublishedImages.isStillShown({ projectId: PROJECT_ID, token: "abc123" }),
    ).resolves.toBe(true);

    query.mockClear();

    // A token that is not hex, or no project: nothing is asked, and it stays.
    await expect(
      PublishedImages.isStillShown({ projectId: PROJECT_ID, token: "a%b" }),
    ).resolves.toBe(true);
    await expect(
      PublishedImages.isStillShown({ projectId: null, token: "abc123" }),
    ).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("the SQL the still-shown check and the data migration run", () => {
  test("STILL_SHOWN_SQL asks every published record of the project, with its switches", () => {
    for (const source of PUBLISHED_MARKDOWN) {
      expect(STILL_SHOWN_SQL).toContain(`FROM "${source.tableName}"`);

      for (const column of source.markdownColumns) {
        expect(STILL_SHOWN_SQL).toContain(`"${column}"::text LIKE $2`);
      }
    }

    expect(STILL_SHOWN_SQL).toContain(
      `FROM "Incident" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "isVisibleOnStatusPage" = true AND "showPostmortemOnStatusPage" = true AND ("postmortemNote"::text LIKE $2)`,
    );
    expect(STILL_SHOWN_SQL.endsWith(" LIMIT 1")).toBe(true);
  });

  test("PUBLISH_SHOWN_IMAGES_SQL makes public only private images of the showing record's own project", () => {
    expect(PUBLISH_SHOWN_IMAGES_SQL).toMatch(/^UPDATE "File" AS "file" SET "isPublic" = true FROM \(/);
    expect(PUBLISH_SHOWN_IMAGES_SQL).toContain(
      `"file"."projectId" = "shown"."projectId"`,
    );
    expect(PUBLISH_SHOWN_IMAGES_SQL).toContain(`"file"."isPublic" = false`);

    for (const source of PUBLISHED_MARKDOWN) {
      expect(PUBLISH_SHOWN_IMAGES_SQL).toContain(`FROM "${source.tableName}"`);
    }

    // What is merely sent out is not made public by the migration.
    expect(PUBLISH_SHOWN_IMAGES_SQL).not.toContain(`"customFields"`);
  });

  test("HIDE_UNSHOWN_FILES_SQL keeps icons, and every image published or sent, by token or by id", () => {
    expect(HIDE_UNSHOWN_FILES_SQL).toContain(
      `UPDATE "File" AS "file" SET "isPublic" = false WHERE "file"."isPublic" = true`,
    );
    expect(HIDE_UNSHOWN_FILES_SQL).toContain(
      `NOT EXISTS (SELECT 1 FROM "Probe" WHERE "Probe"."iconFileId" = "file"."_id")`,
    );
    expect(HIDE_UNSHOWN_FILES_SQL).toContain(
      `NOT EXISTS (SELECT 1 FROM "AIAgent" WHERE "AIAgent"."iconFileId" = "file"."_id")`,
    );
    expect(HIDE_UNSHOWN_FILES_SQL).toContain(`"customFields"::text`);
    expect(HIDE_UNSHOWN_FILES_SQL).toContain(
      `"shownId"."fileId" = "file"."_id"::text`,
    );

    // Kept for any project: an image another project's page shows stays.
    expect(HIDE_UNSHOWN_FILES_SQL).not.toContain(`"shown"."projectId"`);
  });
});

describe("extractImageAccessTokens (shared with InlineImageAccessTokenSync)", () => {
  test("is the same function under both names", () => {
    expect(InlineImageAccessTokenSync.extractImageAccessTokens).toBe(
      extractImageAccessTokens,
    );
  });

  test("reads every distinct token, in the order written", () => {
    expect(
      extractImageAccessTokens(
        `${image("aaa111")} ${image("bbb222")} ${image("aaa111")}`,
      ),
    ).toEqual(["aaa111", "bbb222"]);
    expect(
      extractImageAccessTokens(
        "![logo](https://oneuptime.example/file/image/1e8c8f04-6a52-4c3c-9b3f-4b1f2c0a9d11)",
      ),
    ).toEqual([]);
    expect(extractImageAccessTokens(undefined)).toEqual([]);
    expect(extractImageAccessTokens(42 as unknown as string)).toEqual([]);
  });
});
