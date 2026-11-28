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
      getLogLevel: jest.fn().mockReturnValue("INFO"),
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

import FileAPI from "../../../Server/API/FileAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { BACKFILL_SHOWN_IMAGES_SQL } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187821479-BackfillShownImages";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentNoteTemplateService from "../../../Server/Services/IncidentNoteTemplateService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import ShownImageAccess from "../../../Server/Utils/File/ShownImageAccess";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Entities from "../../../Models/DatabaseModels/Index";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";
import { DataSource, Logger } from "typeorm";

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A PRIVATE INLINE IMAGE'S ADDRESS, HELD TO THE RECORDS THE PERSON MAY READ
 * (#11478), OVER HTTP, AGAINST A MIGRATED POSTGRES.
 *
 *   GET /file/image/access-token/:token
 *
 * Through a real Express app: the production FileAPI router, the real
 * session reading, the real project permission lookup, every record read as
 * the person through its own service, and the production error handler.
 * The records showing each image are recorded by the migration's own
 * statement (BackfillShownImages) and by DatabaseService's write hooks
 * (ShownImages). Only the caches, the audit log, live updates and the
 * session token's signature are stubbed.
 *
 * What it pins:
 *
 *   - a member whose role reads only monitors is refused an incident's
 *     image, private incident or not, though they can open the project: the
 *     gap the issue names - main served it to every member of the project;
 *   - a member who may read the incident gets it, whole; a member limited to
 *     a label gets an image of an incident carrying it, not of one without;
 *   - a private incident's image only to its owners and the project's
 *     admins; an image two records show, through the one the person may
 *     read;
 *   - a note's image to those who may read the note; a Markdown custom
 *     field's, not a Text field's; a monitor's criteria to monitor readers;
 *   - an image no record shows any more - edited out, its record deleted,
 *     never saved to one - to its uploader alone, not even to an admin;
 *   - records written through DatabaseService record their images at once,
 *     on create and on update;
 *   - public images, as status pages and forms show them, still to anyone;
 *   - and how much it costs: a page of twenty images of one incident.
 *
 * Opt in with RUN_POSTGRES_IMAGE_RECORD_ACCESS_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_IMAGE_RECORD_ACCESS_TESTS=true \
 *   IMAGE_RECORD_ACCESS_TEST_DATABASE_HOST=127.0.0.1 \
 *   IMAGE_RECORD_ACCESS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/FileImageRecordAccessPostgres.test.ts
 *
 * IMAGE_RECORD_ACCESS_MEASUREMENT_FILE, when set, is where the measurements
 * are written. The tables it writes are cloned, structure only (LIKE ...
 * INCLUDING ALL), into a uniquely named schema that search_path puts first;
 * every other table a read joins is found, empty, in public. It is dropped
 * afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_IMAGE_RECORD_ACCESS_TESTS"] === "true"
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
  "File",
  "Incident",
  "IncidentLabel",
  "IncidentOwnerUser",
  "IncidentOwnerTeam",
  "IncidentCustomField",
  "IncidentInternalNote",
  "IncidentNoteTemplate",
  "Monitor",
  "MonitorLabel",
  "ShownImage",
];

const HOST: string = "https://oneuptime.example.com";

// A picture's first bytes, then filler.
const PNG_SIGNATURE: Array<number> = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];

const png: (fill: number, size?: number) => Buffer = (
  fill: number,
  size: number = 96,
): Buffer => {
  const bytes: Buffer = Buffer.alloc(size, fill);
  Buffer.from(PNG_SIGNATURE).copy(bytes, 0);
  return bytes;
};

const newToken: () => string = (): string => {
  return (
    ObjectID.generate().toString().replace(/-/g, "") +
    ObjectID.generate().toString().replace(/-/g, "")
  );
};

interface StoredImage {
  id: ObjectID;
  token: string;
  url: string;
  bytes: Buffer;
}

interface HttpAnswer {
  status: number;
  body: Buffer;
  headers: http.IncomingHttpHeaders;
}

const markdownOf: (image: StoredImage, name?: string) => string = (
  image: StoredImage,
  name: string = "screenshot.png",
): string => {
  return `![${name}](${image.url})`;
};

function get(data: {
  port: number;
  path: string;
  bearer?: string | undefined;
}): Promise<HttpAnswer> {
  return new Promise<HttpAnswer>(
    (resolve: (answer: HttpAnswer) => void, reject: (e: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: "GET",
          headers: data.bearer
            ? { authorization: `Bearer ${data.bearer}` }
            : {},
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              body: Buffer.concat(chunks),
              headers: response.headers,
            });
          });
        },
      );

      request.on("error", reject);
      request.end();
    },
  );
}

/*
 * Counts the statements the database is sent while counting is on: the
 * measure of what an image costs that does not depend on the machine.
 */
class StatementCounter implements Logger {
  public counting: boolean = false;
  public statements: Array<string> = [];

  public logQuery(query: string): void {
    if (this.counting) {
      this.statements.push(query);
    }
  }

  public logQueryError(): void {}
  public logQuerySlow(): void {}
  public logSchemaBuild(): void {}
  public logMigration(): void {}
  public log(): void {}

  public start(): void {
    this.statements = [];
    this.counting = true;
  }

  public stop(): number {
    this.counting = false;
    return this.statements.length;
  }
}

describePostgres(
  "a private inline image's address, held to the records the person may read, over HTTP, against a migrated Postgres",
  () => {
    const schema: string = `image_record_access_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const shownLabelId: ObjectID = ObjectID.generate();

    const counter: StatementCounter = new StatementCounter();
    const measurements: JSONObject = {};

    let database: DataSource;
    let server: http.Server;
    let port: number;

    // The people, by what they may read.
    const people: Dictionary<ObjectID> = {};
    // Each person's team, whose permissions they hold.
    const teams: Dictionary<ObjectID> = {};
    // The images, by what shows them.
    const images: Dictionary<StoredImage> = {};
    // The records, by what they are.
    const records: Dictionary<ObjectID> = {};

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
      uploadedBy: ObjectID;
      projectId?: ObjectID;
      isPublic?: boolean;
      fill: number;
    }) => Promise<StoredImage> = async (data: {
      key: string;
      uploadedBy: ObjectID;
      projectId?: ObjectID;
      isPublic?: boolean;
      fill: number;
    }): Promise<StoredImage> => {
      const id: ObjectID = ObjectID.generate();
      const token: string = newToken();
      const bytes: Buffer = png(data.fill);

      await insert("File", {
        _id: id,
        projectId: data.projectId || projectId,
        createdByUserId: data.uploadedBy,
        name: `${data.key}.png`,
        slug: `file-${id.toString()}`,
        fileType: MimeType.png,
        file: bytes,
        imageAccessToken: token,
        isPublic: Boolean(data.isPublic),
        version: 1,
      });

      const image: StoredImage = {
        id: id,
        token: token,
        url: `${HOST}/file/image/access-token/${token}`,
        bytes: bytes,
      };

      images[data.key] = image;

      return image;
    };

    const insertIncident: (data: {
      key: string;
      projectId?: ObjectID;
      description?: string;
      customFields?: JSONObject;
      isPrivate?: boolean;
      labelIds?: Array<ObjectID>;
      isDeleted?: boolean;
    }) => Promise<ObjectID> = async (data: {
      key: string;
      projectId?: ObjectID;
      description?: string;
      customFields?: JSONObject;
      isPrivate?: boolean;
      labelIds?: Array<ObjectID>;
      isDeleted?: boolean;
    }): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();

      await insert("Incident", {
        _id: id,
        projectId: data.projectId || projectId,
        title: `Incident ${data.key}`,
        slug: `incident-${id.toString()}`,
        currentIncidentStateId: ObjectID.generate(),
        incidentSeverityId: ObjectID.generate(),
        description: data.description || null,
        customFields: data.customFields || null,
        isPrivate: Boolean(data.isPrivate),
        deletedAt: data.isDeleted ? new Date() : null,
        version: 1,
      });

      for (const labelId of data.labelIds || []) {
        await insert("IncidentLabel", { incidentId: id, labelId: labelId });
      }

      records[data.key] = id;

      return id;
    };

    // A person who is a member of the project, through a team of their own.
    const addPerson: (data: {
      key: string;
      projectId?: ObjectID;
      permissions: Array<{
        permission: Permission;
        labelIds?: Array<ObjectID>;
      }>;
    }) => Promise<ObjectID> = async (data: {
      key: string;
      projectId?: ObjectID;
      permissions: Array<{
        permission: Permission;
        labelIds?: Array<ObjectID>;
      }>;
    }): Promise<ObjectID> => {
      const userId: ObjectID = ObjectID.generate();
      const teamId: ObjectID = ObjectID.generate();
      const teamProjectId: ObjectID = data.projectId || projectId;

      await insert("User", {
        _id: userId,
        name: `Person ${data.key}`,
        email: `${userId.toString()}@example.com`,
        slug: userId.toString(),
        version: 1,
      });
      await insert("Team", {
        _id: teamId,
        projectId: teamProjectId,
        name: `Team ${data.key}`,
        slug: teamId.toString(),
        version: 1,
      });
      await insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: teamProjectId,
        teamId: teamId,
        userId: userId,
        hasAcceptedInvitation: true,
        version: 1,
      });

      for (const row of data.permissions) {
        const permissionId: ObjectID = ObjectID.generate();

        await insert("TeamPermission", {
          _id: permissionId,
          projectId: teamProjectId,
          teamId: teamId,
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
            teamPermissionId: permissionId,
            labelId: labelId,
          });
        }
      }

      people[data.key] = userId;
      teams[data.key] = teamId;

      return userId;
    };

    // The image's address, asked for as this person (or by nobody).
    const ask: (
      imageKey: string,
      personKey?: string,
    ) => Promise<HttpAnswer> = async (
      imageKey: string,
      personKey?: string,
    ): Promise<HttpAnswer> => {
      return await get({
        port: port,
        path: `/file/image/access-token/${images[imageKey]!.token}`,
        bearer: personKey ? people[personKey]!.toString() : undefined,
      });
    };

    const expectServed: (answer: HttpAnswer, imageKey: string) => void = (
      answer: HttpAnswer,
      imageKey: string,
    ): void => {
      expect(answer.status).toBe(200);
      expect(answer.body.equals(images[imageKey]!.bytes)).toBe(true);
    };

    // Answered exactly as for an image that does not exist, with none of its bytes.
    const expectNotServed: (answer: HttpAnswer, imageKey: string) => void = (
      answer: HttpAnswer,
      imageKey: string,
    ): void => {
      expect(answer.status).toBe(404);
      expect(answer.body.toString("utf8")).toContain("File not found");
      expect(answer.body.includes(images[imageKey]!.bytes)).toBe(false);
    };

    const shownImageRows: (imageKey: string) => Promise<Array<string>> = async (
      imageKey: string,
    ): Promise<Array<string>> => {
      const rows: Array<{ recordTableName: string; recordId: string }> =
        await database.query(
          `SELECT "recordTableName", "recordId" FROM "${schema}"."ShownImage" WHERE "fileId" = $1 ORDER BY "recordTableName", "recordId"`,
          [images[imageKey]!.id.toString()],
        );

      return rows.map(
        (row: { recordTableName: string; recordId: string }): string => {
          return `${row.recordTableName}:${row.recordId}`;
        },
      );
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["IMAGE_RECORD_ACCESS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["IMAGE_RECORD_ACCESS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["IMAGE_RECORD_ACCESS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        synchronize: false,
        logging: ["query", "error"],
        logger: counter,
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

      // The session token names the person; it is not a signed token here.
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

      // The services the records are read through, built before any read.
      expect(IncidentService).toBeTruthy();
      expect(IncidentInternalNoteService).toBeTruthy();
      expect(MonitorService).toBeTruthy();

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

      await insert("Label", {
        _id: shownLabelId,
        projectId: projectId,
        name: "Customer facing",
        slug: shownLabelId.toString(),
        color: "#000000",
        version: 1,
      });

      // The people, each in a team of their own with what they may read.
      await addPerson({
        key: "monitorsOnly",
        permissions: [{ permission: Permission.ReadProjectMonitor }],
      });
      await addPerson({
        key: "incidentReader",
        permissions: [{ permission: Permission.ReadProjectIncident }],
      });
      await addPerson({
        key: "noteReader",
        permissions: [
          { permission: Permission.ReadProjectIncident },
          { permission: Permission.ReadIncidentInternalNote },
          { permission: Permission.ReadIncidentNoteTemplate },
        ],
      });
      await addPerson({
        key: "labelled",
        permissions: [
          {
            permission: Permission.ReadProjectIncident,
            labelIds: [shownLabelId],
          },
        ],
      });
      await addPerson({
        key: "privateOwner",
        permissions: [{ permission: Permission.ReadProjectIncident }],
      });
      await addPerson({
        key: "admin",
        permissions: [{ permission: Permission.ProjectAdmin }],
      });
      // Uploads the images; reads only monitors, so never through a record.
      await addPerson({
        key: "uploader",
        permissions: [{ permission: Permission.ReadProjectMonitor }],
      });
      await addPerson({
        key: "outsider",
        projectId: otherProjectId,
        permissions: [{ permission: Permission.ProjectAdmin }],
      });

      await database.query(
        `INSERT INTO "${schema}"."IncidentCustomField" ("_id", "projectId", "name", "customFieldType", "version") VALUES ($1, $2, 'Customer impact', $3, 1), ($4, $2, 'Ticket link', $5, 1)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          CustomFieldType.Markdown,
          ObjectID.generate().toString(),
          CustomFieldType.Text,
        ],
      );

      const uploader: ObjectID = people["uploader"]!;
      let fill: number = 1;

      for (const key of [
        "incident",
        "privateIncident",
        "labelledIncident",
        "unlabelledIncident",
        "note",
        "markdownField",
        "textField",
        "monitorCriteria",
        "shared",
        "editedOut",
        "deletedRecord",
        "neverSaved",
        "template",
        "templateUpdate",
      ]) {
        await insertImage({ key: key, uploadedBy: uploader, fill: fill++ });
      }

      await insertImage({
        key: "statusPage",
        uploadedBy: uploader,
        isPublic: true,
        fill: fill++,
      });
      await insertImage({
        key: "theirs",
        uploadedBy: people["outsider"]!,
        projectId: otherProjectId,
        fill: fill++,
      });

      await insertIncident({
        key: "incident",
        description: `The checkout page answers 502. ${markdownOf(images["incident"]!)}`,
        customFields: {
          "Customer impact": `Every checkout failed. ${markdownOf(images["markdownField"]!)}`,
          // A Text field holds an address too: it is not Markdown.
          "Ticket link": markdownOf(images["textField"]!),
        },
      });
      await insertIncident({
        key: "privateIncident",
        description: markdownOf(images["privateIncident"]!),
        isPrivate: true,
      });
      await insert("IncidentOwnerUser", {
        _id: ObjectID.generate(),
        projectId: projectId,
        incidentId: records["privateIncident"]!,
        userId: people["privateOwner"]!,
        version: 1,
      });
      await insertIncident({
        key: "labelledIncident",
        description: markdownOf(images["labelledIncident"]!),
        labelIds: [shownLabelId],
      });
      await insertIncident({
        key: "unlabelledIncident",
        description: markdownOf(images["unlabelledIncident"]!),
      });

      // An image a private incident and an incident anyone may read show.
      await insertIncident({
        key: "sharedPrivate",
        description: markdownOf(images["shared"]!),
        isPrivate: true,
      });
      await insertIncident({
        key: "sharedOpen",
        description: `Copied from the private one: ${markdownOf(images["shared"]!)}`,
      });

      // Shown once, then edited out: its row stays, and opens nothing.
      await insertIncident({
        key: "editedOut",
        description: markdownOf(images["editedOut"]!),
      });
      await insertIncident({
        key: "deletedRecord",
        description: markdownOf(images["deletedRecord"]!),
        isDeleted: true,
      });

      // Another project's image, its address copied into one of ours.
      await insertIncident({
        key: "copiedTheirs",
        description: markdownOf(images["theirs"]!),
      });

      const noteId: ObjectID = ObjectID.generate();
      await insert("IncidentInternalNote", {
        _id: noteId,
        projectId: projectId,
        incidentId: records["incident"]!,
        note: `For us only. ${markdownOf(images["note"]!)}`,
        version: 1,
      });
      records["note"] = noteId;

      // A monitor whose criteria open an incident with a screenshot in it.
      const criteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();
      criteriaInstance.setIncidents([
        {
          id: "incident-1",
          title: "Checkout is down",
          description: `What it looks like: ${markdownOf(images["monitorCriteria"]!)}`,
        },
      ]);
      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = { monitorCriteriaInstanceArray: [criteriaInstance] };
      const step: MonitorStep = new MonitorStep();
      step.setMonitorCriteria(criteria);
      const steps: MonitorSteps = new MonitorSteps();
      steps.setMonitorStepsInstanceArray([step]);

      const monitorId: ObjectID = ObjectID.generate();
      await insert("Monitor", {
        _id: monitorId,
        projectId: projectId,
        name: "Checkout",
        slug: `monitor-${monitorId.toString()}`,
        monitorType: "Manual",
        currentMonitorStatusId: ObjectID.generate(),
        monitorSteps: steps.toJSON(),
        version: 1,
      });
      records["monitor"] = monitorId;

      // The records written before ShownImage existed, as the migration reads them.
      await database.query(BACKFILL_SHOWN_IMAGES_SQL);

      // Then the image is edited out, as a write that left its row would.
      await database.query(
        `UPDATE "${schema}"."Incident" SET "description" = 'Nothing to see now.' WHERE "_id" = $1`,
        [records["editedOut"]!.toString()],
      );

      const app: express.Express = express();
      app.use(CookieParser());
      app.use(express.json());
      app.use(new FileAPI().getRouter());
      app.use(expressErrorHandler);

      server = http.createServer(app);

      await new Promise<void>((resolve: () => void) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      port = (server.address() as AddressInfo).port;
    }, 180_000);

    beforeEach(() => {
      // Every test decides from the database, not from an earlier answer.
      ShownImageAccess.forget();
    });

    afterAll(async () => {
      if (server) {
        await new Promise<void>((resolve: () => void) => {
          server.close(() => {
            resolve();
          });
        });
      }

      const measurementFile: string | undefined =
        process.env["IMAGE_RECORD_ACCESS_MEASUREMENT_FILE"];

      if (measurementFile) {
        fs.writeFileSync(
          measurementFile,
          JSON.stringify(measurements, null, 2) + "\n",
        );
      }

      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    describe("the migration reads in the records written before", () => {
      test("each record that shows an image of its own project, once", async () => {
        expect(await shownImageRows("incident")).toEqual([
          `Incident:${records["incident"]!.toString()}`,
        ]);
        expect(await shownImageRows("note")).toEqual([
          `IncidentInternalNote:${records["note"]!.toString()}`,
        ]);
        expect(await shownImageRows("monitorCriteria")).toEqual([
          `Monitor:${records["monitor"]!.toString()}`,
        ]);
        expect((await shownImageRows("shared")).sort()).toEqual(
          [
            `Incident:${records["sharedPrivate"]!.toString()}`,
            `Incident:${records["sharedOpen"]!.toString()}`,
          ].sort(),
        );
      });

      test("custom fields are read whole: a Text field's address is recorded too, and decided by what is Markdown", async () => {
        expect(await shownImageRows("markdownField")).toEqual([
          `Incident:${records["incident"]!.toString()}`,
        ]);
        expect(await shownImageRows("textField")).toEqual([
          `Incident:${records["incident"]!.toString()}`,
        ]);
      });

      test("nothing for a deleted record, another project's image, or an image never saved to a record", async () => {
        expect(await shownImageRows("deletedRecord")).toEqual([]);
        expect(await shownImageRows("theirs")).toEqual([]);
        expect(await shownImageRows("neverSaved")).toEqual([]);
      });

      test("running it again writes nothing new", async () => {
        const before: Array<{ count: string }> = await database.query(
          `SELECT count(*)::text AS "count" FROM "${schema}"."ShownImage"`,
        );

        await database.query(BACKFILL_SHOWN_IMAGES_SQL);

        const after: Array<{ count: string }> = await database.query(
          `SELECT count(*)::text AS "count" FROM "${schema}"."ShownImage"`,
        );

        expect(after[0]!.count).toBe(before[0]!.count);
      });
    });

    describe("the gap the issue names: a member whose role reads only monitors", () => {
      test("is refused an incident's image, though they can open the project", async () => {
        expectNotServed(await ask("incident", "monitorsOnly"), "incident");
      });

      test("is refused a private incident's image", async () => {
        expectNotServed(
          await ask("privateIncident", "monitorsOnly"),
          "privateIncident",
        );
      });

      test("is refused a note's image and a custom field's image", async () => {
        expectNotServed(await ask("note", "monitorsOnly"), "note");
        expectNotServed(
          await ask("markdownField", "monitorsOnly"),
          "markdownField",
        );
      });

      test("still gets the image in a monitor's criteria, which they may read", async () => {
        expectServed(
          await ask("monitorCriteria", "monitorsOnly"),
          "monitorCriteria",
        );
      });
    });

    describe("a member who may read the record", () => {
      test("gets the incident's image, whole, cached for them alone", async () => {
        const answer: HttpAnswer = await ask("incident", "incidentReader");

        expectServed(answer, "incident");
        expect(answer.headers["cache-control"]).toBe("private, no-cache");
      });

      test("gets a Markdown custom field's image, but not one only a Text field names", async () => {
        expectServed(
          await ask("markdownField", "incidentReader"),
          "markdownField",
        );
        expectNotServed(await ask("textField", "incidentReader"), "textField");
      });

      test("an incident reader is refused a note's image; one who may read the note gets it", async () => {
        expectNotServed(await ask("note", "incidentReader"), "note");
        expectServed(await ask("note", "noteReader"), "note");
      });

      test("an incident reader is refused the monitor's criteria image", async () => {
        expectNotServed(
          await ask("monitorCriteria", "incidentReader"),
          "monitorCriteria",
        );
      });
    });

    describe("labels and private records", () => {
      test("a member limited to a label gets an image of an incident carrying it, not of one without", async () => {
        expectServed(
          await ask("labelledIncident", "labelled"),
          "labelledIncident",
        );
        expectNotServed(
          await ask("unlabelledIncident", "labelled"),
          "unlabelledIncident",
        );
      });

      test("a private incident's image goes to its owner and to the project's admins, not to another incident reader", async () => {
        expectNotServed(
          await ask("privateIncident", "incidentReader"),
          "privateIncident",
        );
        expectServed(
          await ask("privateIncident", "privateOwner"),
          "privateIncident",
        );
        expectServed(await ask("privateIncident", "admin"), "privateIncident");
      });

      test("an image a private incident and an open one both show is served through the open one", async () => {
        expectServed(await ask("shared", "incidentReader"), "shared");
        expectNotServed(await ask("shared", "monitorsOnly"), "shared");
      });
    });

    describe("an image no record shows any more", () => {
      test("edited out of its record: to its uploader alone, not even to an admin", async () => {
        expectServed(await ask("editedOut", "uploader"), "editedOut");
        expectNotServed(await ask("editedOut", "incidentReader"), "editedOut");
        expectNotServed(await ask("editedOut", "admin"), "editedOut");
      });

      test("its record deleted: to its uploader alone", async () => {
        expectServed(await ask("deletedRecord", "uploader"), "deletedRecord");
        expectNotServed(await ask("deletedRecord", "admin"), "deletedRecord");
      });

      test("never saved to a record, as in a draft: to the person writing it, and nobody else", async () => {
        expectServed(await ask("neverSaved", "uploader"), "neverSaved");
        expectNotServed(await ask("neverSaved", "admin"), "neverSaved");
        expectNotServed(await ask("neverSaved", "noteReader"), "neverSaved");
      });

      test("the uploader still needs to be able to open the project", async () => {
        expectNotServed(await ask("neverSaved", "outsider"), "neverSaved");
      });
    });

    describe("what was refused before is refused still", () => {
      test("nobody signed in, and a member of another project", async () => {
        expectNotServed(await ask("incident"), "incident");
        expectNotServed(await ask("incident", "outsider"), "incident");
      });

      test("another project's image whose address was copied into one of our incidents", async () => {
        expectNotServed(await ask("theirs", "incidentReader"), "theirs");
        expectNotServed(await ask("theirs", "admin"), "theirs");
        // Its own project's people still open it.
        expectServed(await ask("theirs", "outsider"), "theirs");
      });
    });

    describe("public images, as status pages and forms show them", () => {
      test("anyone gets one, signed in or not, whatever they may read", async () => {
        expectServed(await ask("statusPage"), "statusPage");
        expectServed(await ask("statusPage", "monitorsOnly"), "statusPage");
        expectServed(await ask("statusPage", "outsider"), "statusPage");
      });

      test("cached as before: no private Cache-Control", async () => {
        const answer: HttpAnswer = await ask("statusPage");

        expect(answer.headers["cache-control"]).not.toBe("private, no-cache");
      });

      test("and costs what it did: the public read alone", async () => {
        counter.start();
        await ask("statusPage", "incidentReader");
        const statements: number = counter.stop();

        expect(statements).toBe(1);
        measurements["publicImageStatements"] = statements;
      });
    });

    describe("records written through DatabaseService record their images at once", () => {
      test("a note template created with an image: readers of templates get it", async () => {
        const template: IncidentNoteTemplate = new IncidentNoteTemplate();
        template.projectId = projectId;
        template.templateName = "Customer update";
        template.templateDescription = "What we tell customers";
        template.note = `Here is the graph. ${markdownOf(images["template"]!)}`;

        const created: IncidentNoteTemplate =
          await IncidentNoteTemplateService.create({
            data: template,
            props: { isRoot: true },
          });

        records["template"] = created.id!;

        expect(await shownImageRows("template")).toEqual([
          `IncidentNoteTemplate:${created.id!.toString()}`,
        ]);
        expectServed(await ask("template", "noteReader"), "template");
        expectNotServed(await ask("template", "incidentReader"), "template");
      });

      test("updated to show another image: that one is recorded too", async () => {
        await IncidentNoteTemplateService.updateOneById({
          id: records["template"]!,
          data: {
            note: `Now with the fix. ${markdownOf(images["templateUpdate"]!)}`,
          },
          props: { isRoot: true },
        });

        expect(await shownImageRows("templateUpdate")).toEqual([
          `IncidentNoteTemplate:${records["template"]!.toString()}`,
        ]);
        expectServed(
          await ask("templateUpdate", "noteReader"),
          "templateUpdate",
        );

        // The image it no longer shows keeps its row, and opens nothing.
        expect(await shownImageRows("template")).toEqual([
          `IncidentNoteTemplate:${records["template"]!.toString()}`,
        ]);
        expectNotServed(await ask("template", "noteReader"), "template");
      });

      test("a write that names no image writes no row and sends nothing more", async () => {
        const template: IncidentNoteTemplate = new IncidentNoteTemplate();
        template.projectId = projectId;
        template.templateName = "Plain";
        template.templateDescription = "No pictures";
        template.note = "Words only.";

        counter.start();
        await IncidentNoteTemplateService.create({
          data: template,
          props: { isRoot: true },
        });
        const statements: Array<string> = [...counter.statements];
        counter.stop();

        expect(
          statements.some((statement: string): boolean => {
            return statement.includes('"ShownImage"');
          }),
        ).toBe(false);
      });
    });

    describe("what it costs: a page that draws twenty images of one incident", () => {
      const PAGE_SIZE: number = 20;
      const pageImages: Array<string> = [];

      beforeAll(async () => {
        const uploader: ObjectID = people["uploader"]!;
        const parts: Array<string> = [];

        for (let index: number = 0; index < PAGE_SIZE; index++) {
          const key: string = `page${index}`;
          const image: StoredImage = await insertImage({
            key: key,
            uploadedBy: uploader,
            fill: 100 + index,
          });

          pageImages.push(key);
          parts.push(markdownOf(image, `step ${index}.png`));
        }

        await insertIncident({ key: "page", description: parts.join("\n\n") });

        // A busy project: fifty thousand more incidents, none showing an image.
        await database.query(
          `INSERT INTO "${schema}"."Incident" ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "description", "version") SELECT gen_random_uuid(), $1, 'Incident ' || g, 'incident-busy-' || g, gen_random_uuid(), gen_random_uuid(), 'The checkout page answered 502 for a while. ' || repeat(md5(g::text), 16), 1 FROM generate_series(1, 50000) AS g`,
          [projectId.toString()],
        );
        await database.query(`ANALYZE "${schema}"."Incident"`);

        await database.query(BACKFILL_SHOWN_IMAGES_SQL);
      }, 180_000);

      interface PageDraw {
        // Every statement the page's twenty requests sent.
        statements: number;
        // Of them, the reads of the incident itself.
        incidentReads: number;
        // Of them, the lookups of the records that show an image.
        shownImageLookups: number;
        ms: number;
        statuses: Array<number>;
      }

      // Every image of the page asked for at once, as a browser does.
      const drawPage: (personKey: string) => Promise<PageDraw> = async (
        personKey: string,
      ): Promise<PageDraw> => {
        counter.start();
        const started: number = Date.now();
        const answers: Array<HttpAnswer> = await Promise.all(
          pageImages.map((key: string): Promise<HttpAnswer> => {
            return ask(key, personKey);
          }),
        );
        const ms: number = Date.now() - started;
        const statements: Array<string> = [...counter.statements];
        counter.stop();

        return {
          statements: statements.length,
          incidentReads: statements.filter((statement: string): boolean => {
            return statement.includes('FROM "Incident" "Incident"');
          }).length,
          shownImageLookups: statements.filter((statement: string): boolean => {
            return statement.includes('FROM "ShownImage"');
          }).length,
          ms: ms,
          statuses: answers.map((answer: HttpAnswer): number => {
            return answer.status;
          }),
        };
      };

      test("served to a reader of the incident, refused to a monitor reader", async () => {
        const reader: PageDraw = await drawPage("incidentReader");
        const refused: PageDraw = await drawPage("monitorsOnly");

        expect(reader.statuses).toEqual(
          pageImages.map((): number => {
            return 200;
          }),
        );
        expect(refused.statuses).toEqual(
          pageImages.map((): number => {
            return 404;
          }),
        );
      });

      test("the incident is read once for the whole page, and the page drawn again reads no record", async () => {
        ShownImageAccess.forget();

        // The uploader is decided as main decided every member: no record read.
        const asMainDecided: PageDraw = await drawPage("uploader");

        ShownImageAccess.forget();

        const firstDraw: PageDraw = await drawPage("incidentReader");
        const drawnAgain: PageDraw = await drawPage("incidentReader");

        expect(asMainDecided.shownImageLookups).toBe(0);
        expect(asMainDecided.incidentReads).toBe(0);

        // One lookup of the records that show each image; the incident read once for all twenty.
        expect(firstDraw.shownImageLookups).toBe(PAGE_SIZE);
        expect(firstDraw.incidentReads).toBe(1);

        // Drawn again within half a minute: no lookup, no record read.
        expect(drawnAgain.shownImageLookups).toBe(0);
        expect(drawnAgain.incidentReads).toBe(0);
        expect(drawnAgain.statements).toBeLessThanOrEqual(
          asMainDecided.statements,
        );

        // Generous: the page's twenty requests, end to end, on any runner.
        expect(firstDraw.ms).toBeLessThan(10_000);

        measurements["pageOfTwentyImages"] = {
          busyProjectIncidents: 50_000,
          asMainDecided: { ...asMainDecided, statuses: undefined },
          firstDraw: { ...firstDraw, statuses: undefined },
          drawnAgain: { ...drawnAgain, statuses: undefined },
        } as unknown as JSONObject;
      });

      test("for comparison: finding the records by reading the busy project's incidents instead", async () => {
        // Every record that shows it: one readable by the person may be any of them.
        const started: number = Date.now();
        const rows: Array<{ _id: string }> = await database.query(
          `SELECT "_id" FROM "${schema}"."Incident" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND concat_ws(' ', "description"::text, "rootCause"::text, "postmortemNote"::text, "remediationNotes"::text, "customFields"::text) LIKE $2`,
          [projectId.toString(), `%${images["page0"]!.token}%`],
        );
        const ms: number = Date.now() - started;

        expect(rows.length).toBe(1);

        // One table of the forty-six that can show images, for one image.
        measurements["scanOfIncidentsForOneImageMs"] = ms;

        const lookupStarted: number = Date.now();
        const shown: Array<{ recordId: string }> = await database.query(
          `SELECT "recordId" FROM "${schema}"."ShownImage" WHERE "fileId" = $1 AND "projectId" = $2`,
          [images["page0"]!.id.toString(), projectId.toString()],
        );
        measurements["lookupOfShownImageMs"] = Date.now() - lookupStarted;

        expect(shown.length).toBe(1);
      });
    });
  },
);
