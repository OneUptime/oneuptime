import ProjectAPI from "../../../Server/API/ProjectAPI";
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
});
