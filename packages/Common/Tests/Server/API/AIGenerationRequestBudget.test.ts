import { mockRouter } from "./Helpers";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import IncidentEpisodeAPI from "../../../Server/API/IncidentEpisodeAPI";
import AlertAPI from "../../../Server/API/AlertAPI";
import ScheduledMaintenanceAPI from "../../../Server/API/ScheduledMaintenanceAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import AIService, {
  AILogRequest,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../../Server/Services/AIService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import IncidentAIContextBuilder from "../../../Server/Utils/AI/IncidentAIContextBuilder";
import IncidentEpisodeAIContextBuilder from "../../../Server/Utils/AI/IncidentEpisodeAIContextBuilder";
import AlertAIContextBuilder from "../../../Server/Utils/AI/AlertAIContextBuilder";
import ScheduledMaintenanceAIContextBuilder from "../../../Server/Utils/AI/ScheduledMaintenanceAIContextBuilder";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * GH#3434 — "Generate Postmortem with AI" fails with "Error - Error connecting
 * to server. Please try again in few minutes."
 *
 * Every "Generate with AI" endpoint is synchronous: it awaits the whole LLM
 * completion inside the request handler and writes nothing — not even response
 * headers — until it returns. The browser's connection is therefore held open
 * for the full generation, and nginx's `location /api` gives that request 300s
 * (Nginx/default.conf.template; it used to inherit the 60s default, which is
 * what produced the report).
 *
 * The provider defaults are far larger than any proxy budget. LLMService takes
 * 10 attempts by default, and Ollama — the self-hosted provider in the report —
 * gets 300s per attempt with a retry deadline of max(300s, 300s × 3) = 900s.
 * Left unbounded, one click could keep a socket and a provider busy for fifteen
 * minutes, of which the browser would see the first 60 and then a 504 the
 * dashboard can only render as a generic connection error (the string in
 * Common/UI/Utils/API/API.ts is emitted for 502/504 and nothing else, so the
 * provider's real complaint never reaches the user).
 *
 * These endpoints must therefore bound themselves BELOW the proxy: whichever
 * side gives up first decides what the user reads. The server giving up first
 * yields a real message ("model not found", "connection refused", a rate
 * limit); the proxy giving up first yields the unactionable banner.
 *
 * The bound is asserted for all five endpoints, not just the postmortem route
 * in the report — they share the defect and would each have reproduced it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const SUBJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

/*
 * nginx's `location /api` budget, in ms. Restated here because the nginx
 * config is not importable from TypeScript; the mirror assertion — that the
 * proxy budget stays above this constant — lives in Nginx/Tests/NginxConfig.test.js
 * ("the /api proxy budget stays above the app's own AI generation ceiling").
 */
const API_PROXY_READ_TIMEOUT_IN_MS: number = 300 * 1000;

// The nginx default that was in force before the fix, and the reason for it.
const NGINX_DEFAULT_PROXY_READ_TIMEOUT_IN_MS: number = 60 * 1000;

type GenerationEndpoint = {
  name: string;
  uriSuffix: string;
  body: Record<string, unknown>;
  install: () => void;
};

/*
 * Every synchronous "Generate with AI" route. Each entry stubs the lookups and
 * the context builder its handler runs before reaching AIService, so the test
 * exercises the real handler down to the exact AILogRequest it hands over.
 */
const ENDPOINTS: Array<GenerationEndpoint> = [
  {
    name: "incident postmortem",
    uriSuffix: "/generate-postmortem-from-ai/:incidentId",
    body: { template: "## Summary" },
    install: () => {
      jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue({ _id: SUBJECT_ID, projectId: PROJECT_ID } as never);
      jest
        .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
        .mockResolvedValue({} as never);
      jest
        .spyOn(IncidentAIContextBuilder, "formatIncidentContextForPostmortem")
        .mockReturnValue({ messages: [] } as never);
    },
  },
  {
    name: "incident note",
    uriSuffix: "/generate-note-from-ai/:incidentId",
    body: { noteType: "internal" },
    install: () => {
      jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue({ _id: SUBJECT_ID, projectId: PROJECT_ID } as never);
      jest
        .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
        .mockResolvedValue({} as never);
      jest
        .spyOn(IncidentAIContextBuilder, "formatIncidentContextForNote")
        .mockReturnValue({ messages: [] } as never);
    },
  },
  {
    name: "incident episode postmortem",
    uriSuffix: "/generate-postmortem-from-ai/:episodeId",
    body: { template: "## Summary" },
    install: () => {
      jest
        .spyOn(IncidentEpisodeService, "findOneById")
        .mockResolvedValue({ _id: SUBJECT_ID, projectId: PROJECT_ID } as never);
      jest
        .spyOn(IncidentEpisodeAIContextBuilder, "buildEpisodeContext")
        .mockResolvedValue({} as never);
      jest
        .spyOn(
          IncidentEpisodeAIContextBuilder,
          "formatEpisodeContextForPostmortem",
        )
        .mockReturnValue({ messages: [] } as never);
    },
  },
  {
    name: "alert note",
    uriSuffix: "/generate-note-from-ai/:alertId",
    body: {},
    install: () => {
      jest
        .spyOn(AlertService, "findOneById")
        .mockResolvedValue({ _id: SUBJECT_ID, projectId: PROJECT_ID } as never);
      jest
        .spyOn(AlertAIContextBuilder, "buildAlertContext")
        .mockResolvedValue({} as never);
      jest
        .spyOn(AlertAIContextBuilder, "formatAlertContextForNote")
        .mockReturnValue({ messages: [] } as never);
    },
  },
  {
    name: "scheduled maintenance note",
    uriSuffix: "/generate-note-from-ai/:scheduledMaintenanceId",
    body: { noteType: "internal" },
    install: () => {
      jest
        .spyOn(ScheduledMaintenanceService, "findOneById")
        .mockResolvedValue({ _id: SUBJECT_ID, projectId: PROJECT_ID } as never);
      jest
        .spyOn(
          ScheduledMaintenanceAIContextBuilder,
          "buildScheduledMaintenanceContext",
        )
        .mockResolvedValue({} as never);
      jest
        .spyOn(
          ScheduledMaintenanceAIContextBuilder,
          "formatScheduledMaintenanceContextForNote",
        )
        .mockReturnValue({ messages: [] } as never);
    },
  },
];

function findRoute(uriSuffix: string): {
  handlerFunction: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => void | Promise<void>;
} {
  const route: { uri: string; method: string } | undefined =
    mockRouter.routes.find((candidate: { uri: string; method: string }) => {
      return candidate.method === "POST" && candidate.uri.endsWith(uriSuffix);
    });

  if (!route) {
    throw new Error(`no POST route registered ending in ${uriSuffix}`);
  }

  return route as never;
}

async function callEndpoint(endpoint: GenerationEndpoint): Promise<void> {
  endpoint.install();

  const req: ExpressRequest = {
    body: endpoint.body,
    headers: {},
    params: {
      [endpoint.uriSuffix.split(":")[1] as string]: SUBJECT_ID.toString(),
    },
    query: {},
  } as unknown as ExpressRequest;

  await findRoute(endpoint.uriSuffix).handlerFunction(
    req,
    {} as ExpressResponse,
    (() => {
      // The handler resolves or throws; nothing is delegated to next().
    }) as unknown as NextFunction,
  );
}

describe("synchronous Generate-with-AI endpoints bound their provider call", () => {
  beforeAll(() => {
    /*
     * These are CRUD API classes: routes are registered by the constructor,
     * not at module load, so the mock router stays empty until each one is
     * instantiated.
     */
    mockRouter.routes.length = 0;

    new IncidentAPI();
    new IncidentEpisodeAPI();
    new AlertAPI();
    new ScheduledMaintenanceAPI();
  });

  beforeEach(() => {
    jest.restoreAllMocks();

    /*
     * Master admin: the permission gate is a separate concern with its own
     * coverage, and short-circuiting it keeps every assertion here about the
     * request budget.
     */
    const props: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      isMasterAdmin: true,
    };

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props as never);

    jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue({ content: "generated" } as never);

    /*
     * The project's enableAi kill switch, which these handlers read before
     * they build any context. Every assertion here is about the request
     * budget the handler hands the provider, so the switch is on — the
     * switch's own behaviour is covered in AIGenerationProjectAIToggle and
     * AIKillSwitchBackstop.
     */
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
      enableAi: true,
    } as unknown as Project);
  });

  it.each(
    ENDPOINTS.map((endpoint: GenerationEndpoint) => {
      return [endpoint.name, endpoint] as [string, GenerationEndpoint];
    }),
  )(
    "%s asks the provider for a single attempt inside the proxy budget",
    async (_name: string, endpoint: GenerationEndpoint) => {
      await callEndpoint(endpoint);

      expect(AIService.executeWithLogging).toHaveBeenCalledTimes(1);

      const request: AILogRequest = (
        AIService.executeWithLogging as unknown as jest.Mock
      ).mock.calls[0]![0] as AILogRequest;

      /*
       * Without an explicit bound this endpoint inherits Ollama's 300s ×
       * 10-attempt / 900s ladder while nginx gives the whole request 300s —
       * so the proxy answers first with a 504 and the user reads "Error
       * connecting to server. Please try again in few minutes." (GH#3434).
       */
      expect(request.requestTimeoutInMs).toBe(
        INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
      );

      /*
       * Zero, not merely "few": a second attempt of this length cannot fit
       * inside the proxy budget, and by the time it began the browser would
       * already have been handed the gateway's timeout. `0 ?? default` is 0,
       * so this does reach LLMService rather than falling back.
       */
      expect(request.requestRetries).toBe(0);
    },
  );

  it("bounds the wait strictly inside the ingress budget", () => {
    /*
     * The two numbers are a pair, and this is the invariant that makes the
     * fix work rather than merely make it longer: the app has to give up
     * FIRST so the browser receives the provider's own error instead of a
     * gateway 504 that carries no diagnosis at all.
     */
    expect(INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS).toBeLessThan(
      API_PROXY_READ_TIMEOUT_IN_MS,
    );

    /*
     * ...and comfortably above the old nginx default, so nobody "fixes" a
     * future timeout by dropping the ceiling back under 60s, which would
     * re-break exactly the self-hosted Ollama setup in the report.
     */
    expect(INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS).toBeGreaterThan(
      NGINX_DEFAULT_PROXY_READ_TIMEOUT_IN_MS,
    );

    // Leave room for context building and writing the response.
    expect(
      API_PROXY_READ_TIMEOUT_IN_MS - INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
    ).toBeGreaterThanOrEqual(30 * 1000);
  });
});
