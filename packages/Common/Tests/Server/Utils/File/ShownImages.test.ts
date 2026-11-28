import ShownImages, {
  MAX_RECORDS_SHOWING_AN_IMAGE,
  QueryFunction,
  RECORD_SHOWN_IMAGES_SQL,
  RECORDS_SHOWING_IMAGE_SQL,
  RecordShowingImage,
} from "../../../../Server/Utils/File/ShownImages";
import logger from "../../../../Server/Utils/Logger";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import ShownImage from "../../../../Models/DatabaseModels/ShownImage";
import User from "../../../../Models/DatabaseModels/User";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHICH RECORDS SHOW EACH INLINE IMAGE, as writes record it (#11478).
 * The statements run against Postgres in FileImageRecordAccessPostgres;
 * here, with the database a fake, what each write sends, and when it sends
 * nothing.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const RECORD_ID: string = "a0000000-0000-4000-8000-000000000001";
const OTHER_RECORD_ID: string = "a0000000-0000-4000-8000-000000000002";
const TOKEN: string = "ab".repeat(32);
const OTHER_TOKEN: string = "cd".repeat(32);

const address: (token: string) => string = (token: string): string => {
  return `![shot.png](https://oneuptime.example.com/file/image/access-token/${token})`;
};

interface Sent {
  sql: string;
  parameters: Array<unknown>;
}

let sent: Array<Sent> = [];
let answer: unknown = [];
let failWith: Error | null = null;

beforeEach(() => {
  sent = [];
  answer = [];
  failWith = null;

  jest.spyOn(ShownImages, "getQuery").mockReturnValue((async (
    sql: string,
    parameters: Array<unknown>,
  ): Promise<unknown> => {
    sent.push({ sql, parameters });

    if (failWith) {
      throw failWith;
    }

    return answer;
  }) as QueryFunction);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ShownImages.getWrittenColumns: the columns of a write that can name an image", () => {
  test("those of the record's image columns the write set", () => {
    expect(
      ShownImages.getWrittenColumns(new Incident(), {
        title: "Down",
        description: "text",
        customFields: {},
      }),
    ).toEqual(["description", "customFields"]);
  });

  test("a column set to nothing names nothing", () => {
    expect(
      ShownImages.getWrittenColumns(new Incident(), {
        description: null,
        rootCause: undefined,
      }),
    ).toEqual([]);
  });

  test("a monitor's criteria, and a playbook's steps", () => {
    expect(
      ShownImages.getWrittenColumns(new Monitor(), {
        monitorSteps: {},
        name: "Checkout",
      }),
    ).toEqual(["monitorSteps"]);
    expect(
      ShownImages.getWrittenColumns(new SecurityPlaybook(), { steps: [] }),
    ).toEqual(["steps"]);
  });

  test("none for a record that shows no images, or of no project", () => {
    expect(
      ShownImages.getWrittenColumns(new User(), { name: "x", email: "y" }),
    ).toEqual([]);
    expect(
      ShownImages.getWrittenColumns(new ShownImage(), { recordId: "x" }),
    ).toEqual([]);
  });
});

describe("ShownImages.readTokens", () => {
  test("each token once, from Markdown and from JSON alike, in the order written", () => {
    expect(
      ShownImages.readTokens(
        {
          description: `${address(TOKEN)} and again ${address(TOKEN)}`,
          customFields: { Impact: address(OTHER_TOKEN), Score: 3 },
        },
        ["description", "customFields"],
      ),
    ).toEqual([TOKEN, OTHER_TOKEN]);
  });

  test("only the columns asked", () => {
    expect(
      ShownImages.readTokens(
        { description: address(TOKEN), rootCause: address(OTHER_TOKEN) },
        ["rootCause"],
      ),
    ).toEqual([OTHER_TOKEN]);
  });

  test("an address that is a path alone counts too; text with no address names none", () => {
    expect(
      ShownImages.readTokens(
        { note: `![a](/file/image/access-token/${TOKEN})`, other: "plain" },
        ["note", "other"],
      ),
    ).toEqual([TOKEN]);
  });
});

describe("ShownImages.readProjectId and readRecordId", () => {
  test("a record's project by its tenant column, in lower case", () => {
    expect(
      ShownImages.readProjectId(new Incident(), {
        projectId: new ObjectID(PROJECT_ID.toUpperCase()),
      }),
    ).toBe(PROJECT_ID);
    // A project is its own: its id.
    expect(ShownImages.readProjectId(new Project(), { _id: PROJECT_ID })).toBe(
      PROJECT_ID,
    );
  });

  test("nothing for a value that is not an id", () => {
    expect(
      ShownImages.readProjectId(new Incident(), { projectId: "nope" }),
    ).toBe("");
    expect(ShownImages.readProjectId(new Incident(), {})).toBe("");
    expect(ShownImages.readRecordId({ _id: "nope" })).toBe("");
  });

  test("a record's id by _id or id", () => {
    expect(ShownImages.readRecordId({ _id: RECORD_ID })).toBe(RECORD_ID);
    expect(ShownImages.readRecordId({ id: new ObjectID(RECORD_ID) })).toBe(
      RECORD_ID,
    );
  });
});

describe("ShownImages.afterCreate", () => {
  test("records each image a created record names, in one statement", async () => {
    await ShownImages.afterCreate({
      model: new IncidentInternalNote(),
      row: {
        _id: RECORD_ID,
        projectId: new ObjectID(PROJECT_ID),
        note: `${address(TOKEN)} ${address(OTHER_TOKEN)}`,
      },
    });

    expect(sent).toEqual([
      {
        sql: RECORD_SHOWN_IMAGES_SQL,
        parameters: [
          "IncidentInternalNote",
          [RECORD_ID],
          [PROJECT_ID],
          [TOKEN, OTHER_TOKEN],
        ],
      },
    ]);
  });

  test("sends nothing for a record that names no image, which is most of them", async () => {
    await ShownImages.afterCreate({
      model: new Incident(),
      row: {
        _id: RECORD_ID,
        projectId: PROJECT_ID,
        description: "The checkout is down.",
      },
    });

    expect(sent).toEqual([]);
  });

  test("sends nothing for a record that cannot show images, whatever it holds", async () => {
    await ShownImages.afterCreate({
      model: new User(),
      row: { _id: RECORD_ID, name: address(TOKEN) },
    });

    expect(sent).toEqual([]);
  });

  test("sends nothing for a record of no project, or with no id", async () => {
    await ShownImages.afterCreate({
      model: new Incident(),
      row: { _id: RECORD_ID, description: address(TOKEN) },
    });
    await ShownImages.afterCreate({
      model: new Incident(),
      row: { projectId: PROJECT_ID, description: address(TOKEN) },
    });

    expect(sent).toEqual([]);
  });

  test("never fails the write: a statement that fails is logged", async () => {
    failWith = new Error("the database is unreachable");

    await expect(
      ShownImages.afterCreate({
        model: new Incident(),
        row: {
          _id: RECORD_ID,
          projectId: PROJECT_ID,
          description: address(TOKEN),
        },
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("ShownImages.afterUpdate", () => {
  test("records the images the update wrote against every record it changed, each once", async () => {
    await ShownImages.afterUpdate({
      model: new Incident(),
      written: { description: address(TOKEN), title: "Still down" },
      rows: [
        { _id: RECORD_ID, projectId: PROJECT_ID },
        { _id: OTHER_RECORD_ID, projectId: OTHER_PROJECT_ID },
        { _id: RECORD_ID, projectId: PROJECT_ID },
      ],
    });

    expect(sent).toEqual([
      {
        sql: RECORD_SHOWN_IMAGES_SQL,
        parameters: [
          "Incident",
          [RECORD_ID, OTHER_RECORD_ID],
          [PROJECT_ID, OTHER_PROJECT_ID],
          [TOKEN],
        ],
      },
    ]);
  });

  test("an update that writes no image column sends nothing, whatever the records hold", async () => {
    await ShownImages.afterUpdate({
      model: new Incident(),
      written: { currentIncidentStateId: RECORD_ID },
      rows: [
        { _id: RECORD_ID, projectId: PROJECT_ID, description: address(TOKEN) },
      ],
    });

    expect(sent).toEqual([]);
  });

  test("an update of a monitor's criteria records the images in them", async () => {
    await ShownImages.afterUpdate({
      model: new Monitor(),
      written: {
        monitorSteps: {
          value: { incidents: [{ description: address(TOKEN) }] },
        },
      },
      rows: [{ _id: RECORD_ID, projectId: PROJECT_ID }],
    });

    expect(sent[0]!.parameters).toEqual([
      "Monitor",
      [RECORD_ID],
      [PROJECT_ID],
      [TOKEN],
    ]);
  });

  test("an update that changed no record sends nothing", async () => {
    await ShownImages.afterUpdate({
      model: new Incident(),
      written: { description: address(TOKEN) },
      rows: [],
    });

    expect(sent).toEqual([]);
  });

  test("never fails the write", async () => {
    failWith = new Error("the database is unreachable");

    await expect(
      ShownImages.afterUpdate({
        model: new Incident(),
        written: { description: address(TOKEN) },
        rows: [{ _id: RECORD_ID, projectId: PROJECT_ID }],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("ShownImages.record", () => {
  test("sends nothing without a table, records, tokens, or with projects out of step", async () => {
    for (const data of [
      {
        tableName: "",
        recordIds: [RECORD_ID],
        projectIds: [PROJECT_ID],
        tokens: [TOKEN],
      },
      {
        tableName: "Incident",
        recordIds: [],
        projectIds: [],
        tokens: [TOKEN],
      },
      {
        tableName: "Incident",
        recordIds: [RECORD_ID],
        projectIds: [PROJECT_ID],
        tokens: [],
      },
      {
        tableName: "Incident",
        recordIds: [RECORD_ID, OTHER_RECORD_ID],
        projectIds: [PROJECT_ID],
        tokens: [TOKEN],
      },
    ]) {
      await ShownImages.record(data);
    }

    expect(sent).toEqual([]);
  });

  test("the statement matches each token to a file of the record's own project, not deleted, and keeps a row there already", () => {
    expect(RECORD_SHOWN_IMAGES_SQL).toContain(
      'FROM unnest($2::uuid[], $3::uuid[]) AS "record"("recordId", "projectId")',
    );
    expect(RECORD_SHOWN_IMAGES_SQL).toContain(
      '"file"."projectId" = "record"."projectId" AND "file"."imageAccessToken" = ANY($4::text[]) AND "file"."deletedAt" IS NULL',
    );
    expect(RECORD_SHOWN_IMAGES_SQL).toContain(
      'ON CONFLICT ("fileId", "recordTableName", "recordId") DO NOTHING',
    );
  });
});

describe("ShownImages.findRecords", () => {
  test("asks for the image's records of its own project, the newest first, at most so many", async () => {
    answer = [
      { recordTableName: "Incident", recordId: RECORD_ID },
      { recordTableName: "IncidentInternalNote", recordId: OTHER_RECORD_ID },
    ];

    const records: Array<RecordShowingImage> = await ShownImages.findRecords({
      fileId: new ObjectID(RECORD_ID.toUpperCase()),
      projectId: PROJECT_ID,
    });

    expect(sent).toEqual([
      {
        sql: RECORDS_SHOWING_IMAGE_SQL,
        parameters: [RECORD_ID, PROJECT_ID, MAX_RECORDS_SHOWING_AN_IMAGE],
      },
    ]);
    expect(RECORDS_SHOWING_IMAGE_SQL).toContain('ORDER BY "createdAt" DESC');
    expect(records).toEqual([
      { tableName: "Incident", recordId: RECORD_ID },
      { tableName: "IncidentInternalNote", recordId: OTHER_RECORD_ID },
    ]);
  });

  test("reads TypeORM's [rows, count] as pg's rows, and leaves out what is not a record", async () => {
    answer = [
      [
        { recordTableName: "Incident", recordId: RECORD_ID },
        { recordTableName: "", recordId: RECORD_ID },
        { recordTableName: "Incident", recordId: "not-an-id" },
        "nonsense",
      ],
      4,
    ];

    expect(
      await ShownImages.findRecords({
        fileId: RECORD_ID,
        projectId: PROJECT_ID,
      }),
    ).toEqual([{ tableName: "Incident", recordId: RECORD_ID }]);
  });

  test("asks nothing for an id that is not one", async () => {
    expect(
      await ShownImages.findRecords({ fileId: "nope", projectId: PROJECT_ID }),
    ).toEqual([]);
    expect(
      await ShownImages.findRecords({ fileId: RECORD_ID, projectId: "nope" }),
    ).toEqual([]);
    expect(sent).toEqual([]);
  });
});
