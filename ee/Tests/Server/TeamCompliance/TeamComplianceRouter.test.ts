import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import TeamComplianceArea from "../../../Server/TeamCompliance/Index";
import TeamComplianceAPI, {
  TEAM_COMPLIANCE_STATUS_ROUTE,
} from "../../../Server/TeamCompliance/TeamComplianceAPI";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  createExpressApp,
} from "Common/Server/Utils/Express";
import Team from "Common/Models/DatabaseModels/Team";
import ObjectID from "Common/Types/ObjectID";

/*
 * The team compliance router as REAL express sees it.
 *
 * Core mounts every router the enterprise module hands it at "/api", next to
 * core's own routers. Two properties make that safe, and both are pinned here
 * against the real router object (TeamComplianceAPI.test.ts covers the
 * handler's behaviour with a recording router instead):
 *
 *   - routes only: no router.use() layer, which would run for every request
 *     under "/api" - core's included;
 *   - exactly the one path the Dashboard requests, so none of core's Team
 *     routes can be answered by this router.
 */

interface ExpressRouteLike {
  path: string;
  methods: Record<string, boolean>;
  stack: Array<{ handle: unknown }>;
}

interface ExpressLayerLike {
  route?: ExpressRouteLike | undefined;
  match: (path: string) => boolean;
}

const layersOf: (router: ExpressRouter) => Array<ExpressLayerLike> = (
  router: ExpressRouter,
): Array<ExpressLayerLike> => {
  return (router as unknown as { stack: Array<ExpressLayerLike> }).stack;
};

const TEAM_ID: string = ObjectID.generate().toString();

// The mount prefix core strips before a mounted router sees the path.
const API_PREFIX: RegExp = /^\/api/;

describe("the TeamCompliance area", () => {
  test("hands core exactly one API router: the compliance status router", () => {
    const routers: Array<ExpressRouter> = TeamComplianceArea.getApiRouters!();

    expect(routers).toHaveLength(1);
    expect(routers[0]).toBe(TeamComplianceAPI);
  });

  test("hands the same router every time it is asked", () => {
    expect(TeamComplianceArea.getApiRouters!()[0]).toBe(
      TeamComplianceArea.getApiRouters!()[0],
    );
  });

  test("contributes no identity routers and no worker jobs", () => {
    expect(TeamComplianceArea.name).toBe("TeamCompliance");
    expect(TeamComplianceArea.getIdentityRouters).toBeUndefined();
    expect(TeamComplianceArea.registerWorkerJobs).toBeUndefined();
  });
});

describe("the compliance status router", () => {
  test("holds routes only - no router.use() layer that could shadow core", () => {
    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(TeamComplianceAPI),
    ).toEqual([]);
  });

  test("holds exactly one route: GET /team/compliance-status/:teamId", () => {
    const layers: Array<ExpressLayerLike> = layersOf(TeamComplianceAPI);

    expect(layers).toHaveLength(1);
    expect(layers[0]!.route!.path).toBe("/team/compliance-status/:teamId");
    expect(layers[0]!.route!.methods).toEqual({ get: true });
  });

  test("the path is Team's CRUD path plus /compliance-status/:teamId, as it always was", () => {
    expect(TEAM_COMPLIANCE_STATUS_ROUTE).toBe(
      `${new Team().getCrudApiPath()!.toString()}/compliance-status/:teamId`,
    );
  });

  test("runs the user middleware first, then the handler", () => {
    const stack: Array<{ handle: unknown }> =
      layersOf(TeamComplianceAPI)[0]!.route!.stack;

    expect(stack).toHaveLength(2);
    expect(stack[0]!.handle).toBe(UserMiddleware.getUserMiddleware);
  });

  test.each([
    `/team/compliance-status/${TEAM_ID}`,
    "/team/compliance-status/not-a-uuid",
  ])("answers %s", (path: string) => {
    expect(layersOf(TeamComplianceAPI)[0]!.match(path)).toBe(true);
  });

  test.each([
    "/team/get-list",
    "/team/count",
    "/team",
    `/team/${TEAM_ID}/get-item`,
    `/team/${TEAM_ID}`,
    "/team/compliance-status",
    `/team/compliance-status/${TEAM_ID}/extra`,
    `/team-member/compliance-status/${TEAM_ID}`,
    `/on-call-readiness/user/${TEAM_ID}`,
  ])("leaves %s to core", (path: string) => {
    expect(layersOf(TeamComplianceAPI)[0]!.match(path)).toBe(false);
  });
});

describe("mounted at /api ahead of a core router, like BaseAPI mounts it", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();

    app.use("/api", TeamComplianceAPI);

    // Stands in for core's routers mounted after the enterprise ones.
    app.use("/api", (req: ExpressRequest, res: ExpressResponse): void => {
      res.status(200).json({ servedBy: "core", path: req.path });
    });

    await new Promise<void>((resolve: () => void) => {
      server = app.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    const address: AddressInfo = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  test.each([
    ["GET", "/api/team/get-list"],
    ["POST", "/api/team/get-list"],
    ["POST", `/api/team/${TEAM_ID}/get-item`],
    ["GET", "/api/team/compliance-status"],
    ["POST", `/api/team/compliance-status/${TEAM_ID}`],
    ["GET", "/api/global-config/license"],
  ])(
    "%s %s passes straight through to core",
    async (method: string, path: string) => {
      const response: Response = await fetch(`${baseUrl}${path}`, { method });
      const body: { servedBy?: string; path?: string } =
        (await response.json()) as { servedBy?: string; path?: string };

      expect(response.status).toBe(200);
      expect(body.servedBy).toBe("core");
      expect(body.path).toBe(path.replace(API_PREFIX, ""));
    },
  );
});
