import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import MailService from "../../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "../../../Server/Services/ProjectSmtpConfigService";
import SmsService from "../../../Server/Services/SmsService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberNotificationTemplateVariables from "../../../Types/StatusPage/SubscriberNotificationTemplateVariables";
import { getDefaultSubscriberNotificationTemplate } from "../../../../App/FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
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
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * "Send me a link to manage my subscription" on a status page: the
 * manage-subscription endpoint looks the subscriber up by email, phone or
 * Slack workspace and sends them the link on that channel, through the status
 * page's custom template when it has one.
 *
 * Template authors are promised the variables in
 * SubscriberNotificationTemplateVariables for this event. These tests drive
 * the endpoint against fakes and check that every one of them reaches the
 * template with a real value on every channel the endpoint sends on, that the
 * page is named by its public title like every other subscriber message, and
 * that the default messages are what the dashboard shows as the starters.
 */

const MANAGE_ROUTE: string = "/status-page/manage-subscription/:statusPageId";

const EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberManageSubscription;

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "3f1a7c52-8d4e-4b6a-9c21-5e7d0b8a4f13",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "9b2e4d61-0a3c-4f7e-8d15-6c4b2a1e7f90",
);
const SUBSCRIBER_ID: string = "c47d2e19-5b8a-4e36-a0f2-7d91b3c56e28";

// The public title and the internal name differ, so a test can tell them apart.
const PAGE_TITLE: string = "Acme Cloud Status";
const INTERNAL_NAME: string = "acme-prod-internal-page";

const STATUS_PAGE_URL: string = "https://status.acme-example.com";

// Where the subscriber manages (or cancels) their subscription.
const MANAGE_URL: string =
  "https://status.acme-example.com/update-subscription/c47d2e19-5b8a-4e36-a0f2-7d91b3c56e28";

const SUBSCRIBER_EMAIL: string = "manage.subscriber@acme-example.com";
const SUBSCRIBER_PHONE: string = "+15550100123";
const SLACK_WORKSPACE_NAME: string = "acme-ops-workspace";
const SLACK_WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T0ACME/B0ACME/fixturewebhook";

const EMAIL_SUBJECT_TEMPLATE: string =
  "Manage {{statusPageName}} at {{manageSubscriptionUrl}}";

interface ChannelCase {
  name: string;
  method: StatusPageSubscriberNotificationMethod;
  requestData: JSONObject;
  // Email compiles its subject as well as its body.
  compileCallsPerRequest: number;
}

const CHANNELS: Array<ChannelCase> = [
  {
    name: "email",
    method: StatusPageSubscriberNotificationMethod.Email,
    requestData: { subscriberEmail: SUBSCRIBER_EMAIL },
    compileCallsPerRequest: 2,
  },
  {
    name: "sms",
    method: StatusPageSubscriberNotificationMethod.SMS,
    requestData: { subscriberPhone: SUBSCRIBER_PHONE },
    compileCallsPerRequest: 1,
  },
  {
    name: "slack",
    method: StatusPageSubscriberNotificationMethod.Slack,
    requestData: { slackWorkspaceName: SLACK_WORKSPACE_NAME },
    compileCallsPerRequest: 1,
  },
];

interface CompileCall {
  template: string;
  variables: Record<string, string>;
}

interface PageOptions {
  withCustomSmtpAndSms: boolean;
  pageTitle?: string | undefined;
  name?: string | undefined;
}

type MockOfFunction = (fn: unknown) => jest.Mock;

const mockOf: MockOfFunction = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

type VariableNamesFunction = () => Array<string>;

const offeredVariableNames: VariableNamesFunction = (): Array<string> => {
  return SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
    EVENT,
  );
};

type StatusPageFixtureFunction = (options: PageOptions) => StatusPage;

const statusPageFixture: StatusPageFixtureFunction = (
  options: PageOptions,
): StatusPage => {
  const page: StatusPage = new StatusPage();
  page.id = STATUS_PAGE_ID;
  page.projectId = PROJECT_ID;
  page.isPublicStatusPage = true;
  page.showSubscriberPageOnStatusPage = true;
  page.enableEmailSubscribers = true;
  page.enableSmsSubscribers = true;
  page.enableSlackSubscribers = true;

  // A title or name passed as undefined is left unset on the page.
  const pageTitle: string | undefined =
    "pageTitle" in options ? options.pageTitle : PAGE_TITLE;
  const name: string | undefined =
    "name" in options ? options.name : INTERNAL_NAME;

  if (pageTitle !== undefined) {
    page.pageTitle = pageTitle;
  }

  if (name !== undefined) {
    page.name = name;
  }

  if (options.withCustomSmtpAndSms) {
    const smtpConfig: ProjectSmtpConfig = new ProjectSmtpConfig();
    smtpConfig.id = ObjectID.generate();
    page.smtpConfig = smtpConfig;

    const callSmsConfig: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    callSmsConfig.id = ObjectID.generate();
    page.callSmsConfig = callSmsConfig;
  }

  return page;
};

type TemplateFixtureFunction = (data: {
  body: string;
  subject?: string | undefined;
}) => StatusPageSubscriberNotificationTemplate;

const templateFixture: TemplateFixtureFunction = (data: {
  body: string;
  subject?: string | undefined;
}): StatusPageSubscriberNotificationTemplate => {
  const template: StatusPageSubscriberNotificationTemplate =
    new StatusPageSubscriberNotificationTemplate();
  template.id = ObjectID.generate();
  template.eventType = EVENT;
  template.templateBody = data.body;
  if (data.subject) {
    template.emailSubject = data.subject;
  }
  return template;
};

/*
 * A template body that prints every variable offered for the event as
 * name=[value], so a test can see which ones rendered and with what.
 */
type EveryVariableTemplateFunction = (channel: string) => string;

const templateUsingEveryVariable: EveryVariableTemplateFunction = (
  channel: string,
): string => {
  const lines: Array<string> = offeredVariableNames().map(
    (name: string): string => {
      return `${name}=[{{${name}}}]`;
    },
  );

  return [`channel=${channel}`, ...lines].join("\n");
};

type RenderDefaultFunction = (data: {
  method: StatusPageSubscriberNotificationMethod;
  part: "body" | "subject";
  statusPageName: string;
}) => string;

/*
 * The dashboard's starter for this event, filled in the way the endpoint
 * fills its built-in message.
 */
const dashboardDefault: RenderDefaultFunction = (data: {
  method: StatusPageSubscriberNotificationMethod;
  part: "body" | "subject";
  statusPageName: string;
}): string => {
  const starter: string | undefined = getDefaultSubscriberNotificationTemplate(
    EVENT,
    data.method,
  )?.[data.part];

  expect(starter).toBeTruthy();

  const variables: Record<string, string> = {
    statusPageName: data.statusPageName,
    statusPageUrl: STATUS_PAGE_URL,
    manageSubscriptionUrl: MANAGE_URL,
  };

  return starter!.replace(
    /{{\s*(\w+)\s*}}/g,
    (_match: string, key: string): string => {
      return variables[key] ?? "";
    },
  );
};

describe("StatusPageAPI manage-subscription templates", () => {
  let pageToSend: StatusPage;
  let templatesByMethod: Partial<
    Record<
      StatusPageSubscriberNotificationMethod,
      StatusPageSubscriberNotificationTemplate
    >
  >;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  type UseCustomTemplatesFunction = (options?: {
    withCustomSmtpAndSms?: boolean;
  }) => Record<string, string>;

  /*
   * Gives the status page a custom template for this event on Email, SMS and
   * Slack, each printing every offered variable, and (unless told otherwise)
   * custom SMTP and Twilio so the Email and SMS templates are used. Returns
   * the body configured for each channel.
   */
  const useCustomTemplatesOnEveryChannel: UseCustomTemplatesFunction =
    (options?: { withCustomSmtpAndSms?: boolean }): Record<string, string> => {
      const bodies: Record<string, string> = {
        email: templateUsingEveryVariable("email"),
        sms: templateUsingEveryVariable("sms"),
        slack: templateUsingEveryVariable("slack"),
      };

      pageToSend = statusPageFixture({
        withCustomSmtpAndSms: options?.withCustomSmtpAndSms ?? true,
      });

      templatesByMethod = {
        [StatusPageSubscriberNotificationMethod.Email]: templateFixture({
          body: bodies["email"]!,
          subject: EMAIL_SUBJECT_TEMPLATE,
        }),
        [StatusPageSubscriberNotificationMethod.SMS]: templateFixture({
          body: bodies["sms"]!,
        }),
        [StatusPageSubscriberNotificationMethod.Slack]: templateFixture({
          body: bodies["slack"]!,
        }),
      };

      return bodies;
    };

  type CallManageSubscriptionFunction = (
    requestData: JSONObject,
  ) => Promise<ExpressRequest>;

  const callManageSubscription: CallManageSubscriptionFunction = async (
    requestData: JSONObject,
  ): Promise<ExpressRequest> => {
    const request: ExpressRequest = {
      params: {
        statusPageId: STATUS_PAGE_ID.toString(),
      },
      body: {
        data: requestData,
      },
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", MANAGE_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);

    return request;
  };

  type ExpectSucceededFunction = (request: ExpressRequest) => void;

  // The endpoint still answers with an empty success and raises nothing.
  const expectSucceeded: ExpectSucceededFunction = (
    request: ExpressRequest,
  ): void => {
    expect(nextFunction).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
      request,
      mockResponse,
    );
  };

  type CompileCallsFunction = () => Array<CompileCall>;

  const compileCalls: CompileCallsFunction = (): Array<CompileCall> => {
    return mockOf(
      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
    ).mock.calls.map((call: Array<unknown>): CompileCall => {
      return {
        template: call[0] as string,
        variables: call[1] as Record<string, string>,
      };
    });
  };

  type SentMailFunction = () => Array<JSONObject>;

  const sentMail: SentMailFunction = (): Array<JSONObject> => {
    return mockOf(MailService.sendMail).mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      },
    );
  };

  type SentTextFunction = () => Array<string>;

  const sentSms: SentTextFunction = (): Array<string> => {
    return mockOf(SmsService.sendSms).mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { message: string }).message;
      },
    );
  };

  const sentSlack: SentTextFunction = (): Array<string> => {
    return mockOf(
      SlackUtil.sendMessageToChannelViaIncomingWebhook,
    ).mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { text: string }).text;
    });
  };

  type RenderedMessageFunction = (channel: ChannelCase) => string;

  // What the subscriber received on the given channel.
  const renderedMessage: RenderedMessageFunction = (
    channel: ChannelCase,
  ): string => {
    if (channel.method === StatusPageSubscriberNotificationMethod.Email) {
      expect(sentMail()).toHaveLength(1);
      return (sentMail()[0]!["vars"] as JSONObject)["body"] as string;
    }

    if (channel.method === StatusPageSubscriberNotificationMethod.SMS) {
      expect(sentSms()).toHaveLength(1);
      return sentSms()[0]!;
    }

    expect(sentSlack()).toHaveLength(1);
    return sentSlack()[0]!;
  };

  type FindSubscriberFunction = (findBy: {
    query: JSONObject;
  }) => Promise<StatusPageSubscriber | null>;

  // Stands in for the database: one subscriber, reachable on each channel.
  const findSubscriberFake: FindSubscriberFunction = (findBy: {
    query: JSONObject;
  }): Promise<StatusPageSubscriber | null> => {
    const query: JSONObject = findBy.query;

    if (query["statusPageId"]?.toString() !== STATUS_PAGE_ID.toString()) {
      return Promise.resolve(null);
    }

    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber.id = new ObjectID(SUBSCRIBER_ID);

    if (query["subscriberEmail"]?.toString() === SUBSCRIBER_EMAIL) {
      subscriber.subscriberEmail = new Email(SUBSCRIBER_EMAIL);
      return Promise.resolve(subscriber);
    }

    if (query["subscriberPhone"]?.toString() === SUBSCRIBER_PHONE) {
      subscriber.subscriberPhone = new Phone(SUBSCRIBER_PHONE);
      return Promise.resolve(subscriber);
    }

    if (query["slackWorkspaceName"] === SLACK_WORKSPACE_NAME) {
      subscriber.slackWorkspaceName = SLACK_WORKSPACE_NAME;
      subscriber.slackIncomingWebhookUrl = URL.fromString(SLACK_WEBHOOK_URL);
      return Promise.resolve(subscriber);
    }

    return Promise.resolve(null);
  };

  type FindTemplateFunction = (data: {
    statusPageId: ObjectID;
    eventType: StatusPageSubscriberNotificationEventType;
    notificationMethod: StatusPageSubscriberNotificationMethod;
  }) => Promise<StatusPageSubscriberNotificationTemplate | null>;

  // Only this page has templates, and only for this event.
  const findTemplateFake: FindTemplateFunction = (data: {
    statusPageId: ObjectID;
    eventType: StatusPageSubscriberNotificationEventType;
    notificationMethod: StatusPageSubscriberNotificationMethod;
  }): Promise<StatusPageSubscriberNotificationTemplate | null> => {
    if (
      data.statusPageId.toString() !== STATUS_PAGE_ID.toString() ||
      data.eventType !== EVENT
    ) {
      return Promise.resolve(null);
    }

    return Promise.resolve(templatesByMethod[data.notificationMethod] || null);
  };

  beforeEach(() => {
    jest.clearAllMocks();

    pageToSend = statusPageFixture({ withCustomSmtpAndSms: true });
    templatesByMethod = {};

    // The caller can read the status page.
    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true });

    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockImplementation((): Promise<StatusPage | null> => {
        return Promise.resolve(pageToSend);
      });

    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue(STATUS_PAGE_URL);

    jest
      .spyOn(StatusPageSubscriberService, "findOneBy")
      .mockImplementation(findSubscriberFake as never);

    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockImplementation((): Promise<Array<StatusPage>> => {
        return Promise.resolve([pageToSend]);
      });

    // The real link builder, watched.
    jest.spyOn(StatusPageSubscriberService, "getUnsubscribeLink");

    jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getTemplateForStatusPage",
      )
      .mockImplementation(findTemplateFake as never);

    // The real substitution, watched, so tests can read what each got.
    jest.spyOn(
      StatusPageSubscriberNotificationTemplateServiceClass,
      "compileTemplate",
    );

    jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);
    jest.spyOn(SmsService, "sendSms").mockResolvedValue(undefined as never);
    jest
      .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
      .mockResolvedValue(undefined as never);

    // Hands the message through as written, so tests can read it.
    jest
      .spyOn(SlackUtil, "convertMarkdownToSlackRichText")
      .mockImplementation((markdown: string): string => {
        return markdown;
      });

    jest
      .spyOn(ProjectSmtpConfigService, "toEmailServer")
      .mockReturnValue(undefined);
    jest
      .spyOn(ProjectCallSMSConfigService, "toTwilioConfig")
      .mockReturnValue(undefined);

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("variables offered to the template", () => {
    it("offers the status page variables and the manage link", () => {
      expect([...offeredVariableNames()].sort()).toEqual([
        "manageSubscriptionUrl",
        "statusPageName",
        "statusPageUrl",
        "unsubscribeUrl",
      ]);
    });

    it.each(CHANNELS)(
      "$name: every offered variable reaches the template with a value",
      async (channel: ChannelCase) => {
        const bodies: Record<string, string> =
          useCustomTemplatesOnEveryChannel();

        const request: ExpressRequest = await callManageSubscription(
          channel.requestData,
        );
        expectSucceeded(request);

        const calls: Array<CompileCall> = compileCalls();
        expect(calls).toHaveLength(channel.compileCallsPerRequest);

        const expectedTemplates: Array<string> =
          channel.method === StatusPageSubscriberNotificationMethod.Email
            ? [bodies["email"]!, EMAIL_SUBJECT_TEMPLATE]
            : [bodies[channel.name]!];
        expect(
          calls.map((call: CompileCall): string => {
            return call.template;
          }),
        ).toEqual(expectedTemplates);

        const names: Array<string> = offeredVariableNames();
        expect(names.length).toBeGreaterThan(0);

        for (const call of calls) {
          const missing: Array<string> = names.filter(
            (name: string): boolean => {
              return (
                !Object.prototype.hasOwnProperty.call(call.variables, name) ||
                typeof call.variables[name] !== "string" ||
                call.variables[name] === ""
              );
            },
          );

          expect({ template: call.template, missing }).toEqual({
            template: call.template,
            missing: [],
          });
        }
      },
    );

    it("every templated channel together: four compiles, each with every variable", async () => {
      const bodies: Record<string, string> = useCustomTemplatesOnEveryChannel();

      for (const channel of CHANNELS) {
        const request: ExpressRequest = await callManageSubscription(
          channel.requestData,
        );
        expectSucceeded(request);
      }

      const calls: Array<CompileCall> = compileCalls();

      // Email body and subject, SMS and Slack.
      expect(calls).toHaveLength(4);
      expect(
        calls
          .map((call: CompileCall): string => {
            return call.template;
          })
          .sort(),
      ).toEqual(
        [
          bodies["email"]!,
          EMAIL_SUBJECT_TEMPLATE,
          bodies["sms"]!,
          bodies["slack"]!,
        ].sort(),
      );

      for (const call of calls) {
        for (const name of offeredVariableNames()) {
          expect(Object.keys(call.variables)).toContain(name);
          expect(typeof call.variables[name]).toBe("string");
          expect(call.variables[name]).not.toBe("");
        }
      }

      expect(sentMail()).toHaveLength(1);
      expect(sentSms()).toHaveLength(1);
      expect(sentSlack()).toHaveLength(1);
    });

    it("looks up this page's manage template on Email, SMS and Slack only", async () => {
      useCustomTemplatesOnEveryChannel();

      await callManageSubscription({ subscriberEmail: SUBSCRIBER_EMAIL });

      const lookups: Array<{
        statusPageId: ObjectID;
        eventType: StatusPageSubscriberNotificationEventType;
        notificationMethod: StatusPageSubscriberNotificationMethod;
      }> = mockOf(
        StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
      ).mock.calls.map(
        (
          call: Array<unknown>,
        ): {
          statusPageId: ObjectID;
          eventType: StatusPageSubscriberNotificationEventType;
          notificationMethod: StatusPageSubscriberNotificationMethod;
        } => {
          return call[0] as {
            statusPageId: ObjectID;
            eventType: StatusPageSubscriberNotificationEventType;
            notificationMethod: StatusPageSubscriberNotificationMethod;
          };
        },
      );

      expect(
        lookups
          .map(
            (lookup: {
              notificationMethod: StatusPageSubscriberNotificationMethod;
            }): string => {
              return lookup.notificationMethod;
            },
          )
          .sort(),
      ).toEqual(
        [
          StatusPageSubscriberNotificationMethod.Email,
          StatusPageSubscriberNotificationMethod.SMS,
          StatusPageSubscriberNotificationMethod.Slack,
        ].sort(),
      );

      for (const lookup of lookups) {
        expect(lookup.statusPageId.toString()).toBe(STATUS_PAGE_ID.toString());
        expect(lookup.eventType).toBe(EVENT);
      }
    });
  });

  describe("variable values", () => {
    it.each(CHANNELS)(
      "$name: unsubscribeUrl is the subscriber's manage link",
      async (channel: ChannelCase) => {
        useCustomTemplatesOnEveryChannel();

        await callManageSubscription(channel.requestData);

        // Built by the real helper from the page URL and this subscriber.
        const linkCalls: Array<Array<unknown>> = mockOf(
          StatusPageSubscriberService.getUnsubscribeLink,
        ).mock.calls as Array<Array<unknown>>;
        expect(linkCalls).toHaveLength(1);
        expect((linkCalls[0]![0] as URL).toString()).toBe(
          URL.fromString(STATUS_PAGE_URL).toString(),
        );
        expect((linkCalls[0]![1] as ObjectID).toString()).toBe(SUBSCRIBER_ID);

        expect(MANAGE_URL).not.toBe(STATUS_PAGE_URL);
        expect(MANAGE_URL).toContain(SUBSCRIBER_ID);

        const calls: Array<CompileCall> = compileCalls();
        expect(calls).toHaveLength(channel.compileCallsPerRequest);
        for (const call of calls) {
          expect(call.variables["unsubscribeUrl"]).toBe(MANAGE_URL);
          expect(call.variables["manageSubscriptionUrl"]).toBe(MANAGE_URL);
          expect(call.variables["statusPageUrl"]).toBe(STATUS_PAGE_URL);
        }

        expect(renderedMessage(channel)).toContain(
          `unsubscribeUrl=[${MANAGE_URL}]`,
        );
      },
    );

    it.each(CHANNELS)(
      "$name: statusPageName is the page's public title, not its internal name",
      async (channel: ChannelCase) => {
        useCustomTemplatesOnEveryChannel();

        await callManageSubscription(channel.requestData);

        const calls: Array<CompileCall> = compileCalls();
        expect(calls).toHaveLength(channel.compileCallsPerRequest);
        for (const call of calls) {
          expect(call.variables["statusPageName"]).toBe(PAGE_TITLE);
        }

        const message: string = renderedMessage(channel);
        expect(message).toContain(`statusPageName=[${PAGE_TITLE}]`);
        expect(message).not.toContain(INTERNAL_NAME);

        if (channel.method === StatusPageSubscriberNotificationMethod.Email) {
          expect(sentMail()[0]!["subject"]).toBe(
            `Manage ${PAGE_TITLE} at ${MANAGE_URL}`,
          );
        }
      },
    );

    interface NameFallbackCase {
      channel: ChannelCase;
      label: string;
      pageTitle: string | undefined;
      name: string | undefined;
      expected: string;
    }

    const NAME_FALLBACKS: Array<NameFallbackCase> = CHANNELS.flatMap(
      (channel: ChannelCase): Array<NameFallbackCase> => {
        return [
          {
            channel,
            label: "no title",
            pageTitle: undefined,
            name: INTERNAL_NAME,
            expected: INTERNAL_NAME,
          },
          {
            channel,
            label: "an empty title",
            pageTitle: "",
            name: INTERNAL_NAME,
            expected: INTERNAL_NAME,
          },
          {
            channel,
            label: "neither a title nor a name",
            pageTitle: undefined,
            name: undefined,
            expected: "Status Page",
          },
        ];
      },
    );

    it.each(NAME_FALLBACKS)(
      "$channel.name: a page with $label is called '$expected'",
      async (testCase: NameFallbackCase) => {
        useCustomTemplatesOnEveryChannel();
        pageToSend = statusPageFixture({
          withCustomSmtpAndSms: true,
          pageTitle: testCase.pageTitle,
          name: testCase.name,
        });

        await callManageSubscription(testCase.channel.requestData);

        const calls: Array<CompileCall> = compileCalls();
        expect(calls).toHaveLength(testCase.channel.compileCallsPerRequest);
        for (const call of calls) {
          expect(call.variables["statusPageName"]).toBe(testCase.expected);
        }
      },
    );

    it.each(CHANNELS)(
      "$name: a template using every offered variable renders completely",
      async (channel: ChannelCase) => {
        useCustomTemplatesOnEveryChannel();

        await callManageSubscription(channel.requestData);

        // What the fixtures hold for each offered variable.
        const expectedValues: Record<string, string> = {
          statusPageName: PAGE_TITLE,
          statusPageUrl: STATUS_PAGE_URL,
          unsubscribeUrl: MANAGE_URL,
          manageSubscriptionUrl: MANAGE_URL,
        };

        const names: Array<string> = offeredVariableNames();
        expect(Object.keys(expectedValues).sort()).toEqual([...names].sort());

        const message: string = renderedMessage(channel);
        expect(message).toContain(`channel=${channel.name}`);
        expect(message).not.toMatch(/{{|}}/);

        for (const name of names) {
          expect(expectedValues[name]).not.toBe("");
          expect(message).toContain(`${name}=[${expectedValues[name]}]`);
        }

        if (channel.method === StatusPageSubscriberNotificationMethod.Email) {
          const mail: JSONObject = sentMail()[0]!;
          expect(mail["templateType"]).toBe(EmailTemplateType.BlankTemplate);
          expect(mail["toEmail"]?.toString()).toBe(SUBSCRIBER_EMAIL);
          expect(mail["subject"]).toBe(`Manage ${PAGE_TITLE} at ${MANAGE_URL}`);
          expect(mail["subject"]).not.toMatch(/{{|}}/);
        }

        if (channel.method === StatusPageSubscriberNotificationMethod.SMS) {
          const sms: { to: Phone } = mockOf(SmsService.sendSms).mock
            .calls[0]![0] as { to: Phone };
          expect(sms.to.toString()).toBe(SUBSCRIBER_PHONE);
        }

        if (channel.method === StatusPageSubscriberNotificationMethod.Slack) {
          const slack: { url: URL } = mockOf(
            SlackUtil.sendMessageToChannelViaIncomingWebhook,
          ).mock.calls[0]![0] as { url: URL };
          expect(slack.url.toString()).toBe(SLACK_WEBHOOK_URL);
        }
      },
    );
  });

  describe("default messages", () => {
    it("email without a custom template sends the styled default, unchanged", async () => {
      const request: ExpressRequest = await callManageSubscription({
        subscriberEmail: SUBSCRIBER_EMAIL,
      });
      expectSucceeded(request);

      expect(compileCalls()).toHaveLength(0);
      expect(sentMail()).toHaveLength(1);

      const mail: JSONObject = sentMail()[0]!;
      expect(mail["templateType"]).toBe(
        EmailTemplateType.ManageExistingStatusPageSubscriberSubscription,
      );
      expect(mail["toEmail"]?.toString()).toBe(SUBSCRIBER_EMAIL);
      expect(mail["vars"]).toEqual({
        statusPageName: PAGE_TITLE,
        statusPageUrl: STATUS_PAGE_URL,
        logoUrl: "",
        isPublicStatusPage: "true",
        subscriberEmailNotificationFooterText:
          StatusPageServiceType.getSubscriberEmailFooterText(pageToSend),
        manageSubscriptionUrl: MANAGE_URL,
      });

      const expectedSubject: string = dashboardDefault({
        method: StatusPageSubscriberNotificationMethod.Email,
        part: "subject",
        statusPageName: PAGE_TITLE,
      });
      expect(expectedSubject).toBe(
        "Manage your Subscription for Acme Cloud Status",
      );
      expect(mail["subject"]).toBe(expectedSubject);
    });

    it("sms without a custom template sends the dashboard's default text", async () => {
      const request: ExpressRequest = await callManageSubscription({
        subscriberPhone: SUBSCRIBER_PHONE,
      });
      expectSucceeded(request);

      expect(compileCalls()).toHaveLength(0);

      const expected: string = dashboardDefault({
        method: StatusPageSubscriberNotificationMethod.SMS,
        part: "body",
        statusPageName: PAGE_TITLE,
      });
      expect(expected).toBe(
        `You have selected to manage your subscription for the status page: Acme Cloud Status. You can manage your subscription here: ${MANAGE_URL}`,
      );
      expect(sentSms()).toEqual([expected]);
    });

    it("slack without a custom template sends the dashboard's default text", async () => {
      const request: ExpressRequest = await callManageSubscription({
        slackWorkspaceName: SLACK_WORKSPACE_NAME,
      });
      expectSucceeded(request);

      expect(compileCalls()).toHaveLength(0);

      const expected: string = dashboardDefault({
        method: StatusPageSubscriberNotificationMethod.Slack,
        part: "body",
        statusPageName: PAGE_TITLE,
      });
      expect(expected).toBe(
        `You have selected to manage your subscription for the status page: Acme Cloud Status. You can manage your subscription here: ${MANAGE_URL}`,
      );
      expect(SlackUtil.convertMarkdownToSlackRichText).toHaveBeenCalledWith(
        expected,
      );
      expect(sentSlack()).toEqual([expected]);
    });

    it("a custom email template is not used without the page's own SMTP", async () => {
      useCustomTemplatesOnEveryChannel({ withCustomSmtpAndSms: false });

      await callManageSubscription({ subscriberEmail: SUBSCRIBER_EMAIL });

      expect(compileCalls()).toHaveLength(0);
      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!["templateType"]).toBe(
        EmailTemplateType.ManageExistingStatusPageSubscriberSubscription,
      );
      expect(sentMail()[0]!["subject"]).toBe(
        dashboardDefault({
          method: StatusPageSubscriberNotificationMethod.Email,
          part: "subject",
          statusPageName: PAGE_TITLE,
        }),
      );
    });

    it("a custom SMS template is not used without the page's own Twilio", async () => {
      useCustomTemplatesOnEveryChannel({ withCustomSmtpAndSms: false });

      await callManageSubscription({ subscriberPhone: SUBSCRIBER_PHONE });

      expect(compileCalls()).toHaveLength(0);
      expect(sentSms()).toEqual([
        dashboardDefault({
          method: StatusPageSubscriberNotificationMethod.SMS,
          part: "body",
          statusPageName: PAGE_TITLE,
        }),
      ]);
    });
  });
});
