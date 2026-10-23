import AlertAPI from "../../../Server/API/AlertAPI";
import AlertEpisodeAPI from "../../../Server/API/AlertEpisodeAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import IncidentEpisodeAPI from "../../../Server/API/IncidentEpisodeAPI";
import OwnerRulePreviewRoute from "../../../Server/API/OwnerRulePreviewRoute";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import OwnerRulePreviewBuilder from "../../../Server/Utils/Rules/OwnerRulePreviewBuilder";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import OwnerRulePreview, {
  OwnerRulePreviewEvent,
  OwnerRulePreviewResult,
} from "../../../Types/Rules/OwnerRulePreview";
import UserType from "../../../Types/UserType";
import { tenantPermissionsFor } from "./PermissionRows";
/*
 * jest itself is the global one: @jest/globals types spyOn and fn as mocks
 * the global jest.SpyInstance and jest.Mock annotations here do not accept.
 */
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - POST /<event>/owner-rule-preview
 * (Server/API/OwnerRulePreviewRoute): which owner rules would run for an
 * incident, alert or episode being created, and who they would add.
 *
 * Each event's API registers it on its own router, behind the session
 * guards (an idle tab is answered 401 and refreshes - ExpiredSessionRoute
 * Guards.test.ts holds the four routes to that). The handler reads the
 * project from the request's tenant, refuses a caller who may not read the
 * event's owner rules, reads the draft from the body, and answers with the
 * plan's rules as JSON, never cached.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");
const LABEL_ID: string = "30000000-0000-4000-8000-000000000001";

type RouteFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> | void;

interface Registration {
  path: string;
  functions: Array<RouteFunction>;
}

// A router that records what is registered on it.
function recordingRouter(): {
  router: ExpressRouter;
  posts: Array<Registration>;
} {
  const posts: Array<Registration> = [];

  const router: ExpressRouter = {
    post: (path: string, ...functions: Array<RouteFunction>) => {
      posts.push({ path, functions });
    },
  } as unknown as ExpressRouter;

  return { router, posts };
}

const MEMBER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
  userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, [
    Permission.ProjectMember,
  ]),
};

const RESULT: OwnerRulePreviewResult = {
  rules: [
    {
      ruleId: "40000000-0000-4000-8000-000000000001",
      ruleName: "Platform owns checkout",
      userIds: [],
      teamIds: ["50000000-0000-4000-8000-000000000001"],
      creatorTeamIds: ["50000000-0000-4000-8000-000000000001"],
      notifiesOwners: true,
    },
  ],
};

interface Answer {
  sent: jest.SpyInstance;
  noCache: jest.SpyInstance;
  build: jest.SpyInstance;
  next: jest.Mock;
}

/*
 * Registers the route for `event`, then runs its handler with this caller
 * and body, as Express would once the session guards let it through.
 */
async function ask(data: {
  event: OwnerRulePreviewEvent;
  props: DatabaseCommonInteractionProps;
  body: unknown;
}): Promise<Answer> {
  const { router, posts } = recordingRouter();

  OwnerRulePreviewRoute.register({
    router: router,
    apiPath: "/incident",
    event: data.event,
  });

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(data.props);

  const sent: jest.SpyInstance = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((() => {
      return undefined;
    }) as never);
  const noCache: jest.SpyInstance = jest
    .spyOn(Response, "setNoCacheHeaders")
    .mockImplementation((() => {
      return undefined;
    }) as never);
  const build: jest.SpyInstance = jest
    .spyOn(OwnerRulePreviewBuilder, "build")
    .mockResolvedValue(RESULT);

  const next: jest.Mock = jest.fn();
  const handler: RouteFunction = posts[0]!.functions[2]!;

  await handler(
    { body: data.body } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { sent, noCache, build, next };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the owner rule preview route", () => {
  it("is a POST under the event's API path, behind the session guards", () => {
    const { router, posts } = recordingRouter();

    OwnerRulePreviewRoute.register({
      router: router,
      apiPath: "/alert-episode",
      event: OwnerRulePreviewEvent.AlertEpisode,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/alert-episode/owner-rule-preview");
    expect(posts[0]!.functions).toHaveLength(3);
    expect(posts[0]!.functions[0]).toBe(UserMiddleware.getUserMiddleware);
    expect(posts[0]!.functions[1]).toBe(
      UserMiddleware.requireUserAuthentication,
    );
  });

  it("answers with the plan's rules, as JSON, never cached", async () => {
    const answer: Answer = await ask({
      event: OwnerRulePreviewEvent.Incident,
      props: MEMBER,
      body: { title: "Checkout is down", labelIds: [LABEL_ID] },
    });

    expect(answer.next).not.toHaveBeenCalled();
    expect(answer.noCache).toHaveBeenCalledTimes(1);
    expect(answer.sent).toHaveBeenCalledTimes(1);
    expect(answer.sent.mock.calls[0]![2]).toEqual(
      OwnerRulePreview.resultToJSON(RESULT),
    );
  });

  it("works the plan out for the event, in the request's project, from the body", async () => {
    const answer: Answer = await ask({
      event: OwnerRulePreviewEvent.Alert,
      props: MEMBER,
      body: { title: "CPU", labelIds: [LABEL_ID.toUpperCase()] },
    });

    const asked: Record<string, any> = answer.build.mock.calls[0]![0] as never;

    expect(asked["event"]).toBe(OwnerRulePreviewEvent.Alert);
    expect(String(asked["projectId"])).toBe(PROJECT_ID.toString());
    expect(asked["props"]).toBe(MEMBER);
    expect(asked["draft"]).toEqual({
      ...OwnerRulePreview.emptyDraft(),
      title: "CPU",
      labelIds: [LABEL_ID],
    });
  });

  it("refuses a request of no project", async () => {
    const answer: Answer = await ask({
      event: OwnerRulePreviewEvent.Incident,
      props: { ...MEMBER, tenantId: undefined },
      body: {},
    });

    expect(answer.next).toHaveBeenCalledTimes(1);
    expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    expect(answer.build).not.toHaveBeenCalled();
    expect(answer.sent).not.toHaveBeenCalled();
  });

  it("refuses a caller who may not read the event's owner rules, before reading the body", async () => {
    const parse: jest.SpyInstance = jest.spyOn(
      OwnerRulePreviewBuilder,
      "parseDraft",
    );

    const answer: Answer = await ask({
      event: OwnerRulePreviewEvent.Incident,
      props: {
        ...MEMBER,
        userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, [
          Permission.ReadAlertOwnerRule,
        ]),
      },
      body: { title: "Checkout is down" },
    });

    expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(parse).not.toHaveBeenCalled();
    expect(answer.build).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a draft", async () => {
    const answer: Answer = await ask({
      event: OwnerRulePreviewEvent.Incident,
      props: MEMBER,
      body: { labelIds: ["not-an-id"] },
    });

    expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    expect(answer.build).not.toHaveBeenCalled();
  });

  /*
   * A project API key is admitted like a member, its permissions deciding:
   * automation may ask too. It has no creator, so no creator's team.
   */
  it("admits a project API key that may read the rules", async () => {
    const answer: Answer = await ask({
      event: OwnerRulePreviewEvent.IncidentEpisode,
      props: {
        tenantId: PROJECT_ID,
        userType: UserType.API,
        apiKeyId: new ObjectID("60000000-0000-4000-8000-000000000001"),
        userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, [
          Permission.ReadIncidentEpisodeOwnerRule,
        ]),
      },
      body: {},
    });

    expect(answer.next).not.toHaveBeenCalled();
    expect(answer.sent).toHaveBeenCalledTimes(1);
  });
});

describe("each event's API", () => {
  it.each([
    ["IncidentAPI", "/incident", OwnerRulePreviewEvent.Incident],
    ["AlertAPI", "/alert", OwnerRulePreviewEvent.Alert],
    [
      "IncidentEpisodeAPI",
      "/incident-episode",
      OwnerRulePreviewEvent.IncidentEpisode,
    ],
    ["AlertEpisodeAPI", "/alert-episode", OwnerRulePreviewEvent.AlertEpisode],
  ] as Array<[string, string, OwnerRulePreviewEvent]>)(
    "%s registers the preview of its own event, on its own path",
    (name: string, apiPath: string, event: OwnerRulePreviewEvent) => {
      const register: jest.SpyInstance = jest.spyOn(
        OwnerRulePreviewRoute,
        "register",
      );

      const api: { getRouter: () => ExpressRouter } =
        name === "IncidentAPI"
          ? new IncidentAPI()
          : name === "AlertAPI"
            ? new AlertAPI()
            : name === "IncidentEpisodeAPI"
              ? new IncidentEpisodeAPI()
              : new AlertEpisodeAPI();

      expect(register).toHaveBeenCalledTimes(1);

      const registered: Record<string, unknown> = register.mock
        .calls[0]![0] as never;

      expect(registered["apiPath"]).toBe(apiPath);
      expect(registered["event"]).toBe(event);
      expect(registered["router"]).toBe(api.getRouter());

      // The path the dashboard calls is the one registered.
      expect(`${apiPath}/owner-rule-preview`).toBe(
        OwnerRulePreview.getApiPath(event),
      );
    },
  );
});
