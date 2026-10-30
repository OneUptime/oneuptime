import SecurityCaseEvidenceAPI from "../../../Server/API/SecurityCaseEvidenceAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SecurityCaseEvidenceService from "../../../Server/Services/SecurityCaseEvidenceService";
import SecurityHuntService from "../../../Server/Services/SecurityHuntService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
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
 * POST /security-case-evidence/add-events: security events kept on a case.
 *
 *   - Signed in, a member of the project, with a role that adds evidence to
 *     cases and one that reads security events - what is kept is read from
 *     the events table as them.
 *   - It names a case and the events ({ eventUid, time }), and may name the
 *     hunt that found them; a hunt that is not there, or not one the person
 *     can read, is left out, as a hunt named by another project is.
 *   - It answers the service's { added, alreadyOnCase, notFound }.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

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

const ROUTE: string = "/security-case-evidence/add-events";
const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const CASE_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000138");
const HUNT_ID: ObjectID = new ObjectID("3b000000-0000-4000-8000-000000000001");
const MAYA: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000001");

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: MAYA,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return { _type: "UserPermission", permission, labelIds: [] };
        }),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

const ANALYST: DatabaseCommonInteractionProps = member([
  Permission.ProjectUser,
  Permission.SecurityMember,
]);

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

let propsOf: Spy;
let addEvents: Spy;
let findHunt: Spy;
let sent: Array<JSONObject>;

async function post(body: unknown): Promise<unknown> {
  const route: NonNullable<Layer["route"]> = routeLayer();
  const handler: Handler = route.stack[route.stack.length - 1]!.handle;
  const req: ExpressRequest = {
    body,
    headers: {},
    query: {},
    params: {},
  } as unknown as ExpressRequest;
  let failure: unknown = undefined;

  await handler(
    req,
    {} as ExpressResponse,
    ((error: unknown): void => {
      failure = error;
    }) as NextFunction,
  );

  return failure;
}

const BODY: JSONObject = {
  securityCaseId: CASE_ID.toString(),
  events: [
    { eventUid: "evt-1", time: "2026-10-28T22:42:00.000Z" },
    { eventUid: "evt-2", time: "2026-10-28T23:00:00.000Z" },
  ],
  securityHuntId: HUNT_ID.toString(),
};

beforeEach(() => {
  sent = [];
  propsOf = getJestSpyOn(
    CommonAPI,
    "getDatabaseCommonInteractionProps",
  ).mockResolvedValue(ANALYST as never);
  addEvents = getJestSpyOn(
    SecurityCaseEvidenceService,
    "addEvents",
  ).mockResolvedValue({
    added: ["evt-1"],
    alreadyOnCase: ["evt-2"],
    notFound: [],
  } as never);

  const hunt: SecurityHunt = new SecurityHunt();
  hunt._id = HUNT_ID.toString();
  hunt.name = "Encoded PowerShell";
  findHunt = getJestSpyOn(SecurityHuntService, "findOneBy").mockResolvedValue(
    hunt as never,
  );
  getJestSpyOn(Response, "sendJsonObjectResponse").mockImplementation(((
    _req: ExpressRequest,
    _res: ExpressResponse,
    object: JSONObject,
  ): void => {
    sent.push(object);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /security-case-evidence/add-events", () => {
  test("is a POST that runs the signed-in user's middleware and requires a session", () => {
    const route: NonNullable<Layer["route"]> = routeLayer();

    expect(route.methods["post"]).toBe(true);
    expect(route.stack[0]!.handle).toBe(UserMiddleware.getUserMiddleware);
    expect(route.stack[1]!.handle).toBe(
      UserMiddleware.requireUserAuthentication,
    );
  });

  test("keeps the events as the person asking, naming the hunt as they can read it, and answers what happened to each", async () => {
    expect(await post(BODY)).toBeUndefined();

    expect(addEvents).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      events: [
        { eventUid: "evt-1", time: new Date("2026-10-28T22:42:00.000Z") },
        { eventUid: "evt-2", time: new Date("2026-10-28T23:00:00.000Z") },
      ],
      hunt: { id: HUNT_ID.toString(), name: "Encoded PowerShell" },
      props: ANALYST,
    });

    const huntRead: Record<string, unknown> = findHunt.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(huntRead["query"]).toEqual({ _id: HUNT_ID, projectId: PROJECT_ID });
    expect(huntRead["props"]).toBe(ANALYST);
    expect(sent).toEqual([
      { added: ["evt-1"], alreadyOnCase: ["evt-2"], notFound: [] },
    ]);
  });

  test("leaves out a hunt that is not there, not the person's to read, or not an id", async () => {
    findHunt.mockResolvedValue(null as never);
    await post(BODY);
    await post({ ...BODY, securityHuntId: "not-an-id" });
    await post({ ...BODY, securityHuntId: undefined });

    for (const call of addEvents.mock.calls) {
      expect((call[0] as { hunt: unknown }).hunt).toBeNull();
    }
    // Only the id that is one was looked up.
    expect(findHunt).toHaveBeenCalledTimes(1);
  });

  test("names a case, and the events to keep", async () => {
    expect(await post({ ...BODY, securityCaseId: "CASE-138" })).toEqual(
      new BadDataException("Choose the case to keep the events on."),
    );
    expect(await post({ ...BODY, events: [] })).toEqual(
      new BadDataException("Choose the events to keep on the case."),
    );
    expect(
      await post({ ...BODY, events: [{ eventUid: "evt-1", time: "soon" }] }),
    ).toEqual(new BadDataException("Choose the events to keep on the case."));
    expect(await post("evt-1")).toEqual(
      new BadDataException("Choose the case to keep the events on."),
    );
    expect(addEvents).not.toHaveBeenCalled();
  });

  test("takes a role that adds evidence to cases", async () => {
    propsOf.mockResolvedValue(
      member([Permission.ProjectUser, Permission.ReadSecurityEvent]) as never,
    );

    expect(await post(BODY)).toEqual(
      new NotAuthorizedException(
        "Keeping events on a case takes a role that can add evidence to cases.",
      ),
    );
    expect(addEvents).not.toHaveBeenCalled();
  });

  test("and one that reads security events", async () => {
    propsOf.mockResolvedValue(
      member([
        Permission.ProjectUser,
        Permission.CreateSecurityCaseEvidence,
      ]) as never,
    );

    expect(await post(BODY)).toEqual(
      new NotAuthorizedException(
        "Keeping events on a case takes a role that can read security events.",
      ),
    );
    expect(addEvents).not.toHaveBeenCalled();
  });

  test("refuses somebody who is not a member of the project", async () => {
    propsOf.mockResolvedValue({
      userId: MAYA,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {},
    } as never);

    expect(await post(BODY)).toBeInstanceOf(NotAuthorizedException);
    expect(addEvents).not.toHaveBeenCalled();
  });
});
