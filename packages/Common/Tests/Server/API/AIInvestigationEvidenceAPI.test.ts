import { mockRouter } from "./Helpers";
import {
  MAX_EVIDENCE_TEXT_LENGTH,
  pinEvidenceArgumentsToInvestigationTime,
} from "../../../Server/API/AIInvestigationAPI";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../Server/Utils/AI/Toolbox/Index";
import {
  ObservabilityTool,
  ToolExecutionResult,
} from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import CommonAPI from "../../../Server/API/CommonAPI";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import {
  AIChatCitationTargetType,
  AIChatWidget,
  AIChatWidgetType,
  AIRunEventResultSummary,
} from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunType from "../../../Types/AI/AIRunType";
import { InvestigationEvidenceRowsResponse } from "../../../Types/AI/InvestigationEvidence";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

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
 * POST /ai-investigation/evidence re-runs the query behind one report
 * citation for the person looking at the panel. It is the only way a viewer
 * can make the server execute an AI tool outside a chat, so these tests pin
 * every link of its trust chain: input validation before any read, the
 * viewer's access to the subject before the run is touched, the run bound to
 * that exact subject, the tool and arguments taken from the run's own events
 * (never the body), mutation/unknown tools refused, the viewer's permissions
 * on execution, and the time window pinned to the investigation.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const ALERT_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const USER_ID: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const RUN_ID: ObjectID = new ObjectID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");

const STARTED_AT: string = "2026-09-14T18:01:00.000Z";

// A second project the same viewer belongs to.
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);

function tenantGrant(projectId: ObjectID): JSONObject {
  return {
    projectId,
    permissions: [],
    _type: "UserTenantAccessPermission",
  } as unknown as JSONObject;
}

// A member of PROJECT_ID, whose request names PROJECT_ID as its tenant.
const viewerProps: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: tenantGrant(PROJECT_ID),
  },
} as unknown as DatabaseCommonInteractionProps;

// What every read and the tool run must receive: the tenant, never multi-tenant.
const pinnedViewerProps: DatabaseCommonInteractionProps = {
  ...viewerProps,
  isMultiTenantRequest: false,
};

function makeEvent(data: {
  eventType: AIRunEventType;
  toolName?: string | undefined;
  toolArguments?: JSONObject | undefined;
  resultSummary?: AIRunEventResultSummary | undefined;
  citationId?: string | undefined;
  createdAt?: string | undefined;
}): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent();
  event.eventType = data.eventType;
  if (data.toolName !== undefined) {
    event.toolName = data.toolName;
  }
  if (data.toolArguments !== undefined) {
    event.toolArguments = data.toolArguments;
  }
  if (data.resultSummary !== undefined) {
    event.resultSummary = data.resultSummary;
  }
  if (data.citationId !== undefined) {
    event.citationId = data.citationId;
  }
  if (data.createdAt !== undefined) {
    event.createdAt = new Date(data.createdAt);
  }
  return event;
}

// One cited tool call as the engine records it: Started, then Completed.
function citedCall(data: {
  toolName: string;
  citationId: string;
  toolArguments: JSONObject;
  startedAt?: string | undefined;
  withStartEvent?: boolean | undefined;
}): Array<AIRunEvent> {
  const events: Array<AIRunEvent> = [];

  if (data.withStartEvent !== false) {
    events.push(
      makeEvent({
        eventType: AIRunEventType.ToolCallStarted,
        toolName: data.toolName,
        toolArguments: data.toolArguments,
        createdAt: data.startedAt || STARTED_AT,
      }),
    );
  }

  events.push(
    makeEvent({
      eventType: AIRunEventType.ToolCallCompleted,
      toolName: data.toolName,
      citationId: data.citationId,
      toolArguments:
        data.withStartEvent === false ? data.toolArguments : undefined,
      resultSummary: { rowCount: 4, durationInMs: 200 },
      createdAt: "2026-09-14T18:01:05.000Z",
    }),
  );

  return events;
}

function toolResult(
  overrides: Partial<ToolExecutionResult> = {},
): ToolCallOutcome {
  const result: ToolExecutionResult = {
    dataForLlm: "time | severity | body\n18:00 | Error | pool exhausted",
    rowCount: 1,
    citationLabel: "Logs 17:01 – 18:01 (1 shown)",
    citationTarget: { type: AIChatCitationTargetType.Logs },
    redactionCount: 0,
    isTruncated: false,
    ...overrides,
  };

  return { success: true, textForLlm: result.dataForLlm, result };
}

function requestFor(body: JSONObject): ExpressRequest {
  return { body } as unknown as ExpressRequest;
}

function response(): ExpressResponse {
  return {} as ExpressResponse;
}

async function callEvidenceRoute(
  body: JSONObject,
): Promise<ReturnType<typeof jest.fn>> {
  const next: ReturnType<typeof jest.fn> = jest.fn();

  await mockRouter
    .match("post", "/ai-investigation/evidence")
    .handlerFunction(
      requestFor(body),
      response(),
      next as unknown as NextFunction,
    );

  return next;
}

function sentPayload(): InvestigationEvidenceRowsResponse {
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  return send.mock.calls[0]![2] as InvestigationEvidenceRowsResponse;
}

function incidentBody(overrides: JSONObject = {}): JSONObject {
  return {
    subjectType: "incident",
    subjectId: INCIDENT_ID.toString(),
    investigationRunId: RUN_ID.toString(),
    citationId: "C1",
    ...overrides,
  };
}

describe("POST /ai-investigation/evidence", () => {
  let events: Array<AIRunEvent>;
  let incidentFindOne: SpyInstance<typeof IncidentService.findOneById>;
  let alertFindOne: SpyInstance<typeof AlertService.findOneById>;
  let runFindOne: SpyInstance<typeof AIRunService.findOneBy>;
  let eventFindBy: SpyInstance<typeof AIRunEventService.findBy>;
  let executeTool: SpyInstance<typeof AIToolbox.executeTool>;

  beforeEach(() => {
    jest.clearAllMocks();

    events = [
      makeEvent({ eventType: AIRunEventType.RunStarted }),
      ...citedCall({
        toolName: "search_logs",
        citationId: "C1",
        toolArguments: {
          startTime: "2026-09-14T17:01:00.000Z",
          bodySearchText: "pool exhausted",
        },
      }),
      makeEvent({ eventType: AIRunEventType.RunCompleted }),
    ];

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(viewerProps);

    const incident: Incident = new Incident(INCIDENT_ID);
    incident.projectId = PROJECT_ID;
    incidentFindOne = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident);

    const alert: Alert = new Alert(ALERT_ID);
    alert.projectId = PROJECT_ID;
    alertFindOne = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alert);

    runFindOne = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(new AIRun(RUN_ID));

    eventFindBy = jest
      .spyOn(AIRunEventService, "findBy")
      .mockImplementation(async (): Promise<Array<AIRunEvent>> => {
        return events;
      });

    executeTool = jest
      .spyOn(AIToolbox, "executeTool")
      .mockResolvedValue(toolResult());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectNoReads(): void {
    expect(incidentFindOne).not.toHaveBeenCalled();
    expect(alertFindOne).not.toHaveBeenCalled();
    expect(runFindOne).not.toHaveBeenCalled();
    expect(eventFindBy).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  describe("input validation happens before any read", () => {
    it.each([
      ["a missing subjectType", { subjectType: undefined }],
      ["an unknown subjectType", { subjectType: "monitor" }],
      ["a missing subjectId", { subjectId: undefined }],
      ["a non-UUID subjectId", { subjectId: "6954" }],
      ["a non-string subjectId", { subjectId: 6954 }],
      [
        "a missing run id",
        { investigationRunId: undefined, aiRunId: undefined },
      ],
      ["a non-UUID run id", { investigationRunId: "latest" }],
      [
        "two different run ids",
        { aiRunId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
      ],
      ["a missing citationId", { citationId: undefined }],
      ["a lowercase citationId", { citationId: "c1" }],
      ["a bracketed citationId", { citationId: "[C1]" }],
      ["a four-digit citationId", { citationId: "C1000" }],
      ["a bare number citationId", { citationId: 1 }],
      ["a citationId with a suffix", { citationId: "C1; drop" }],
    ])("rejects %s", async (_description: string, overrides: JSONObject) => {
      const body: JSONObject = incidentBody(overrides);

      for (const key of Object.keys(overrides)) {
        if (overrides[key] === undefined) {
          delete body[key];
        }
      }

      const next: ReturnType<typeof jest.fn> = await callEvidenceRoute(body);

      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expectNoReads();
    });

    /*
     * No credentials at all is 401, not 422: it is almost always an expired
     * dashboard session, and 401 is what makes the client refresh it and
     * replay the request.
     */
    it("requires a logged-in user session, answering a caller with no credentials with 401", async () => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({
          tenantId: PROJECT_ID,
        } as DatabaseCommonInteractionProps);

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticatedException));
      expect((next.mock.calls[0]![0] as NotAuthenticatedException).code).toBe(
        ExceptionCode.NotAuthenticatedException,
      );
      expectNoReads();
    });

    it("answers an anonymous caller with 401 even when its body is malformed too", async () => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({
          userType: UserType.Public,
        } as DatabaseCommonInteractionProps);

      const next: ReturnType<typeof jest.fn> = await callEvidenceRoute(
        incidentBody({ citationId: "not-a-citation" }),
      );

      expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticatedException));
      expectNoReads();
    });

    /*
     * A project API key is authenticated, so it keeps the 422 this
     * person-only route has always given it; a 401 would only send its
     * client to refresh a session that does not exist.
     */
    it("refuses a project API key with 422 before any read", async () => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({
          tenantId: PROJECT_ID,
          userType: UserType.API,
          userTenantAccessPermission: viewerProps.userTenantAccessPermission,
        } as DatabaseCommonInteractionProps);

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).toHaveBeenCalledWith(
        new NotAuthorizedException("A logged-in user session is required."),
      );
      expect(next).not.toHaveBeenCalledWith(
        expect.any(NotAuthenticatedException),
      );
      expectNoReads();
    });

    it("accepts the aiRunId alias and trims the citation id", async () => {
      const next: ReturnType<typeof jest.fn> = await callEvidenceRoute({
        subjectType: "incident",
        subjectId: INCIDENT_ID.toString(),
        aiRunId: RUN_ID.toString(),
        citationId: " C1 ",
      });

      expect(next).not.toHaveBeenCalled();
      expect(sentPayload().citationId).toBe("C1");
    });
  });

  describe("access and run binding", () => {
    it("checks the viewer can read the incident before touching the run", async () => {
      incidentFindOne.mockResolvedValue(null);

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).toHaveBeenCalledWith(
        new BadDataException(
          "Incident not found (or you do not have access to it).",
        ),
      );
      expect(incidentFindOne).toHaveBeenCalledWith({
        id: INCIDENT_ID,
        select: { _id: true, projectId: true },
        props: pinnedViewerProps,
      });
      expect(runFindOne).not.toHaveBeenCalled();
      expect(eventFindBy).not.toHaveBeenCalled();
      expect(executeTool).not.toHaveBeenCalled();
    });

    it("checks the viewer can read the alert before touching the run", async () => {
      alertFindOne.mockResolvedValue(null);

      const next: ReturnType<typeof jest.fn> = await callEvidenceRoute(
        incidentBody({
          subjectType: "alert",
          subjectId: ALERT_ID.toString(),
        }),
      );

      expect(next).toHaveBeenCalledWith(
        new BadDataException(
          "Alert not found (or you do not have access to it).",
        ),
      );
      expect(incidentFindOne).not.toHaveBeenCalled();
      expect(runFindOne).not.toHaveBeenCalled();
      expect(executeTool).not.toHaveBeenCalled();
    });

    it("treats a subject without a project as not found", async () => {
      incidentFindOne.mockResolvedValue(new Incident(INCIDENT_ID));

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(runFindOne).not.toHaveBeenCalled();
    });

    it("binds the run to the incident, its project and the Investigation run type", async () => {
      await callEvidenceRoute(incidentBody());

      expect(runFindOne).toHaveBeenCalledWith({
        query: {
          _id: RUN_ID,
          projectId: PROJECT_ID,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: INCIDENT_ID,
        },
        select: { _id: true },
        props: { isRoot: true },
      });
    });

    it("binds the run to the alert on the alert subject", async () => {
      await callEvidenceRoute(
        incidentBody({
          subjectType: "alert",
          subjectId: ALERT_ID.toString(),
        }),
      );

      expect(runFindOne).toHaveBeenCalledWith({
        query: {
          _id: RUN_ID,
          projectId: PROJECT_ID,
          runType: AIRunType.Investigation,
          triggeredByAlertId: ALERT_ID,
        },
        select: { _id: true },
        props: { isRoot: true },
      });
      expect(
        (runFindOne.mock.calls[0]![0] as unknown as { query: JSONObject })
          .query,
      ).not.toHaveProperty("triggeredByIncidentId");
    });

    it("refuses a run that does not belong to the subject", async () => {
      runFindOne.mockResolvedValue(null);

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).toHaveBeenCalledWith(
        new BadDataException(
          "This investigation was not found for this incident.",
        ),
      );
      expect(eventFindBy).not.toHaveBeenCalled();
      expect(executeTool).not.toHaveBeenCalled();
    });

    it("reads the run's events as root, pinned to the run and project, in sequence order", async () => {
      await callEvidenceRoute(incidentBody());

      expect(eventFindBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { aiRunId: RUN_ID, projectId: PROJECT_ID },
          sort: { sequence: SortOrder.Ascending },
          props: { isRoot: true },
          select: expect.objectContaining({
            toolName: true,
            toolArguments: true,
            citationId: true,
            resultSummary: true,
            createdAt: true,
            eventType: true,
          }),
        }),
      );
    });
  });

  describe("tenant pinning", () => {
    function propsWith(
      overrides: Partial<DatabaseCommonInteractionProps>,
    ): DatabaseCommonInteractionProps {
      return { ...viewerProps, ...overrides };
    }

    function mockProps(props: DatabaseCommonInteractionProps): void {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(props);
    }

    function executedContext(): {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } {
      return (
        executeTool.mock.calls[0]![0] as unknown as {
          ctx: { projectId: ObjectID; props: DatabaseCommonInteractionProps };
        }
      ).ctx;
    }

    /*
     * The reported attack: a member of both projects sends their tenant (A,
     * where they may read telemetry) plus the multi-tenant header, and names
     * an incident in B (where they may not). The toolbox would check A's
     * grants and run the recorded query against B.
     */
    it.each([
      ["incident", INCIDENT_ID],
      ["alert", ALERT_ID],
    ])(
      "refuses a multi-tenant request for an %s in another project before the run is read",
      async (subjectType: string, subjectId: ObjectID) => {
        mockProps(
          propsWith({
            isMultiTenantRequest: true,
            userTenantAccessPermission: {
              [PROJECT_ID.toString()]: tenantGrant(PROJECT_ID),
              [OTHER_PROJECT_ID.toString()]: tenantGrant(OTHER_PROJECT_ID),
            } as unknown as DatabaseCommonInteractionProps["userTenantAccessPermission"],
          }),
        );

        const incident: Incident = new Incident(INCIDENT_ID);
        incident.projectId = OTHER_PROJECT_ID;
        incidentFindOne.mockResolvedValue(incident);

        const alert: Alert = new Alert(ALERT_ID);
        alert.projectId = OTHER_PROJECT_ID;
        alertFindOne.mockResolvedValue(alert);

        const next: ReturnType<typeof jest.fn> = await callEvidenceRoute(
          incidentBody({ subjectType, subjectId: subjectId.toString() }),
        );

        expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
        expect(runFindOne).not.toHaveBeenCalled();
        expect(eventFindBy).not.toHaveBeenCalled();
        expect(executeTool).not.toHaveBeenCalled();
        expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      },
    );

    it("refuses a subject the lookup places in another project even without the multi-tenant header", async () => {
      const incident: Incident = new Incident(INCIDENT_ID);
      incident.projectId = OTHER_PROJECT_ID;
      incidentFindOne.mockResolvedValue(incident);

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
      expect(runFindOne).not.toHaveBeenCalled();
      expect(executeTool).not.toHaveBeenCalled();
    });

    it("looks the subject up with the multi-tenant flag cleared, pinned to the tenant", async () => {
      mockProps(propsWith({ isMultiTenantRequest: true }));

      await callEvidenceRoute(incidentBody());

      expect(incidentFindOne).toHaveBeenCalledTimes(1);

      const lookupProps: DatabaseCommonInteractionProps = (
        incidentFindOne.mock.calls[0]![0] as unknown as {
          props: DatabaseCommonInteractionProps;
        }
      ).props;

      expect(lookupProps.isMultiTenantRequest).toBe(false);
      expect(lookupProps.tenantId).toBe(PROJECT_ID);
      expect(lookupProps.userId).toBe(USER_ID);
    });

    it("runs the tool in the tenant with the tenant's own single-project props", async () => {
      mockProps(propsWith({ isMultiTenantRequest: true }));

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).not.toHaveBeenCalled();
      expect(executeTool).toHaveBeenCalledTimes(1);

      const ctx: {
        projectId: ObjectID;
        props: DatabaseCommonInteractionProps;
      } = executedContext();

      expect(ctx.projectId).toBe(PROJECT_ID);
      expect(ctx.props.tenantId!.toString()).toBe(ctx.projectId.toString());
      expect(ctx.props.isMultiTenantRequest).toBe(false);
      expect(ctx.props.isRoot).toBeFalsy();
    });

    it("reads the run and its events in the tenant", async () => {
      await callEvidenceRoute(incidentBody());

      expect(
        (runFindOne.mock.calls[0]![0] as unknown as { query: JSONObject })
          .query["projectId"],
      ).toBe(PROJECT_ID);
      expect(
        (eventFindBy.mock.calls[0]![0] as unknown as { query: JSONObject })
          .query["projectId"],
      ).toBe(PROJECT_ID);
    });

    it("rejects a request without a tenant before any read", async () => {
      mockProps(propsWith({ tenantId: undefined }));

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expectNoReads();
    });

    it.each([
      ["no tenant grants at all", undefined],
      [
        "grants only in another project",
        {
          [OTHER_PROJECT_ID.toString()]: tenantGrant(OTHER_PROJECT_ID),
        },
      ],
    ])(
      "rejects a caller with %s before any read",
      async (_description: string, grants: JSONObject | undefined) => {
        mockProps(
          propsWith({
            userTenantAccessPermission:
              grants as unknown as DatabaseCommonInteractionProps["userTenantAccessPermission"],
          }),
        );

        const next: ReturnType<typeof jest.fn> =
          await callEvidenceRoute(incidentBody());

        expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
        expectNoReads();
      },
    );
  });

  describe("which evidence can be re-run", () => {
    it("reports a citation the run never minted as no longer available", async () => {
      const next: ReturnType<typeof jest.fn> = await callEvidenceRoute(
        incidentBody({ citationId: "C7" }),
      );

      expect(next).toHaveBeenCalledWith(
        new BadDataException("This evidence is no longer available."),
      );
      expect(executeTool).not.toHaveBeenCalled();
    });

    it("does not re-run a citation from an earlier, superseded attempt", async () => {
      events = [
        makeEvent({ eventType: AIRunEventType.RunStarted }),
        ...citedCall({
          toolName: "search_logs",
          citationId: "C2",
          toolArguments: {},
        }),
        makeEvent({ eventType: AIRunEventType.RunFailed }),
        makeEvent({ eventType: AIRunEventType.RunStarted }),
        ...citedCall({
          toolName: "search_logs",
          citationId: "C1",
          toolArguments: {},
        }),
      ];

      const next: ReturnType<typeof jest.fn> = await callEvidenceRoute(
        incidentBody({ citationId: "C2" }),
      );

      expect(next).toHaveBeenCalledWith(
        new BadDataException("This evidence is no longer available."),
      );
      expect(executeTool).not.toHaveBeenCalled();
    });

    it.each([
      ["a mutation tool", "create_incident"],
      ["a mutation tool", "acknowledge_alert"],
      ["an investigation-excluded tool", "get_ai_investigation"],
      ["a remediation extra tool", "execute_remediation_command"],
      ["an unknown tool", "drop_all_tables"],
    ])("refuses %s (%s)", async (_description: string, toolName: string) => {
      events = [
        makeEvent({ eventType: AIRunEventType.RunStarted }),
        ...citedCall({
          toolName,
          citationId: "C1",
          toolArguments: { title: "x" },
        }),
      ];

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).toHaveBeenCalledWith(
        new BadDataException("This evidence can't be re-run."),
      );
      expect(executeTool).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  describe("execution", () => {
    it("runs the ORIGINAL arguments from the event under the viewer's props and the tenant", async () => {
      const longText: string = "x".repeat(1200);
      events = [
        makeEvent({ eventType: AIRunEventType.RunStarted }),
        ...citedCall({
          toolName: "query_incidents",
          citationId: "C1",
          toolArguments: {
            state: "active",
            searchHint: longText,
            nested: { kept: "as recorded" },
          },
        }),
      ];

      const next: ReturnType<typeof jest.fn> = await callEvidenceRoute(
        incidentBody({
          // Hostile body fields are ignored — the event is the only source.
          toolName: "create_incident",
          args: { state: "resolved" },
          toolArguments: { state: "resolved" },
          queryArguments: { state: "resolved" },
        }),
      );

      expect(next).not.toHaveBeenCalled();
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenCalledWith({
        name: "query_incidents",
        args: {
          state: "active",
          searchHint: longText,
          nested: { kept: "as recorded" },
        },
        ctx: { projectId: PROJECT_ID, props: pinnedViewerProps },
      });

      const ctx: { props: DatabaseCommonInteractionProps } = (
        executeTool.mock.calls[0]![0] as unknown as {
          ctx: { props: DatabaseCommonInteractionProps };
        }
      ).ctx;
      expect(ctx.props.userId).toBe(USER_ID);
      expect(ctx.props.isRoot).toBeFalsy();
    });

    it("pins a missing endTime to when the investigation ran the query", async () => {
      await callEvidenceRoute(incidentBody());

      expect(executeTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "search_logs",
          args: {
            startTime: "2026-09-14T17:01:00.000Z",
            bodySearchText: "pool exhausted",
            endTime: STARTED_AT,
          },
        }),
      );
      expect(sentPayload().isPinnedToInvestigationTime).toBe(true);
      expect(sentPayload().investigatedAt).toBe(STARTED_AT);
    });

    it("keeps an explicit endTime", async () => {
      events = [
        makeEvent({ eventType: AIRunEventType.RunStarted }),
        ...citedCall({
          toolName: "search_logs",
          citationId: "C1",
          toolArguments: {
            startTime: "2026-09-14T16:00:00.000Z",
            endTime: "2026-09-14T17:00:00.000Z",
          },
        }),
      ];

      await callEvidenceRoute(incidentBody());

      expect(
        (executeTool.mock.calls[0]![0] as unknown as { args: JSONObject }).args,
      ).toEqual({
        startTime: "2026-09-14T16:00:00.000Z",
        endTime: "2026-09-14T17:00:00.000Z",
      });
      expect(sentPayload().isPinnedToInvestigationTime).toBe(true);
    });

    it("pins a missing atTime for a baseline check", async () => {
      events = [
        makeEvent({ eventType: AIRunEventType.RunStarted }),
        ...citedCall({
          toolName: "baseline_anomaly",
          citationId: "C1",
          toolArguments: { metricName: "http.server.duration" },
        }),
      ];

      await callEvidenceRoute(incidentBody());

      expect(
        (executeTool.mock.calls[0]![0] as unknown as { args: JSONObject }).args,
      ).toEqual({
        metricName: "http.server.duration",
        atTime: STARTED_AT,
      });
      expect(sentPayload().isPinnedToInvestigationTime).toBe(true);
    });

    it("adds no time to a tool without a time window and reports live data", async () => {
      events = [
        makeEvent({ eventType: AIRunEventType.RunStarted }),
        ...citedCall({
          toolName: "query_incidents",
          citationId: "C1",
          toolArguments: { state: "active" },
        }),
      ];

      await callEvidenceRoute(incidentBody());

      expect(
        (executeTool.mock.calls[0]![0] as unknown as { args: JSONObject }).args,
      ).toEqual({ state: "active" });
      expect(sentPayload().isPinnedToInvestigationTime).toBe(false);
    });

    it("pins a legacy call without a start event to the completion time", async () => {
      events = [
        makeEvent({ eventType: AIRunEventType.RunStarted }),
        ...citedCall({
          toolName: "search_logs",
          citationId: "C1",
          toolArguments: {},
          withStartEvent: false,
        }),
      ];

      await callEvidenceRoute(incidentBody());

      expect(
        (executeTool.mock.calls[0]![0] as unknown as { args: JSONObject }).args,
      ).toEqual({ endTime: "2026-09-14T18:01:05.000Z" });
      expect(sentPayload().investigatedAt).toBe("2026-09-14T18:01:05.000Z");
    });

    it("never mutates the recorded event arguments", async () => {
      const recorded: JSONObject = events[1]!.toolArguments!;
      const snapshot: string = JSON.stringify(recorded);

      await callEvidenceRoute(incidentBody());

      expect(JSON.stringify(recorded)).toBe(snapshot);
      expect(recorded).not.toHaveProperty("endTime");
    });

    it("turns a tool failure into a 400 with the tool's message", async () => {
      executeTool.mockResolvedValue({
        success: false,
        textForLlm: "Error: the current user does not have permission",
        errorMessage: "Permission denied for tool: search_logs",
      });

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).toHaveBeenCalledWith(
        new BadDataException("Permission denied for tool: search_logs"),
      );
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    it("falls back to a generic message when the tool gives none", async () => {
      executeTool.mockResolvedValue({ success: true, textForLlm: "" });

      const next: ReturnType<typeof jest.fn> =
        await callEvidenceRoute(incidentBody());

      expect(next).toHaveBeenCalledWith(
        new BadDataException("This evidence could not be loaded."),
      );
    });
  });

  describe("response", () => {
    it("returns plain-text rows when the tool has no widget", async () => {
      const before: number = Date.now();

      await callEvidenceRoute(incidentBody());

      const payload: InvestigationEvidenceRowsResponse = sentPayload();
      const executedAt: number = new Date(payload.executedAt).getTime();

      expect(payload).toEqual({
        citationId: "C1",
        toolName: "search_logs",
        label: "Logs 17:01 – 18:01 (1 shown)",
        rowCount: 1,
        text: "time | severity | body\n18:00 | Error | pool exhausted",
        isTruncated: false,
        executedAt: payload.executedAt,
        isPinnedToInvestigationTime: true,
        investigatedAt: STARTED_AT,
      });
      expect(payload).not.toHaveProperty("widget");
      expect(executedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(executedAt).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it("returns the widget — and no text — when the tool builds one", async () => {
      const widget: AIChatWidget = {
        id: "",
        type: AIChatWidgetType.Table,
        title: "Logs (1)",
        data: {
          columns: [{ key: "body", title: "Body" }],
          rows: [{ body: "pool exhausted" }],
        },
      };
      executeTool.mockResolvedValue(toolResult({ widget }));

      await callEvidenceRoute(incidentBody());

      const payload: InvestigationEvidenceRowsResponse = sentPayload();
      expect(payload.widget).toEqual({
        ...widget,
        id: "W1",
        citationId: "C1",
      });
      expect(payload).not.toHaveProperty("text");
    });

    it("keeps a widget's own id", async () => {
      executeTool.mockResolvedValue(
        toolResult({
          widget: {
            id: "W9",
            type: AIChatWidgetType.StatCards,
            title: "Stats",
            data: { stats: [] },
          },
        }),
      );

      await callEvidenceRoute(incidentBody());

      expect(sentPayload().widget?.id).toBe("W9");
    });

    it(`clips text to ${MAX_EVIDENCE_TEXT_LENGTH} characters and marks it truncated`, async () => {
      executeTool.mockResolvedValue(
        toolResult({ dataForLlm: "r".repeat(MAX_EVIDENCE_TEXT_LENGTH + 500) }),
      );

      await callEvidenceRoute(incidentBody());

      const payload: InvestigationEvidenceRowsResponse = sentPayload();
      expect(payload.text).toHaveLength(MAX_EVIDENCE_TEXT_LENGTH);
      expect(payload.isTruncated).toBe(true);
    });

    it("text exactly at the limit is not marked truncated", async () => {
      executeTool.mockResolvedValue(
        toolResult({ dataForLlm: "r".repeat(MAX_EVIDENCE_TEXT_LENGTH) }),
      );

      await callEvidenceRoute(incidentBody());

      expect(sentPayload().text).toHaveLength(MAX_EVIDENCE_TEXT_LENGTH);
      expect(sentPayload().isTruncated).toBe(false);
    });

    it("passes the tool's own truncation flag through", async () => {
      executeTool.mockResolvedValue(toolResult({ isTruncated: true }));

      await callEvidenceRoute(incidentBody());

      expect(sentPayload().isTruncated).toBe(true);
    });

    it("an empty result is sent as an empty text with zero rows", async () => {
      executeTool.mockResolvedValue(
        toolResult({ dataForLlm: "", rowCount: 0 }),
      );

      await callEvidenceRoute(incidentBody());

      expect(sentPayload()).toEqual(
        expect.objectContaining({ rowCount: 0, text: "" }),
      );
    });
  });
});

describe("pinEvidenceArgumentsToInvestigationTime", () => {
  const investigatedAt: Date = new Date(STARTED_AT);

  function tool(name: string): ObservabilityTool {
    const found: ObservabilityTool | undefined = AIToolbox.getToolByName(name);
    expect(found).toBeDefined();
    return found!;
  }

  it("treats a blank endTime as missing", () => {
    expect(
      pinEvidenceArgumentsToInvestigationTime({
        tool: tool("search_logs"),
        rawArguments: { endTime: "   " },
        investigatedAt,
      }),
    ).toEqual({
      args: { endTime: STARTED_AT },
      isPinnedToInvestigationTime: true,
    });
  });

  it("without a known investigation time a windowless call stays live", () => {
    expect(
      pinEvidenceArgumentsToInvestigationTime({
        tool: tool("search_logs"),
        rawArguments: { bodySearchText: "x" },
        investigatedAt: undefined,
      }),
    ).toEqual({
      args: { bodySearchText: "x" },
      isPinnedToInvestigationTime: false,
    });
  });

  it("returns a copy", () => {
    const rawArguments: JSONObject = { metricName: "cpu" };
    const pinned: { args: JSONObject; isPinnedToInvestigationTime: boolean } =
      pinEvidenceArgumentsToInvestigationTime({
        tool: tool("query_metrics"),
        rawArguments,
        investigatedAt,
      });

    expect(pinned.args).not.toBe(rawArguments);
    expect(rawArguments).toEqual({ metricName: "cpu" });
    expect(pinned.args).toEqual({ metricName: "cpu", endTime: STARTED_AT });
  });

  it("ignores time keys the tool's schema does not declare", () => {
    expect(
      pinEvidenceArgumentsToInvestigationTime({
        tool: tool("query_alerts"),
        rawArguments: { endTime: "2026-01-01T00:00:00.000Z" },
        investigatedAt,
      }),
    ).toEqual({
      args: { endTime: "2026-01-01T00:00:00.000Z" },
      isPinnedToInvestigationTime: false,
    });
  });

  it("handles a tool whose schema has no properties", () => {
    expect(
      pinEvidenceArgumentsToInvestigationTime({
        tool: {
          ...tool("query_probes"),
          inputSchema: { type: "object" },
        },
        rawArguments: {},
        investigatedAt,
      }),
    ).toEqual({ args: {}, isPinnedToInvestigationTime: false });
  });
});
