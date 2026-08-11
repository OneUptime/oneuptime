import ProjectAPI, {
  MAX_DELETION_REASON_LENGTH,
} from "../../../Server/API/ProjectAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { describe, expect, it } from "@jest/globals";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import BadDataException from "../../../Types/Exception/BadDataException";
import Permission, { UserPermission } from "../../../Types/Permission";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
  };
});

jest.mock("../../../Server/Services/BillingService");

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

jest.mock("../../../Server/Services/TeamMemberService");
jest.mock("../../../Server/Services/ProjectService");

describe("ProjectAPI", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  beforeEach(() => {
    new ProjectAPI();
    mockRequest = {} as OneUptimeRequest;
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /project/list-user-projects", () => {
    it("should respond with a empty list", async () => {
      const mockUserId: ObjectID = new ObjectID("123");
      mockRequest.userAuthorization = {
        userId: mockUserId,
      } as JSONWebTokenData;

      const mockTeamMembers: Array<TeamMember> = [
        {
          userId: mockUserId,
          hasAcceptedInvitation: true,
        } as TeamMember,
      ];

      const projects: Array<Project> = [];

      TeamMemberService.findBy = jest.fn().mockResolvedValue(mockTeamMembers);

      await mockRouter
        .match("post", "/project/list-user-projects")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(TeamMemberService.findBy).toHaveBeenCalledWith({
        query: {
          userId: mockUserId,
          hasAcceptedInvitation: true,
        },
        select: {
          project: {
            _id: true,
            name: true,
            trialEndsAt: true,
            paymentProviderPlanId: true,
            resellerId: true,
            isFeatureFlagMonitorGroupsEnabled: true,
            paymentProviderMeteredSubscriptionStatus: true,
            paymentProviderSubscriptionStatus: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendEntityArrayResponse",
      );
      expect(response).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        projects,
        new PositiveNumber(projects.length),
        Project,
      );
    });

    it("should respond with a list of projects by project", async () => {
      const mockUserId: ObjectID = new ObjectID("123");
      mockRequest.userAuthorization = {
        userId: mockUserId,
      } as JSONWebTokenData;

      const mockTeamMembers: Array<TeamMember> = [
        {
          userId: mockUserId,
          hasAcceptedInvitation: true,
          project: {
            _id: "project1",
            name: "Project 1",
            slug: "Project 1",
          },
        } as TeamMember,
        {
          userId: mockUserId,
          hasAcceptedInvitation: true,
          project: {
            _id: "project2",
            name: "Project 2",
            slug: "Project 2",
          },
        } as TeamMember,
      ];

      const projects: Array<Project> = [
        {
          _id: "project1",
          name: "Project 1",
          slug: "Project 1",
        } as Project,
        {
          _id: "project2",
          name: "Project 2",
          slug: "Project 2",
        } as Project,
      ];

      TeamMemberService.findBy = jest.fn().mockResolvedValue(mockTeamMembers);

      await mockRouter
        .match("post", "/project/list-user-projects")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(TeamMemberService.findBy).toHaveBeenCalledWith({
        query: {
          userId: mockUserId,
          hasAcceptedInvitation: true,
        },
        select: {
          project: {
            _id: true,
            name: true,
            trialEndsAt: true,
            paymentProviderPlanId: true,
            resellerId: true,
            isFeatureFlagMonitorGroupsEnabled: true,
            paymentProviderMeteredSubscriptionStatus: true,
            paymentProviderSubscriptionStatus: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendEntityArrayResponse",
      );
      expect(response).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        projects,
        new PositiveNumber(projects.length),
        Project,
      );
    });

    it("should handle authentication error", async () => {
      const authError: NotAuthenticatedException =
        new NotAuthenticatedException(
          "User should be logged in to access this API",
        );
      await mockRouter
        .match("post", "/project/list-user-projects")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(authError);
    });
  });

  describe("PUT /project/:id/change-plan", () => {
    const planId: string = "plan_123";

    const tenantMismatchError: BadDataException = new BadDataException(
      "Project ID in the URL does not match the project the request is authenticated for",
    );

    beforeEach(() => {
      ProjectService.findOneById = jest.fn().mockResolvedValue({
        paymentProviderCustomerId: "cus_123",
      } as Project);
      ProjectService.changePlan = jest.fn().mockResolvedValue(undefined);
      BillingService.hasPaymentMethods = jest.fn().mockResolvedValue(true);
    });

    it("should reject when the URL project id does not match the authenticated tenant", async () => {
      const victimProjectId: ObjectID = ObjectID.generate();
      const attackerProjectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: victimProjectId.toString() };
      mockRequest.tenantId = attackerProjectId;
      mockRequest.body = { data: { paymentProviderPlanId: planId } };

      await mockRouter
        .match("put", "/project/:id/change-plan")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(tenantMismatchError);
      expect(ProjectService.changePlan).not.toHaveBeenCalled();
      // the foreign project must not even be looked up.
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
    });

    it("should reject when the request has no authenticated tenant", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.body = { data: { paymentProviderPlanId: planId } };

      await mockRouter
        .match("put", "/project/:id/change-plan")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(tenantMismatchError);
      expect(ProjectService.changePlan).not.toHaveBeenCalled();
    });

    it("should change the plan of the authenticated tenant's own project", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.body = { data: { paymentProviderPlanId: planId } };

      jest
        .spyOn(ProjectAPI.prototype, "getPermissionsForTenant")
        .mockResolvedValue([
          {
            permission: Permission.ProjectOwner,
          } as UserPermission,
        ]);

      await mockRouter
        .match("put", "/project/:id/change-plan")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.changePlan).toHaveBeenCalledWith({
        projectId: projectId,
        paymentProviderPlanId: planId,
      });
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
    });
  });

  describe("PUT /project/:id/extend-trial", () => {
    const projectId: ObjectID = ObjectID.generate();

    beforeEach(() => {
      ProjectService.extendTrial = jest.fn().mockResolvedValue(undefined);
      mockRequest.params = { id: projectId.toString() };

      /*
       * Response is module-mocked once for the whole file, so its call log
       * carries over from the change-plan tests above.
       */
      (Response.sendEmptySuccessResponse as jest.Mock).mockClear();
    });

    it("should sit behind the master admin middleware", () => {
      /*
       * Extending a trial hands out free service across any project, so it
       * must not be reachable with project-level billing permissions - and not
       * with the static master API key either, only a master admin session.
       */
      expect(
        mockRouter.match("put", "/project/:id/extend-trial").middleware,
      ).toBe(MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware);
    });

    it("should extend the trial and respond with an empty success response", async () => {
      const trialEndsAt: string = "2027-01-15T00:00:00.000Z";
      mockRequest.body = { data: { trialEndsAt } };

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.extendTrial).toHaveBeenCalledWith({
        projectId: projectId,
        trialEndsAt: new Date(trialEndsAt),
      });
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
    });

    it("should work without a tenant id, since master admins act across projects", async () => {
      mockRequest.body = { data: { trialEndsAt: "2027-01-15T00:00:00.000Z" } };
      delete (mockRequest as { tenantId?: ObjectID }).tenantId;

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.extendTrial).toHaveBeenCalled();
    });

    it("should reject when trialEndsAt is missing", async () => {
      mockRequest.body = { data: {} };

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("Trial end date is required to extend the trial"),
      );
      expect(ProjectService.extendTrial).not.toHaveBeenCalled();
    });

    it("should reject when the body has no data object", async () => {
      mockRequest.body = {};

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("Trial end date is required to extend the trial"),
      );
      expect(ProjectService.extendTrial).not.toHaveBeenCalled();
    });

    it("should reject when trialEndsAt is not a parseable date", async () => {
      mockRequest.body = { data: { trialEndsAt: "not-a-date" } };

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("Trial end date is not a valid date"),
      );
      expect(ProjectService.extendTrial).not.toHaveBeenCalled();
    });

    it("should reject a non-string trialEndsAt", async () => {
      /*
       * OneUptimeDate.fromString hands back its own error text rather than a
       * Date for a non-string, which would sail past an isNaN check.
       */
      for (const value of [12345, { year: 2027 }, ["2027-01-15"], true]) {
        (nextFunction as jest.Mock).mockClear();
        mockRequest.body = { data: { trialEndsAt: value } };

        await mockRouter
          .match("put", "/project/:id/extend-trial")
          .handlerFunction(mockRequest, mockResponse, nextFunction);

        expect(nextFunction).toHaveBeenCalledWith(
          new BadDataException("Trial end date is not a valid date"),
        );
      }

      expect(ProjectService.extendTrial).not.toHaveBeenCalled();
    });

    it("should record which master admin granted the extension", async () => {
      const adminUserId: ObjectID = ObjectID.generate();

      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockReturnValue("a-master-admin-token");
      jest.spyOn(JSONWebToken, "decode").mockReturnValue({
        userId: adminUserId,
      } as JSONWebTokenData);

      mockRequest.body = { data: { trialEndsAt: "2027-01-15T00:00:00.000Z" } };

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(ProjectService.extendTrial).toHaveBeenCalledWith(
        expect.objectContaining({ extendedByUserId: adminUserId }),
      );
    });

    it("should still extend when the acting admin cannot be resolved", async () => {
      /*
       * The identity is only used for the audit log line - the middleware has
       * already authorized the request, so a decode failure must not block it.
       */
      jest
        .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
        .mockImplementation(() => {
          throw new Error("no cookie on this request");
        });

      mockRequest.body = { data: { trialEndsAt: "2027-01-15T00:00:00.000Z" } };

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.extendTrial).toHaveBeenCalledWith(
        expect.objectContaining({ extendedByUserId: undefined }),
      );
    });

    it("should forward service errors to next", async () => {
      const serviceError: BadDataException = new BadDataException(
        "Payment Provider subscription not found",
      );

      ProjectService.extendTrial = jest.fn().mockRejectedValue(serviceError);
      mockRequest.body = { data: { trialEndsAt: "2027-01-15T00:00:00.000Z" } };

      await mockRouter
        .match("put", "/project/:id/extend-trial")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(serviceError);
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });
  });

  /*
   * The delete confirmation in the dashboard asks why the customer is leaving,
   * and a DELETE has nowhere to put the answer. This route is the same delete
   * with a body - so the interesting cases are the ones where the body could
   * be used to reach a project the caller is not authenticated for, or to
   * store something the column was never sized for.
   */
  describe("POST /project/:id/delete-project", () => {
    const tenantMismatchError: BadDataException = new BadDataException(
      "Project ID in the URL does not match the project the request is authenticated for",
    );

    beforeEach(() => {
      ProjectService.deleteOneById = jest.fn().mockResolvedValue(1);
      /*
       * getDatabaseCommonInteractionProps asks for the plan of the
       * authenticated tenant when billing is on.
       */
      ProjectService.getCurrentPlan = jest.fn().mockResolvedValue({
        plan: null,
        isSubscriptionUnpaid: false,
      });
      mockRequest.headers = {};

      /*
       * Response is module-mocked once for the whole file, so its call log
       * carries over from the suites above.
       */
      (Response.sendEmptySuccessResponse as jest.Mock).mockClear();
    });

    it("deletes the authenticated tenant's own project", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.body = { data: { deletionReason: "We built our own" } };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.deleteOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: projectId,
          deletionReason: "We built our own",
        }),
      );
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
    });

    /*
     * Permissions are resolved for the authenticated tenant, so without this
     * guard being an owner of one project would authorize deleting another.
     */
    it("refuses to delete a project the request is not authenticated for", async () => {
      const victimProjectId: ObjectID = ObjectID.generate();
      const attackerProjectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: victimProjectId.toString() };
      mockRequest.tenantId = attackerProjectId;
      mockRequest.body = { data: { deletionReason: "not mine to delete" } };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(tenantMismatchError);
      expect(ProjectService.deleteOneById).not.toHaveBeenCalled();
    });

    it("refuses when the request has no authenticated tenant", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      delete mockRequest.tenantId;
      mockRequest.body = { data: { deletionReason: "anything" } };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(tenantMismatchError);
      expect(ProjectService.deleteOneById).not.toHaveBeenCalled();
    });

    it("rejects an id that is not a project id", async () => {
      mockRequest.params = { id: "not-a-uuid" };
      mockRequest.tenantId = ObjectID.generate();
      mockRequest.body = { data: {} };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(ProjectService.deleteOneById).not.toHaveBeenCalled();
    });

    /*
     * The reason is optional: a customer who does not want to answer must
     * still be able to delete their project.
     */
    it("deletes without a reason when none was given", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.body = {};

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.deleteOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: projectId,
          deletionReason: undefined,
        }),
      );
    });

    it("treats a blank reason as no reason", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.body = { data: { deletionReason: "   " } };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(ProjectService.deleteOneById).toHaveBeenCalledWith(
        expect.objectContaining({ deletionReason: undefined }),
      );
    });

    it("ignores a reason that is not text", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.body = { data: { deletionReason: { $ne: null } } };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.deleteOneById).toHaveBeenCalledWith(
        expect.objectContaining({ deletionReason: undefined }),
      );
    });

    /*
     * Postgres rejects NUL bytes in a text column. The insert that would fail
     * is the audit record of a project that has already been deleted, and
     * there is no second chance at writing it - so they are dropped here.
     */
    it("strips NUL bytes the database would reject", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.body = {
        data: { deletionReason: "too\u0000 expensive\u0000" },
      };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(ProjectService.deleteOneById).toHaveBeenCalledWith(
        expect.objectContaining({ deletionReason: "too expensive" }),
      );
    });

    it("treats a reason that is only NUL bytes as no reason", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.body = { data: { deletionReason: "\u0000\u0000" } };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ProjectService.deleteOneById).toHaveBeenCalledWith(
        expect.objectContaining({ deletionReason: undefined }),
      );
    });

    it("trims the reason before storing it", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.body = { data: { deletionReason: "  too expensive  " } };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(ProjectService.deleteOneById).toHaveBeenCalledWith(
        expect.objectContaining({ deletionReason: "too expensive" }),
      );
    });

    /*
     * The column is unbounded text and the field is free text from a browser,
     * so the only thing standing between a client and an arbitrarily large
     * row is this cap.
     */
    it("caps how much free text a client can store", async () => {
      const projectId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.body = {
        data: { deletionReason: "a".repeat(MAX_DELETION_REASON_LENGTH + 500) },
      };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const call: { deletionReason?: string } = (
        ProjectService.deleteOneById as unknown as {
          mock: { calls: Array<Array<{ deletionReason?: string }>> };
        }
      ).mock.calls[0]![0]!;

      expect(call.deletionReason).toHaveLength(MAX_DELETION_REASON_LENGTH);
    });

    /*
     * The delete goes through the ordinary permission-checked path with the
     * caller's own props - the reason must not turn this into a privileged
     * delete.
     */
    it("deletes as the caller, not as root", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const userId: ObjectID = ObjectID.generate();

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.userAuthorization = { userId: userId } as JSONWebTokenData;
      mockRequest.body = { data: { deletionReason: "done with it" } };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const call: { props: { isRoot?: boolean; userId?: ObjectID } } = (
        ProjectService.deleteOneById as unknown as {
          mock: {
            calls: Array<
              Array<{ props: { isRoot?: boolean; userId?: ObjectID } }>
            >;
          };
        }
      ).mock.calls[0]![0]!;

      expect(call.props.isRoot).toBeFalsy();
      expect(call.props.userId).toBe(userId);
    });

    it("forwards a refused delete to next instead of reporting success", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const notAllowed: BadDataException = new BadDataException(
        "Delete on Project is not allowed",
      );

      ProjectService.deleteOneById = jest.fn().mockRejectedValue(notAllowed);

      mockRequest.params = { id: projectId.toString() };
      mockRequest.tenantId = projectId;
      mockRequest.body = { data: { deletionReason: "nope" } };

      await mockRouter
        .match("post", "/project/:id/delete-project")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(notAllowed);
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });
  });
});
