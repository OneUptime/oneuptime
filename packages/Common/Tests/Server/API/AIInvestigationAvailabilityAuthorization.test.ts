import { mockRouter } from "./Helpers";
import "../../../Server/API/AIInvestigationAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import InvestigationEligibility from "../../../Server/Utils/AI/SRE/InvestigationEligibility";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import InvestigationNotStartedReason from "../../../Types/AI/InvestigationNotStartedReason";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const SUBJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();

const VIEWER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
  isMultiTenantRequest: true,
};

const RECORDED_REASON: InvestigationNotStartedReason = {
  code: "monitor_cooldown",
  title: "A recent investigation covers this monitor",
  description:
    "Another alert for this monitor started an investigation within the last 30 minutes.",
  nextStep:
    "Review the recent investigation or adjust the cooldown for future alerts.",
  source: "recorded",
  evaluatedAt: "2026-09-17T12:24:00.000Z",
};

function subjectInProject(
  subjectType: "incident" | "alert",
  projectId: ObjectID,
): Incident | Alert {
  const subject: Incident | Alert =
    subjectType === "incident"
      ? new Incident(SUBJECT_ID)
      : new Alert(SUBJECT_ID);
  subject.projectId = projectId;
  return subject;
}

describe.each(["incident", "alert"] as const)(
  "%s investigation availability authorization",
  (subjectType: "incident" | "alert") => {
    let subjectRead: jest.SpyInstance;
    let reasonRead: jest.SpyInstance;
    let runRead: jest.SpyInstance;

    beforeEach(() => {
      jest.clearAllMocks();
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(VIEWER_PROPS);
      subjectRead = jest
        .spyOn(
          subjectType === "incident" ? IncidentService : AlertService,
          "findOneById",
        )
        .mockResolvedValue(subjectInProject(subjectType, PROJECT_ID));
      runRead = jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
      reasonRead = jest
        .spyOn(InvestigationEligibility, "getNotStartedReason")
        .mockResolvedValue(RECORDED_REASON);
      jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function callRoute(body?: JSONObject): Promise<jest.Mock> {
      const next: jest.Mock = jest.fn();
      await mockRouter
        .match("post", `/ai-investigation/${subjectType}`)
        .handlerFunction(
          {
            body: body || { [`${subjectType}Id`]: SUBJECT_ID.toString() },
          } as ExpressRequest,
          {} as ExpressResponse,
          next as NextFunction,
        );
      return next;
    }

    function payload(): JSONObject {
      return (Response.sendJsonObjectResponse as jest.Mock).mock
        .calls[0]![2] as JSONObject;
    }

    function expectNoPrivateReads(): void {
      expect(reasonRead).not.toHaveBeenCalled();
      expect(runRead).not.toHaveBeenCalled();
      expect(AIRunEventService.findBy).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    }

    test("returns the recorded reason only after the viewer can read the subject", async () => {
      const next: jest.Mock = await callRoute();

      expect(next).not.toHaveBeenCalled();
      expect(subjectRead).toHaveBeenCalledWith(
        expect.objectContaining({
          id: SUBJECT_ID,
          props: { ...VIEWER_PROPS, isMultiTenantRequest: false },
        }),
      );
      expect(reasonRead).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        [`${subjectType}Id`]: SUBJECT_ID,
      });
      expect(subjectRead.mock.invocationCallOrder[0]).toBeLessThan(
        reasonRead.mock.invocationCallOrder[0]!,
      );
      expect(payload()).toEqual(
        expect.objectContaining({
          run: null,
          events: [],
          analysisMarkdown: null,
          notInvestigatedReason: RECORDED_REASON,
        }),
      );
    });

    test.each(["current_configuration", "unknown"] as const)(
      "preserves the %s provenance instead of inventing a historical decision",
      async (source: "current_configuration" | "unknown") => {
        const reason: InvestigationNotStartedReason = {
          ...RECORDED_REASON,
          source,
        };
        reasonRead.mockResolvedValue(reason);

        expect(await callRoute()).not.toHaveBeenCalled();
        expect(payload()["notInvestigatedReason"]).toEqual(reason);
      },
    );

    test("reads the latest investigation inside the authenticated project", async () => {
      await callRoute();
      expect(runRead).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            projectId: PROJECT_ID,
            [`triggeredBy${subjectType === "incident" ? "Incident" : "Alert"}Id`]:
              SUBJECT_ID,
            runType: AIRunType.Investigation,
          },
        }),
      );
    });

    test("does not evaluate a missing investigation when a queued run already exists", async () => {
      const run: AIRun = new AIRun(RUN_ID);
      run.status = AIRunStatus.Queued;
      runRead.mockResolvedValue([run]);

      expect(await callRoute()).not.toHaveBeenCalled();
      expect(reasonRead).not.toHaveBeenCalled();
      expect(payload()["notInvestigatedReason"]).toBeNull();
      expect(payload()["run"]).toEqual(
        expect.objectContaining({ status: AIRunStatus.Queued }),
      );
    });

    test("refuses the explanation for a subject in another project", async () => {
      subjectRead.mockResolvedValue(
        subjectInProject(subjectType, OTHER_PROJECT_ID),
      );

      expect(await callRoute()).toHaveBeenCalledWith(
        expect.any(NotAuthorizedException),
      );
      expectNoPrivateReads();
    });

    test("does not expose settings for an unreadable or nonexistent subject", async () => {
      subjectRead.mockResolvedValue(null);

      expect(await callRoute()).toHaveBeenCalledWith(
        expect.any(BadDataException),
      );
      expectNoPrivateReads();
    });

    test("propagates a private-subject denial without reading the reason", async () => {
      subjectRead.mockRejectedValue(
        new NotAuthorizedException("Private subject."),
      );

      expect(await callRoute()).toHaveBeenCalledWith(
        expect.any(NotAuthorizedException),
      );
      expectNoPrivateReads();
    });

    /*
     * A caller with no credentials at all (only a tenantid header) is an
     * expired session far more often than a stranger, so it gets 401 - the
     * status the dashboard answers by refreshing the session and replaying -
     * rather than the 422 it used to get.
     */
    test("requires a logged-in user before any subject or explanation read, answering an anonymous caller with 401", async () => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({ tenantId: PROJECT_ID });

      const next: jest.Mock = await callRoute();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticatedException));
      expect((next.mock.calls[0]![0] as NotAuthenticatedException).code).toBe(
        ExceptionCode.NotAuthenticatedException,
      );
      expect(subjectRead).not.toHaveBeenCalled();
      expectNoPrivateReads();
    });

    test("an anonymous caller with no tenant either still gets 401, not the missing-tenant 400", async () => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({ userType: UserType.Public });

      const next: jest.Mock = await callRoute();

      expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticatedException));
      expect(subjectRead).not.toHaveBeenCalled();
      expectNoPrivateReads();
    });

    /*
     * A project API key is authenticated, just not as a person. The panel
     * is a person's view, so the key is refused - with 422, never the 401
     * that would send its client off to refresh a session it never had.
     */
    test("refuses a project API key with 422 before any subject or explanation read", async () => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({ tenantId: PROJECT_ID, userType: UserType.API });

      const next: jest.Mock = await callRoute();

      expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
      expect(next).not.toHaveBeenCalledWith(
        expect.any(NotAuthenticatedException),
      );
      expect((next.mock.calls[0]![0] as NotAuthorizedException).message).toBe(
        "A logged-in user session is required.",
      );
      expect(subjectRead).not.toHaveBeenCalled();
      expectNoPrivateReads();
    });

    test("requires a tenant before any subject or explanation read", async () => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({ userId: USER_ID });

      expect(await callRoute()).toHaveBeenCalledWith(
        expect.any(BadDataException),
      );
      expect(subjectRead).not.toHaveBeenCalled();
      expectNoPrivateReads();
    });

    test("requires the subject id before reading settings", async () => {
      expect(await callRoute({})).toHaveBeenCalledWith(
        expect.any(BadDataException),
      );
      expect(subjectRead).not.toHaveBeenCalled();
      expectNoPrivateReads();
    });
  },
);
