jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// The audit trail of a write is kept elsewhere.
jest.mock("../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: jest.fn(),
      recordUpdate: jest.fn(),
      recordDelete: jest.fn(),
    },
  };
});

import IncidentAPI from "../../../Server/API/IncidentAPI";
import IncidentInternalNoteAPI from "../../../Server/API/IncidentInternalNoteAPI";
import IncidentPublicNoteAPI from "../../../Server/API/IncidentPublicNoteAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import HashedApiKey from "../../../Server/Utils/APIKey/HashedApiKey";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import MarkdownFiles from "../../../Server/Utils/File/MarkdownFiles";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Entities from "../../../Models/DatabaseModels/Index";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import {
  MARKDOWN_FILE_MAX_SIZE_IN_BYTES,
  MARKDOWN_FILES_MAX_COUNT,
  MARKDOWN_FILES_MAX_REFERENCES,
  MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES,
  MarkdownFile,
  MarkdownFileLeftOut,
  MarkdownFileLeftOutReason,
} from "../../../Types/File/MarkdownFiles";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";
import { DataSource } from "typeorm";

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * THE IMAGES A RECORD'S MARKDOWN SHOWS, OVER HTTP, AGAINST A MIGRATED
 * POSTGRES (#11256).
 *
 *   GET or POST /api/<record>/:id/markdown-files
 *
 * Through a real Express app: the production routers of incidents and their
 * notes, the real API key and session middleware, the real permission checks
 * of every read, and the production error handler. Only the caches, the
 * audit log and live updates are stubbed.
 *
 * What it pins:
 *
 *   - an API key that may read the record gets exactly the pictures its
 *     Markdown and its Markdown custom fields show: name, type, size, bytes,
 *     content ID, addresses and fields, in the order the record shows them;
 *   - nothing else, ever: not a file of the project the record does not
 *     show, not one a Text custom field names, not another project's file
 *     whose address was copied in, not a deleted one, not an SVG or a page
 *     stored as a picture;
 *   - no reading through a record the caller may not read: a key with no
 *     read of the table (refused, 422), a key of another project, a key limited to
 *     labels the record does not carry, a private incident for a key that
 *     is no admin (404, as a record that is not there), and anonymous (401);
 *   - a file two records show is handed out through either, to whoever may
 *     read that record, and not through the one they may not;
 *   - the limits: one file, the total, the count and the addresses looked up;
 *   - a signed-in member is held to their team's permissions the same way.
 *
 * Opt in with RUN_POSTGRES_MARKDOWN_FILES_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_MARKDOWN_FILES_TESTS=true \
 *   MARKDOWN_FILES_TEST_DATABASE_HOST=127.0.0.1 \
 *   MARKDOWN_FILES_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/MarkdownFilesPostgres.test.ts
 *
 * The tables it writes are cloned, structure only (LIKE ... INCLUDING ALL),
 * into a uniquely named schema that search_path puts first; every other
 * table a read joins is found, empty, in public. No row is written outside
 * it, and it is dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MARKDOWN_FILES_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "User",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "ApiKey",
  "ApiKeyPermission",
  "ApiKeyPermissionLabel",
  "ApiKeyCustomRole",
  "File",
  "Incident",
  "IncidentLabel",
  "IncidentCustomField",
  "IncidentPublicNote",
  "IncidentInternalNote",
];

const HOST: string = "https://oneuptime.example.com";

interface PermissionRow {
  permission: Permission;
  labelIds?: Array<ObjectID>;
}

interface StoredImage {
  id: ObjectID;
  token: string;
  url: string;
  name: string;
  fileType: string;
  bytes: Buffer;
}

interface HttpAnswer {
  status: number;
  json: JSONObject;
  headers: http.IncomingHttpHeaders;
}

// A picture's first bytes, then filler: what the content check reads.
const PNG_SIGNATURE: Array<number> = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];

const png: (size?: number, fill?: number) => Buffer = (
  size: number = 64,
  fill: number = 7,
): Buffer => {
  const bytes: Buffer = Buffer.alloc(
    Math.max(size, PNG_SIGNATURE.length),
    fill,
  );
  Buffer.from(PNG_SIGNATURE).copy(bytes, 0);
  return bytes;
};

const jpeg: () => Buffer = (): Buffer => {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from("..JFIF a photo of the rack"),
  ]);
};

const gif: () => Buffer = (): Buffer => {
  return Buffer.concat([
    Buffer.from("GIF89a"),
    Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]),
  ]);
};

const SVG_BYTES: Buffer = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
);

const PAGE_BYTES: Buffer = Buffer.from(
  "<!doctype html><script>fetch('/api/user').then(r=>r.text())</script>",
);

const token: () => string = (): string => {
  return (
    ObjectID.generate().toString().replace(/-/g, "") +
    ObjectID.generate().toString().replace(/-/g, "")
  );
};

const imageMarkdown: (image: {
  name: string;
  url: string;
}) => string = (image: { name: string; url: string }): string => {
  return `![${image.name}](${image.url})`;
};

function send(data: {
  port: number;
  path: string;
  headers?: Dictionary<string>;
  method?: "GET" | "POST";
}): Promise<HttpAnswer> {
  return new Promise<HttpAnswer>(
    (resolve: (answer: HttpAnswer) => void, reject: (e: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: data.method || "GET",
          headers: {
            "content-type": "application/json",
            ...(data.headers || {}),
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            let json: JSONObject = {};

            try {
              json = text ? (JSON.parse(text) as JSONObject) : {};
            } catch {
              json = { text: text };
            }

            resolve({
              status: response.statusCode || 0,
              json: json,
              headers: response.headers,
            });
          });
        },
      );

      request.on("error", reject);

      if (data.method === "POST") {
        request.write("{}");
      }

      request.end();
    },
  );
}

const filesOf: (answer: HttpAnswer) => Array<MarkdownFile> = (
  answer: HttpAnswer,
): Array<MarkdownFile> => {
  return (answer.json["files"] || []) as unknown as Array<MarkdownFile>;
};

const leftOutOf: (answer: HttpAnswer) => Array<MarkdownFileLeftOut> = (
  answer: HttpAnswer,
): Array<MarkdownFileLeftOut> => {
  return (answer.json["leftOut"] ||
    []) as unknown as Array<MarkdownFileLeftOut>;
};

const namesOf: (
  files: Array<{ name: string | null }>,
) => Array<string | null> = (
  files: Array<{ name: string | null }>,
): Array<string | null> => {
  return files.map((file: { name: string | null }): string | null => {
    return file.name;
  });
};

describePostgres(
  "the images a record's Markdown shows, over HTTP, against a migrated Postgres",
  () => {
    const schema: string = `markdown_files_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    const shownLabelId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const memberTeamId: ObjectID = ObjectID.generate();

    let database: DataSource;
    let server: http.Server;
    let port: number;

    // The images, by what they are.
    const images: Dictionary<StoredImage> = {};

    // The records, by what they show.
    let incidentId: ObjectID;
    let labelledIncidentId: ObjectID;
    let privateIncidentId: ObjectID;
    let otherProjectIncidentId: ObjectID;
    let publicNoteId: ObjectID;
    let internalNoteId: ObjectID;
    let tooLargeIncidentId: ObjectID;
    let exactlyAsLargeIncidentId: ObjectID;
    let overTotalIncidentId: ObjectID;
    let tooManyIncidentId: ObjectID;
    let tooManyAddressesIncidentId: ObjectID;
    let noImagesIncidentId: ObjectID;

    // The API keys, by what they may do.
    const keys: Dictionary<string> = {};

    const insert: (
      table: string,
      row: Dictionary<unknown>,
    ) => Promise<void> = async (
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> => {
      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          const value: unknown = row[column];

          if (value instanceof ObjectID) {
            return value.toString();
          }

          if (
            value &&
            typeof value === "object" &&
            !Buffer.isBuffer(value) &&
            !(value instanceof Date)
          ) {
            return JSON.stringify(value);
          }

          return value;
        }),
      );
    };

    const insertImage: (data: {
      key: string;
      name: string;
      fileType: string;
      bytes: Buffer;
      projectId?: ObjectID;
      isDeleted?: boolean;
      isPublic?: boolean;
    }) => Promise<StoredImage> = async (data: {
      key: string;
      name: string;
      fileType: string;
      bytes: Buffer;
      projectId?: ObjectID;
      isDeleted?: boolean;
      isPublic?: boolean;
    }): Promise<StoredImage> => {
      const id: ObjectID = ObjectID.generate();
      const imageToken: string = token();

      await insert("File", {
        _id: id,
        projectId: data.projectId || projectId,
        name: data.name,
        slug: `file-${id.toString()}`,
        fileType: data.fileType,
        file: data.bytes,
        imageAccessToken: imageToken,
        isPublic: Boolean(data.isPublic),
        deletedAt: data.isDeleted ? new Date() : null,
        version: 1,
      });

      const image: StoredImage = {
        id: id,
        token: imageToken,
        url: `${HOST}/file/image/access-token/${imageToken}`,
        name: data.name,
        fileType: data.fileType,
        bytes: data.bytes,
      };

      images[data.key] = image;

      return image;
    };

    const insertIncident: (data: {
      projectId?: ObjectID;
      title: string;
      description?: string;
      rootCause?: string;
      postmortemNote?: string;
      customFields?: JSONObject;
      isPrivate?: boolean;
      labelIds?: Array<ObjectID>;
    }) => Promise<ObjectID> = async (data: {
      projectId?: ObjectID;
      title: string;
      description?: string;
      rootCause?: string;
      postmortemNote?: string;
      customFields?: JSONObject;
      isPrivate?: boolean;
      labelIds?: Array<ObjectID>;
    }): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();

      await insert("Incident", {
        _id: id,
        projectId: data.projectId || projectId,
        title: data.title,
        slug: `incident-${id.toString()}`,
        currentIncidentStateId: ObjectID.generate(),
        incidentSeverityId: ObjectID.generate(),
        description: data.description || null,
        rootCause: data.rootCause || null,
        postmortemNote: data.postmortemNote || null,
        customFields: data.customFields || null,
        isPrivate: Boolean(data.isPrivate),
        version: 1,
      });

      for (const labelId of data.labelIds || []) {
        await insert("IncidentLabel", { incidentId: id, labelId: labelId });
      }

      return id;
    };

    const insertNote: (data: {
      table: "IncidentPublicNote" | "IncidentInternalNote";
      incidentId: ObjectID;
      note: string;
    }) => Promise<ObjectID> = async (data: {
      table: "IncidentPublicNote" | "IncidentInternalNote";
      incidentId: ObjectID;
      note: string;
    }): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();

      await insert(data.table, {
        _id: id,
        projectId: projectId,
        incidentId: data.incidentId,
        note: data.note,
        version: 1,
      });

      return id;
    };

    // A new API key of the project with these permission rows; its key.
    const createApiKey: (
      keyProjectId: ObjectID,
      rows: Array<PermissionRow>,
    ) => Promise<string> = async (
      keyProjectId: ObjectID,
      rows: Array<PermissionRow>,
    ): Promise<string> => {
      const id: ObjectID = ObjectID.generate();
      const apiKey: string = HashedApiKey.generate();

      await insert("ApiKey", {
        _id: id,
        projectId: keyProjectId,
        name: `Key ${id.toString()}`,
        slug: `key-${id.toString()}`,
        apiKey: HashedApiKey.hash(apiKey),
        apiKeyHint: HashedApiKey.getHint(apiKey),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        version: 1,
      });

      for (const row of rows) {
        const permissionId: ObjectID = ObjectID.generate();

        await insert("ApiKeyPermission", {
          _id: permissionId,
          projectId: keyProjectId,
          apiKeyId: id,
          permission: row.permission,
          isBlockPermission: false,
          version: 1,
        });

        for (const labelId of row.labelIds || []) {
          await insert("ApiKeyPermissionLabel", {
            apiKeyPermissionId: permissionId,
            labelId: labelId,
          });
        }
      }

      return apiKey;
    };

    const setMemberPermissions: (
      rows: Array<PermissionRow>,
    ) => Promise<void> = async (rows: Array<PermissionRow>): Promise<void> => {
      await database.query(
        `DELETE FROM "${schema}"."TeamPermissionLabel" WHERE "teamPermissionId" IN (SELECT "_id" FROM "${schema}"."TeamPermission" WHERE "teamId" = $1)`,
        [memberTeamId.toString()],
      );
      await database.query(
        `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
        [memberTeamId.toString()],
      );

      for (const row of rows) {
        const id: ObjectID = ObjectID.generate();

        await insert("TeamPermission", {
          _id: id,
          projectId: projectId,
          teamId: memberTeamId,
          permission: row.permission,
          isBlockPermission: false,
          scope:
            row.labelIds && row.labelIds.length > 0
              ? PermissionScope.Labels
              : PermissionScope.All,
          version: 1,
        });

        for (const labelId of row.labelIds || []) {
          await insert("TeamPermissionLabel", {
            teamPermissionId: id,
            labelId: labelId,
          });
        }
      }
    };

    const pathOf: (record: string, id: ObjectID | string) => string = (
      record: string,
      id: ObjectID | string,
    ): string => {
      return `/api/${record}/${id.toString()}/markdown-files`;
    };

    const asKey: (
      key: string,
      record: string,
      id: ObjectID | string,
      method?: "GET" | "POST",
    ) => Promise<HttpAnswer> = async (
      key: string,
      record: string,
      id: ObjectID | string,
      method?: "GET" | "POST",
    ): Promise<HttpAnswer> => {
      return await send({
        port: port,
        path: pathOf(record, id),
        headers: { apikey: key },
        method: method,
      });
    };

    const asMember: (
      record: string,
      id: ObjectID | string,
      tenantId?: ObjectID,
    ) => Promise<HttpAnswer> = async (
      record: string,
      id: ObjectID | string,
      tenantId: ObjectID = projectId,
    ): Promise<HttpAnswer> => {
      return await send({
        port: port,
        path: pathOf(record, id),
        headers: {
          authorization: `Bearer ${memberId.toString()}`,
          tenantid: tenantId.toString(),
        },
      });
    };

    // The answer of a record that is not there for the caller: 404, no files.
    const expectNotFound: (answer: HttpAnswer, name: string) => void = (
      answer: HttpAnswer,
      name: string,
    ): void => {
      expect(answer.status).toBe(404);
      expect(answer.json["files"]).toBeUndefined();
      expect(JSON.stringify(answer.json)).toContain(`${name} not found.`);
    };

    /*
     * The answer of a record whose table the caller may not read: refused
     * (422, as every read the permissions refuse), with no file.
     */
    const expectRefused: (answer: HttpAnswer, message: string) => void = (
      answer: HttpAnswer,
      message: string,
    ): void => {
      expect(answer.status).toBe(422);
      expect(answer.json["files"]).toBeUndefined();
      expect(JSON.stringify(answer.json)).toContain(message);
    };

    // Not one byte of these images in the answer, nor their names.
    const expectNothingOf: (
      answer: HttpAnswer,
      keysOfImages: Array<string>,
    ) => void = (answer: HttpAnswer, keysOfImages: Array<string>): void => {
      const text: string = JSON.stringify(answer.json);

      for (const key of keysOfImages) {
        const image: StoredImage = images[key]!;

        expect(text).not.toContain(image.bytes.toString("base64"));
        expect(namesOf(filesOf(answer))).not.toContain(image.name);
        expect(namesOf(leftOutOf(answer))).not.toContain(image.name);
      }
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["MARKDOWN_FILES_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["MARKDOWN_FILES_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MARKDOWN_FILES_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        synchronize: false,
        logging: ["error"],
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
        database,
      );

      // The session token names the member; it is not a signed token here.
      getJestSpyOn(JSONWebToken, "decode").mockImplementation(((
        accessToken: string,
      ): JSONWebTokenData => {
        return {
          userId: new ObjectID(accessToken),
          isMasterAdmin: false,
          isGlobalLogin: true,
        } as JSONWebTokenData;
      }) as never);

      // Permissions are read from the tables every time: nothing is cached.
      getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(
        null as never,
      );
      getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(RealtimeAccessChanges, "announce").mockReturnValue(
        undefined as never,
      );
      getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(
        GlobalConfigService,
        "getRequireSsoForLogin",
      ).mockResolvedValue(false as never);
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerWorkflow",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerRealtime",
      ).mockResolvedValue(undefined as never);

      for (const [id, name] of [
        [projectId, "Home project"],
        [otherProjectId, "Other project"],
      ] as Array<[ObjectID, string]>) {
        await insert("Project", {
          _id: id,
          name: name,
          slug: id.toString(),
          version: 1,
        });
      }

      await insert("User", {
        _id: memberId,
        name: "Synthetic Member",
        email: `${memberId.toString()}@example.com`,
        slug: memberId.toString(),
        version: 1,
      });
      await insert("Team", {
        _id: memberTeamId,
        projectId: projectId,
        name: "Responders",
        slug: memberTeamId.toString(),
        version: 1,
      });
      await insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: memberTeamId,
        userId: memberId,
        hasAcceptedInvitation: true,
        version: 1,
      });

      await insert("Label", {
        _id: shownLabelId,
        projectId: projectId,
        name: "Customer facing",
        slug: shownLabelId.toString(),
        color: "#000000",
        version: 1,
      });

      // The project's custom fields: one Markdown, one Text, one Number.
      for (const [name, type] of [
        ["Customer impact", CustomFieldType.Markdown],
        ["Ticket link", CustomFieldType.Text],
        ["Severity score", CustomFieldType.Number],
      ] as Array<[string, CustomFieldType]>) {
        await insert("IncidentCustomField", {
          _id: ObjectID.generate(),
          projectId: projectId,
          name: name,
          customFieldType: type,
          version: 1,
        });
      }

      // The other project calls a Markdown field by the Text field's name.
      await insert("IncidentCustomField", {
        _id: ObjectID.generate(),
        projectId: otherProjectId,
        name: "Ticket link",
        customFieldType: CustomFieldType.Markdown,
        version: 1,
      });

      const screenshot: StoredImage = await insertImage({
        key: "screenshot",
        name: "screenshot.png",
        fileType: MimeType.png,
        bytes: png(300, 1),
      });
      const rackPhoto: StoredImage = await insertImage({
        key: "rackPhoto",
        name: "rack photo.jpg",
        fileType: MimeType.jpeg,
        bytes: jpeg(),
      });
      const graph: StoredImage = await insertImage({
        key: "graph",
        name: "latency.gif",
        fileType: MimeType.gif,
        bytes: gif(),
      });
      const diagram: StoredImage = await insertImage({
        key: "diagram",
        name: "diagram.svg",
        fileType: MimeType.svg,
        bytes: SVG_BYTES,
      });
      const page: StoredImage = await insertImage({
        key: "page",
        name: "totally-a-picture.png",
        fileType: MimeType.png,
        bytes: PAGE_BYTES,
      });
      const shared: StoredImage = await insertImage({
        key: "shared",
        name: "shared timeline.png",
        fileType: MimeType.png,
        bytes: png(120, 2),
      });
      const internal: StoredImage = await insertImage({
        key: "internal",
        name: "internal only.png",
        fileType: MimeType.png,
        bytes: png(90, 3),
      });
      const deleted: StoredImage = await insertImage({
        key: "deleted",
        name: "deleted.png",
        fileType: MimeType.png,
        bytes: png(80, 4),
        isDeleted: true,
      });
      const ticket: StoredImage = await insertImage({
        key: "ticket",
        name: "ticket screenshot.png",
        fileType: MimeType.png,
        bytes: png(70, 5),
      });
      // Of the project, but no record shows it.
      await insertImage({
        key: "unshown",
        name: "never shown.png",
        fileType: MimeType.png,
        bytes: png(60, 6),
      });
      // Of the other project; its address is copied into one of ours.
      const theirs: StoredImage = await insertImage({
        key: "theirs",
        name: "their screenshot.png",
        fileType: MimeType.png,
        bytes: png(110, 8),
        projectId: otherProjectId,
      });

      incidentId = await insertIncident({
        title: "Checkout is down",
        description: [
          "The checkout page answers 502.",
          imageMarkdown(screenshot),
          imageMarkdown(diagram),
          imageMarkdown(page),
          imageMarkdown(theirs),
          imageMarkdown(deleted),
          // The same image again, by the same address: one file.
          `<img src="${screenshot.url}" width="400">`,
        ].join("\n\n"),
        rootCause: `A bad deploy. ${imageMarkdown(graph)}`,
        postmortemNote: `What we saw: ${imageMarkdown(shared)}`,
        customFields: {
          "Customer impact": `Every checkout failed. ${imageMarkdown(rackPhoto)}`,
          // A Text field holds an address too: it is not Markdown.
          "Ticket link": imageMarkdown(ticket),
          "Severity score": 3,
        },
      });

      labelledIncidentId = await insertIncident({
        title: "Payments are slow",
        description: imageMarkdown(screenshot),
        labelIds: [shownLabelId],
      });

      privateIncidentId = await insertIncident({
        title: "A private matter",
        description: imageMarkdown(screenshot),
        isPrivate: true,
      });

      otherProjectIncidentId = await insertIncident({
        projectId: otherProjectId,
        title: "Their incident",
        description: imageMarkdown(theirs),
        customFields: { "Ticket link": imageMarkdown(theirs) },
      });

      publicNoteId = await insertNote({
        table: "IncidentPublicNote",
        incidentId: incidentId,
        note: `We are on it. ${imageMarkdown(shared)}`,
      });

      internalNoteId = await insertNote({
        table: "IncidentInternalNote",
        incidentId: incidentId,
        note: `For us only. ${imageMarkdown(internal)}`,
      });

      // The limits.
      const tooLarge: StoredImage = await insertImage({
        key: "tooLarge",
        name: "too large.png",
        fileType: MimeType.png,
        bytes: png(MARKDOWN_FILE_MAX_SIZE_IN_BYTES + 1, 9),
      });
      const small: StoredImage = await insertImage({
        key: "small",
        name: "small.png",
        fileType: MimeType.png,
        bytes: png(32, 10),
      });

      tooLargeIncidentId = await insertIncident({
        title: "One file too large",
        description: `${imageMarkdown(tooLarge)} ${imageMarkdown(small)}`,
      });

      const exactlyAsLarge: StoredImage = await insertImage({
        key: "exactlyAsLarge",
        name: "as large as allowed.png",
        fileType: MimeType.png,
        bytes: png(MARKDOWN_FILE_MAX_SIZE_IN_BYTES, 11),
      });

      exactlyAsLargeIncidentId = await insertIncident({
        title: "One file as large as allowed",
        description: imageMarkdown(exactlyAsLarge),
      });

      const quarter: number = Math.floor(
        MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES * 0.4,
      );
      const totals: Array<StoredImage> = [];

      for (const index of [1, 2, 3]) {
        totals.push(
          await insertImage({
            key: `total${index}`,
            name: `part ${index}.png`,
            fileType: MimeType.png,
            bytes: png(quarter, 20 + index),
          }),
        );
      }

      overTotalIncidentId = await insertIncident({
        title: "Too much in all",
        description: [...totals, small].map(imageMarkdown).join("\n"),
      });

      const many: Array<StoredImage> = [];

      for (
        let index: number = 0;
        index < MARKDOWN_FILES_MAX_COUNT + 2;
        index++
      ) {
        many.push(
          await insertImage({
            key: `many${index}`,
            name: `shot ${String(index).padStart(2, "0")}.png`,
            fileType: MimeType.png,
            bytes: png(40, index),
          }),
        );
      }

      tooManyIncidentId = await insertIncident({
        title: "Too many images",
        description: many.map(imageMarkdown).join("\n"),
      });

      // Addresses that open nothing, then a real image past the lookup limit.
      const addresses: Array<string> = [];

      for (
        let index: number = 0;
        index < MARKDOWN_FILES_MAX_REFERENCES;
        index++
      ) {
        addresses.push(
          `![nothing](${HOST}/file/image/access-token/${token()})`,
        );
      }

      addresses.push(imageMarkdown(small));

      tooManyAddressesIncidentId = await insertIncident({
        title: "Too many addresses",
        description: addresses.join(" "),
      });

      noImagesIncidentId = await insertIncident({
        title: "Words only",
        description: "No pictures here.",
      });

      keys["reader"] = await createApiKey(projectId, [
        { permission: Permission.ReadProjectIncident },
        { permission: Permission.ReadIncidentPublicNote },
        { permission: Permission.ReadIncidentInternalNote },
      ]);
      keys["incidentsOnly"] = await createApiKey(projectId, [
        { permission: Permission.ReadProjectIncident },
      ]);
      keys["publicNotesOnly"] = await createApiKey(projectId, [
        { permission: Permission.ReadIncidentPublicNote },
      ]);
      keys["monitorsOnly"] = await createApiKey(projectId, [
        { permission: Permission.ReadProjectMonitor },
      ]);
      keys["labelled"] = await createApiKey(projectId, [
        {
          permission: Permission.ReadProjectIncident,
          labelIds: [shownLabelId],
        },
      ]);
      keys["admin"] = await createApiKey(projectId, [
        { permission: Permission.ProjectAdmin },
      ]);
      keys["otherProject"] = await createApiKey(otherProjectId, [
        { permission: Permission.ReadProjectIncident },
      ]);

      const app: express.Express = express();
      app.use(CookieParser());
      app.use(express.json());
      app.use("/api", new IncidentAPI().getRouter());
      app.use("/api", new IncidentPublicNoteAPI().getRouter());
      app.use("/api", new IncidentInternalNoteAPI().getRouter());
      app.use(expressErrorHandler);

      server = http.createServer(app);

      await new Promise<void>((resolve: () => void) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      port = (server.address() as AddressInfo).port;
    }, 180_000);

    afterAll(async () => {
      if (server) {
        await new Promise<void>((resolve: () => void) => {
          server.close(() => {
            resolve();
          });
        });
      }

      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    describe("an API key that may read the record", () => {
      test("gets each picture the record's Markdown and Markdown custom fields show, whole, in the order shown", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          incidentId,
        );

        expect(answer.status).toBe(200);

        const files: Array<MarkdownFile> = filesOf(answer);

        // description, rootCause, postmortemNote, then the custom fields.
        expect(namesOf(files)).toEqual([
          "screenshot.png",
          "latency.gif",
          "shared timeline.png",
          "rack photo.jpg",
        ]);

        for (const file of files) {
          const image: StoredImage = Object.values(images).find(
            (stored: StoredImage): boolean => {
              return stored.name === file.name;
            },
          )!;

          expect(Buffer.from(file.base64, "base64").equals(image.bytes)).toBe(
            true,
          );
          expect(file.sizeInBytes).toBe(image.bytes.length);
          expect(file.mimeType).toBe(image.fileType);
          expect(file.contentId).toBe(MarkdownFiles.getContentId(image.token));
          expect(file.urls).toEqual([image.url]);
        }

        expect(files[0]!.fields).toEqual(["description"]);
        expect(files[1]!.fields).toEqual(["rootCause"]);
        expect(files[2]!.fields).toEqual(["postmortemNote"]);
        expect(files[3]!.fields).toEqual(["Customer impact"]);
      });

      test("an image shown twice by the same address is handed out once", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          incidentId,
        );

        expect(
          filesOf(answer).filter((file: MarkdownFile): boolean => {
            return file.name === "screenshot.png";
          }),
        ).toHaveLength(1);
      });

      test("an SVG and a page stored as a picture are left out as no pictures, without their bytes", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          incidentId,
        );

        const notPictures: Array<MarkdownFileLeftOut> = leftOutOf(
          answer,
        ).filter((leftOut: MarkdownFileLeftOut): boolean => {
          return leftOut.reason === MarkdownFileLeftOutReason.NotAPicture;
        });

        expect(namesOf(notPictures)).toEqual([
          "diagram.svg",
          "totally-a-picture.png",
        ]);

        const text: string = JSON.stringify(answer.json);

        expect(text).not.toContain(SVG_BYTES.toString("base64"));
        expect(text).not.toContain(PAGE_BYTES.toString("base64"));
      });

      test("another project's image whose address was copied in, and a deleted image, read as no file at all", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          incidentId,
        );

        const notFound: Array<MarkdownFileLeftOut> = leftOutOf(answer).filter(
          (leftOut: MarkdownFileLeftOut): boolean => {
            return leftOut.reason === MarkdownFileLeftOutReason.NotFound;
          },
        );

        // Named by address only: the same for theirs and for a deleted one.
        expect(notFound).toHaveLength(2);

        for (const leftOut of notFound) {
          expect(leftOut.name).toBeNull();
        }

        expect(
          notFound.map((leftOut: MarkdownFileLeftOut): Array<string> => {
            return leftOut.urls;
          }),
        ).toEqual([[images["theirs"]!.url], [images["deleted"]!.url]]);

        expectNothingOf(answer, ["theirs", "deleted"]);
      });

      test("never a file the record does not show, nor one only a Text custom field names", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          incidentId,
        );

        expectNothingOf(answer, ["unshown", "ticket", "internal"]);
        expect(JSON.stringify(answer.json)).not.toContain(
          images["ticket"]!.url,
        );
      });

      test("POST answers as GET does", async () => {
        const get: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          incidentId,
        );
        const post: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          incidentId,
          "POST",
        );

        expect(post.status).toBe(200);
        expect(post.json).toEqual(get.json);
      });

      test("the answer is JSON, kept by no cache", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          incidentId,
        );

        expect(String(answer.headers["content-type"])).toContain(
          "application/json",
        );
        expect(String(answer.headers["cache-control"])).toContain("no-store");
      });

      test("a record whose Markdown shows no image answers with none", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          noImagesIncidentId,
        );

        expect(answer.status).toBe(200);
        expect(answer.json).toEqual({ files: [], leftOut: [] });
      });

      test("another project's key gets its own project's images, and nothing a field of ours with that name would show", async () => {
        const answer: HttpAnswer = await asKey(
          keys["otherProject"]!,
          "incident",
          otherProjectIncidentId,
        );

        expect(answer.status).toBe(200);
        expect(namesOf(filesOf(answer))).toEqual(["their screenshot.png"]);
        expect(filesOf(answer)[0]!.fields).toEqual([
          "description",
          "Ticket link",
        ]);
      });
    });

    describe("no reading through a record the caller may not read", () => {
      test("anonymous: 401, whatever the record", async () => {
        const answer: HttpAnswer = await send({
          port: port,
          path: pathOf("incident", incidentId),
        });

        expect(answer.status).toBe(401);
        expect(answer.json["files"]).toBeUndefined();
      });

      test("a key that may not read incidents at all: refused, with no file", async () => {
        const answer: HttpAnswer = await asKey(
          keys["monitorsOnly"]!,
          "incident",
          incidentId,
        );

        expectRefused(answer, "You do not have permissions to read Incident");
        expectNothingOf(answer, ["screenshot", "rackPhoto", "graph", "shared"]);
      });

      test("another project's key: the record is not there for it", async () => {
        const answer: HttpAnswer = await asKey(
          keys["otherProject"]!,
          "incident",
          incidentId,
        );

        expectNotFound(answer, "Incident");
        expectNothingOf(answer, ["screenshot", "rackPhoto", "graph", "shared"]);
      });

      test("a key limited to a label: the records carrying it, and not the others", async () => {
        const labelled: HttpAnswer = await asKey(
          keys["labelled"]!,
          "incident",
          labelledIncidentId,
        );

        expect(labelled.status).toBe(200);
        expect(namesOf(filesOf(labelled))).toEqual(["screenshot.png"]);

        expectNotFound(
          await asKey(keys["labelled"]!, "incident", incidentId),
          "Incident",
        );
      });

      test("a private incident: not there for a key that is no admin, there for one that is", async () => {
        expectNotFound(
          await asKey(keys["reader"]!, "incident", privateIncidentId),
          "Incident",
        );

        const admin: HttpAnswer = await asKey(
          keys["admin"]!,
          "incident",
          privateIncidentId,
        );

        expect(admin.status).toBe(200);
        expect(namesOf(filesOf(admin))).toEqual(["screenshot.png"]);
      });

      test("a record that does not exist, and an id that is not one, answer as not found", async () => {
        expectNotFound(
          await asKey(keys["reader"]!, "incident", ObjectID.generate()),
          "Incident",
        );
        expectNotFound(
          await asKey(keys["reader"]!, "incident", "not-an-id"),
          "Incident",
        );
      });

      test("a key that is not one is refused before anything is read", async () => {
        const answer: HttpAnswer = await asKey(
          ObjectID.generate().toString(),
          "incident",
          incidentId,
        );

        expect(answer.status).toBeGreaterThanOrEqual(400);
        expect(answer.status).toBeLessThan(500);
        expect(answer.json["files"]).toBeUndefined();
      });
    });

    describe("a file two records show", () => {
      test("is handed out through either record, to a key that may read both", async () => {
        const incident: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          incidentId,
        );
        const note: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident-public-note",
          publicNoteId,
        );

        expect(namesOf(filesOf(incident))).toContain("shared timeline.png");
        expect(note.status).toBe(200);
        expect(namesOf(filesOf(note))).toEqual(["shared timeline.png"]);
        expect(filesOf(note)[0]!.fields).toEqual(["note"]);
        expect(filesOf(note)[0]!.contentId).toBe(
          filesOf(incident).find((file: MarkdownFile): boolean => {
            return file.name === "shared timeline.png";
          })!.contentId,
        );
      });

      test("is handed out through the record a key may read, and not through the one it may not", async () => {
        const incident: HttpAnswer = await asKey(
          keys["incidentsOnly"]!,
          "incident",
          incidentId,
        );

        expect(incident.status).toBe(200);
        expect(namesOf(filesOf(incident))).toContain("shared timeline.png");

        const note: HttpAnswer = await asKey(
          keys["incidentsOnly"]!,
          "incident-public-note",
          publicNoteId,
        );

        expectRefused(
          note,
          "You do not have permissions to read Incident Public Note",
        );
        expect(JSON.stringify(note.json)).not.toContain(
          images["shared"]!.bytes.toString("base64"),
        );
      });

      test("a note is read through its incident: a key that may read notes but not incidents gets none of the note's images", async () => {
        const note: HttpAnswer = await asKey(
          keys["publicNotesOnly"]!,
          "incident-public-note",
          publicNoteId,
        );

        expectRefused(note, "It is read through its Incident");
        expectNothingOf(note, ["shared"]);
      });

      test("an internal note's image takes a read of internal notes", async () => {
        const reader: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident-internal-note",
          internalNoteId,
        );

        expect(reader.status).toBe(200);
        expect(namesOf(filesOf(reader))).toEqual(["internal only.png"]);

        const incidentsOnly: HttpAnswer = await asKey(
          keys["incidentsOnly"]!,
          "incident-internal-note",
          internalNoteId,
        );

        expectRefused(
          incidentsOnly,
          "You do not have permissions to read Incident Internal Note",
        );
        expectNothingOf(incidentsOnly, ["internal"]);
      });
    });

    describe("the limits", () => {
      test("a file larger than one file may be is left out, the files beside it are not", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          tooLargeIncidentId,
        );

        expect(answer.status).toBe(200);
        expect(namesOf(filesOf(answer))).toEqual(["small.png"]);
        expect(
          leftOutOf(answer).map((leftOut: MarkdownFileLeftOut) => {
            return [leftOut.name, leftOut.reason];
          }),
        ).toEqual([["too large.png", MarkdownFileLeftOutReason.TooLarge]]);
      });

      test("a file exactly as large as one file may be is handed out whole", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          exactlyAsLargeIncidentId,
        );

        expect(answer.status).toBe(200);
        expect(filesOf(answer)).toHaveLength(1);
        expect(filesOf(answer)[0]!.sizeInBytes).toBe(
          MARKDOWN_FILE_MAX_SIZE_IN_BYTES,
        );
        expect(
          Buffer.from(filesOf(answer)[0]!.base64, "base64").equals(
            images["exactlyAsLarge"]!.bytes,
          ),
        ).toBe(true);
      });

      test("files past the total are left out, and a later one that fits is still handed out", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          overTotalIncidentId,
        );

        expect(answer.status).toBe(200);
        expect(namesOf(filesOf(answer))).toEqual([
          "part 1.png",
          "part 2.png",
          "small.png",
        ]);
        expect(
          leftOutOf(answer).map((leftOut: MarkdownFileLeftOut) => {
            return [leftOut.name, leftOut.reason];
          }),
        ).toEqual([["part 3.png", MarkdownFileLeftOutReason.OverTotalSize]]);

        const total: number = filesOf(answer).reduce(
          (sum: number, file: MarkdownFile): number => {
            return sum + file.sizeInBytes;
          },
          0,
        );

        expect(total).toBeLessThanOrEqual(
          MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES,
        );
      });

      test("past the most files one read hands out, the rest are left out", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          tooManyIncidentId,
        );

        expect(answer.status).toBe(200);
        expect(filesOf(answer)).toHaveLength(MARKDOWN_FILES_MAX_COUNT);
        expect(namesOf(filesOf(answer))[0]).toBe("shot 00.png");
        expect(
          leftOutOf(answer).map((leftOut: MarkdownFileLeftOut) => {
            return [leftOut.name, leftOut.reason];
          }),
        ).toEqual([
          ["shot 20.png", MarkdownFileLeftOutReason.TooMany],
          ["shot 21.png", MarkdownFileLeftOutReason.TooMany],
        ]);
      });

      test("past the most addresses looked up, the rest are left out unread, even an image that is there", async () => {
        const answer: HttpAnswer = await asKey(
          keys["reader"]!,
          "incident",
          tooManyAddressesIncidentId,
        );

        expect(answer.status).toBe(200);
        expect(filesOf(answer)).toEqual([]);

        const leftOut: Array<MarkdownFileLeftOut> = leftOutOf(answer);

        expect(leftOut).toHaveLength(MARKDOWN_FILES_MAX_REFERENCES + 1);
        expect(
          leftOut
            .slice(0, MARKDOWN_FILES_MAX_REFERENCES)
            .every((entry: MarkdownFileLeftOut): boolean => {
              return entry.reason === MarkdownFileLeftOutReason.NotFound;
            }),
        ).toBe(true);
        expect(leftOut[MARKDOWN_FILES_MAX_REFERENCES]).toEqual(
          expect.objectContaining({
            name: null,
            urls: [images["small"]!.url],
            reason: MarkdownFileLeftOutReason.TooMany,
          }),
        );
        expectNothingOf(answer, ["small"]);
      });
    });

    describe("a signed-in member", () => {
      test("is held to their team's permissions, as a key is", async () => {
        await setMemberPermissions([
          { permission: Permission.ReadProjectIncident },
        ]);

        const reader: HttpAnswer = await asMember("incident", incidentId);

        expect(reader.status).toBe(200);
        expect(namesOf(filesOf(reader))).toEqual([
          "screenshot.png",
          "latency.gif",
          "shared timeline.png",
          "rack photo.jpg",
        ]);

        await setMemberPermissions([
          {
            permission: Permission.ReadProjectIncident,
            labelIds: [shownLabelId],
          },
        ]);

        expectNotFound(await asMember("incident", incidentId), "Incident");
        expect((await asMember("incident", labelledIncidentId)).status).toBe(
          200,
        );

        await setMemberPermissions([
          { permission: Permission.ReadProjectMonitor },
        ]);

        expectRefused(
          await asMember("incident", incidentId),
          "You do not have permissions to read Incident",
        );
      });

      test("asking in a project they are not a member of reads nothing", async () => {
        await setMemberPermissions([
          { permission: Permission.ReadProjectIncident },
        ]);

        const answer: HttpAnswer = await asMember(
          "incident",
          otherProjectIncidentId,
          otherProjectId,
        );

        expect(answer.status).toBeGreaterThanOrEqual(400);
        expect(answer.json["files"]).toBeUndefined();
        expectNothingOf(answer, ["theirs"]);
      });
    });
  },
);
