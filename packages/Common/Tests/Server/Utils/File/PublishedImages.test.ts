import PublishedImages, {
  CASCADES,
  CascadedRow,
  extractImageAccessTokens,
  getCascadedRowsSql,
  getRowsShownUnderSql,
  getShownParentsSql,
  HIDE_HIDDEN_RECORD_IMAGES_SQL,
  HIDE_NOT_YET_SHOWN_IMAGES_SQL,
  HIDE_PRIVATE_RECORD_IMAGES_SQL,
  HIDE_UNSHOWN_FILES_SQL,
  KEPT_MARKDOWN,
  PROJECT_FILES_PRIVATE_SQL,
  PUBLISHED_MARKDOWN,
  PUBLISH_SHOWN_IMAGES_SQL,
  PUBLISH_WHEN_SHOWN_SQL,
  PublishedCascade,
  PublishedMarkdown,
  PublishedParent,
  ShownParents,
  SOURCES_SHOWN_FROM_A_TIME,
  STILL_SHOWN_SQL,
} from "../../../../Server/Utils/File/PublishedImages";
import logger from "../../../../Server/Utils/Logger";
import OneUptimeDate from "../../../../Types/Date";
import * as InlineImageAccessTokenSync from "../../../../Server/Utils/InlineImageAccessTokenSync";
import FileService from "../../../../Server/Services/FileService";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../../Models/DatabaseModels/File";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";
import { FindOperator, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { JoinColumnMetadataArgs } from "typeorm/metadata-args/JoinColumnMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

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
 * edited out, the record deleted, or deleted along with the record it
 * belongs to) makes it private again, unless another record of the project
 * still shows it. Only images of the record's own project, and best-effort:
 * a write never fails over an image.
 *
 * No database: what each case asks to make public or private is recorded,
 * and the file lookups and the still-shown query answer from stubs.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

// An incident a public note is shown under.
const INCIDENT_ID: string = "44444444-4444-4444-8444-444444444444";

const image: (token: string) => string = (token: string): string => {
  return `![shot](https://oneuptime.example/file/image/access-token/${token})`;
};

interface VisibilityRequest {
  projectId: unknown;
  publish: Iterable<string>;
  unpublish: Iterable<string>;
}

type SetImagesVisibilityMock = Mock<(data: VisibilityRequest) => Promise<void>>;

type QueryMock = Mock<
  (sql: string, parameters: Array<unknown>) => Promise<unknown>
>;

let setImagesVisibility: SetImagesVisibilityMock;

// Records what the hooks ask to make public and private, without a database.
function recordVisibility(): void {
  setImagesVisibility = jest.fn(async (): Promise<void> => {
    return;
  });

  jest
    .spyOn(PublishedImages, "setImagesVisibility")
    .mockImplementation(setImagesVisibility as never);
}

// What each image was asked to be, in order: "aaa:public", "bbb:private".
function visibilityAsked(): Array<string> {
  return setImagesVisibility.mock.calls.flatMap(
    (call: [VisibilityRequest]): Array<string> => {
      expect(String(call[0].projectId)).toBe(PROJECT_ID.toString());

      return [
        ...Array.from(call[0].publish).map((token: string): string => {
          return `${token}:public`;
        }),
        ...Array.from(call[0].unpublish).map((token: string): string => {
          return `${token}:private`;
        }),
      ];
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

function modelTypeOf(tableName: string): { new (): BaseModel } {
  const modelType: { new (): BaseModel } | undefined = AllModelTypes.find(
    (candidate: { new (): BaseModel }): boolean => {
      return new candidate().tableName === tableName;
    },
  );

  expect(modelType).toBeDefined();

  return modelType!;
}

function modelOf(tableName: string): BaseModel {
  return new (modelTypeOf(tableName))();
}

function columnType(model: BaseModel, column: string): TableColumnType {
  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(column);

  expect(metadata).toBeDefined();

  return metadata!.type;
}

// The values a QueryHelper.any query names.
function anyValues(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    ((operator as FindOperator<unknown>).objectLiteralParameters as Record<
      string,
      unknown
    >) || {};

  return (Object.values(parameters)[0] as Array<string>) || [];
}

describe("PUBLISHED_MARKDOWN: what records show to everyone, and when", () => {
  test.each(
    [...PUBLISHED_MARKDOWN, ...KEPT_MARKDOWN].map(
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

      for (const column of [
        ...source.shownWhen,
        ...(source.hiddenWhen || []),
      ]) {
        expect(columnType(model, column)).toBe(TableColumnType.Boolean);
      }

      // The time it is shown from is a date of it.
      if (source.shownFrom) {
        expect(columnType(model, source.shownFrom)).toBe(TableColumnType.Date);
      }
    },
  );

  /*
   * A private incident or episode is never shown on a status page
   * (StatusPageVisibility): its markdown is hidden by Private, whatever its
   * Visible on Status Page switch says.
   */
  /*
   * A create that leaves a hiding switch out stores it off, so afterCreate
   * reads nothing for it: each one must default to off.
   */
  test.each(
    [...PUBLISHED_MARKDOWN, ...KEPT_MARKDOWN].flatMap(
      (source: PublishedMarkdown) => {
        return (source.hiddenWhen || []).map((column: string) => {
          return { tableName: source.tableName, column: column };
        });
      },
    ),
  )(
    "$tableName.$column, a switch that hides markdown, defaults to off",
    ({ tableName, column }: { tableName: string; column: string }) => {
      const model: BaseModel = modelOf(tableName);

      const declared: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
        .columns.filter((args: ColumnMetadataArgs): boolean => {
          return (
            args.target === model.constructor && args.propertyName === column
          );
        })
        .pop();

      expect(declared?.options.default).toBe(false);
    },
  );

  test("an incident's and an episode's markdown is hidden while it is private", () => {
    expect(
      [...PUBLISHED_MARKDOWN, ...KEPT_MARKDOWN]
        .filter((source: PublishedMarkdown): boolean => {
          return (source.hiddenWhen || []).length > 0;
        })
        .map((source: PublishedMarkdown): string => {
          return `${source.tableName}.${source.markdownColumns.join("+")} unless ${(source.hiddenWhen || []).join(" or ")}`;
        }),
    ).toEqual([
      "Incident.description unless isPrivate",
      "Incident.postmortemNote unless isPrivate",
      "IncidentEpisode.description unless isPrivate",
      "Incident.customFields unless isPrivate",
    ]);
  });

  test("names every record a status page or a form's page shows what people write in", () => {
    expect(
      PUBLISHED_MARKDOWN.map((source: PublishedMarkdown): string => {
        return `${source.tableName}.${source.markdownColumns.join("+")} when ${
          source.shownUnder
            ? `its ${source.shownUnder.tableName} is shown`
            : source.shownFrom
              ? `${source.shownFrom} has come`
              : source.shownWhen.join(" and ") || "always"
        } on ${source.shownOn}`;
      }),
    ).toEqual([
      "Incident.description when isVisibleOnStatusPage on statusPage",
      "Incident.postmortemNote when isVisibleOnStatusPage and showPostmortemOnStatusPage on statusPage",
      "IncidentPublicNote.note when its Incident is shown on statusPage",
      "IncidentEpisode.description when isVisibleOnStatusPage on statusPage",
      "IncidentEpisodePublicNote.note when its IncidentEpisode is shown on statusPage",
      "ScheduledMaintenance.description when isVisibleOnStatusPage on statusPage",
      "ScheduledMaintenancePublicNote.note when its ScheduledMaintenance is shown on statusPage",
      "StatusPageAnnouncement.description when showAnnouncementAt has come on statusPage",
      "StatusPage.overviewPageDescription when always on statusPage",
      "StatusPageGroup.description when always on statusPage",
      "StatusPageResource.displayDescription when always on statusPage",
      "Form.description+successMessage when isEnabled on formPage",
    ]);
  });

  test("keeps what is sent out to everyone without being kept in step: a shown incident's custom fields", () => {
    expect(
      KEPT_MARKDOWN.map((source: PublishedMarkdown): string => {
        return `${source.tableName}.${source.markdownColumns.join("+")} when ${source.shownWhen.join(" and ")} on ${source.shownOn}`;
      }),
    ).toEqual([
      "Incident.customFields when isVisibleOnStatusPage on notifications",
    ]);

    // Kept, never kept in step: a write of custom fields sets nothing.
    expect(PublishedImages.getColumns("Incident")).not.toContain(
      "customFields",
    );
    // A form's texts are kept in step, by its switch.
    expect(PublishedImages.getColumns("Form").sort()).toEqual([
      "description",
      "isEnabled",
      "successMessage",
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

  // What the status pages show; a form's page is not read here.
  const published: Set<string> = new Set<string>(
    PUBLISHED_MARKDOWN.filter((source: PublishedMarkdown): boolean => {
      return source.shownOn === "statusPage";
    }).flatMap((source: PublishedMarkdown): Array<string> => {
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

/*
 * GUARD: CASCADES is every way the database deletes a published row along
 * with a row of another table - read from the models' own relations, and
 * followed up the chain (what deletes the parent deletes the row too). A
 * relation added later with ON DELETE CASCADE fails here until it is named:
 * the rows it takes with it would otherwise leave their images public.
 */
describe("GUARD: CASCADES names every delete that takes a published row with it", () => {
  const describeCascade: (cascade: PublishedCascade) => string = (
    cascade: PublishedCascade,
  ): string => {
    return `${cascade.parentTable} -> ${cascade.tableName}.${cascade.foreignKey}`;
  };

  // The parents whose deleted rows take a table's rows with them.
  function cascadingParents(tableName: string): Array<PublishedCascade> {
    const modelType: { new (): BaseModel } = modelTypeOf(tableName);

    return getMetadataArgsStorage()
      .relations.filter((relation: RelationMetadataArgs): boolean => {
        return (
          typeof relation.target === "function" &&
          (relation.target === modelType ||
            modelType.prototype instanceof relation.target) &&
          (relation.relationType === "many-to-one" ||
            relation.relationType === "one-to-one") &&
          relation.options.onDelete === "CASCADE"
        );
      })
      .map((relation: RelationMetadataArgs): PublishedCascade => {
        const parentType: { new (): BaseModel } = (
          relation.type as () => { new (): BaseModel }
        )();
        const joinColumn: JoinColumnMetadataArgs | undefined =
          getMetadataArgsStorage().joinColumns.find(
            (candidate: JoinColumnMetadataArgs): boolean => {
              return (
                candidate.target === relation.target &&
                candidate.propertyName === relation.propertyName
              );
            },
          );

        expect(joinColumn?.name).toBeTruthy();

        return {
          parentTable: new parentType().tableName || "",
          tableName: tableName,
          foreignKey: joinColumn!.name!,
        };
      });
  }

  test("every ON DELETE CASCADE into a published table, and up the chain, is named; nothing else", () => {
    const found: Array<PublishedCascade> = [];
    const visited: Set<string> = new Set<string>();
    let pending: Array<string> = PUBLISHED_MARKDOWN.map(
      (source: PublishedMarkdown): string => {
        return source.tableName;
      },
    );

    while (pending.length > 0) {
      const next: Array<string> = [];

      for (const tableName of pending) {
        if (visited.has(tableName)) {
          continue;
        }

        visited.add(tableName);

        for (const cascade of cascadingParents(tableName)) {
          // A deleted project makes every file of its own private instead.
          if (cascade.parentTable === "Project") {
            continue;
          }

          found.push(cascade);
          next.push(cascade.parentTable);
        }
      }

      pending = next;
    }

    expect(found.map(describeCascade).sort()).toEqual(
      CASCADES.map(describeCascade).sort(),
    );
  });

  test("every published table's project deletes it with the project", () => {
    for (const source of PUBLISHED_MARKDOWN) {
      expect(cascadingParents(source.tableName).map(describeCascade)).toContain(
        `Project -> ${source.tableName}.projectId`,
      );
    }
  });

  test("every table CASCADES reads has the columns the read asks for", () => {
    for (const cascade of CASCADES) {
      const model: BaseModel = modelOf(cascade.tableName);

      for (const column of [
        "_id",
        "projectId",
        "deletedAt",
        cascade.foreignKey,
        ...PublishedImages.getColumns(cascade.tableName),
      ]) {
        expect(
          model.getTableColumns().columns.includes(column) ||
            column === "_id" ||
            column === "deletedAt",
        ).toBe(true);
      }
    }
  });
});

describe("PublishedImages.getColumns / isWrittenBy", () => {
  test("a table's markdown and switches, each once", () => {
    expect(PublishedImages.getColumns("Incident").sort()).toEqual(
      [
        "description",
        "isPrivate",
        "isVisibleOnStatusPage",
        "postmortemNote",
        "showPostmortemOnStatusPage",
      ].sort(),
    );
    expect(PublishedImages.getColumns("IncidentEpisode").sort()).toEqual(
      ["description", "isPrivate", "isVisibleOnStatusPage"].sort(),
    );
    // A note's markdown, and the record it is shown under.
    expect(PublishedImages.getColumns("IncidentPublicNote")).toEqual([
      "note",
      "incidentId",
    ]);
    expect(PublishedImages.getColumns("IncidentEpisodePublicNote")).toEqual([
      "note",
      "incidentEpisodeId",
    ]);
    expect(
      PublishedImages.getColumns("ScheduledMaintenancePublicNote"),
    ).toEqual(["note", "scheduledMaintenanceId"]);
    // An announcement's text, and the time it is shown from.
    expect(PublishedImages.getColumns("StatusPageAnnouncement")).toEqual([
      "description",
      "showAnnouncementAt",
    ]);
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
    // Making an incident or an episode private stops it showing its images.
    expect(PublishedImages.isWrittenBy("Incident", ["isPrivate"])).toBe(true);
    expect(PublishedImages.isWrittenBy("IncidentEpisode", ["isPrivate"])).toBe(
      true,
    );
    expect(
      PublishedImages.isWrittenBy("Incident", ["title", "rootCause"]),
    ).toBe(false);
    expect(PublishedImages.isWrittenBy("Monitor", ["description"])).toBe(false);
    // An announcement moved to another time; not its end, which hides nothing.
    expect(
      PublishedImages.isWrittenBy("StatusPageAnnouncement", [
        "showAnnouncementAt",
      ]),
    ).toBe(true);
    expect(
      PublishedImages.isWrittenBy("StatusPageAnnouncement", [
        "endAnnouncementAt",
        "title",
      ]),
    ).toBe(false);
  });
});

describe("PublishedImages.getShownTokens: what a record shows to everyone", () => {
  test("an incident's description while it is shown on status pages", () => {
    const row: Record<string, unknown> = {
      description: `${image("aaa111")} and ${image("bbb222")}`,
      isVisibleOnStatusPage: true,
    };

    expect(Array.from(PublishedImages.getShownTokens("Incident", row))).toEqual(
      ["aaa111", "bbb222"],
    );

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

  test("the status page's own texts, always", () => {
    for (const [tableName, column] of [
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

  test("an announcement's description once it is shown, ended or not; nothing before", () => {
    const description: string = image("ddd444");
    const now: Date = new Date("2026-10-07T12:00:00.000Z");

    expect(
      Array.from(
        PublishedImages.getShownTokens(
          "StatusPageAnnouncement",
          {
            description,
            showAnnouncementAt: new Date("2026-10-07T11:00:00.000Z"),
          },
          undefined,
          now,
        ),
      ),
    ).toEqual(["ddd444"]);

    expect(
      PublishedImages.getShownTokens(
        "StatusPageAnnouncement",
        {
          description,
          showAnnouncementAt: new Date("2026-10-07T13:00:00.000Z"),
        },
        undefined,
        now,
      ).size,
    ).toBe(0);
  });

  test("a form's description and thank-you message while it accepts submissions", () => {
    const row: Record<string, unknown> = {
      description: image("aaa111"),
      successMessage: image("bbb222"),
      isEnabled: true,
    };

    expect(Array.from(PublishedImages.getShownTokens("Form", row))).toEqual([
      "aaa111",
      "bbb222",
    ]);
    expect(
      PublishedImages.getShownTokens("Form", { ...row, isEnabled: false }).size,
    ).toBe(0);
  });

  /*
   * A private incident or episode is never shown on a status page
   * (StatusPageVisibility), so its markdown shows nothing to everyone,
   * whatever its Visible on Status Page switch says.
   */
  test("nothing of a private incident or episode, even switched visible", () => {
    const incident: Record<string, unknown> = {
      description: image("aaa111"),
      postmortemNote: image("bbb222"),
      isVisibleOnStatusPage: true,
      showPostmortemOnStatusPage: true,
    };

    expect(
      Array.from(PublishedImages.getShownTokens("Incident", incident)),
    ).toEqual(["aaa111", "bbb222"]);

    for (const isPrivate of [true, "true", 1]) {
      expect(
        PublishedImages.getShownTokens("Incident", {
          ...incident,
          isPrivate,
        }).size,
      ).toBe(0);
      expect(
        PublishedImages.getShownTokens("IncidentEpisode", {
          description: image("ccc333"),
          isVisibleOnStatusPage: true,
          isPrivate,
        }).size,
      ).toBe(0);
    }

    // Not private, or never set: shown by its switch alone.
    for (const isPrivate of [false, null, undefined]) {
      expect(
        PublishedImages.getShownTokens("Incident", { ...incident, isPrivate })
          .size,
      ).toBe(2);
      expect(
        PublishedImages.getShownTokens("IncidentEpisode", {
          description: image("ccc333"),
          isVisibleOnStatusPage: true,
          isPrivate,
        }).size,
      ).toBe(1);
    }

    // Nor does a public note of one: it is shown only with its incident.
    expect(
      PublishedImages.getShownTokens(
        "IncidentPublicNote",
        {
          note: image("ddd444"),
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID.toString(),
        },
        new Map(),
      ).size,
    ).toBe(0);
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
  beforeEach(recordVisibility);

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
        isPrivate: false,
      },
      readStored: readStored,
    });

    expect(visibilityAsked()).toEqual(["aaa111:public"]);
    expect(readStored).not.toHaveBeenCalled();
  });

  test("a new private record leaves its images private, whatever its Visible on Status Page says", async () => {
    for (const tableName of ["Incident", "IncidentEpisode"]) {
      setImagesVisibility.mockClear();

      await PublishedImages.afterCreate({
        tableName: tableName,
        row: {
          projectId: PROJECT_ID,
          description: image("aaa111"),
          isVisibleOnStatusPage: true,
          isPrivate: true,
        },
        readStored: async () => {
          return null;
        },
      });

      expect(visibilityAsked()).toEqual([]);
    }
  });

  test("a Private left out is off, as its column's default stores it: nothing is read for it", async () => {
    const readStored: Mock<
      (columns: Array<string>) => Promise<Record<string, unknown> | null>
    > = jest.fn(async (): Promise<Record<string, unknown> | null> => {
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

    expect(readStored).not.toHaveBeenCalled();
    expect(visibilityAsked()).toEqual(["aaa111:public"]);
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

    // Only the switch it was created without is read; the one given is kept.
    expect(readStored.mock.calls[0]![0]).toEqual([
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
    expect(setImagesVisibility).not.toHaveBeenCalled();
  });

  test("never fails the create it follows", async () => {
    setImagesVisibility.mockRejectedValue(new Error("db down"));

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
  beforeEach(recordVisibility);

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

  test("clearing the note makes its images private", async () => {
    await PublishedImages.afterUpdate({
      tableName: "IncidentPublicNote",
      rowsBefore: [{ projectId: PROJECT_ID, note: image("aaa111") }],
      written: { note: null },
    });

    expect(visibilityAsked()).toEqual(["aaa111:private"]);
  });

  test("making a shown incident private makes every image it showed private", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [{ ...SHOWN_INCIDENT, isPrivate: false }],
      written: { isPrivate: true, isVisibleOnStatusPage: false },
    });

    expect(visibilityAsked()).toEqual(["aaa111:private", "bbb222:private"]);
  });

  test("making it private alone, without the switch, still makes them private", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [{ ...SHOWN_INCIDENT, isPrivate: false }],
      written: { isPrivate: true },
    });

    expect(visibilityAsked()).toEqual(["aaa111:private", "bbb222:private"]);
  });

  test("switching a private incident visible makes nothing public: what it holds is only asked to be private", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [
        { ...SHOWN_INCIDENT, isVisibleOnStatusPage: false, isPrivate: true },
      ],
      written: { isVisibleOnStatusPage: true },
    });

    expect(visibilityAsked()).toEqual(["aaa111:private", "bbb222:private"]);
  });

  test("making a private, visible incident not private shows its images again", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [{ ...SHOWN_INCIDENT, isPrivate: true }],
      written: { isPrivate: false },
    });

    expect(visibilityAsked()).toEqual(["aaa111:public", "bbb222:public"]);
  });

  test("making a shown episode private makes its description's images private", async () => {
    await PublishedImages.afterUpdate({
      tableName: "IncidentEpisode",
      rowsBefore: [
        {
          projectId: PROJECT_ID,
          description: image("ccc333"),
          isVisibleOnStatusPage: true,
          isPrivate: false,
        },
      ],
      written: { isPrivate: true },
    });

    expect(visibilityAsked()).toEqual(["ccc333:private"]);
  });

  test("an update of nothing a record shows leaves its images alone", async () => {
    await PublishedImages.afterUpdate({
      tableName: "Incident",
      rowsBefore: [SHOWN_INCIDENT],
      written: { title: "Renamed", rootCause: image("zzz999") },
    });

    expect(setImagesVisibility).not.toHaveBeenCalled();
  });

  test("the rows of a project are set together, once, and each project for itself", async () => {
    await PublishedImages.afterUpdate({
      tableName: "ScheduledMaintenance",
      rowsBefore: [
        {
          projectId: PROJECT_ID,
          description: image("aaa111"),
          isVisibleOnStatusPage: false,
        },
        {
          projectId: OTHER_PROJECT_ID,
          description: image("bbb222"),
          isVisibleOnStatusPage: false,
        },
        {
          projectId: PROJECT_ID,
          description: image("ccc333"),
          isVisibleOnStatusPage: false,
        },
      ],
      written: { isVisibleOnStatusPage: true },
    });

    expect(
      setImagesVisibility.mock.calls.map(
        (call: [VisibilityRequest]): string => {
          return `${Array.from(call[0].publish).join("+")}:${String(call[0].projectId)}`;
        },
      ),
    ).toEqual([
      `aaa111+ccc333:${PROJECT_ID.toString()}`,
      `bbb222:${OTHER_PROJECT_ID.toString()}`,
    ]);
  });

  test("a row with no project changes nothing", async () => {
    await PublishedImages.afterUpdate({
      tableName: "IncidentPublicNote",
      rowsBefore: [{ note: image("aaa111") }],
      written: { note: image("bbb222") },
    });

    expect(setImagesVisibility).not.toHaveBeenCalled();
  });

  test("a project whose images cannot be set leaves the others' to be set", async () => {
    setImagesVisibility.mockRejectedValueOnce(new Error("db down"));

    await PublishedImages.afterUpdate({
      tableName: "IncidentPublicNote",
      rowsBefore: [
        { projectId: OTHER_PROJECT_ID, note: image("aaa111") },
        { projectId: PROJECT_ID, note: image("bbb222") },
      ],
      written: { note: "Images removed." },
    });

    expect(setImagesVisibility).toHaveBeenCalledTimes(2);
    expect(String(setImagesVisibility.mock.calls[1]![0].projectId)).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("never fails the update it follows", async () => {
    setImagesVisibility.mockRejectedValue(new Error("db down"));

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
  beforeEach(recordVisibility);

  test("a deleted record's images become private, shown or not, unless something still shows them", async () => {
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

    expect(visibilityAsked()).toEqual(["aaa111:private", "bbb222:private"]);
  });

  test("so do the images of the rows the delete took with it", async () => {
    await PublishedImages.afterDelete({
      tableName: "Incident",
      rowsDeleted: [
        {
          projectId: PROJECT_ID,
          description: image("aaa111"),
          isVisibleOnStatusPage: true,
        },
      ],
      cascaded: [
        {
          tableName: "IncidentPublicNote",
          row: { projectId: PROJECT_ID.toString(), note: image("bbb222") },
        },
        {
          tableName: "IncidentPublicNote",
          row: { projectId: PROJECT_ID.toString(), note: "No pictures." },
        },
      ],
    });

    // One request for the project, every image the delete took out of view.
    expect(setImagesVisibility).toHaveBeenCalledTimes(1);
    expect(visibilityAsked()).toEqual(["aaa111:private", "bbb222:private"]);
  });

  test("a deleted record of a table that shows nothing changes nothing, and reads nothing of its rows", async () => {
    const getShownTokens: SpyInstance<typeof PublishedImages.getShownTokens> =
      jest.spyOn(PublishedImages, "getShownTokens");

    await PublishedImages.afterDelete({
      tableName: "AlertInternalNote",
      rowsDeleted: [{ projectId: PROJECT_ID, note: image("aaa111") }],
    });
    await PublishedImages.afterDelete({
      tableName: "AlertInternalNote",
      rowsDeleted: [{ projectId: PROJECT_ID }],
      cascaded: [],
    });

    expect(getShownTokens).not.toHaveBeenCalled();
    expect(setImagesVisibility).not.toHaveBeenCalled();
  });

  test("a deleted project's files all become private, in one statement", async () => {
    const query: QueryMock = jest.fn(async (): Promise<unknown> => {
      return [[], 3];
    });

    jest.spyOn(FileService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);

    await PublishedImages.afterDelete({
      tableName: "Project",
      rowsDeleted: [
        { _id: PROJECT_ID.toString() },
        { _id: "not-an-id" },
        { _id: OTHER_PROJECT_ID.toString().toUpperCase() },
      ],
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toBe(PROJECT_FILES_PRIVATE_SQL);
    expect(query.mock.calls[0]![1]).toEqual([
      [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()],
    ]);
    expect(setImagesVisibility).not.toHaveBeenCalled();
  });

  test("never fails the delete it follows", async () => {
    jest.spyOn(FileService, "getRepository").mockReturnValue({
      manager: {
        query: async (): Promise<unknown> => {
          throw new Error("db down");
        },
      },
    } as never);
    setImagesVisibility.mockRejectedValue(new Error("db down"));

    await expect(
      PublishedImages.afterDelete({
        tableName: "Project",
        rowsDeleted: [{ _id: PROJECT_ID.toString() }],
      }),
    ).resolves.toBeUndefined();
    await expect(
      PublishedImages.afterDelete({
        tableName: "IncidentPublicNote",
        rowsDeleted: [{ projectId: PROJECT_ID, note: image("aaa111") }],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("PublishedImages.readCascadedRows: what a delete takes with it", () => {
  const STATUS_PAGE_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
  const GROUP_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
  const SUB_GROUP_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
  const RESOURCE_ID: string = "cccccccc-0000-4000-8000-000000000001";
  const GROUPED_RESOURCE_ID: string = "cccccccc-0000-4000-8000-000000000002";
  // In the sub-group: found only by following the sub-group down.
  const SUB_GROUP_RESOURCE_ID: string = "cccccccc-0000-4000-8000-000000000003";

  function cascadeOf(tableName: string, foreignKey: string): PublishedCascade {
    const cascade: PublishedCascade | undefined = CASCADES.find(
      (candidate: PublishedCascade): boolean => {
        return (
          candidate.tableName === tableName &&
          candidate.foreignKey === foreignKey
        );
      },
    );

    expect(cascade).toBeDefined();

    return cascade!;
  }

  /*
   * A status page with a group and its sub-group, a resource on the page, one
   * in the group and one in the sub-group.
   */
  function statusPageTree(): QueryMock {
    const answers: Map<
      string,
      Record<string, Array<Record<string, unknown>>>
    > = new Map([
      [
        getCascadedRowsSql(cascadeOf("StatusPageGroup", "statusPageId")),
        {
          [STATUS_PAGE_ID]: [
            { _id: GROUP_ID, projectId: PROJECT_ID.toString() },
            { _id: SUB_GROUP_ID, projectId: PROJECT_ID.toString() },
          ],
        },
      ],
      [
        getCascadedRowsSql(
          cascadeOf("StatusPageGroup", "parentStatusPageGroupId"),
        ),
        {
          [GROUP_ID]: [{ _id: SUB_GROUP_ID, projectId: PROJECT_ID.toString() }],
        },
      ],
      [
        getCascadedRowsSql(cascadeOf("StatusPageResource", "statusPageId")),
        {
          [STATUS_PAGE_ID]: [
            { _id: RESOURCE_ID, projectId: PROJECT_ID.toString() },
            { _id: GROUPED_RESOURCE_ID, projectId: PROJECT_ID.toString() },
          ],
        },
      ],
      [
        getCascadedRowsSql(
          cascadeOf("StatusPageResource", "statusPageGroupId"),
        ),
        {
          [GROUP_ID]: [
            { _id: GROUPED_RESOURCE_ID, projectId: PROJECT_ID.toString() },
          ],
          [SUB_GROUP_ID]: [
            { _id: SUB_GROUP_RESOURCE_ID, projectId: PROJECT_ID.toString() },
          ],
        },
      ],
    ]);

    return jest.fn(
      async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
        const byParent: Record<
          string,
          Array<Record<string, unknown>>
        > = answers.get(sql) || {};

        return (parameters[0] as Array<string>).flatMap(
          (parentId: string): Array<Record<string, unknown>> => {
            return byParent[parentId] || [];
          },
        );
      },
    );
  }

  test("reads the rows a status page's delete takes with it, down the chain, each once", async () => {
    const query: QueryMock = statusPageTree();

    const cascaded: Array<CascadedRow> = await PublishedImages.readCascadedRows(
      {
        tableName: "StatusPage",
        ids: [new ObjectID(STATUS_PAGE_ID)],
        query: query,
      },
    );

    expect(
      cascaded
        .map((entry: CascadedRow): string => {
          return `${entry.tableName}:${String(entry.row["_id"])}`;
        })
        .sort(),
    ).toEqual(
      [
        `StatusPageGroup:${GROUP_ID}`,
        `StatusPageGroup:${SUB_GROUP_ID}`,
        `StatusPageResource:${RESOURCE_ID}`,
        `StatusPageResource:${GROUPED_RESOURCE_ID}`,
        `StatusPageResource:${SUB_GROUP_RESOURCE_ID}`,
      ].sort(),
    );

    // Every statement is the one CASCADES names, with the parents' ids.
    for (const call of query.mock.calls) {
      expect(
        CASCADES.map((cascade: PublishedCascade): string => {
          return getCascadedRowsSql(cascade);
        }),
      ).toContain(call[0]);
      expect(Array.isArray(call[1][0])).toBe(true);
    }
  });

  test("a group's delete reaches its sub-groups, and the resources in them", async () => {
    const cascaded: Array<CascadedRow> = await PublishedImages.readCascadedRows(
      {
        tableName: "StatusPageGroup",
        ids: [GROUP_ID],
        query: statusPageTree(),
      },
    );

    expect(
      cascaded
        .map((entry: CascadedRow): string => {
          return `${entry.tableName}:${String(entry.row["_id"])}`;
        })
        .sort(),
    ).toEqual(
      [
        `StatusPageGroup:${SUB_GROUP_ID}`,
        `StatusPageResource:${GROUPED_RESOURCE_ID}`,
        `StatusPageResource:${SUB_GROUP_RESOURCE_ID}`,
      ].sort(),
    );
  });

  test("reads each kept row's markdown and switches, to tell what it showed", () => {
    expect(
      getCascadedRowsSql(cascadeOf("IncidentPublicNote", "incidentId")),
    ).toBe(
      `SELECT "_id", "projectId", "note", "incidentId" FROM "IncidentPublicNote" WHERE "incidentId" = ANY($1::uuid[]) AND "deletedAt" IS NULL`,
    );
    expect(getCascadedRowsSql(cascadeOf("StatusPage", "logoFileId"))).toBe(
      `SELECT "_id", "projectId", "overviewPageDescription" FROM "StatusPage" WHERE "logoFileId" = ANY($1::uuid[]) AND "deletedAt" IS NULL`,
    );
  });

  test("asks nothing of a table no published row hangs from, or of ids that are not ids", async () => {
    const query: QueryMock = statusPageTree();

    await expect(
      PublishedImages.readCascadedRows({
        tableName: "Label",
        ids: [new ObjectID(STATUS_PAGE_ID)],
        query: query,
      }),
    ).resolves.toEqual([]);
    await expect(
      PublishedImages.readCascadedRows({
        tableName: "StatusPage",
        ids: ["not-an-id"],
        query: query,
      }),
    ).resolves.toEqual([]);
    await expect(
      PublishedImages.readCascadedRows({
        tableName: undefined,
        ids: [STATUS_PAGE_ID],
        query: query,
      }),
    ).resolves.toEqual([]);

    expect(query).not.toHaveBeenCalled();
  });

  test("a failed read never fails the delete", async () => {
    const query: QueryMock = jest.fn(async (): Promise<unknown> => {
      throw new Error("db down");
    });

    await expect(
      PublishedImages.readCascadedRows({
        tableName: "Incident",
        ids: [PROJECT_ID],
        query: query,
      }),
    ).resolves.toEqual([]);
  });

  test("one failed read leaves the others to be made", async () => {
    const tree: QueryMock = statusPageTree();
    const groupsOfPage: string = getCascadedRowsSql(
      cascadeOf("StatusPageGroup", "statusPageId"),
    );
    const query: QueryMock = jest.fn(
      async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
        if (sql === groupsOfPage) {
          throw new Error("db down");
        }

        return await tree(sql, parameters);
      },
    );

    const cascaded: Array<CascadedRow> = await PublishedImages.readCascadedRows(
      {
        tableName: "StatusPage",
        ids: [STATUS_PAGE_ID],
        query: query,
      },
    );

    // The page's resources are still read; its groups could not be.
    expect(
      cascaded
        .map((entry: CascadedRow): string => {
          return `${entry.tableName}:${String(entry.row["_id"])}`;
        })
        .sort(),
    ).toEqual(
      [
        `StatusPageResource:${RESOURCE_ID}`,
        `StatusPageResource:${GROUPED_RESOURCE_ID}`,
      ].sort(),
    );
  });

  test("reads a table's rows together, and never a row being deleted itself", async () => {
    const query: QueryMock = statusPageTree();

    // The group and its sub-group deleted together.
    const cascaded: Array<CascadedRow> = await PublishedImages.readCascadedRows(
      {
        tableName: "StatusPageGroup",
        ids: [GROUP_ID, SUB_GROUP_ID],
        query: query,
      },
    );

    expect(
      cascaded
        .map((entry: CascadedRow): string => {
          return `${entry.tableName}:${String(entry.row["_id"])}`;
        })
        .sort(),
    ).toEqual(
      [
        `StatusPageResource:${GROUPED_RESOURCE_ID}`,
        `StatusPageResource:${SUB_GROUP_RESOURCE_ID}`,
      ].sort(),
    );

    // Each cascade of a group asked once, for both groups at once.
    const groupCascades: Array<PublishedCascade> = CASCADES.filter(
      (cascade: PublishedCascade): boolean => {
        return cascade.parentTable === "StatusPageGroup";
      },
    );

    expect(query).toHaveBeenCalledTimes(groupCascades.length);

    for (const call of query.mock.calls) {
      expect((call[1][0] as Array<string>).sort()).toEqual(
        [GROUP_ID, SUB_GROUP_ID].sort(),
      );
    }
  });
});

describe("PublishedImages.setImagesVisibility: one project's images, public or private", () => {
  type FindByMock = Mock<(data: unknown) => Promise<Array<File>>>;
  type UpdateByMock = Mock<(data: unknown) => Promise<number>>;
  type FindStillShownMock = Mock<
    (data: {
      projectId: ObjectID | string | null | undefined;
      tokens: Array<string>;
    }) => Promise<Set<string>>
  >;

  let findBy: FindByMock;
  let updateBy: UpdateByMock;
  let findStillShown: FindStillShownMock;

  function file(data: {
    id: string;
    token: string;
    projectId: ObjectID;
    isPublic: boolean;
  }): File {
    const value: File = new File();
    value._id = data.id;
    value.imageAccessToken = data.token;
    value.projectId = data.projectId;
    value.isPublic = data.isPublic;
    return value;
  }

  const OWN_PRIVATE: File = file({
    id: "dddddddd-0000-4000-8000-000000000001",
    token: "aaa111",
    projectId: PROJECT_ID,
    isPublic: false,
  });
  const OWN_PUBLIC: File = file({
    id: "dddddddd-0000-4000-8000-000000000002",
    token: "bbb222",
    projectId: PROJECT_ID,
    isPublic: true,
  });
  const OWN_PUBLIC_STILL_SHOWN: File = file({
    id: "dddddddd-0000-4000-8000-000000000003",
    token: "ccc333",
    projectId: PROJECT_ID,
    isPublic: true,
  });
  const OTHER_PRIVATE: File = file({
    id: "dddddddd-0000-4000-8000-000000000004",
    token: "eee555",
    projectId: OTHER_PROJECT_ID,
    isPublic: false,
  });
  const OTHER_PUBLIC: File = file({
    id: "dddddddd-0000-4000-8000-000000000005",
    token: "fff666",
    projectId: OTHER_PROJECT_ID,
    isPublic: true,
  });

  beforeEach(() => {
    findBy = jest.fn(async (): Promise<Array<File>> => {
      return [
        OWN_PRIVATE,
        OWN_PUBLIC,
        OWN_PUBLIC_STILL_SHOWN,
        OTHER_PRIVATE,
        OTHER_PUBLIC,
      ];
    });
    updateBy = jest.fn(async (): Promise<number> => {
      return 1;
    });
    findStillShown = jest.fn(async (): Promise<Set<string>> => {
      return new Set<string>(["ccc333"]);
    });

    jest.spyOn(FileService, "findBy").mockImplementation(findBy as never);
    jest.spyOn(FileService, "updateBy").mockImplementation(updateBy as never);
    jest
      .spyOn(PublishedImages, "findStillShown")
      .mockImplementation(findStillShown as never);
  });

  // Each write: "public: <ids>" or "private: <ids>".
  function writes(): Array<string> {
    return updateBy.mock.calls.map((call: [unknown]): string => {
      const data: {
        query: { _id: unknown };
        data: { isPublic: boolean };
        props: unknown;
      } = call[0] as {
        query: { _id: unknown };
        data: { isPublic: boolean };
        props: unknown;
      };

      expect(data.props).toEqual({ isRoot: true, ignoreHooks: true });

      return `${data.data.isPublic ? "public" : "private"}: ${anyValues(
        data.query._id,
      ).join(",")}`;
    });
  }

  test("looks every image up once, without the bytes, and writes each visibility once", async () => {
    await PublishedImages.setImagesVisibility({
      projectId: PROJECT_ID,
      publish: ["aaa111", "eee555"],
      unpublish: ["bbb222", "ccc333", "fff666"],
    });

    expect(findBy).toHaveBeenCalledTimes(1);

    const lookup: {
      query: { imageAccessToken: unknown };
      select: Record<string, unknown>;
      props: unknown;
    } = findBy.mock.calls[0]![0] as {
      query: { imageAccessToken: unknown };
      select: Record<string, unknown>;
      props: unknown;
    };

    expect(anyValues(lookup.query.imageAccessToken).sort()).toEqual(
      ["aaa111", "bbb222", "ccc333", "eee555", "fff666"].sort(),
    );
    expect(lookup.select).not.toHaveProperty("file");
    expect(lookup.props).toEqual({ isRoot: true, ignoreHooks: true });

    expect(writes()).toEqual([
      `public: ${OWN_PRIVATE._id}`,
      `private: ${OWN_PUBLIC._id}`,
    ]);
  });

  test("never touches another project's image", async () => {
    await PublishedImages.setImagesVisibility({
      projectId: PROJECT_ID,
      publish: ["eee555"],
      unpublish: ["fff666"],
    });

    expect(updateBy).not.toHaveBeenCalled();
    expect(findStillShown).not.toHaveBeenCalled();
  });

  test("makes private only what no record of the project still shows, asked once for all", async () => {
    await PublishedImages.setImagesVisibility({
      projectId: PROJECT_ID,
      publish: [],
      unpublish: ["bbb222", "ccc333"],
    });

    expect(findStillShown).toHaveBeenCalledTimes(1);
    expect(findStillShown.mock.calls[0]![0].tokens.sort()).toEqual([
      "bbb222",
      "ccc333",
    ]);
    expect(String(findStillShown.mock.calls[0]![0].projectId)).toBe(
      PROJECT_ID.toString(),
    );
    expect(writes()).toEqual([`private: ${OWN_PUBLIC._id}`]);
  });

  test("leaves an image as it is when it already is so", async () => {
    await PublishedImages.setImagesVisibility({
      projectId: PROJECT_ID,
      publish: ["bbb222"],
      unpublish: ["aaa111"],
    });

    expect(updateBy).not.toHaveBeenCalled();
    // A private image is not asked about: it stays private.
    expect(findStillShown).not.toHaveBeenCalled();
  });

  test("an image both shown and hidden by the same write stays public", async () => {
    await PublishedImages.setImagesVisibility({
      projectId: PROJECT_ID,
      publish: ["aaa111", "bbb222"],
      unpublish: ["aaa111", "bbb222"],
    });

    expect(findStillShown).not.toHaveBeenCalled();
    expect(writes()).toEqual([`public: ${OWN_PRIVATE._id}`]);
  });

  test("asks nothing for no project, an id that is not one, or no real tokens", async () => {
    for (const projectId of [null, undefined, "not-an-id"]) {
      await PublishedImages.setImagesVisibility({
        projectId: projectId,
        publish: ["aaa111"],
        unpublish: ["bbb222"],
      });
    }

    await PublishedImages.setImagesVisibility({
      projectId: PROJECT_ID,
      publish: ["a%b", ""],
      unpublish: ["' OR 1=1 --"],
    });

    expect(findBy).not.toHaveBeenCalled();
    expect(updateBy).not.toHaveBeenCalled();
  });

  test("never fails the write it follows; one failed write leaves the other to be made", async () => {
    findBy.mockRejectedValueOnce(new Error("db down"));

    await expect(
      PublishedImages.setImagesVisibility({
        projectId: PROJECT_ID,
        publish: ["aaa111"],
        unpublish: ["bbb222"],
      }),
    ).resolves.toBeUndefined();
    expect(updateBy).not.toHaveBeenCalled();

    updateBy.mockRejectedValueOnce(new Error("db down"));

    await expect(
      PublishedImages.setImagesVisibility({
        projectId: PROJECT_ID,
        publish: ["aaa111"],
        unpublish: ["bbb222"],
      }),
    ).resolves.toBeUndefined();
    expect(updateBy).toHaveBeenCalledTimes(2);
    expect(writes()[1]).toBe(`private: ${OWN_PUBLIC._id}`);
  });

  test("a write of several files that fails is made a file at a time, so one that cannot be written leaves the rest", async () => {
    const SECOND_OWN_PRIVATE: File = file({
      id: "dddddddd-0000-4000-8000-000000000006",
      token: "abc666",
      projectId: PROJECT_ID,
      isPublic: false,
    });
    const THIRD_OWN_PRIVATE: File = file({
      id: "dddddddd-0000-4000-8000-000000000007",
      token: "abc777",
      projectId: PROJECT_ID,
      isPublic: false,
    });

    findBy.mockResolvedValue([
      OWN_PRIVATE,
      SECOND_OWN_PRIVATE,
      THIRD_OWN_PRIVATE,
    ]);

    // The write of all three fails, and then the second file's own.
    updateBy
      .mockRejectedValueOnce(new Error("statement timeout"))
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("row locked"))
      .mockResolvedValueOnce(1);

    await expect(
      PublishedImages.setImagesVisibility({
        projectId: PROJECT_ID,
        publish: ["aaa111", "abc666", "abc777"],
        unpublish: [],
      }),
    ).resolves.toBeUndefined();

    expect(writes()).toEqual([
      `public: ${OWN_PRIVATE._id},${SECOND_OWN_PRIVATE._id},${THIRD_OWN_PRIVATE._id}`,
      `public: ${OWN_PRIVATE._id}`,
      `public: ${SECOND_OWN_PRIVATE._id}`,
      `public: ${THIRD_OWN_PRIVATE._id}`,
    ]);
  });
});

describe("PublishedImages.findStillShown", () => {
  function stubQuery(answer: () => Promise<unknown>): QueryMock {
    const query: QueryMock = jest.fn(answer);

    jest.spyOn(FileService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);

    return query;
  }

  test("asks the database once, for the project and every image's address", async () => {
    const query: QueryMock = stubQuery(async () => {
      return [{ token: "abc123" }];
    });

    const shown: Set<string> = await PublishedImages.findStillShown({
      projectId: PROJECT_ID,
      tokens: ["abc123", "def456", "abc123"],
    });

    expect(Array.from(shown)).toEqual(["abc123"]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toBe(STILL_SHOWN_SQL);
    expect(query.mock.calls[0]![1]).toEqual([
      PROJECT_ID.toString(),
      [
        "%/file/image/access-token/abc123%",
        "%/file/image/access-token/def456%",
      ],
      ["abc123", "def456"],
      expect.any(Date),
    ]);
  });

  test("asks as of the time it is given, or now: what an announcement shows depends on it", async () => {
    const query: QueryMock = stubQuery(async () => {
      return [];
    });
    const asOf: Date = new Date("2026-10-07T12:00:00.000Z");

    await PublishedImages.findStillShown({
      projectId: PROJECT_ID,
      tokens: ["abc123"],
      now: asOf,
    });

    expect(query.mock.calls[0]![1]![3]).toBe(asOf);

    const current: Date = new Date("2026-10-08T09:30:00.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(current);

    await PublishedImages.findStillShown({
      projectId: PROJECT_ID,
      tokens: ["abc123"],
    });

    expect(query.mock.calls[1]![1]![3]).toBe(current);
  });

  test("no published record of the project shows them: none is still shown", async () => {
    stubQuery(async () => {
      return [];
    });

    await expect(
      PublishedImages.findStillShown({
        projectId: PROJECT_ID,
        tokens: ["abc123"],
      }),
    ).resolves.toEqual(new Set<string>());
  });

  test("an image is never made private on a guess", async () => {
    const query: QueryMock = stubQuery(async () => {
      throw new Error("db down");
    });

    await expect(
      PublishedImages.findStillShown({
        projectId: PROJECT_ID,
        tokens: ["abc123", "def456"],
      }),
    ).resolves.toEqual(new Set<string>(["abc123", "def456"]));

    query.mockClear();

    // A token that is not hex, or no project: nothing is asked, and all stay.
    await expect(
      PublishedImages.findStillShown({
        projectId: PROJECT_ID,
        tokens: ["abc123", "a%b"],
      }),
    ).resolves.toEqual(new Set<string>(["abc123", "a%b"]));
    await expect(
      PublishedImages.findStillShown({ projectId: null, tokens: ["abc123"] }),
    ).resolves.toEqual(new Set<string>(["abc123"]));
    await expect(
      PublishedImages.findStillShown({ projectId: PROJECT_ID, tokens: [] }),
    ).resolves.toEqual(new Set<string>());
    expect(query).not.toHaveBeenCalled();
  });
});

describe("the SQL the still-shown check, a project's delete and the data migration run", () => {
  test("STILL_SHOWN_SQL asks every published or sent record of the project, with its switches", () => {
    for (const source of [...PUBLISHED_MARKDOWN, ...KEPT_MARKDOWN]) {
      expect(STILL_SHOWN_SQL).toContain(`FROM "${source.tableName}"`);

      for (const column of source.markdownColumns) {
        expect(STILL_SHOWN_SQL).toContain(`"${column}"::text`);
      }
    }

    expect(STILL_SHOWN_SQL).toContain(
      `FROM "Incident" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "isVisibleOnStatusPage" = true AND "showPostmortemOnStatusPage" = true AND "isPrivate" IS NOT TRUE AND concat_ws(' ', "postmortemNote"::text) LIKE ANY($2)`,
    );
    // Custom fields count while the incident is shown, and so sent out.
    expect(STILL_SHOWN_SQL).toContain(
      `FROM "Incident" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "isVisibleOnStatusPage" = true AND "isPrivate" IS NOT TRUE AND concat_ws(' ', "customFields"::text) LIKE ANY($2)`,
    );
    // A private incident or episode shows nothing, whatever its switch says.
    expect(STILL_SHOWN_SQL).toContain(
      `FROM "Incident" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "isVisibleOnStatusPage" = true AND "isPrivate" IS NOT TRUE AND concat_ws(' ', "description"::text) LIKE ANY($2)`,
    );
    expect(STILL_SHOWN_SQL).toContain(
      `FROM "IncidentEpisode" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "isVisibleOnStatusPage" = true AND "isPrivate" IS NOT TRUE AND concat_ws(' ', "description"::text) LIKE ANY($2)`,
    );
    // A scheduled maintenance event has no Private switch.
    expect(STILL_SHOWN_SQL).toContain(
      `FROM "ScheduledMaintenance" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "isVisibleOnStatusPage" = true AND concat_ws(' ', "description"::text) LIKE ANY($2)`,
    );
    // A form, while it accepts submissions.
    expect(STILL_SHOWN_SQL).toContain(
      `FROM "Form" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "isEnabled" = true AND concat_ws(' ', "description"::text, "successMessage"::text) LIKE ANY($2)`,
    );
    expect(STILL_SHOWN_SQL).toMatch(/^SELECT DISTINCT "shown"\."token"/);
    expect(STILL_SHOWN_SQL.endsWith(`WHERE "shown"."token" = ANY($3)`)).toBe(
      true,
    );
  });

  test("PROJECT_FILES_PRIVATE_SQL makes the deleted projects' public files private, but an icon still in use", () => {
    expect(PROJECT_FILES_PRIVATE_SQL).toBe(
      `UPDATE "File" AS "file" SET "isPublic" = false WHERE "file"."isPublic" = true AND "file"."projectId" = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM "Probe" WHERE "Probe"."iconFileId" = "file"."_id") AND NOT EXISTS (SELECT 1 FROM "AIAgent" WHERE "AIAgent"."iconFileId" = "file"."_id")`,
    );
  });

  test("PUBLISH_SHOWN_IMAGES_SQL makes public only private images of the showing record's own project", () => {
    expect(PUBLISH_SHOWN_IMAGES_SQL).toMatch(
      /^UPDATE "File" AS "file" SET "isPublic" = true FROM \(/,
    );
    expect(PUBLISH_SHOWN_IMAGES_SQL).toContain(
      `"file"."projectId" = "shown"."projectId"`,
    );
    expect(PUBLISH_SHOWN_IMAGES_SQL).toContain(`"file"."isPublic" = false`);

    for (const source of PUBLISHED_MARKDOWN) {
      expect(PUBLISH_SHOWN_IMAGES_SQL).toContain(`FROM "${source.tableName}"`);
    }

    // What is merely sent out is not made public by it.
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
    expect(HIDE_UNSHOWN_FILES_SQL).toContain(`FROM "Form"`);
    expect(HIDE_UNSHOWN_FILES_SQL).toContain(
      `"shownId"."fileId" = "file"."_id"::text`,
    );

    // Kept for any project: an image another project's page shows stays.
    expect(HIDE_UNSHOWN_FILES_SQL).not.toContain(`"shown"."projectId"`);
  });

  /*
   * Once, for images a private incident or episode made public while its
   * switch was still on: those, and only those, become private - unless a
   * published record still shows them, or they are icons.
   */
  test("HIDE_PRIVATE_RECORD_IMAGES_SQL makes private only the public images of private records of the file's own project", () => {
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).toContain(
      `UPDATE "File" AS "file" SET "isPublic" = false WHERE "file"."isPublic" = true`,
    );
    // Only images a private record holds, of that record's own project or of none.
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).toContain(
      `EXISTS (SELECT 1 FROM "hiddenToken" WHERE "hiddenToken"."token" = "file"."imageAccessToken" AND ("file"."projectId" IS NULL OR "hiddenToken"."projectId" = "file"."projectId"))`,
    );
    for (const [table, column] of [
      ["Incident", "description"],
      ["Incident", "postmortemNote"],
      ["Incident", "customFields"],
      ["IncidentEpisode", "description"],
    ] as Array<[string, string]>) {
      expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).toContain(
        `FROM "${table}" WHERE "deletedAt" IS NULL AND ("isPrivate" IS TRUE) AND concat_ws(' ', "${column}"::text) LIKE '%/file/image/access-token/%'`,
      );
    }
    // Nothing that has no Private switch is read as hiding anything.
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).not.toMatch(
      /FROM "(ScheduledMaintenance|IncidentPublicNote|StatusPageAnnouncement|Form)" WHERE "deletedAt" IS NULL AND \(/,
    );
    // Kept: what a published record still shows, by token or by id, and icons.
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).toContain(
      `NOT EXISTS (SELECT 1 FROM "shownToken" WHERE "shownToken"."token" = "file"."imageAccessToken")`,
    );
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).toContain(
      `NOT EXISTS (SELECT 1 FROM "shownId" WHERE "shownId"."fileId" = "file"."_id"::text)`,
    );
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).toContain(
      `NOT EXISTS (SELECT 1 FROM "Probe" WHERE "Probe"."iconFileId" = "file"."_id")`,
    );
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).toContain(
      `NOT EXISTS (SELECT 1 FROM "AIAgent" WHERE "AIAgent"."iconFileId" = "file"."_id")`,
    );
    // The shown images are read by the rule that leaves private records out.
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).toContain(
      `FROM "Incident" WHERE "deletedAt" IS NULL AND "isVisibleOnStatusPage" = true AND "isPrivate" IS NOT TRUE AND concat_ws(' ', "description"::text) LIKE '%/file/image/access-token/%'`,
    );
    // It never makes anything public.
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).not.toContain(
      `SET "isPublic" = true`,
    );
  });

  test("the one-off statements read private records out of what is published", () => {
    expect(PUBLISH_SHOWN_IMAGES_SQL).toContain(
      `FROM "Incident" WHERE "deletedAt" IS NULL AND "isVisibleOnStatusPage" = true AND "isPrivate" IS NOT TRUE`,
    );
    expect(PUBLISH_SHOWN_IMAGES_SQL).toContain(
      `FROM "IncidentEpisode" WHERE "deletedAt" IS NULL AND "isVisibleOnStatusPage" = true AND "isPrivate" IS NOT TRUE`,
    );
    expect(HIDE_UNSHOWN_FILES_SQL).toContain(`"isPrivate" IS NOT TRUE`);
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

/*
 * A PUBLIC NOTE SHOWS ITS IMAGES ONLY WHILE ITS RECORD IS SHOWN.
 *
 * A public note is shown on a status page under its incident, episode or
 * scheduled maintenance event, never without it: its images are public
 * while that record is shown (an incident or an episode visible and not
 * private, an event visible), and private again - unless something else
 * still shows them - once it is not, whichever of the two is written.
 */
describe("GUARD: every record a public note is shown under", () => {
  const sourcesShownUnder: Array<PublishedMarkdown> = PUBLISHED_MARKDOWN.filter(
    (source: PublishedMarkdown): boolean => {
      return Boolean(source.shownUnder);
    },
  );

  test("is named for every public note", () => {
    expect(
      sourcesShownUnder.map((source: PublishedMarkdown): string => {
        return `${source.tableName}.${source.shownUnder!.foreignKey} -> ${source.shownUnder!.tableName}`;
      }),
    ).toEqual([
      "IncidentPublicNote.incidentId -> Incident",
      "IncidentEpisodePublicNote.incidentEpisodeId -> IncidentEpisode",
      "ScheduledMaintenancePublicNote.scheduledMaintenanceId -> ScheduledMaintenance",
    ]);
  });

  test("is shown by the very switches its own description is shown by", () => {
    for (const source of sourcesShownUnder) {
      const parent: PublishedParent = source.shownUnder!;
      const own: PublishedMarkdown | undefined = PUBLISHED_MARKDOWN.find(
        (candidate: PublishedMarkdown): boolean => {
          return (
            candidate.tableName === parent.tableName &&
            candidate.markdownColumns.includes("description")
          );
        },
      );

      expect(own).toBeDefined();
      expect(parent.shownWhen).toEqual(own!.shownWhen);
      expect(parent.hiddenWhen || []).toEqual(own!.hiddenWhen || []);
    }
  });

  test("names it by a column of the note, and its switches are switches of it", () => {
    for (const source of sourcesShownUnder) {
      const parent: PublishedParent = source.shownUnder!;

      expect(modelOf(source.tableName).getTableColumns().columns).toContain(
        parent.foreignKey,
      );

      for (const column of [
        ...parent.shownWhen,
        ...(parent.hiddenWhen || []),
      ]) {
        expect(columnType(modelOf(parent.tableName), column)).toBe(
          TableColumnType.Boolean,
        );
      }
    }
  });

  test("takes its notes with it when it is deleted (CASCADES)", () => {
    for (const source of sourcesShownUnder) {
      expect(
        CASCADES.some((cascade: PublishedCascade): boolean => {
          return (
            cascade.parentTable === source.shownUnder!.tableName &&
            cascade.tableName === source.tableName &&
            cascade.foreignKey === source.shownUnder!.foreignKey
          );
        }),
      ).toBe(true);
    }
  });

  test("getSourcesShownUnder answers a record's notes, and nothing for others", () => {
    expect(
      PublishedImages.getSourcesShownUnder("Incident").map(
        (source: PublishedMarkdown): string => {
          return source.tableName;
        },
      ),
    ).toEqual(["IncidentPublicNote"]);
    expect(
      PublishedImages.getSourcesShownUnder("ScheduledMaintenance").map(
        (source: PublishedMarkdown): string => {
          return source.tableName;
        },
      ),
    ).toEqual(["ScheduledMaintenancePublicNote"]);
    expect(PublishedImages.getSourcesShownUnder("Monitor")).toEqual([]);
    expect(PublishedImages.getSourcesShownUnder(undefined)).toEqual([]);
  });
});

describe("PublishedImages: a public note shows its images only while its record is shown", () => {
  const OTHER_INCIDENT_ID: string = "55555555-5555-4555-8555-555555555555";

  // The incidents shown now, each with its project.
  function shown(entries: Array<[string, ObjectID]>): ShownParents {
    return new Map(
      entries.map(([id, projectId]: [string, ObjectID]): [string, string] => {
        return [id, projectId.toString()];
      }),
    );
  }

  function note(data: {
    token: string;
    incidentId?: string;
    projectId?: ObjectID;
  }): Record<string, unknown> {
    return {
      _id: "66666666-6666-4666-8666-666666666666",
      projectId: (data.projectId || PROJECT_ID).toString(),
      incidentId: data.incidentId === undefined ? INCIDENT_ID : data.incidentId,
      note: image(data.token),
    };
  }

  describe("getShownTokens", () => {
    test("shown while its incident is shown, of the note's own project", () => {
      expect(
        Array.from(
          PublishedImages.getShownTokens(
            "IncidentPublicNote",
            note({ token: "aaa111" }),
            shown([[INCIDENT_ID, PROJECT_ID]]),
          ),
        ),
      ).toEqual(["aaa111"]);
    });

    test("not while its incident is not shown, or not read", () => {
      for (const shownParents of [
        shown([]),
        shown([[OTHER_INCIDENT_ID, PROJECT_ID]]),
        undefined,
      ]) {
        expect(
          PublishedImages.getShownTokens(
            "IncidentPublicNote",
            note({ token: "aaa111" }),
            shownParents,
          ).size,
        ).toBe(0);
      }
    });

    test("not when its incident is of another project", () => {
      expect(
        PublishedImages.getShownTokens(
          "IncidentPublicNote",
          note({ token: "aaa111" }),
          shown([[INCIDENT_ID, OTHER_PROJECT_ID]]),
        ).size,
      ).toBe(0);
    });

    test("not when it names no incident", () => {
      expect(
        PublishedImages.getShownTokens(
          "IncidentPublicNote",
          note({ token: "aaa111", incidentId: "" }),
          shown([[INCIDENT_ID, PROJECT_ID]]),
        ).size,
      ).toBe(0);
    });

    test("getHeldTokens reads every image a note holds, shown or not", () => {
      expect(
        Array.from(
          PublishedImages.getHeldTokens("IncidentPublicNote", {
            note: `${image("aaa111")} ${image("bbb222")} ${image("aaa111")}`,
          }),
        ),
      ).toEqual(["aaa111", "bbb222"]);
      expect(
        PublishedImages.getHeldTokens("IncidentInternalNote", {
          note: image("aaa111"),
        }).size,
      ).toBe(0);
    });
  });

  describe("isParentShown", () => {
    const incident: PublishedParent = PUBLISHED_MARKDOWN.find(
      (source: PublishedMarkdown): boolean => {
        return source.tableName === "IncidentPublicNote";
      },
    )!.shownUnder!;

    test("an incident visible and not private shows its notes", () => {
      for (const isPrivate of [false, null, undefined]) {
        expect(
          PublishedImages.isParentShown(incident, {
            isVisibleOnStatusPage: true,
            isPrivate,
          }),
        ).toBe(true);
      }
    });

    test("one hidden, private, or switched on by anything but true shows none", () => {
      for (const row of [
        { isVisibleOnStatusPage: false, isPrivate: false },
        { isVisibleOnStatusPage: null },
        { isVisibleOnStatusPage: "true" },
        { isVisibleOnStatusPage: true, isPrivate: true },
        { isVisibleOnStatusPage: true, isPrivate: "yes" },
      ] as Array<Record<string, unknown>>) {
        expect(PublishedImages.isParentShown(incident, row)).toBe(false);
      }
    });
  });

  describe("readShownParents", () => {
    type QueryCall = [string, Array<unknown>];

    function stubQuery(answer: (sql: string) => Promise<unknown>): QueryMock {
      const query: QueryMock = jest.fn(answer);

      jest.spyOn(FileService, "getRepository").mockReturnValue({
        manager: { query },
      } as never);

      return query;
    }

    test("asks once for every incident the notes name, and answers the shown ones with their project", async () => {
      const query: QueryMock = stubQuery(async () => {
        return [
          { _id: INCIDENT_ID.toUpperCase(), projectId: PROJECT_ID.toString() },
        ];
      });

      const shownParents: ShownParents = await PublishedImages.readShownParents(
        "IncidentPublicNote",
        [
          note({ token: "aaa111" }),
          note({ token: "bbb222", incidentId: OTHER_INCIDENT_ID }),
          note({ token: "ccc333" }),
          note({ token: "ddd444", incidentId: "not-an-id" }),
        ],
      );

      expect(query).toHaveBeenCalledTimes(1);

      const call: QueryCall = query.mock.calls[0] as QueryCall;

      expect(call[0]).toBe(
        getShownParentsSql(
          PUBLISHED_MARKDOWN.find((source: PublishedMarkdown): boolean => {
            return source.tableName === "IncidentPublicNote";
          })!.shownUnder!,
        ),
      );
      expect((call[1][0] as Array<string>).sort()).toEqual(
        [INCIDENT_ID, OTHER_INCIDENT_ID].sort(),
      );
      expect(Array.from(shownParents.entries())).toEqual([
        [INCIDENT_ID, PROJECT_ID.toString()],
      ]);
    });

    test("asks nothing for a table shown under nothing, or notes that name no record", async () => {
      const query: QueryMock = stubQuery(async () => {
        return [];
      });

      await PublishedImages.readShownParents("Incident", [
        { incidentId: INCIDENT_ID },
      ]);
      await PublishedImages.readShownParents("IncidentPublicNote", [
        note({ token: "aaa111", incidentId: "" }),
      ]);

      expect(query).not.toHaveBeenCalled();
    });

    test("a failed read takes none as shown: nothing is made public on a guess", async () => {
      stubQuery(async () => {
        throw new Error("db down");
      });

      await expect(
        PublishedImages.readShownParents("IncidentPublicNote", [
          note({ token: "aaa111" }),
        ]),
      ).resolves.toEqual(new Map());
    });
  });

  describe("when a note is written", () => {
    beforeEach(recordVisibility);

    function parentsShown(entries: Array<[string, ObjectID]>): void {
      jest
        .spyOn(PublishedImages, "readShownParents")
        .mockResolvedValue(shown(entries));
    }

    test("a note posted on a shown incident makes its images public", async () => {
      parentsShown([[INCIDENT_ID, PROJECT_ID]]);

      await PublishedImages.afterCreate({
        tableName: "IncidentPublicNote",
        row: note({ token: "aaa111" }),
        readStored: async () => {
          return null;
        },
      });

      expect(visibilityAsked()).toEqual(["aaa111:public"]);
    });

    test("a note posted on a hidden or private incident leaves them private", async () => {
      parentsShown([]);

      await PublishedImages.afterCreate({
        tableName: "IncidentPublicNote",
        row: note({ token: "aaa111" }),
        readStored: async () => {
          return null;
        },
      });

      expect(visibilityAsked()).toEqual([]);
    });

    test("a note edited on a shown incident publishes what it shows now, and asks the rest to be private", async () => {
      parentsShown([[INCIDENT_ID, PROJECT_ID]]);

      await PublishedImages.afterUpdate({
        tableName: "IncidentPublicNote",
        rowsBefore: [note({ token: "aaa111" })],
        written: { note: image("bbb222") },
      });

      expect(visibilityAsked()).toEqual(["bbb222:public", "aaa111:private"]);
    });

    test("a note edited on a hidden incident makes nothing public, and asks all it held to be private", async () => {
      parentsShown([]);

      await PublishedImages.afterUpdate({
        tableName: "IncidentPublicNote",
        rowsBefore: [note({ token: "aaa111" })],
        written: { note: `${image("aaa111")} ${image("bbb222")}` },
      });

      expect(visibilityAsked()).toEqual(["aaa111:private", "bbb222:private"]);
    });

    test("the incident it is shown under is read as the note is after the write", async () => {
      const readShownParents: SpyInstance<
        typeof PublishedImages.readShownParents
      > = jest
        .spyOn(PublishedImages, "readShownParents")
        .mockResolvedValue(shown([[OTHER_INCIDENT_ID, PROJECT_ID]]));

      await PublishedImages.afterUpdate({
        tableName: "IncidentPublicNote",
        rowsBefore: [note({ token: "aaa111" })],
        written: { incidentId: OTHER_INCIDENT_ID },
      });

      expect(
        (
          readShownParents.mock.calls[0]![1] as Array<Record<string, unknown>>
        )[0]!["incidentId"],
      ).toBe(OTHER_INCIDENT_ID);
      expect(visibilityAsked()).toEqual(["aaa111:public"]);
    });

    test("a note deleted asks every image it held to be private", async () => {
      await PublishedImages.afterDelete({
        tableName: "IncidentPublicNote",
        rowsDeleted: [note({ token: "aaa111" })],
      });

      expect(visibilityAsked()).toEqual(["aaa111:private"]);
    });
  });

  describe("when the record a note is shown under is written", () => {
    beforeEach(recordVisibility);

    const SHOWN: Record<string, unknown> = {
      _id: INCIDENT_ID,
      projectId: PROJECT_ID,
      description: "No pictures.",
      isVisibleOnStatusPage: true,
      isPrivate: false,
    };

    // The notes of the incident the database answers, with an image each.
    function notesOfIncident(notes: Array<Record<string, unknown>>): QueryMock {
      const query: QueryMock = jest.fn(
        async (sql: string): Promise<unknown> => {
          return sql === getRowsShownUnderSql(noteSource()) ? notes : [];
        },
      );

      jest.spyOn(FileService, "getRepository").mockReturnValue({
        manager: { query },
      } as never);

      return query;
    }

    function noteSource(): PublishedMarkdown {
      return PUBLISHED_MARKDOWN.find((source: PublishedMarkdown): boolean => {
        return source.tableName === "IncidentPublicNote";
      })!;
    }

    test("hiding it makes its notes' images private", async () => {
      const query: QueryMock = notesOfIncident([note({ token: "aaa111" })]);

      await PublishedImages.afterUpdate({
        tableName: "Incident",
        rowsBefore: [SHOWN],
        written: { isVisibleOnStatusPage: false },
      });

      expect(query.mock.calls[0]![0]).toBe(getRowsShownUnderSql(noteSource()));
      expect(query.mock.calls[0]![1]).toEqual([[INCIDENT_ID]]);
      expect(visibilityAsked()).toEqual(["aaa111:private"]);
    });

    test("making it private makes them private too", async () => {
      notesOfIncident([note({ token: "aaa111" })]);

      await PublishedImages.afterUpdate({
        tableName: "Incident",
        rowsBefore: [SHOWN],
        written: { isPrivate: true, isVisibleOnStatusPage: false },
      });

      expect(visibilityAsked()).toEqual(["aaa111:private"]);
    });

    test("showing it makes its notes' images public", async () => {
      notesOfIncident([note({ token: "aaa111" }), note({ token: "bbb222" })]);

      await PublishedImages.afterUpdate({
        tableName: "Incident",
        rowsBefore: [{ ...SHOWN, isVisibleOnStatusPage: false }],
        written: { isVisibleOnStatusPage: true },
      });

      expect(visibilityAsked()).toEqual(["aaa111:public", "bbb222:public"]);
    });

    test("what its write stored decides, not what the update asked for", async () => {
      notesOfIncident([note({ token: "aaa111" })]);

      // Asked to be shown; stored hidden, as the incident was private by then.
      await PublishedImages.afterUpdate({
        tableName: "Incident",
        rowsBefore: [{ ...SHOWN, isVisibleOnStatusPage: false }],
        written: { isVisibleOnStatusPage: true },
        rowsAfter: [{ isVisibleOnStatusPage: false, isPrivate: true }],
      });

      expect(visibilityAsked()).toEqual(["aaa111:private"]);
    });

    test("a note of another project is never made public by it", async () => {
      notesOfIncident([note({ token: "aaa111", projectId: OTHER_PROJECT_ID })]);

      await PublishedImages.afterUpdate({
        tableName: "Incident",
        rowsBefore: [{ ...SHOWN, isVisibleOnStatusPage: false }],
        written: { isVisibleOnStatusPage: true },
      });

      expect(
        setImagesVisibility.mock.calls.flatMap(
          (call: [VisibilityRequest]): Array<string> => {
            return Array.from(call[0].publish);
          },
        ),
      ).toEqual([]);
    });

    test("a write of anything but its switches reads no notes", async () => {
      const query: QueryMock = notesOfIncident([note({ token: "aaa111" })]);

      await PublishedImages.afterUpdate({
        tableName: "Incident",
        rowsBefore: [SHOWN],
        written: { description: image("ccc333") },
      });

      expect(query).not.toHaveBeenCalled();
      expect(visibilityAsked()).toEqual(["ccc333:public"]);
    });

    test("a scheduled maintenance event hidden makes its notes' images private", async () => {
      const source: PublishedMarkdown = PUBLISHED_MARKDOWN.find(
        (candidate: PublishedMarkdown): boolean => {
          return candidate.tableName === "ScheduledMaintenancePublicNote";
        },
      )!;
      const query: QueryMock = jest.fn(
        async (sql: string): Promise<unknown> => {
          return sql === getRowsShownUnderSql(source)
            ? [
                {
                  projectId: PROJECT_ID.toString(),
                  scheduledMaintenanceId: INCIDENT_ID,
                  note: image("eee555"),
                },
              ]
            : [];
        },
      );

      jest.spyOn(FileService, "getRepository").mockReturnValue({
        manager: { query },
      } as never);

      await PublishedImages.afterUpdate({
        tableName: "ScheduledMaintenance",
        rowsBefore: [
          {
            _id: INCIDENT_ID,
            projectId: PROJECT_ID,
            description: "Planned.",
            isVisibleOnStatusPage: true,
          },
        ],
        written: { isVisibleOnStatusPage: false },
      });

      expect(visibilityAsked()).toEqual(["eee555:private"]);
    });

    test("a failed read of the notes leaves them as they are, and the record's own images are still set", async () => {
      jest.spyOn(FileService, "getRepository").mockReturnValue({
        manager: {
          query: async (): Promise<unknown> => {
            throw new Error("db down");
          },
        },
      } as never);

      await expect(
        PublishedImages.afterUpdate({
          tableName: "Incident",
          rowsBefore: [{ ...SHOWN, description: image("fff666") }],
          written: { isVisibleOnStatusPage: false },
        }),
      ).resolves.toBeUndefined();

      expect(visibilityAsked()).toEqual(["fff666:private"]);
    });
  });
});

describe("the SQL that reads which records notes are shown under, and their notes", () => {
  const incidentNotes: PublishedMarkdown = PUBLISHED_MARKDOWN.find(
    (source: PublishedMarkdown): boolean => {
      return source.tableName === "IncidentPublicNote";
    },
  )!;

  test("getShownParentsSql reads the shown ones, with their projects", () => {
    expect(getShownParentsSql(incidentNotes.shownUnder!)).toBe(
      `SELECT "_id", "projectId" FROM "Incident" WHERE "_id" = ANY($1::uuid[]) AND "deletedAt" IS NULL AND "isVisibleOnStatusPage" = true AND "isPrivate" IS NOT TRUE`,
    );
  });

  test("getRowsShownUnderSql reads their notes that carry an image", () => {
    expect(getRowsShownUnderSql(incidentNotes)).toBe(
      `SELECT "_id", "projectId", "incidentId", "note" FROM "IncidentPublicNote" WHERE "incidentId" = ANY($1::uuid[]) AND "deletedAt" IS NULL AND concat_ws(' ', "note"::text) LIKE '%/file/image/access-token/%'`,
    );
  });

  test("STILL_SHOWN_SQL counts a note only while its record is shown, of its project", () => {
    expect(STILL_SHOWN_SQL).toContain(
      `FROM "IncidentPublicNote" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "Incident" AS "parentRecord" WHERE "parentRecord"."_id" = "IncidentPublicNote"."incidentId" AND "parentRecord"."projectId" = "IncidentPublicNote"."projectId" AND "parentRecord"."deletedAt" IS NULL AND "parentRecord"."isVisibleOnStatusPage" = true AND "parentRecord"."isPrivate" IS NOT TRUE) AND concat_ws(' ', "note"::text) LIKE ANY($2)`,
    );
    expect(STILL_SHOWN_SQL).toContain(
      `FROM "ScheduledMaintenancePublicNote" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "ScheduledMaintenance" AS "parentRecord" WHERE "parentRecord"."_id" = "ScheduledMaintenancePublicNote"."scheduledMaintenanceId" AND "parentRecord"."projectId" = "ScheduledMaintenancePublicNote"."projectId" AND "parentRecord"."deletedAt" IS NULL AND "parentRecord"."isVisibleOnStatusPage" = true)`,
    );
  });

  test("every one-off statement reads notes the same way", () => {
    for (const sql of [
      PUBLISH_SHOWN_IMAGES_SQL,
      HIDE_UNSHOWN_FILES_SQL,
      HIDE_PRIVATE_RECORD_IMAGES_SQL,
      HIDE_HIDDEN_RECORD_IMAGES_SQL,
    ]) {
      expect(sql).toContain(
        `FROM "IncidentEpisodePublicNote" WHERE "deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "IncidentEpisode" AS "parentRecord" WHERE "parentRecord"."_id" = "IncidentEpisodePublicNote"."incidentEpisodeId"`,
      );
    }
  });

  /*
   * Once, for images a public note made public whatever its record showed,
   * or that a private record kept public through its own notes.
   */
  test("HIDE_HIDDEN_RECORD_IMAGES_SQL makes private the images of private records and of notes of records not shown - and nothing else", () => {
    expect(HIDE_HIDDEN_RECORD_IMAGES_SQL).toContain(
      `UPDATE "File" AS "file" SET "isPublic" = false WHERE "file"."isPublic" = true`,
    );
    expect(HIDE_HIDDEN_RECORD_IMAGES_SQL).not.toContain(
      `SET "isPublic" = true`,
    );

    // A private record's own images, as HIDE_PRIVATE_RECORD_IMAGES_SQL reads them.
    expect(HIDE_HIDDEN_RECORD_IMAGES_SQL).toContain(
      `FROM "Incident" WHERE "deletedAt" IS NULL AND ("isPrivate" IS TRUE) AND concat_ws(' ', "description"::text) LIKE '%/file/image/access-token/%'`,
    );

    // A note of a record not shown: hidden, private, or of another project.
    for (const [table, parent, foreignKey] of [
      ["IncidentPublicNote", "Incident", "incidentId"],
      ["IncidentEpisodePublicNote", "IncidentEpisode", "incidentEpisodeId"],
      [
        "ScheduledMaintenancePublicNote",
        "ScheduledMaintenance",
        "scheduledMaintenanceId",
      ],
    ] as Array<[string, string, string]>) {
      expect(HIDE_HIDDEN_RECORD_IMAGES_SQL).toContain(
        `FROM "${table}" WHERE "deletedAt" IS NULL AND (NOT EXISTS (SELECT 1 FROM "${parent}" AS "parentRecord" WHERE "parentRecord"."_id" = "${table}"."${foreignKey}"`,
      );
    }

    // Kept: what a published record still shows, by token or by id, and icons.
    expect(HIDE_HIDDEN_RECORD_IMAGES_SQL).toContain(
      `NOT EXISTS (SELECT 1 FROM "shownToken" WHERE "shownToken"."token" = "file"."imageAccessToken")`,
    );
    expect(HIDE_HIDDEN_RECORD_IMAGES_SQL).toContain(
      `NOT EXISTS (SELECT 1 FROM "shownId" WHERE "shownId"."fileId" = "file"."_id"::text)`,
    );
    expect(HIDE_HIDDEN_RECORD_IMAGES_SQL).toContain(
      `NOT EXISTS (SELECT 1 FROM "Probe" WHERE "Probe"."iconFileId" = "file"."_id")`,
    );
    // Only images of the hidden row's own project, or of none.
    expect(HIDE_HIDDEN_RECORD_IMAGES_SQL).toContain(
      `("file"."projectId" IS NULL OR "hiddenToken"."projectId" = "file"."projectId")`,
    );
  });

  test("HIDE_PRIVATE_RECORD_IMAGES_SQL reads no note as hidden, but no longer keeps an image a private record's own note holds", () => {
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).not.toMatch(
      /FROM "IncidentPublicNote" WHERE "deletedAt" IS NULL AND \(/,
    );
    // Its notes count as showing an image only while it is shown.
    expect(HIDE_PRIVATE_RECORD_IMAGES_SQL).toContain(
      `FROM "IncidentPublicNote" WHERE "deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "Incident" AS "parentRecord"`,
    );
  });
});

/*
 * AN ANNOUNCEMENT SHOWS ITS IMAGES FROM THE TIME IT IS SHOWN ON.
 *
 * A status page shows an announcement once its Start Showing Announcement
 * At has come - on its overview while it is active, in its list (under the
 * past announcements once it has ended), and by its link - and holds back
 * one scheduled for later. Its images follow: private until it is shown,
 * public from then on, ended or not. With no write at the moment it starts,
 * the first request for one of its images makes that image public
 * (publishWhenShown).
 */
describe("PublishedImages: an announcement shows its images from the time it is shown from", () => {
  const ANNOUNCEMENT_ID: string = "55555555-5555-4555-8555-555555555555";
  const FILE_ID: string = "66666666-6666-4666-8666-666666666666";
  const TOKEN: string = "ab".repeat(32);
  const NOW: Date = new Date("2026-10-07T12:00:00.000Z");
  const EARLIER: Date = new Date("2026-10-07T11:00:00.000Z");
  const LATER: Date = new Date("2026-10-07T13:00:00.000Z");

  const announcementSource: () => PublishedMarkdown = (): PublishedMarkdown => {
    return PUBLISHED_MARKDOWN.find((source: PublishedMarkdown): boolean => {
      return source.tableName === "StatusPageAnnouncement";
    })!;
  };

  beforeEach(() => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  });

  describe("GUARD: the records shown from a time", () => {
    test("are announcements alone, by Start Showing Announcement At", () => {
      expect(
        SOURCES_SHOWN_FROM_A_TIME.map((source: PublishedMarkdown): string => {
          return `${source.tableName}.${source.markdownColumns.join("+")} from ${source.shownFrom}`;
        }),
      ).toEqual(["StatusPageAnnouncement.description from showAnnouncementAt"]);
      expect(
        KEPT_MARKDOWN.some((source: PublishedMarkdown): boolean => {
          return Boolean(source.shownFrom);
        }),
      ).toBe(false);
    });

    test("an announcement is stored with the time it is shown from, always", () => {
      const declared: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
        .columns.filter((args: ColumnMetadataArgs): boolean => {
          return (
            args.target === modelTypeOf("StatusPageAnnouncement") &&
            args.propertyName === "showAnnouncementAt"
          );
        })
        .pop();

      // NOT NULL: no announcement is shown from no time.
      expect(declared?.options.nullable).toBe(false);
    });
  });

  describe("hasTimeCome", () => {
    test("once the time has come: at it, and after", () => {
      for (const shownFrom of [EARLIER, NOW]) {
        expect(
          PublishedImages.hasTimeCome(
            announcementSource(),
            { showAnnouncementAt: shownFrom },
            NOW,
          ),
        ).toBe(true);
      }
    });

    test("not before it", () => {
      expect(
        PublishedImages.hasTimeCome(
          announcementSource(),
          { showAnnouncementAt: LATER },
          NOW,
        ),
      ).toBe(false);
      expect(
        PublishedImages.hasTimeCome(
          announcementSource(),
          { showAnnouncementAt: new Date(NOW.getTime() + 1) },
          NOW,
        ),
      ).toBe(false);
    });

    test("reads the time as a write hands it back: a date, its text, or its milliseconds", () => {
      for (const shownFrom of [
        EARLIER.toISOString(),
        "2026-10-07 11:00:00.000+00",
        EARLIER.getTime(),
      ]) {
        expect(
          PublishedImages.hasTimeCome(
            announcementSource(),
            { showAnnouncementAt: shownFrom },
            NOW,
          ),
        ).toBe(true);
      }

      expect(
        PublishedImages.hasTimeCome(
          announcementSource(),
          { showAnnouncementAt: "2026-10-07 13:00:00.000+00" },
          NOW,
        ),
      ).toBe(false);
    });

    test("a time not set, or not a time, has not come: nothing is made public on a guess", () => {
      for (const shownFrom of [
        undefined,
        null,
        "",
        "soon",
        true,
        {},
        Number.NaN,
      ]) {
        expect({
          shownFrom,
          hasCome: PublishedImages.hasTimeCome(
            announcementSource(),
            { showAnnouncementAt: shownFrom },
            NOW,
          ),
        }).toEqual({ shownFrom, hasCome: false });
      }
    });

    test("is now when no time is given", () => {
      expect(
        PublishedImages.hasTimeCome(announcementSource(), {
          showAnnouncementAt: EARLIER,
        }),
      ).toBe(true);
      expect(
        PublishedImages.hasTimeCome(announcementSource(), {
          showAnnouncementAt: LATER,
        }),
      ).toBe(false);
    });

    test("a record shown whatever the time is shown", () => {
      const statusPage: PublishedMarkdown = PUBLISHED_MARKDOWN.find(
        (source: PublishedMarkdown): boolean => {
          return source.tableName === "StatusPage";
        },
      )!;

      expect(PublishedImages.hasTimeCome(statusPage, {}, NOW)).toBe(true);
    });
  });

  describe("getShownTokens", () => {
    test("an announcement that has ended still shows them: its status pages still list it", () => {
      expect(
        Array.from(
          PublishedImages.getShownTokens("StatusPageAnnouncement", {
            description: image("aaa111"),
            showAnnouncementAt: new Date("2026-10-01T00:00:00.000Z"),
            endAnnouncementAt: new Date("2026-10-02T00:00:00.000Z"),
          }),
        ),
      ).toEqual(["aaa111"]);
    });

    test("one scheduled for later shows none, whatever else it holds", () => {
      expect(
        PublishedImages.getShownTokens("StatusPageAnnouncement", {
          description: `${image("aaa111")} ${image("bbb222")}`,
          showAnnouncementAt: LATER,
        }).size,
      ).toBe(0);
    });

    test("getHeldTokens still reads what one scheduled for later holds, to keep it private", () => {
      expect(
        Array.from(
          PublishedImages.getHeldTokens("StatusPageAnnouncement", {
            description: image("aaa111"),
            showAnnouncementAt: LATER,
          }),
        ),
      ).toEqual(["aaa111"]);
    });
  });

  describe("afterCreate", () => {
    beforeEach(recordVisibility);

    test("an announcement scheduled for later leaves its images private", async () => {
      await PublishedImages.afterCreate({
        tableName: "StatusPageAnnouncement",
        row: {
          projectId: PROJECT_ID,
          description: image("aaa111"),
          showAnnouncementAt: LATER,
        },
        readStored: async () => {
          return null;
        },
      });

      expect(visibilityAsked()).toEqual([]);
    });

    test("one shown at once makes its images public", async () => {
      for (const showAnnouncementAt of [EARLIER, NOW]) {
        setImagesVisibility.mockClear();

        await PublishedImages.afterCreate({
          tableName: "StatusPageAnnouncement",
          row: {
            projectId: PROJECT_ID,
            description: image("aaa111"),
            showAnnouncementAt,
          },
          readStored: async () => {
            return null;
          },
        });

        expect(visibilityAsked()).toEqual(["aaa111:public"]);
      }
    });

    test("a time left to the column is read as stored, and decides", async () => {
      for (const [stored, asked] of [
        [EARLIER, ["aaa111:public"]],
        [LATER, []],
      ] as Array<[Date, Array<string>]>) {
        setImagesVisibility.mockClear();

        const readStored: Mock<
          (columns: Array<string>) => Promise<Record<string, unknown> | null>
        > = jest.fn(async (): Promise<Record<string, unknown> | null> => {
          return { showAnnouncementAt: stored };
        });

        await PublishedImages.afterCreate({
          tableName: "StatusPageAnnouncement",
          row: { projectId: PROJECT_ID, description: image("aaa111") },
          readStored: readStored,
        });

        expect(readStored.mock.calls[0]![0]).toEqual(["showAnnouncementAt"]);
        expect(visibilityAsked()).toEqual(asked);
      }
    });

    test("a time that cannot be read makes nothing public", async () => {
      await PublishedImages.afterCreate({
        tableName: "StatusPageAnnouncement",
        row: { projectId: PROJECT_ID, description: image("aaa111") },
        readStored: async () => {
          return null;
        },
      });

      expect(visibilityAsked()).toEqual([]);
    });
  });

  describe("afterUpdate", () => {
    beforeEach(recordVisibility);

    const SHOWN: Record<string, unknown> = {
      _id: ANNOUNCEMENT_ID,
      projectId: PROJECT_ID,
      description: image("aaa111"),
      showAnnouncementAt: EARLIER,
    };

    test("moving a shown announcement to a later time makes its images private again", async () => {
      await PublishedImages.afterUpdate({
        tableName: "StatusPageAnnouncement",
        rowsBefore: [SHOWN],
        written: { showAnnouncementAt: LATER },
        rowsAfter: [{ showAnnouncementAt: LATER }],
      });

      expect(visibilityAsked()).toEqual(["aaa111:private"]);
    });

    test("moving one scheduled for later to now makes them public", async () => {
      await PublishedImages.afterUpdate({
        tableName: "StatusPageAnnouncement",
        rowsBefore: [{ ...SHOWN, showAnnouncementAt: LATER }],
        written: { showAnnouncementAt: EARLIER },
        rowsAfter: [{ showAnnouncementAt: EARLIER }],
      });

      expect(visibilityAsked()).toEqual(["aaa111:public"]);
    });

    test("an image added to one scheduled for later stays private", async () => {
      await PublishedImages.afterUpdate({
        tableName: "StatusPageAnnouncement",
        rowsBefore: [{ ...SHOWN, showAnnouncementAt: LATER }],
        written: { description: `${image("aaa111")} ${image("bbb222")}` },
      });

      expect(visibilityAsked()).toEqual(["aaa111:private", "bbb222:private"]);
    });

    test("what the write stored decides, not what the update asked for", async () => {
      await PublishedImages.afterUpdate({
        tableName: "StatusPageAnnouncement",
        rowsBefore: [SHOWN],
        written: { showAnnouncementAt: EARLIER },
        rowsAfter: [{ showAnnouncementAt: LATER }],
      });

      expect(visibilityAsked()).toEqual(["aaa111:private"]);
    });

    test("ending it, or renaming it, changes nothing it shows", async () => {
      await PublishedImages.afterUpdate({
        tableName: "StatusPageAnnouncement",
        rowsBefore: [SHOWN],
        written: { endAnnouncementAt: EARLIER, title: "Renamed" },
      });

      expect(setImagesVisibility).not.toHaveBeenCalled();
    });
  });

  describe("publishWhenShown: the image route's question for an image it would refuse", () => {
    type Query = Mock<
      (sql: string, parameters: Array<unknown>) => Promise<unknown>
    >;

    function stubQuery(answer: () => Promise<unknown>): Query {
      const query: Query = jest.fn(answer);

      jest.spyOn(FileService, "getRepository").mockReturnValue({
        manager: { query },
      } as never);

      return query;
    }

    const PRIVATE_IMAGE: {
      _id: string;
      projectId: ObjectID;
      imageAccessToken: string;
      isPublic: boolean;
    } = {
      _id: FILE_ID,
      projectId: PROJECT_ID,
      imageAccessToken: TOKEN,
      isPublic: false,
    };

    test("asks one statement, with the file, its project, its token, the time and its address", async () => {
      const query: Query = stubQuery(async () => {
        return [[{ _id: FILE_ID }], 1];
      });

      expect(await PublishedImages.publishWhenShown(PRIVATE_IMAGE)).toBe(true);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0]![0]).toBe(PUBLISH_WHEN_SHOWN_SQL);
      expect(query.mock.calls[0]![1]).toEqual([
        FILE_ID,
        PROJECT_ID.toString(),
        TOKEN,
        NOW,
        `%/file/image/access-token/${TOKEN}%`,
      ]);
    });

    test("as of the time it is given", async () => {
      const query: Query = stubQuery(async () => {
        return [[], 0];
      });

      await PublishedImages.publishWhenShown(PRIVATE_IMAGE, LATER);

      expect(query.mock.calls[0]![1]![3]).toBe(LATER);
    });

    test("nothing shows it now: it stays private", async () => {
      stubQuery(async () => {
        return [[], 0];
      });

      expect(await PublishedImages.publishWhenShown(PRIVATE_IMAGE)).toBe(false);
    });

    test("reads the rows the statement hands back, however the driver shapes them", async () => {
      for (const [answer, made] of [
        [[{ _id: FILE_ID }], true],
        [[], false],
        [[[{ _id: FILE_ID }]], true],
        [[[]], false],
        [undefined, false],
        [{ affected: 1 }, false],
      ] as Array<[unknown, boolean]>) {
        stubQuery(async () => {
          return answer;
        });

        expect({
          answer,
          made: await PublishedImages.publishWhenShown(PRIVATE_IMAGE),
        }).toEqual({ answer, made });
      }
    });

    test("asks nothing for a public image, no file, a file of no project, an id or a project that is not one, or a token that is not one", async () => {
      const query: Query = stubQuery(async () => {
        return [[{ _id: FILE_ID }], 1];
      });

      for (const file of [
        { ...PRIVATE_IMAGE, isPublic: true },
        null,
        undefined,
        { ...PRIVATE_IMAGE, projectId: null },
        { ...PRIVATE_IMAGE, projectId: "not-a-project" },
        { ...PRIVATE_IMAGE, _id: "not-an-id" },
        { ...PRIVATE_IMAGE, imageAccessToken: undefined },
        { ...PRIVATE_IMAGE, imageAccessToken: "" },
        { ...PRIVATE_IMAGE, imageAccessToken: "ab%cd" },
        { ...PRIVATE_IMAGE, imageAccessToken: "ab_cd" },
      ]) {
        expect(await PublishedImages.publishWhenShown(file as never)).toBe(
          false,
        );
      }

      expect(query).not.toHaveBeenCalled();
    });

    test("a statement that fails makes nothing public, and never throws", async () => {
      stubQuery(async () => {
        throw new Error("db down");
      });

      await expect(
        PublishedImages.publishWhenShown(PRIVATE_IMAGE),
      ).resolves.toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("the SQL", () => {
    test("STILL_SHOWN_SQL counts an announcement only once its time has come, by the time it is asked with", () => {
      expect(STILL_SHOWN_SQL).toContain(
        `FROM "StatusPageAnnouncement" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "showAnnouncementAt" <= $4::timestamptz AND concat_ws(' ', "description"::text) LIKE ANY($2)`,
      );
      // No other record is decided by a time.
      expect(STILL_SHOWN_SQL.match(/\$4::timestamptz/g)).toHaveLength(1);
    });

    test("PUBLISH_WHEN_SHOWN_SQL makes public only that file, of that project, while an announcement of its project shows it", () => {
      expect(PUBLISH_WHEN_SHOWN_SQL).toBe(
        `UPDATE "File" SET "isPublic" = true WHERE "_id" = $1 AND "projectId" = $2 AND "imageAccessToken" = $3 AND "deletedAt" IS NULL AND EXISTS (SELECT 1 FROM (SELECT (regexp_matches(concat_ws(' ', "description"::text), '/file/image/access-token/([a-fA-F0-9]+)', 'g'))[1] AS "token" FROM "StatusPageAnnouncement" WHERE "projectId" = $2 AND "deletedAt" IS NULL AND "showAnnouncementAt" <= $4::timestamptz AND concat_ws(' ', "description"::text) LIKE $5) AS "shown" WHERE "shown"."token" = $3) RETURNING "_id"`,
      );
    });

    test("the one-off statements count an announcement only once its time has come", () => {
      for (const sql of [
        PUBLISH_SHOWN_IMAGES_SQL,
        HIDE_UNSHOWN_FILES_SQL,
        HIDE_PRIVATE_RECORD_IMAGES_SQL,
        HIDE_HIDDEN_RECORD_IMAGES_SQL,
      ]) {
        expect(sql).toContain(
          `FROM "StatusPageAnnouncement" WHERE "deletedAt" IS NULL AND "showAnnouncementAt" <= now() AND concat_ws(' ', "description"::text) LIKE '%/file/image/access-token/%'`,
        );
      }
    });

    test("HIDE_NOT_YET_SHOWN_IMAGES_SQL makes private only token images of the announcement's own project, never public", () => {
      expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).toMatch(
        /^WITH "notYetShown" AS \(.*\) UPDATE "File" AS "file" SET "isPublic" = false WHERE "file"\."isPublic" = true AND /,
      );
      expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).not.toContain(
        `SET "isPublic" = true`,
      );
      // The announcements whose time has not come, by the database's clock.
      expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).toContain(
        `FROM "StatusPageAnnouncement" WHERE "deletedAt" IS NULL AND "showAnnouncementAt" > now() AND concat_ws(' ', "description"::text) LIKE '%/file/image/access-token/%'`,
      );
      // Their own project's files only, by token: never one of no project.
      expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).toContain(
        `EXISTS (SELECT 1 FROM "notYetShown" WHERE "notYetShown"."token" = "file"."imageAccessToken" AND "notYetShown"."projectId" = "file"."projectId")`,
      );
      expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).not.toContain(
        `"file"."projectId" IS NULL`,
      );
      // Kept: what a published record shows now, by token or by id, and icons.
      expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).toContain(
        `NOT EXISTS (SELECT 1 FROM "shownToken" WHERE "shownToken"."token" = "file"."imageAccessToken")`,
      );
      expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).toContain(
        `NOT EXISTS (SELECT 1 FROM "shownId" WHERE "shownId"."fileId" = "file"."_id"::text)`,
      );
      expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).toContain(
        `NOT EXISTS (SELECT 1 FROM "Probe" WHERE "Probe"."iconFileId" = "file"."_id")`,
      );
      expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).toContain(
        `NOT EXISTS (SELECT 1 FROM "AIAgent" WHERE "AIAgent"."iconFileId" = "file"."_id")`,
      );
      for (const source of [...PUBLISHED_MARKDOWN, ...KEPT_MARKDOWN]) {
        expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).toContain(
          `FROM "${source.tableName}"`,
        );
      }
    });
  });
});
