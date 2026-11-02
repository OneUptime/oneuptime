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

import CustomFieldFileAPI from "../../../Server/API/CustomFieldFileAPI";
import AlertService from "../../../Server/Services/AlertService";
import FileService from "../../../Server/Services/FileService";
import IncidentService from "../../../Server/Services/IncidentService";
import ProjectService from "../../../Server/Services/ProjectService";
import Response from "../../../Server/Utils/Response";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import File from "../../../Models/DatabaseModels/File";
import Incident from "../../../Models/DatabaseModels/Incident";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { getCustomFieldRecordKind } from "../../../Types/CustomField/CustomFieldRecordKinds";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A FILE A RECORD'S FILE CUSTOM FIELD HOLDS, DOWNLOADED.
 *
 *   GET /api/custom-field-file/:projectId/:recordKind/:recordId/:fileId
 *
 * Served only to someone who may read the record (it is read as the
 * caller), only while one of the record's File or Multiple files fields
 * holds the file, only when the file is of the record's project, and always
 * as a download - a picture too. Everything else reads as a file that is
 * not there. Driven through a real Express app with the production error
 * handler; only the data layer is stubbed.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const INCIDENT_ID: string = "eeeeeeee-0000-4000-8000-000000000001";

const CONTRACT_FILE: string = "f0000000-0000-4000-8000-000000000001";
const PHOTO_FILE: string = "f0000000-0000-4000-8000-000000000002";
const FOREIGN_FILE: string = "f0000000-0000-4000-8000-000000000003";
const TEXT_FIELD_ID: string = "f0000000-0000-4000-8000-000000000004";
const NOT_HELD_FILE: string = "f0000000-0000-4000-8000-000000000005";

const PDF_BYTES: Buffer = Buffer.from("%PDF-1.7 the contract");
const PNG_BYTES: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

interface HttpResult {
  status: number;
  text: string;
  headers: http.IncomingHttpHeaders;
}

function send(port: number, path: string): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: path,
          method: "GET",
          headers: { tenantid: "" },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              text: Buffer.concat(chunks).toString("utf8"),
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

function stored(
  fileId: string,
  name: string,
  fileType: string,
): Dictionary<unknown> {
  return { fileId, name, fileType, size: 10 };
}

function storedFile(data: {
  id: string;
  bytes: Buffer;
  name: string;
  fileType: MimeType;
  projectId: string;
}): File {
  const file: File = new File();
  file._id = data.id;
  file.file = data.bytes;
  file.name = data.name;
  file.fileType = data.fileType;
  file.projectId = new ObjectID(data.projectId);
  return file;
}

const FILES: Dictionary<File> = {
  [CONTRACT_FILE]: storedFile({
    id: CONTRACT_FILE,
    bytes: PDF_BYTES,
    name: "contract.pdf",
    fileType: MimeType.pdf,
    projectId: PROJECT_ID,
  }),
  [PHOTO_FILE]: storedFile({
    id: PHOTO_FILE,
    bytes: PNG_BYTES,
    name: "rack photo.png",
    fileType: MimeType.png,
    projectId: PROJECT_ID,
  }),
  // Held from before the checks, of another project: never served.
  [FOREIGN_FILE]: storedFile({
    id: FOREIGN_FILE,
    bytes: Buffer.from("%PDF-1.7 theirs"),
    name: "theirs.pdf",
    fileType: MimeType.pdf,
    projectId: OTHER_PROJECT_ID,
  }),
  [NOT_HELD_FILE]: storedFile({
    id: NOT_HELD_FILE,
    bytes: Buffer.from("%PDF-1.7 not held"),
    name: "other.pdf",
    fileType: MimeType.pdf,
    projectId: PROJECT_ID,
  }),
};

describe("downloading a file custom field's file", () => {
  let server: http.Server;
  let port: number;
  let incidentReads: Array<Dictionary<unknown>>;
  let readable: boolean;
  let refuses: boolean;
  let fileReads: number;

  beforeAll(async () => {
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Enterprise,
      isSubscriptionUnpaid: false,
    } as never);
    jest
      .spyOn(ProjectService, "updateLastActive")
      .mockResolvedValue(undefined as never);

    jest.spyOn(IncidentService, "findOneBy").mockImplementation((async (
      data: Dictionary<unknown>,
    ) => {
      incidentReads.push(data);

      if (refuses) {
        throw new NotAuthorizedException(
          "You do not have permissions to read Incident.",
        );
      }

      if (!readable) {
        return null;
      }

      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID;
      incident.projectId = new ObjectID(PROJECT_ID);
      incident.customFields = {
        Contract: stored(CONTRACT_FILE, "contract.pdf", MimeType.pdf),
        Photos: [
          stored(PHOTO_FILE, "rack photo.png", MimeType.png),
          stored(FOREIGN_FILE, "theirs.pdf", MimeType.pdf),
        ],
        // A text field holding something that looks like a file.
        Notes: stored(TEXT_FIELD_ID, "x.pdf", MimeType.pdf),
      } as never;
      return incident;
    }) as never);

    jest.spyOn(IncidentService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string): Promise<unknown> => {
          if (sql.startsWith('SELECT "name", "customFieldType"')) {
            return [
              { name: "Contract", customFieldType: CustomFieldType.File },
              {
                name: "Photos",
                customFieldType: CustomFieldType.MultipleFiles,
              },
            ];
          }

          return [];
        },
      },
    } as never);

    jest.spyOn(FileService, "findOneBy").mockImplementation((async (data: {
      query: Dictionary<unknown>;
    }) => {
      fileReads++;
      return FILES[String(data.query["_id"])] || null;
    }) as never);

    const app: express.Express = express();
    app.use(CookieParser());
    app.use("/api", new CustomFieldFileAPI().getRouter());
    app.use(expressErrorHandler);

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    incidentReads = [];
    readable = true;
    refuses = false;
    fileReads = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });

    jest.restoreAllMocks();
  });

  const path: (fileId: string, kind?: string, projectId?: string) => string = (
    fileId: string,
    kind: string = "incident",
    projectId: string = PROJECT_ID,
  ): string => {
    return `/api/custom-field-file/${projectId}/${kind}/${INCIDENT_ID}/${fileId}`;
  };

  it("serves a file a File field holds, as a download, never cached", async () => {
    const result: HttpResult = await send(port, path(CONTRACT_FILE));

    expect(result.status).toBe(200);
    expect(result.text).toBe(PDF_BYTES.toString("utf8"));
    expect(result.headers["content-type"]).toBe(MimeType.pdf);
    expect(String(result.headers["content-disposition"])).toBe(
      Response.getContentDisposition("attachment", "contract.pdf"),
    );
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(result.headers["content-security-policy"])).toContain(
      "sandbox",
    );
    expect(String(result.headers["cache-control"])).toContain("no-store");
  });

  it("a picture is a download too, never shown in the page", async () => {
    const result: HttpResult = await send(port, path(PHOTO_FILE));

    expect(result.status).toBe(200);
    expect(
      String(result.headers["content-disposition"]).startsWith("attachment;"),
    ).toBe(true);
    expect(String(result.headers["content-disposition"])).toContain(
      "filename*=UTF-8''rack%20photo.png",
    );
  });

  it("reads the record as the caller, in the project the address names", async () => {
    await send(port, path(CONTRACT_FILE));

    expect(incidentReads).toHaveLength(1);
    expect(
      String((incidentReads[0]!["query"] as Dictionary<unknown>)["_id"]),
    ).toBe(INCIDENT_ID);
    expect(
      String((incidentReads[0]!["query"] as Dictionary<unknown>)["projectId"]),
    ).toBe(PROJECT_ID);
    expect(incidentReads[0]!["select"]).toEqual({
      _id: true,
      projectId: true,
      customFields: true,
    });
    // Not as root: what the caller may not read is not there for them.
    expect(
      (incidentReads[0]!["props"] as Dictionary<unknown>)["isRoot"],
    ).toBeFalsy();
  });

  it("a record the caller may not read gives no file, whatever its id", async () => {
    readable = false;

    const result: HttpResult = await send(port, path(CONTRACT_FILE));

    expect(result.status).toBe(404);
    expect(result.text).not.toContain("the contract");
    expect(fileReads).toBe(0);
  });

  it("a refusal to read the record is not turned into the file", async () => {
    refuses = true;

    const result: HttpResult = await send(port, path(CONTRACT_FILE));

    expect(result.status).not.toBe(200);
    expect(result.text).not.toContain("the contract");
    expect(fileReads).toBe(0);
  });

  it("a file no file field of the record holds is not there: another record's, or one a text field names", async () => {
    for (const fileId of [NOT_HELD_FILE, TEXT_FIELD_ID]) {
      const result: HttpResult = await send(port, path(fileId));

      expect(result.status).toBe(404);
    }

    expect(fileReads).toBe(0);
  });

  it("a file of another project is not served, though the record holds it", async () => {
    const foreign: HttpResult = await send(port, path(FOREIGN_FILE));
    const missing: HttpResult = await send(port, path(NOT_HELD_FILE));

    expect(foreign.status).toBe(404);
    expect(foreign.text).toBe(missing.text);
    expect(foreign.text).not.toContain("theirs");
  });

  it("an address that names no kind of record, or no ids, reads nothing", async () => {
    for (const address of [
      path(CONTRACT_FILE, "label"),
      path(CONTRACT_FILE, "Incident"),
      path("not-a-file"),
      path(CONTRACT_FILE, "incident", "not-a-project"),
    ]) {
      const result: HttpResult = await send(port, address);
      expect(result.status).toBe(404);
    }

    expect(incidentReads).toHaveLength(0);
    expect(fileReads).toBe(0);
  });

  it("every kind of record is served by its own service", () => {
    expect(
      CustomFieldFileAPI.getRecordService(
        getCustomFieldRecordKind("Incident")!,
      ),
    ).toBe(IncidentService);
    expect(
      CustomFieldFileAPI.getRecordService(getCustomFieldRecordKind("Alert")!),
    ).toBe(AlertService);
  });
});
