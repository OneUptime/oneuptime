import SecurityCaseAPI from "../../../Server/API/SecurityCaseAPI";
import DetectionRuleAPI from "../../../Server/API/DetectionRuleAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import DetectionRuleDraft from "../../../Server/Utils/AI/Security/DetectionRuleDraft";
import SecurityCaseTriage, {
  SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES,
} from "../../../Server/Utils/AI/Security/SecurityCaseTriage";
import SecurityCaseTriageStatus from "../../../Server/Utils/AI/Security/SecurityCaseTriageStatus";
import AIToolbox from "../../../Server/Utils/AI/Toolbox/Index";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunType from "../../../Types/AI/AIRunType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * The routes behind a case's AI card and Draft with AI: who may call each,
 * that each reads as the caller and within the caller's project, and what
 * each answers. The evidence route re-runs a tool for the person looking,
 * so its trust chain is pinned link by link, as the incident card's is
 * (AIInvestigationEvidenceAPI.test.ts).
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;
const recordedRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];
jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return {
        post: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ uri, handlers });
        },
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RUN_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const TRIAGE: string = "/security-case/:caseId/ai-triage";
const START: string = "/security-case/:caseId/ai-triage/start";
const EVIDENCE: string = "/security-case/:caseId/ai-triage/evidence";
const DRAFT: string = "/detection-rule/draft-with-ai";

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
const res: ExpressResponse = {} as ExpressResponse;

function setPermissions(...permissions: Array<Permission>): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    },
  } as never;
}

function route(uri: string): Handler {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === uri;
    });
  expect(found).toBeDefined();
  return found!.handlers[found!.handlers.length - 1]!;
}

function request(
  body: JSONObject = {},
  caseId: string = CASE_ID.toString(),
): ExpressRequest {
  return { params: { caseId }, body } as unknown as ExpressRequest;
}

function answered(): JSONObject {
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  return mock.mock.calls[mock.mock.calls.length - 1]![2] as JSONObject;
}

// The case the viewer may read, in their project.
function caseReadable(projectId: ObjectID = PROJECT): jest.SpyInstance {
  return jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
    id: CASE_ID,
    _id: CASE_ID.toString(),
    projectId,
  } as unknown as SecurityCase);
}

beforeAll(() => {
  new SecurityCaseAPI();
  new DetectionRuleAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermissions(Permission.SecurityMember);
  next = jest.fn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("route registration", () => {
  test.each([TRIAGE, START, EVIDENCE, DRAFT])(
    "%s resolves the user and requires authentication first",
    (uri: string) => {
      const found: { uri: string; handlers: Array<Handler> } | undefined =
        recordedRoutes.find((item: { uri: string }) => {
          return item.uri === uri;
        });

      expect(found?.handlers.slice(0, 2)).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
      expect(found?.handlers).toHaveLength(3);
    },
  );
});

describe("POST /security-case/:caseId/ai-triage", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
  ])(
    "answers %s with the case's triage, the case read as them",
    async (permission: Permission) => {
      setPermissions(permission);
      const findCase: jest.SpyInstance = caseReadable();
      const status: jest.SpyInstance = jest
        .spyOn(SecurityCaseTriageStatus, "read")
        .mockResolvedValue({ run: null, isAutomaticTriageOn: true });

      await route(TRIAGE)(request(), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(findCase.mock.calls[0]![0]).toMatchObject({
        query: { _id: CASE_ID.toString(), projectId: PROJECT },
        props,
      });
      expect(status).toHaveBeenCalledWith({
        projectId: PROJECT,
        securityCaseId: CASE_ID,
      });
      expect(answered()).toEqual({ run: null, isAutomaticTriageOn: true });
    },
  );

  test.each([Permission.TelemetryAdmin, Permission.ProjectMember])(
    "refuses %s, who cannot read cases",
    async (permission: Permission) => {
      setPermissions(permission);
      const status: jest.SpyInstance = jest.spyOn(
        SecurityCaseTriageStatus,
        "read",
      );

      await route(TRIAGE)(request(), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(status).not.toHaveBeenCalled();
    },
  );

  test("a case the caller cannot read, or of another project, is no case", async () => {
    const status: jest.SpyInstance = jest.spyOn(
      SecurityCaseTriageStatus,
      "read",
    );

    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue(null);
    await route(TRIAGE)(request(), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));

    next.mockClear();
    caseReadable(OTHER_PROJECT);
    await route(TRIAGE)(request(), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));

    expect(status).not.toHaveBeenCalled();
  });

  test("an ID that is not one is refused before any read", async () => {
    const findCase: jest.SpyInstance = jest.spyOn(
      SecurityCaseService,
      "findOneBy",
    );

    await route(TRIAGE)(request({}, "case-1"), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(findCase).not.toHaveBeenCalled();
  });
});

describe("POST /security-case/:caseId/ai-triage/start", () => {
  test("a role that works cases starts a triage, whatever the automatic switch says", async () => {
    caseReadable();
    const start: jest.SpyInstance = jest
      .spyOn(SecurityCaseTriage, "startTriage")
      .mockResolvedValue({ started: true, runId: RUN_ID });

    await route(START)(request(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith({
      projectId: PROJECT,
      securityCaseId: CASE_ID,
    });
    expect(answered()).toEqual({ runId: RUN_ID.toString() });
  });

  test("a Security Viewer reads the triage but cannot ask for one", async () => {
    setPermissions(Permission.SecurityViewer);
    const start: jest.SpyInstance = jest.spyOn(
      SecurityCaseTriage,
      "startTriage",
    );

    await route(START)(request(), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(start).not.toHaveBeenCalled();
  });

  test.each([
    "ai_disabled",
    "provider_missing",
    "insufficient_ai_balance",
    "project_daily_limit_reached",
    "already_triaging",
    "not_enqueued",
  ] as const)(
    "what stops a triage (%s) is said, in a 400",
    async (code: keyof typeof SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES) => {
      caseReadable();
      jest
        .spyOn(SecurityCaseTriage, "startTriage")
        .mockResolvedValue({ started: false, code });

      await route(START)(request(), res, next);

      const error: unknown = next.mock.calls[0]![0];

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES[code],
      );
    },
  );
});

describe("POST /security-case/:caseId/ai-triage/evidence", () => {
  function events(): Array<AIRunEvent> {
    return [
      {
        sequence: 1,
        eventType: AIRunEventType.ToolCallStarted,
        toolName: "lookup_threat_intel",
        toolArguments: { values: ["203.0.113.9"] },
        createdAt: new Date("2026-10-14T11:00:00.000Z"),
      },
      {
        sequence: 2,
        eventType: AIRunEventType.ToolCallCompleted,
        toolName: "lookup_threat_intel",
        citationId: "C1",
        resultSummary: {
          rowCount: 1,
          citationLabel: "Threat intel lookup of 1 value(s) - 1 known-bad",
        },
        createdAt: new Date("2026-10-14T11:00:01.000Z"),
      },
    ] as unknown as Array<AIRunEvent>;
  }

  test.each([
    [{ runId: "nope", citationId: "C1" }, "runId must be a valid ID."],
    [
      { runId: RUN_ID.toString(), citationId: "1; DROP" },
      'citationId must be a citation marker such as "C1".',
    ],
  ])(
    "refuses %j before any read",
    async (body: JSONObject, message: string) => {
      const findCase: jest.SpyInstance = jest.spyOn(
        SecurityCaseService,
        "findOneBy",
      );

      await route(EVIDENCE)(request(body), res, next);

      expect((next.mock.calls[0]![0] as Error).message).toBe(message);
      expect(findCase).not.toHaveBeenCalled();
    },
  );

  test("a run that is not this case's triage is never replayed", async () => {
    caseReadable();
    const findRun: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);
    const execute: jest.SpyInstance = jest.spyOn(AIToolbox, "executeTool");

    await route(EVIDENCE)(
      request({ runId: RUN_ID.toString(), citationId: "C1" }),
      res,
      next,
    );

    expect(findRun.mock.calls[0]![0]).toMatchObject({
      query: {
        _id: RUN_ID,
        projectId: PROJECT,
        runType: AIRunType.Investigation,
        triggeredBySecurityCaseId: CASE_ID,
      },
    });
    expect((next.mock.calls[0]![0] as Error).message).toBe(
      "This triage was not found for this case.",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  test("re-runs the cited check from the run's own events, with the viewer's own permissions", async () => {
    const findCase: jest.SpyInstance = caseReadable();
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue({ id: RUN_ID } as unknown as AIRun);
    jest.spyOn(AIRunEventService, "findBy").mockResolvedValue(events());
    const execute: jest.SpyInstance = jest
      .spyOn(AIToolbox, "executeTool")
      .mockResolvedValue({
        success: true,
        textForLlm: "203.0.113.9 known-bad",
        result: {
          dataForLlm: "value: 203.0.113.9, match: known-bad",
          rowCount: 1,
          citationLabel: "Threat intel lookup of 1 value(s) - 1 known-bad",
          redactionCount: 0,
          isTruncated: false,
        },
      });

    await route(EVIDENCE)(
      request({
        runId: RUN_ID.toString(),
        citationId: "C1",
        // A body naming its own tool is never what runs.
        toolName: "run_security_playbook",
      }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    // The case is read as the viewer, pinned to the tenant.
    const pinned: Partial<DatabaseCommonInteractionProps> = {
      userId: USER,
      tenantId: PROJECT,
      isMultiTenantRequest: false,
    };

    expect(
      (findCase.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps })
        .props,
    ).toMatchObject(pinned);
    expect(execute).toHaveBeenCalledTimes(1);

    const run: {
      name: string;
      args: JSONObject;
      ctx: { projectId: ObjectID; props: DatabaseCommonInteractionProps };
    } = execute.mock.calls[0]![0] as {
      name: string;
      args: JSONObject;
      ctx: { projectId: ObjectID; props: DatabaseCommonInteractionProps };
    };

    // The run's own tool and arguments, never the body's.
    expect(run.name).toBe("lookup_threat_intel");
    expect(run.args).toEqual({ values: ["203.0.113.9"] });
    expect(run.ctx.projectId).toBe(PROJECT);
    // The viewer's own props, never root.
    expect(run.ctx.props).toMatchObject(pinned);
    expect(run.ctx.props.isRoot).toBeUndefined();
    expect(answered()).toMatchObject({
      citationId: "C1",
      toolName: "lookup_threat_intel",
      rowCount: 1,
      text: "value: 203.0.113.9, match: known-bad",
    });
  });

  test("a citation the run never made is no longer available", async () => {
    caseReadable();
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue({ id: RUN_ID } as unknown as AIRun);
    jest.spyOn(AIRunEventService, "findBy").mockResolvedValue(events());

    await route(EVIDENCE)(
      request({ runId: RUN_ID.toString(), citationId: "C7" }),
      res,
      next,
    );

    expect((next.mock.calls[0]![0] as Error).message).toBe(
      "This evidence is no longer available.",
    );
  });
});

describe("POST /detection-rule/draft-with-ai", () => {
  test("a role that creates detection rules drafts one from its description", async () => {
    const draft: jest.SpyInstance = jest
      .spyOn(DetectionRuleDraft, "draft")
      .mockResolvedValue({
        sigmaRuleYaml: "title: SSH Brute Force\n",
        title: "SSH Brute Force",
        isCorrelation: true,
      });

    await route(DRAFT)(
      request({ description: "Ten failed SSH sign-ins from one address" }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(draft).toHaveBeenCalledWith({
      projectId: PROJECT,
      userId: USER,
      description: "Ten failed SSH sign-ins from one address",
    });
    expect(answered()).toEqual({
      sigmaRuleYaml: "title: SSH Brute Force\n",
      title: "SSH Brute Force",
      isCorrelation: true,
    });
  });

  test("a Security Viewer cannot draft a rule", async () => {
    setPermissions(Permission.SecurityViewer);
    const draft: jest.SpyInstance = jest.spyOn(DetectionRuleDraft, "draft");

    await route(DRAFT)(request({ description: "anything at all" }), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(draft).not.toHaveBeenCalled();
  });

  test("a body that is not an object drafts from nothing", async () => {
    const draft: jest.SpyInstance = jest
      .spyOn(DetectionRuleDraft, "draft")
      .mockRejectedValue(new BadDataException("Describe what to detect."));

    await route(DRAFT)(
      { params: {}, body: ["a list"] } as unknown as ExpressRequest,
      res,
      next,
    );

    expect(draft).toHaveBeenCalledWith(
      expect.objectContaining({ description: "" }),
    );
    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
  });
});
