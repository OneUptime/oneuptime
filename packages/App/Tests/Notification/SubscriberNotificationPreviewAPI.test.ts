import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import UserService from "Common/Server/Services/UserService";
import Response from "Common/Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import SubscriberNotificationPreviewBuilder, {
  SubscriberNotificationPreviewBuild,
  SubscriberNotificationPreviewPage,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationPreviewBuilder";
import User from "Common/Models/DatabaseModels/User";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import Hostname from "Common/Types/API/Hostname";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import IncidentSubscriberAudience from "Common/Types/StatusPage/IncidentSubscriberAudience";
import SubscriberNotificationPreview, {
  SubscriberEmailTemplateChoiceReason,
  SubscriberNotificationPreviewEvent,
  SubscriberNotificationPreviewNothingSentReason,
} from "Common/Types/StatusPage/SubscriberNotificationPreview";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * POST /api/notification/subscriber-notification-preview/preview and
 * /send-test: "Preview notification" and "Send test to me".
 *
 * The routes are module-level Express registrations, so the router is mocked
 * and each handler invoked directly, as the sibling SMTP config test does.
 * CommonAPI's guards are the real ones. The preview itself is
 * SubscriberNotificationPreviewBuilder's (tested on its own in Common); here
 * it is stubbed, so what is pinned is the route's own job:
 *
 *   - both routes need a signed-in member of the project in the tenant
 *     header, and each sits behind its own per-user rate limit;
 *   - /preview renders each page's email with the mailer's own render, the
 *     one send() renders with, and answers with no address;
 *   - /send-test sends only to the caller's own verified account email -
 *     whatever the body says - through the page's own SMTP server, with
 *     [Test] in front of the subject and the body exactly as previewed.
 */

const RATE_LIMIT_MIDDLEWARE: () => void = jest.fn();
const PREVIEW_RATE_LIMIT_MIDDLEWARE: () => void = jest.fn();

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});

jest.mock(
  "Common/Server/Middleware/SubscriberNotificationTestSendRateLimit",
  () => {
    return {
      __esModule: true,
      default: {
        getMiddleware: () => {
          return RATE_LIMIT_MIDDLEWARE;
        },
      },
    };
  },
);

jest.mock(
  "Common/Server/Middleware/SubscriberNotificationPreviewRateLimit",
  () => {
    return {
      __esModule: true,
      default: {
        getMiddleware: () => {
          return PREVIEW_RATE_LIMIT_MIDDLEWARE;
        },
      },
    };
  },
);

jest.mock("../../FeatureSet/Notification/Services/MailService", () => {
  return {
    __esModule: true,
    default: { send: jest.fn(), render: jest.fn() },
  };
});

import MailService from "../../FeatureSet/Notification/Services/MailService";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import "../../FeatureSet/Notification/API/SubscriberNotificationPreview";

const PREVIEW_ROUTE: string = SubscriberNotificationPreview.previewPath;
const SEND_TEST_ROUTE: string = SubscriberNotificationPreview.sendTestPath;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");
const INCIDENT_ID: string = "a0000000-0000-4000-8000-00000000000a";
const SITE_1: string = "b0000000-0000-4000-8000-000000000001";

const CALLER_EMAIL: string = "me@acme.com";
const SMTP_CONFIG: JSONObject = { _id: "f0000000-0000-4000-8000-000000000001" };
const PAGE_MAIL_SERVER: EmailServer = {
  id: new ObjectID("f0000000-0000-4000-8000-000000000001"),
  host: Hostname.fromString("smtp.acme.com"),
  port: new Port(587),
  secure: true,
  username: "apikey",
  password: "secret",
  fromName: "Acme",
  fromEmail: new Email("status@acme.com"),
};

const NOTE_BODY: JSONObject = {
  event: "IncidentPublicNoteCreated",
  incidentId: INCIDENT_ID,
  note: "We are **rolling back**.",
  postedAt: null,
};

let callerProps: DatabaseCommonInteractionProps;
let user: User | null;
let build: SubscriberNotificationPreviewBuild;

function memberProps(projectId: ObjectID): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
      } as UserPermission,
    ],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[projectId.toString()] = tenantPermission;

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userTenantAccessPermission: permissionMap,
  };
}

function page(): SubscriberNotificationPreviewPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = SITE_1;
  (statusPage as unknown as JSONObject)["smtpConfig"] = SMTP_CONFIG;

  return {
    statusPage: statusPage,
    statusPageId: SITE_1,
    name: "Site 01",
    subscriberCounts: {
      ...IncidentSubscriberAudience.getEmptyCounts(),
      email: 41,
    },
    templateChoice: {
      usesCustomTemplate: false,
      reason: SubscriberEmailTemplateChoiceReason.NoCustomTemplate,
    },
    email: {
      subject: "[Update Incident] Checkout failing",
      envelope: {
        templateType: EmailTemplateType.SubscriberIncidentNoteCreated,
        vars: {
          incidentTitle: "Checkout failing",
          unsubscribeUrl: `https://status.acme.com/unsubscribe/preview`,
        },
        subject: "[Update Incident] Checkout failing",
        isSubjectLiteral: true,
      },
    },
  };
}

function built(
  partial: Partial<SubscriberNotificationPreviewBuild> = {},
): SubscriberNotificationPreviewBuild {
  return {
    event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
    nothingSentReason: null,
    audience: {
      hasMonitors: true,
      isScoped: false,
      isHiddenFromStatusPages: false,
      statusPages: [
        {
          statusPageId: SITE_1,
          name: "Site 01",
          subscriberCounts: {
            ...IncidentSubscriberAudience.getEmptyCounts(),
            email: 41,
          },
        },
      ],
      hiddenStatusPageCount: 0,
      excludedStatusPages: [],
      selectedStatusPagesNotListingMonitors: [],
    },
    statusPages: [page()],
    ...partial,
  };
}

interface RouteCall {
  thrown: unknown;
  sent: JSONObject | undefined;
}

async function post(route: string, body: unknown): Promise<RouteCall> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as ExpressResponse;
  const next: jest.Mock = jest.fn() as unknown as jest.Mock;

  await mockRouter
    .match("post", route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    sent: send.mock.calls[0]
      ? (send.mock.calls[0][2] as JSONObject)
      : undefined,
  };
}

function sentMail(): EmailMessage {
  return (MailService.send as unknown as jest.Mock).mock
    .calls[0]![0] as EmailMessage;
}

function sendOptions(): JSONObject {
  return (MailService.send as unknown as jest.Mock).mock
    .calls[0]![1] as JSONObject;
}

let buildSpy: jest.Mock;

beforeAll(() => {
  // Registered at import; the helper router is shared by every suite.
  expect(
    mockRouter.routes.some((route: { uri: string }): boolean => {
      return route.uri === PREVIEW_ROUTE;
    }),
  ).toBe(true);
});

beforeEach(() => {
  jest.clearAllMocks();

  callerProps = memberProps(PROJECT_ID);
  user = Object.assign(new User(), {
    email: new Email(CALLER_EMAIL),
    isEmailVerified: true,
  });
  build = built();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async () => {
      return callerProps;
    }) as never);

  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    return user;
  }) as never);

  buildSpy = jest.fn(async () => {
    return build;
  }) as unknown as jest.Mock;
  jest
    .spyOn(SubscriberNotificationPreviewBuilder, "build")
    .mockImplementation(buildSpy as never);

  jest.spyOn(ProjectSMTPConfigService, "toEmailServer").mockImplementation(((
    config: unknown,
  ) => {
    return config === SMTP_CONFIG ? PAGE_MAIL_SERVER : undefined;
  }) as never);

  (MailService.render as unknown as jest.Mock).mockImplementation(
    (async (envelope: { subject: string; templateType: string }) => {
      return {
        subject: envelope.subject,
        body: `<html>rendered ${envelope.templateType}</html>`,
      };
    }) as never,
  );
  (MailService.send as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the routes", () => {
  test("both need a signed-in user, and each is rate limited per user after that", () => {
    const preview: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "post",
      PREVIEW_ROUTE,
    );
    const sendTest: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "post",
      SEND_TEST_ROUTE,
    );

    /*
     * A preview renders an email for every page the caller can read: any
     * audience role could otherwise ask for as much rendering as it liked.
     */
    expect(preview.middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      PREVIEW_RATE_LIMIT_MIDDLEWARE,
    ]);
    expect(sendTest.middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      RATE_LIMIT_MIDDLEWARE,
    ]);
  });

  test.each([PREVIEW_ROUTE, SEND_TEST_ROUTE])(
    "%s refuses a caller who is not signed in",
    async (route: string) => {
      callerProps = {};

      const call: RouteCall = await post(route, NOTE_BODY);

      expect(call.thrown).toBeInstanceOf(NotAuthenticatedException);
      expect(buildSpy).not.toHaveBeenCalled();
      expect(MailService.send).not.toHaveBeenCalled();
    },
  );

  test.each([PREVIEW_ROUTE, SEND_TEST_ROUTE])(
    "%s refuses a member of another project naming this one",
    async (route: string) => {
      callerProps = memberProps(OTHER_PROJECT_ID);

      const call: RouteCall = await post(route, {
        ...NOTE_BODY,
        statusPageId: SITE_1,
      });

      expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
      expect(buildSpy).not.toHaveBeenCalled();
      expect(MailService.send).not.toHaveBeenCalled();
    },
  );
});

describe("POST /preview", () => {
  test("builds for the caller's project and renders each page with the mailer's render", async () => {
    const call: RouteCall = await post(PREVIEW_ROUTE, NOTE_BODY);

    expect(call.thrown).toBeUndefined();

    const args: JSONObject = buildSpy.mock.calls[0]![0] as JSONObject;
    expect((args["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(args["props"]).toBe(callerProps);
    expect(args["onlyStatusPageId"]).toBeUndefined();
    expect(args["request"]).toEqual({
      event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
      incidentId: INCIDENT_ID,
      note: "We are **rolling back**.",
      postedAt: null,
    });

    expect(MailService.render).toHaveBeenCalledWith(page().email.envelope);
    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);

    const answer: JSONObject = call.sent!;
    const pages: Array<JSONObject> = answer["statusPages"] as Array<JSONObject>;

    expect(pages).toHaveLength(1);
    expect(pages[0]!["html"]).toBe(
      "<html>rendered SubscriberIncidentNoteCreated.hbs</html>",
    );
    expect(pages[0]!["subject"]).toBe("[Update Incident] Checkout failing");
    expect(pages[0]!["subscriberCounts"]).toEqual(
      page().subscriberCounts as unknown as JSONObject,
    );
  });

  test("never answers with an address or the page's mail settings", async () => {
    const call: RouteCall = await post(PREVIEW_ROUTE, NOTE_BODY);
    const text: string = JSON.stringify(call.sent);

    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toContain("smtpConfig");
    expect(text).not.toContain(SMTP_CONFIG["_id"] as string);
  });

  test("a request that is not one is refused before anything is built", async () => {
    const call: RouteCall = await post(PREVIEW_ROUTE, { event: "Nope" });

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(buildSpy).not.toHaveBeenCalled();
  });

  test("nothing will be sent: answered, with no email", async () => {
    build = built({
      nothingSentReason:
        SubscriberNotificationPreviewNothingSentReason.NoMonitors,
      statusPages: [],
    });

    const call: RouteCall = await post(PREVIEW_ROUTE, NOTE_BODY);

    expect(call.sent!["nothingSentReason"]).toBe("NoMonitors");
    expect(call.sent!["statusPages"]).toEqual([]);
    expect(MailService.render).not.toHaveBeenCalled();
  });
});

describe("POST /send-test", () => {
  const SEND_TEST_BODY: JSONObject = { ...NOTE_BODY, statusPageId: SITE_1 };

  test("sends the page's email to the caller's own address only, as previewed, marked as a test", async () => {
    const call: RouteCall = await post(SEND_TEST_ROUTE, {
      ...SEND_TEST_BODY,
      toEmail: "someone-else@example.com",
      SMTP_HOST: "attacker.example.com",
    });

    expect(call.thrown).toBeUndefined();
    expect(call.sent).toEqual({ sentTo: CALLER_EMAIL });

    expect(MailService.send).toHaveBeenCalledTimes(1);

    const mail: EmailMessage = sentMail();

    expect(mail.toEmail.toString()).toBe(CALLER_EMAIL);
    expect(mail.subject).toBe("[Test] [Update Incident] Checkout failing");
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.templateType).toBe(page().email.envelope.templateType);
    expect(mail.vars).toEqual(page().email.envelope.vars);

    const options: JSONObject = sendOptions();
    expect(options["emailServer"]).toBe(PAGE_MAIL_SERVER);
    expect((options["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((options["statusPageId"] as ObjectID).toString()).toBe(SITE_1);
    expect((options["userId"] as ObjectID).toString()).toBe(USER_ID.toString());

    // Only that page's email is built.
    expect((buildSpy.mock.calls[0]![0] as JSONObject)["onlyStatusPageId"]).toBe(
      SITE_1,
    );

    // The caller's address is read by their own id.
    expect(
      (
        (UserService.findOneById as unknown as jest.Mock).mock.calls[0]![0] as {
          id: ObjectID;
        }
      ).id.toString(),
    ).toBe(USER_ID.toString());
  });

  test("a page with no SMTP server of its own sends through the instance's mail settings", async () => {
    const withoutSmtp: SubscriberNotificationPreviewPage = page();
    delete (withoutSmtp.statusPage as unknown as JSONObject)["smtpConfig"];
    build = built({ statusPages: [withoutSmtp] });

    await post(SEND_TEST_ROUTE, SEND_TEST_BODY);

    expect(sendOptions()["emailServer"]).toBeUndefined();
  });

  test("an unverified account email is not sent to", async () => {
    user = Object.assign(new User(), {
      email: new Email(CALLER_EMAIL),
      isEmailVerified: false,
    });

    const call: RouteCall = await post(SEND_TEST_ROUTE, SEND_TEST_BODY);

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect((call.thrown as Error).message).toContain("Verify your account");
    expect(MailService.send).not.toHaveBeenCalled();
  });

  test("no account email: nothing is sent", async () => {
    user = null;

    const call: RouteCall = await post(SEND_TEST_ROUTE, SEND_TEST_BODY);

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(MailService.send).not.toHaveBeenCalled();
  });

  test("a request naming no status page is refused before anything is read", async () => {
    const call: RouteCall = await post(SEND_TEST_ROUTE, NOTE_BODY);

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(UserService.findOneById).not.toHaveBeenCalled();
    expect(MailService.send).not.toHaveBeenCalled();
  });

  test("nothing would be sent: refused with why", async () => {
    build = built({
      nothingSentReason:
        SubscriberNotificationPreviewNothingSentReason.HiddenFromStatusPages,
      statusPages: [],
    });

    const call: RouteCall = await post(SEND_TEST_ROUTE, SEND_TEST_BODY);

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect((call.thrown as Error).message).toContain(
      "this incident is hidden from status pages",
    );
    expect(MailService.send).not.toHaveBeenCalled();
  });

  test("a page that would not be sent the email, or that the caller cannot see, is refused", async () => {
    build = built({ statusPages: [] });

    const call: RouteCall = await post(SEND_TEST_ROUTE, SEND_TEST_BODY);

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(MailService.send).not.toHaveBeenCalled();
  });

  test("a mail server that refuses the email: said so plainly", async () => {
    (MailService.send as unknown as jest.Mock).mockRejectedValue(
      new Error("Invalid login: 535 Authentication failed") as never,
    );

    const call: RouteCall = await post(SEND_TEST_ROUTE, SEND_TEST_BODY);

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect((call.thrown as Error).message).toBe(
      "The test email could not be sent: Invalid login: 535 Authentication failed",
    );
  });
});
