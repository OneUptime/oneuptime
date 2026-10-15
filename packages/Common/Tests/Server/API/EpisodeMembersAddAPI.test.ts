import AlertEpisodeMemberAPI from "../../../Server/API/AlertEpisodeMemberAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentEpisodeMemberAPI from "../../../Server/API/IncidentEpisodeMemberAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ALERT_EPISODE_MEMBERS_ADD_PATH,
  EpisodeMembersAddResult,
  INCIDENT_EPISODE_MEMBERS_ADD_PATH,
} from "../../../Types/Episode/EpisodeMembersAdd";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * POST /alert-episode-member/add-alerts and
 * /incident-episode-member/add-incidents: several alerts or incidents added
 * to an episode in one request (EpisodeMembersAdd) - the lists' Add to
 * Existing Episode and an episode's own Add Alerts / Add Incidents.
 *
 * The route is behind a signed-in caller (a person, an API key or an MCP
 * client), must name the project in the tenant header, hands the body to the
 * member service as it came - the service reads and checks it - and answers
 * what happened to every id. EpisodeMembersBulkAdd covers the service.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-a91a-4aaa-8bbb-000000000001",
);
const EPISODE_ID: string = "0193c0de-a91a-4aaa-8bbb-0000000000e1";
const RECORD_1: string = "0193c0de-a91a-4aaa-8bbb-000000000101";
const RECORD_2: string = "0193c0de-a91a-4aaa-8bbb-000000000102";
const RECORD_3: string = "0193c0de-a91a-4aaa-8bbb-000000000103";

interface Kind {
  name: string;
  path: string;
  build: () => void;
  service: unknown;
  method: string;
  episodeIdKey: string;
  idsKey: string;
}

const KINDS: Array<Kind> = [
  {
    name: "alerts",
    path: ALERT_EPISODE_MEMBERS_ADD_PATH,
    build: () => {
      new AlertEpisodeMemberAPI();
    },
    service: AlertEpisodeMemberService,
    method: "addAlertsToEpisode",
    episodeIdKey: "alertEpisodeId",
    idsKey: "alertIds",
  },
  {
    name: "incidents",
    path: INCIDENT_EPISODE_MEMBERS_ADD_PATH,
    build: () => {
      new IncidentEpisodeMemberAPI();
    },
    service: IncidentEpisodeMemberService,
    method: "addIncidentsToEpisode",
    episodeIdKey: "incidentEpisodeId",
    idsKey: "incidentIds",
  },
];

const RESULT: EpisodeMembersAddResult = {
  added: [RECORD_1],
  alreadyInEpisode: [RECORD_2],
  notAdded: [{ id: RECORD_3, reason: "Not found." }],
};

describe.each(KINDS)("POST <member>/add-$name", (kind: Kind) => {
  let request: OneUptimeRequest;
  let response: OneUptimeResponse;
  let next: jest.Mock;
  let props: DatabaseCommonInteractionProps;
  let add: jest.SpyInstance;

  async function post(body: unknown): Promise<void> {
    request.body = body;

    await mockRouter
      .match("post", kind.path)
      .handlerFunction(request, response, next as unknown as NextFunction);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.routes.length = 0;

    kind.build();

    props = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
      userType: UserType.User,
    };

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockImplementation(async () => {
        return props;
      });

    add = jest
      .spyOn(
        kind.service as Record<string, (...args: Array<unknown>) => unknown>,
        kind.method,
      )
      .mockResolvedValue(RESULT as never);

    request = { headers: {} } as unknown as OneUptimeRequest;
    response = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sits under the member model's path, behind a signed-in caller", () => {
    const route: { middlewares: Array<unknown> } | undefined =
      mockRouter.routes.find(
        (candidate: { method: string; uri: string }): boolean => {
          return candidate.method === "POST" && candidate.uri === kind.path;
        },
      ) as { middlewares: Array<unknown> } | undefined;

    expect(route).toBeDefined();
    expect(route!.middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  it("hands the body to the member service, as the caller, and answers each id", async () => {
    await post({
      [kind.episodeIdKey]: EPISODE_ID,
      [kind.idsKey]: [RECORD_1, RECORD_2, RECORD_3],
    });

    expect(add).toHaveBeenCalledWith({
      [kind.episodeIdKey]: EPISODE_ID,
      [kind.idsKey]: [RECORD_1, RECORD_2, RECORD_3],
      props: props,
    });
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      request,
      response,
      {
        added: [RECORD_1],
        alreadyInEpisode: [RECORD_2],
        notAdded: [{ id: RECORD_3, reason: "Not found." }],
      },
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("an API key adds as itself", async () => {
    props = {
      tenantId: PROJECT_ID,
      apiKeyId: ObjectID.generate(),
      userType: UserType.API,
    };

    await post({ [kind.episodeIdKey]: EPISODE_ID, [kind.idsKey]: [RECORD_1] });

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ props: props }));
  });

  it("a request that names no project is refused before the service is asked", async () => {
    delete props.tenantId;

    await post({ [kind.episodeIdKey]: EPISODE_ID, [kind.idsKey]: [RECORD_1] });

    expect(add).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0]![0] as Error).message).toBe(
      "Project ID is required. Please pass the project ID in the 'tenantid' header.",
    );
  });

  it("no body is handed on as empty, for the service to refuse", async () => {
    await post(undefined);

    expect(add).toHaveBeenCalledWith({
      [kind.episodeIdKey]: undefined,
      [kind.idsKey]: undefined,
      props: props,
    });
  });

  it("the service's refusal is the answer", async () => {
    add.mockRejectedValue(
      new BadDataException("Please select at least one to add.") as never,
    );

    await post({ [kind.episodeIdKey]: EPISODE_ID, [kind.idsKey]: [] });

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
