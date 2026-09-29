import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import BillingPaymentMethodAPI from "../../../Server/API/BillingPaymentMethodAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import BillingService from "../../../Server/Services/BillingService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import Project from "../../../Models/DatabaseModels/Project";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
  };
});

type SetBillingEnabledFunction = (enabled: boolean) => void;

/*
 * The route reads IsBillingEnabled off the module on every request, so
 * flipping it on the mocked module switches billing off for one test.
 */
const setBillingEnabled: SetBillingEnabledFunction = (
  enabled: boolean,
): void => {
  (
    jest.requireMock("../../../Server/EnvironmentConfig") as {
      IsBillingEnabled: boolean;
    }
  ).IsBillingEnabled = enabled;
};
jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
    },
  };
});
/*
 * Both middlewares are distinct mocks so the route registration can be
 * asserted by identity. Leaving requireUserAuthentication out would register
 * `undefined` in its place, and toEqual reads a trailing undefined as absent.
 */
jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});
jest.mock("../../../Server/API/CommonAPI", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Services/BillingPaymentMethodService", () => {
  return {
    __esModule: true,
    default: {},
    Service: class {},
  };
});
jest.mock("../../../Server/Services/BillingService", () => {
  return {
    __esModule: true,
    default: {
      makePaymentMethodDefault: jest.fn(),
      getSetupIntentSecret: jest.fn(),
    },
  };
});
jest.mock("../../../Server/Services/ProjectService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});
jest.mock("../../../Server/Services/PayAsYouGoBillingService", () => {
  return { __esModule: true, default: { invalidate: jest.fn() } };
});

const SET_DEFAULT_ROUTE: string = "/billing-payment-methods/set-default";
const SETUP_ROUTE: string = "/billing-payment-methods/setup";

// The ids from the production incident this route exists for.
const PROJECT_CUSTOMER_ID: string = "cus_stale_card_customer";
const NEW_CARD_ID: string = "pm_new_default_card";

const PROJECT_ID_IN_BODY_MESSAGE: string =
  "projectId should not be passed in the request body. The project is resolved from the tenantid header.";

describe("BillingPaymentMethodAPI", () => {
  const projectId: ObjectID = ObjectID.generate();

  let req: OneUptimeRequest;
  let res: OneUptimeResponse;
  let next: MockFunction;
  let project: Project;
  let permissions: ReturnType<typeof getJestSpyOn>;

  const makePaymentMethodDefault: MockFunction =
    BillingService.makePaymentMethodDefault as unknown as MockFunction;
  const getSetupIntentSecret: MockFunction =
    BillingService.getSetupIntentSecret as unknown as MockFunction;
  const findProject: MockFunction =
    ProjectService.findOneById as unknown as MockFunction;
  const invalidate: MockFunction =
    PayAsYouGoBillingService.invalidate as unknown as MockFunction;

  type CallRouteFunction = (uri: string) => Promise<void>;

  const callRoute: CallRouteFunction = async (uri: string): Promise<void> => {
    await mockRouter
      .match("post", uri)
      .handlerFunction(req, res, next as unknown as NextFunction);
  };

  type GivenPermissionsFunction = (list: Array<Permission>) => void;

  const givenPermissions: GivenPermissionsFunction = (
    list: Array<Permission>,
  ): void => {
    permissions.mockResolvedValue(
      list.map((permission: Permission) => {
        return { permission: permission } as UserPermission;
      }),
    );
  };

  type NextErrorFunction = () => unknown;

  const nextError: NextErrorFunction = (): unknown => {
    return next.mock.calls[0]?.[0];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setBillingEnabled(true);
    mockRouter.routes = [];

    new BillingPaymentMethodAPI();

    project = new Project();
    project.id = projectId;
    project.paymentProviderCustomerId = PROJECT_CUSTOMER_ID;

    findProject.mockResolvedValue(project as never);
    makePaymentMethodDefault.mockResolvedValue(undefined as never);
    getSetupIntentSecret.mockResolvedValue("seti_secret" as never);

    permissions = getJestSpyOn(
      BillingPaymentMethodAPI.prototype,
      "getPermissionsForTenant",
    ).mockResolvedValue([
      { permission: Permission.ProjectOwner } as UserPermission,
    ]);

    req = {
      tenantId: projectId,
      body: {
        data: {
          paymentProviderPaymentMethodId: NEW_CARD_ID,
        },
      },
    } as unknown as OneUptimeRequest;
    res = {} as OneUptimeResponse;
    next = getJestMockFunction();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe(`POST ${SET_DEFAULT_ROUTE}`, () => {
    /*
     * getUserMiddleware lets a request with no session through as Public;
     * requireUserAuthentication then answers it with a 401. The billing page
     * left open past the access-token lifetime sends exactly that request,
     * and the 401 is what makes the browser client refresh the session and
     * replay it instead of showing a permission error.
     */
    it("is registered behind the user middleware and the authentication guard", () => {
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        SET_DEFAULT_ROUTE,
      );

      expect(route.middlewares).toStrictEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    });

    it("makes the card the default on the project's own customer, invalidates the pay-as-you-go cache and answers with an empty success", async () => {
      await callRoute(SET_DEFAULT_ROUTE);

      expect(next).not.toHaveBeenCalled();
      expect(findProject).toHaveBeenCalledWith(
        expect.objectContaining({
          id: projectId,
          props: { isRoot: true },
          select: expect.objectContaining({
            paymentProviderCustomerId: true,
          }),
        }),
      );
      expect(makePaymentMethodDefault).toHaveBeenCalledTimes(1);
      expect(makePaymentMethodDefault).toHaveBeenCalledWith(
        PROJECT_CUSTOMER_ID,
        NEW_CARD_ID,
      );
      expect(invalidate).toHaveBeenCalledWith(projectId);
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(req, res);

      // The cache is dropped only after the provider has the new default.
      expect(
        makePaymentMethodDefault.mock.invocationCallOrder[0] as number,
      ).toBeLessThan(invalidate.mock.invocationCallOrder[0] as number);
    });

    it("ignores a customer id in the body and always uses the project's own customer", async () => {
      req.body = {
        data: {
          paymentProviderPaymentMethodId: NEW_CARD_ID,
          paymentProviderCustomerId: "cus_another_tenant",
        },
      };

      await callRoute(SET_DEFAULT_ROUTE);

      expect(makePaymentMethodDefault).toHaveBeenCalledWith(
        PROJECT_CUSTOMER_ID,
        NEW_CARD_ID,
      );
    });

    it("refuses when billing is disabled", async () => {
      setBillingEnabled(false);

      await callRoute(SET_DEFAULT_ROUTE);

      expect(nextError()).toEqual(
        new BadDataException("Billing is not enabled for this server"),
      );
      expect(findProject).not.toHaveBeenCalled();
      expect(makePaymentMethodDefault).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    it("rejects a projectId in the body - the project comes from the tenantid header", async () => {
      req.body = {
        projectId: ObjectID.generate().toString(),
        data: { paymentProviderPaymentMethodId: NEW_CARD_ID },
      };

      await callRoute(SET_DEFAULT_ROUTE);

      expect(nextError()).toEqual(
        new BadDataException(PROJECT_ID_IN_BODY_MESSAGE),
      );
      expect(findProject).not.toHaveBeenCalled();
      expect(makePaymentMethodDefault).not.toHaveBeenCalled();
    });

    it.each([
      [[] as Array<Permission>],
      [[Permission.ProjectMember]],
      [[Permission.ReadBillingPaymentMethod, Permission.BillingViewer]],
      [[Permission.DeleteBillingPaymentMethod]],
    ])("refuses a member holding %j", async (held: Array<Permission>) => {
      givenPermissions(held);

      await callRoute(SET_DEFAULT_ROUTE);

      expect(nextError()).toBeInstanceOf(BadDataException);
      expect((nextError() as Error).message).toContain(
        "change the default payment method",
      );
      expect(findProject).not.toHaveBeenCalled();
      expect(makePaymentMethodDefault).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    });

    it.each([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
      Permission.CreateBillingPaymentMethod,
      Permission.EditBillingPaymentMethod,
    ])("allows a member holding %s", async (held: Permission) => {
      givenPermissions([Permission.ProjectMember, held]);

      await callRoute(SET_DEFAULT_ROUTE);

      expect(next).not.toHaveBeenCalled();
      expect(makePaymentMethodDefault).toHaveBeenCalledWith(
        PROJECT_CUSTOMER_ID,
        NEW_CARD_ID,
      );
    });

    it("allows a master admin with no project permission", async () => {
      givenPermissions([]);
      (req as unknown as { userAuthorization: unknown }).userAuthorization = {
        isMasterAdmin: true,
      };

      await callRoute(SET_DEFAULT_ROUTE);

      expect(next).not.toHaveBeenCalled();
      expect(makePaymentMethodDefault).toHaveBeenCalledWith(
        PROJECT_CUSTOMER_ID,
        NEW_CARD_ID,
      );
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalled();
    });

    it("refuses a request with no tenant", async () => {
      (req as unknown as { tenantId: unknown }).tenantId = undefined;

      await callRoute(SET_DEFAULT_ROUTE);

      expect(nextError()).toEqual(new BadDataException("Project not found"));
      expect(findProject).not.toHaveBeenCalled();
      expect(makePaymentMethodDefault).not.toHaveBeenCalled();
    });

    it("refuses when the project does not exist", async () => {
      findProject.mockResolvedValue(null as never);

      await callRoute(SET_DEFAULT_ROUTE);

      expect(nextError()).toEqual(new BadDataException("Project not found"));
      expect(makePaymentMethodDefault).not.toHaveBeenCalled();
    });

    it("refuses when the project has no payment provider customer", async () => {
      (
        project as unknown as { paymentProviderCustomerId?: string | undefined }
      ).paymentProviderCustomerId = undefined;

      await callRoute(SET_DEFAULT_ROUTE);

      expect(nextError()).toEqual(
        new BadDataException("Payment Provider customer not found"),
      );
      expect(makePaymentMethodDefault).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    });

    it.each([
      ["no data at all", {}],
      ["no payment method id", { data: {} }],
      [
        "an empty payment method id",
        { data: { paymentProviderPaymentMethodId: "" } },
      ],
      [
        "a blank payment method id",
        { data: { paymentProviderPaymentMethodId: "   " } },
      ],
      [
        "a payment method id that is not a string",
        { data: { paymentProviderPaymentMethodId: 12345 } },
      ],
      [
        "a payment method id given as an object",
        { data: { paymentProviderPaymentMethodId: { id: NEW_CARD_ID } } },
      ],
    ])("refuses %s", async (_case: string, body: Record<string, unknown>) => {
      req.body = body;

      await callRoute(SET_DEFAULT_ROUTE);

      expect(nextError()).toEqual(
        new BadDataException("Payment method ID not found"),
      );
      expect(makePaymentMethodDefault).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    });

    it("passes the service's refusal of another customer's card to the error handler", async () => {
      const refusal: BadDataException = new BadDataException(
        "Payment method does not belong to this project",
      );
      makePaymentMethodDefault.mockRejectedValue(refusal as never);

      await callRoute(SET_DEFAULT_ROUTE);

      expect(next).toHaveBeenCalledWith(refusal);
      expect(invalidate).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    /*
     * The service translates a failed provider write into an Exception before
     * it gets here (BillingService.writePaymentProvider). That matters at this
     * boundary: the global handler only formats an Exception, so anything else
     * is answered as an opaque 500 {"error":"Server Error"} - and the billing
     * page would then tell the customer "Reason: Server Error" for what is
     * usually a transient provider failure worth retrying.
     */
    it.each([
      [
        "a provider that could not be reached",
        new ServiceUnavailableException(
          "Could not reach the payment provider to update your default payment method. Please try again.",
        ),
      ],
      [
        "a write the provider refused",
        new BadDataException("This subscription cannot be updated"),
      ],
    ])(
      "passes %s to the error handler as an Exception instead of reporting success",
      async (_case: string, failure: Exception) => {
        makePaymentMethodDefault.mockRejectedValue(failure as never);

        await callRoute(SET_DEFAULT_ROUTE);

        expect(next).toHaveBeenCalledWith(failure);
        expect(nextError()).toBeInstanceOf(Exception);
        expect(invalidate).not.toHaveBeenCalled();
        expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
      },
    );

    it("passes a failed permission lookup to the error handler", async () => {
      const failure: Error = new Error("permission lookup failed");
      permissions.mockRejectedValue(failure);

      await callRoute(SET_DEFAULT_ROUTE);

      expect(next).toHaveBeenCalledWith(failure);
      expect(makePaymentMethodDefault).not.toHaveBeenCalled();
    });

    it("trims whitespace around the payment method id", async () => {
      req.body = {
        data: { paymentProviderPaymentMethodId: `  ${NEW_CARD_ID}\n` },
      };

      await callRoute(SET_DEFAULT_ROUTE);

      expect(makePaymentMethodDefault).toHaveBeenCalledWith(
        PROJECT_CUSTOMER_ID,
        NEW_CARD_ID,
      );
    });
  });

  describe(`POST ${SETUP_ROUTE}`, () => {
    it("is registered behind the user middleware and the authentication guard", () => {
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        SETUP_ROUTE,
      );

      expect(route.middlewares).toStrictEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    });

    it("rejects a projectId in the body with a message that says so", async () => {
      /*
       * The check always rejected a body projectId, but told the caller that
       * projectId was REQUIRED - the opposite of what it enforced.
       */
      req.body = { projectId: ObjectID.generate().toString() };

      await callRoute(SETUP_ROUTE);

      expect(nextError()).toEqual(
        new BadDataException(PROJECT_ID_IN_BODY_MESSAGE),
      );
      expect(getSetupIntentSecret).not.toHaveBeenCalled();
    });

    it("still returns a setup intent for the project's own customer", async () => {
      req.body = {};

      await callRoute(SETUP_ROUTE);

      expect(next).not.toHaveBeenCalled();
      expect(getSetupIntentSecret).toHaveBeenCalledWith(PROJECT_CUSTOMER_ID);
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(req, res, {
        setupIntent: "seti_secret",
      });
    });

    it("still refuses a member without permission to add a payment method", async () => {
      givenPermissions([Permission.EditBillingPaymentMethod]);
      req.body = {};

      await callRoute(SETUP_ROUTE);

      expect(nextError()).toBeInstanceOf(BadDataException);
      expect(getSetupIntentSecret).not.toHaveBeenCalled();
    });
  });
});
