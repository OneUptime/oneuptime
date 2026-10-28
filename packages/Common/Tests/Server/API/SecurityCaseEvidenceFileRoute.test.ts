import SecurityCaseEvidenceAPI, {
  EVIDENCE_FILE_NOT_FOUND_MESSAGE,
} from "../../../Server/API/SecurityCaseEvidenceAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SecurityCaseEvidenceService from "../../../Server/Services/SecurityCaseEvidenceService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import FileOwnership from "../../../Server/Utils/File/FileOwnership";
import Response from "../../../Server/Utils/Response";
import File from "../../../Models/DatabaseModels/File";
import SecurityCaseEvidence from "../../../Models/DatabaseModels/SecurityCaseEvidence";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * GET /security-case-evidence/file/:projectId/:evidenceId: a security
 * case's evidence file, downloaded.
 *
 *   - It runs the signed-in user's middleware, and reads the evidence as
 *     the person asking - never as OneUptime - so only whoever can read the
 *     case gets its files.
 *   - It sends the evidence's own file, uploaded in the evidence's own
 *     project, uncached, through the one file response (a download, behind
 *     a sandboxing policy).
 *   - Evidence that is not there, a link, a file of another project, a
 *     malformed id: the same 404, word for word.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const EVIDENCE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const FILE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const USER_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
const ROUTE: string = "/security-case-evidence/file/:projectId/:evidenceId";

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => unknown;

interface Layer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Handler }>;
  };
}

const CALLER: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

let evidence: SecurityCaseEvidence | null;
let fileProjectId: ObjectID | null;
let evidenceReads: Array<JSONObject>;
let sentFiles: Array<File>;
let uncached: number;

function routeLayer(): NonNullable<Layer["route"]> {
  const api: SecurityCaseEvidenceAPI = new SecurityCaseEvidenceAPI();
  const layers: Array<Layer> = (
    api.getRouter() as unknown as { stack: Array<Layer> }
  ).stack;
  const layer: Layer | undefined = layers.find((candidate: Layer): boolean => {
    return candidate.route?.path === ROUTE;
  });

  expect(layer?.route).toBeDefined();
  return layer!.route!;
}

async function download(
  evidenceId: string = EVIDENCE_ID.toString(),
): Promise<unknown> {
  const route: NonNullable<Layer["route"]> = routeLayer();
  const handler: Handler = route.stack[route.stack.length - 1]!.handle;
  const req: ExpressRequest = {
    params: { projectId: PROJECT_ID.toString(), evidenceId },
    headers: {},
    query: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as unknown as ExpressResponse;
  let failure: unknown = undefined;

  await handler(req, res, ((error: unknown): void => {
    failure = error;
  }) as NextFunction);

  return failure;
}

function storedEvidence(): SecurityCaseEvidence {
  const file: File = new File();
  file._id = FILE_ID.toString();
  file.name = "proxy.pcap";
  file.fileType = MimeType.png;
  file.file = Buffer.from("hello");

  const model: SecurityCaseEvidence = new SecurityCaseEvidence();
  model._id = EVIDENCE_ID.toString();
  model.projectId = PROJECT_ID;
  model.fileId = FILE_ID;
  model.file = file;
  return model;
}

beforeEach(() => {
  evidence = storedEvidence();
  fileProjectId = PROJECT_ID;
  evidenceReads = [];
  sentFiles = [];
  uncached = 0;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(CALLER as never);
  jest
    .spyOn(SecurityCaseEvidenceService, "findOneBy")
    .mockImplementation(async (args: unknown) => {
      evidenceReads.push(args as JSONObject);
      return evidence as never;
    });
  jest
    .spyOn(FileOwnership, "readFileOwners")
    .mockImplementation(async (fileIds: Array<ObjectID>) => {
      return new Map(
        fileIds.map((fileId: ObjectID) => {
          return [
            fileId.toString().toLowerCase(),
            { projectId: fileProjectId, createdByUserId: USER_ID },
          ];
        }),
      );
    });
  jest.spyOn(Response, "setNoCacheHeaders").mockImplementation((() => {
    uncached++;
  }) as never);
  jest.spyOn(Response, "sendFileResponse").mockImplementation(((
    _req: ExpressRequest,
    _res: ExpressResponse,
    file: File,
  ) => {
    sentFiles.push(file);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("downloading a security case's evidence file", () => {
  test("is a GET behind the signed-in user's middleware", () => {
    const route: NonNullable<Layer["route"]> = routeLayer();

    expect(route.methods["get"]).toBe(true);
    expect(route.stack[0]!.handle).toBe(UserMiddleware.getUserMiddleware);
  });

  test("reads the evidence as the person asking, and sends its own file, uncached", async () => {
    expect(await download()).toBeUndefined();

    expect(evidenceReads).toHaveLength(1);
    expect(evidenceReads[0]!["props"]).toBe(CALLER);
    expect(evidenceReads[0]!["query"]).toEqual({ _id: EVIDENCE_ID });
    expect(sentFiles).toHaveLength(1);
    expect(sentFiles[0]!.name).toBe("proxy.pcap");
    expect(uncached).toBe(1);
  });

  test("evidence the person cannot read, or that is not there: 404", async () => {
    evidence = null;

    const failure: unknown = await download();

    expect(failure).toBeInstanceOf(NotFoundException);
    expect((failure as Error).message).toBe(EVIDENCE_FILE_NOT_FOUND_MESSAGE);
    expect(sentFiles).toEqual([]);
  });

  test("a link has no file to send: the same 404", async () => {
    evidence!.fileId = undefined;
    evidence!.file = undefined;

    expect((await download()) as Error).toEqual(
      new NotFoundException(EVIDENCE_FILE_NOT_FOUND_MESSAGE),
    );
    expect(sentFiles).toEqual([]);
  });

  test("a file uploaded in another project, or in none: the same 404", async () => {
    fileProjectId = OTHER_PROJECT_ID;
    expect((await download()) as Error).toEqual(
      new NotFoundException(EVIDENCE_FILE_NOT_FOUND_MESSAGE),
    );

    fileProjectId = null;
    expect((await download()) as Error).toEqual(
      new NotFoundException(EVIDENCE_FILE_NOT_FOUND_MESSAGE),
    );
    expect(sentFiles).toEqual([]);
  });

  test("a malformed id: the same 404, and nothing read", async () => {
    expect((await download("not-an-id")) as Error).toEqual(
      new NotFoundException(EVIDENCE_FILE_NOT_FOUND_MESSAGE),
    );
    expect(evidenceReads).toEqual([]);
  });
});
