import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import PublicNoteApprovalRoutes, {
  PUBLIC_NOTE_APPROVAL_SUMMARY_LIMIT,
} from "../../../Server/API/PublicNoteApprovalRoutes";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalHost,
  PublicNoteKind,
} from "../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
  PublicNoteApprovalDecision,
  PublicNoteApprovalEventType,
  PublicNoteApprovalState,
} from "../../../Types/StatusPage/PublicNoteApproval";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The public note approval routes (issue #5720): approving and rejecting
 * take a signed-in person who is a member of the project - an approver is a
 * person, never an API key; sending a note again and withdrawing an edit
 * take whoever may edit it; the reads take a member who can read the notes.
 * What each route reads from the request is checked before the engine sees
 * it.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<unknown>;

interface Route {
  path: string;
  middleware: unknown;
  handler: Handler;
}

const BASE: string = "/incident-public-note";
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOTE_ID: string = "44444444-4444-4444-8444-444444444444";
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

let routes: Array<Route>;
let props: DatabaseCommonInteractionProps;

const HOST: PublicNoteApprovalHost<IncidentPublicNote> = {
  kind: PublicNoteKind.Incident,
  eventType: PublicNoteApprovalEventType.Incident,
  modelType: IncidentPublicNote,
} as unknown as PublicNoteApprovalHost<IncidentPublicNote>;

function member(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          {
            permission: Permission.ProjectMember,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    } as never,
  };
}

function apiKey(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userType: UserType.API,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          {
            permission: Permission.ProjectOwner,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    } as never,
  };
}

function route(path: string): Route {
  const found: Route | undefined = routes.find((candidate: Route) => {
    return candidate.path === `${BASE}${path}`;
  });

  expect(found).toBeDefined();
  return found!;
}

async function call(
  path: string,
  request: { params?: Record<string, string>; body?: unknown },
): Promise<{ error: unknown; answered: unknown }> {
  let error: unknown = undefined;

  await route(path).handler(
    { params: request.params || {}, body: request.body } as never,
    {} as never,
    ((thrown: unknown): void => {
      error = thrown;
    }) as never,
  );

  const sent: jest.Mock = Response.sendJsonObjectResponse as unknown as jest.Mock;

  return {
    error,
    answered: sent.mock.calls.length > 0 ? sent.mock.calls[0]![2] : undefined,
  };
}

beforeEach(() => {
  routes = [];
  props = member();

  const router: ExpressRouter = {
    post: (path: string, middleware: unknown, handler: Handler): void => {
      routes.push({ path, middleware, handler });
    },
  } as unknown as ExpressRouter;

  PublicNoteApprovalRoutes.register({
    router,
    basePath: BASE,
    getHost: () => {
      return HOST;
    },
  });

  getJestSpyOn(CommonAPI, "getDatabaseCommonInteractionProps").mockImplementation(
    (async () => {
      return props;
    }) as never,
  );
  getJestSpyOn(Response, "sendJsonObjectResponse").mockImplementation(
    (() => {
      return undefined;
    }) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PublicNoteApprovalRoutes.register", () => {
  test("adds the six routes, each behind the user middleware", () => {
    expect(
      routes.map((registered: Route) => {
        return registered.path;
      }),
    ).toEqual([
      `${BASE}/:noteId/approve`,
      `${BASE}/:noteId/reject`,
      `${BASE}/:noteId/resubmit`,
      `${BASE}/:noteId/discard-edit`,
      `${BASE}/approval/notes`,
      `${BASE}/approval/policy`,
    ]);

    for (const registered of routes) {
      expect(registered.middleware).toBe(UserMiddleware.getUserMiddleware);
    }
  });
});

describe("approving and rejecting", () => {
  test("a member approves, with a comment trimmed to what a decision keeps", async () => {
    const decide: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "decide",
    ).mockResolvedValue({
      noteId: NOTE_ID,
      state: PublicNoteApprovalState.Published,
      isPublished: true,
    });

    const { error, answered } = await call("/:noteId/approve", {
      params: { noteId: NOTE_ID },
      body: {
        comment: `  ${"x".repeat(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH + 10)}  `,
      },
    });

    expect(error).toBeUndefined();
    expect(answered).toEqual({
      noteId: NOTE_ID,
      state: PublicNoteApprovalState.Published,
      isPublished: true,
    });

    const args: any = decide.mock.calls[0]![0];
    expect(args.host).toBe(HOST);
    expect(args.noteId.toString()).toBe(NOTE_ID);
    expect(args.decision).toBe(PublicNoteApprovalDecision.Approve);
    expect(args.props).toBe(props);
    expect(args.text).toHaveLength(PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH);
  });

  test("a rejection's reason is read from reason", async () => {
    const decide: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "decide",
    ).mockResolvedValue({
      noteId: NOTE_ID,
      state: PublicNoteApprovalState.Rejected,
      isPublished: false,
    });

    await call("/:noteId/reject", {
      params: { noteId: NOTE_ID },
      body: { reason: " Do not name the vendor. ", comment: "not this" },
    });

    const args: any = decide.mock.calls[0]![0];
    expect(args.decision).toBe(PublicNoteApprovalDecision.Reject);
    expect(args.text).toBe("Do not name the vendor.");
  });

  test("an API key cannot approve or reject: an approver is a person", async () => {
    props = apiKey();
    const decide: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "decide",
    );

    for (const path of ["/:noteId/approve", "/:noteId/reject"]) {
      const { error } = await call(path, {
        params: { noteId: NOTE_ID },
        body: { reason: "x" },
      });

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toContain("approvers are people");
    }

    expect(decide).not.toHaveBeenCalled();
  });

  test("a person who is not a member of the project cannot", async () => {
    props = { ...member(), userTenantAccessPermission: {} };
    const decide: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "decide",
    );

    const { error } = await call("/:noteId/approve", {
      params: { noteId: NOTE_ID },
    });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(decide).not.toHaveBeenCalled();
  });

  test("a note ID that is not one, and a reason that is not text, are refused before anything is read", async () => {
    const decide: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "decide",
    );

    expect(
      (await call("/:noteId/approve", { params: { noteId: "nope" } })).error,
    ).toBeInstanceOf(BadDataException);
    expect(
      (
        await call("/:noteId/reject", {
          params: { noteId: NOTE_ID },
          body: { reason: { $ne: "" } },
        })
      ).error,
    ).toBeInstanceOf(BadDataException);
    expect(decide).not.toHaveBeenCalled();
  });
});

describe("sending again and withdrawing an edit", () => {
  test("take whoever may edit the note: a member, or the project's API key", async () => {
    const resubmit: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "resubmit",
    ).mockResolvedValue({
      noteId: NOTE_ID,
      state: PublicNoteApprovalState.WaitingForApproval,
      isPublished: false,
    });
    const discardEdit: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "discardEdit",
    ).mockResolvedValue({
      noteId: NOTE_ID,
      state: PublicNoteApprovalState.Published,
      isPublished: true,
    });

    for (const caller of [member(), apiKey()]) {
      props = caller;

      expect(
        (await call("/:noteId/resubmit", { params: { noteId: NOTE_ID } }))
          .error,
      ).toBeUndefined();
      expect(
        (await call("/:noteId/discard-edit", { params: { noteId: NOTE_ID } }))
          .error,
      ).toBeUndefined();
    }

    expect(resubmit).toHaveBeenCalledTimes(2);
    expect(discardEdit).toHaveBeenCalledTimes(2);
  });

  test("not somebody signed out", async () => {
    props = { tenantId: PROJECT_ID };
    const resubmit: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "resubmit",
    );

    expect(
      (await call("/:noteId/resubmit", { params: { noteId: NOTE_ID } })).error,
    ).toBeDefined();
    expect(resubmit).not.toHaveBeenCalled();
  });
});

describe("where notes stand, and who approves", () => {
  test("reads each note asked about once, up to a page of them", async () => {
    const describeNotes: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "describeNotes",
    ).mockResolvedValue([]);

    const { error, answered } = await call("/approval/notes", {
      body: { noteIds: [NOTE_ID, NOTE_ID] },
    });

    expect(error).toBeUndefined();
    expect(answered).toEqual({ notes: [] });

    const args: any = describeNotes.mock.calls[0]![0];
    expect(
      args.noteIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([NOTE_ID]);
    expect(args.projectId).toEqual(PROJECT_ID);
  });

  test("refuses a list that is not one, holds something else, or is longer than a page", async () => {
    const describeNotes: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "describeNotes",
    );

    for (const body of [
      {},
      { noteIds: NOTE_ID },
      { noteIds: [NOTE_ID, "nope"] },
      { noteIds: [42] },
      {
        noteIds: new Array(PUBLIC_NOTE_APPROVAL_SUMMARY_LIMIT + 1).fill(
          NOTE_ID,
        ),
      },
    ]) {
      expect((await call("/approval/notes", { body })).error).toBeInstanceOf(
        BadDataException,
      );
    }

    expect(describeNotes).not.toHaveBeenCalled();
  });

  test("who approves is told to those who can read the notes", async () => {
    const describePolicy: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalEngine,
      "describePolicy",
    ).mockResolvedValue({ isRequired: true, steps: [] } as never);

    expect((await call("/approval/policy", {})).error).toBeUndefined();
    expect(describePolicy).toHaveBeenCalledTimes(1);

    // A member whose role reads nothing of incidents.
    props = {
      ...member(),
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          permissions: [
            {
              permission: Permission.ReadAlert,
              labelIds: [],
              isBlockPermission: false,
            },
          ],
        },
      } as never,
    };

    const { error } = await call("/approval/policy", {});

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(describePolicy).toHaveBeenCalledTimes(1);
  });
});
