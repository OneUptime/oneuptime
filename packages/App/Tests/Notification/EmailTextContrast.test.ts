import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import {
  LowContrastText,
  lowContrastText,
} from "Common/Tests/Helpers/SpamAssassinTextColors";
import { readStartTag } from "Common/Tests/Helpers/MarkupReferences";
import MailService, {
  RenderedEmail,
} from "../../FeatureSet/Notification/Services/MailService";
import { BRAND_VARIABLE_NAMES } from "../../FeatureSet/Notification/Utils/EmailBranding";
import "../../FeatureSet/Notification/Utils/Handlebars";
import { getDefaultSubscriberNotificationTemplate } from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import {
  VariableSet,
  variableSetsFor,
} from "./Fixtures/EmailTemplateVariables";

/*
 * NO EMAIL'S TEXT READS AS HIDDEN BY ITS COLOUR.
 *
 * SpamAssassin scores an email whose text it reads in a colour too close to
 * the background behind it (HTML_FONT_LOW_CONTRAST, and FONT_INVIS_MSGID
 * with it), as spam hides words that way. The status page uptime report
 * hid its inbox preview line with display:none and a near-white colour as
 * well, and every report scored 1.7 points for it (#5294); a preview line
 * hidden by display:none alone, as Partials/Start.hbs hides every other
 * email's, scores nothing.
 *
 * Common/Tests/Helpers/SpamAssassinTextColors reads text the way
 * SpamAssassin 4.0 does (and is held to SpamAssassin's own verdicts there).
 * Here: every template, rendered by the real MailService with every way its
 * rows come and go (Fixtures/EmailTemplateVariables) under every branding,
 * and every email starter a status page is offered, holds no text it reads
 * too close to its background.
 */

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    IsDevelopment: false,
    Host: "oneuptime.example.test",
    HttpProtocol: "https://",
  };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { updateOneById: jest.fn() } };
});

jest.mock("Common/Models/DatabaseModels/EmailLog", () => {
  return { __esModule: true, default: jest.fn() };
});

jest.mock("Common/Models/DatabaseModels/GlobalConfig", () => {
  return {
    EmailServerType: { Sendgrid: "Sendgrid", CustomSMTP: "Custom SMTP" },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/DataSource/EgressGuard", () => {
  return { __esModule: true, default: { assertHostnameAllowed: jest.fn() } };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: jest.fn() };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

jest.mock("nodemailer", () => {
  return { __esModule: true, default: { createTransport: jest.fn() } };
});

jest.mock("@sendgrid/mail", () => {
  return {
    __esModule: true,
    default: { setApiKey: jest.fn(), send: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return { __esModule: true, default: { getAccessToken: jest.fn() } };
});

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const CUSTOM_LOGO_PATH: string = "/api/branding/logo?v=7";

const WHITESPACE: RegExp = /\s+/g;

interface BrandingCase {
  label: string;
  branding: ProductBranding | null;
}

const BRANDING_CASES: Array<BrandingCase> = [
  { label: "OneUptime's own branding", branding: null },
  {
    label: "a logo of the installation's own",
    branding: { logoUrl: CUSTOM_LOGO_PATH, isLogoEmailSafe: true },
  },
  {
    label: "a renamed product",
    branding: {
      productName: "Acme Ops",
      websiteUrl: "https://ops.acme.example.test",
    },
  },
  {
    label: "a renamed product with a logo of its own",
    branding: {
      productName: "Acme Ops",
      websiteUrl: "https://ops.acme.example.test",
      logoUrl: CUSTOM_LOGO_PATH,
      isLogoEmailSafe: true,
    },
  },
];

// The variable sets every branding is rendered with, beside OneUptime's all.
const CORE_SETS: ReadonlyArray<string> = [
  "every variable",
  "no variables",
  "every variable empty",
];

const brandAs: (branding: ProductBranding | null) => void = (
  branding: ProductBranding | null,
): void => {
  jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue(branding);
};

const readTemplate: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, name), "utf8");
};

const catalog: Array<string> = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".hbs");
  })
  .sort();

const templateEmail: (
  name: string,
  variables: Record<string, unknown>,
) => EmailMessage = (
  name: string,
  variables: Record<string, unknown>,
): EmailMessage => {
  return {
    toEmail: new Email("alice@example.test"),
    subject: "A notification",
    isSubjectLiteral: true,
    templateType: name as EmailTemplateType,
    vars: variables as EmailMessage["vars"],
  };
};

const describeText: (found: LowContrastText) => string = (
  found: LowContrastText,
): string => {
  return `"${found.text.slice(0, 80)}" in ${found.textColor} on ${found.backgroundColor} (distance ${found.distance.toFixed(1)})`;
};

beforeAll(async () => {
  const partialNames: Array<string> = fs
    .readdirSync(Path.join(TEMPLATES_DIR, "Partials"))
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    })
    .map((name: string): string => {
      return name.slice(0, -4);
    });
  const deadline: number = Date.now() + 15000;

  // The production initializer registers the partials asynchronously.
  while (
    partialNames.some((name: string): boolean => {
      return typeof Handlebars.partials[name] !== "function";
    })
  ) {
    if (Date.now() >= deadline) {
      throw new Error("Production email partial registration did not finish");
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
});

beforeEach(() => {
  jest.restoreAllMocks();
  brandAs(null);
});

describe("the uptime report's inbox preview line", () => {
  // The preview line: the first element of the report, hidden from view.
  const previewLineStyle: (html: string) => string = (html: string): string => {
    const at: number = html.indexOf("uptime report");
    const start: number = html.lastIndexOf("<div", at);

    expect(start).toBeGreaterThanOrEqual(0);

    return (
      readStartTag(html.slice(start)).attributes.find(
        (attribute: { name: string; value: string }): boolean => {
          return attribute.name === "style";
        },
      )?.value || ""
    );
  };

  test("is hidden by display:none alone, with no colour of its own", async () => {
    const rendered: RenderedEmail = await MailService.render(
      templateEmail("StatusPageSubscriberReport.hbs", {
        ...variableSetsFor(readTemplate("StatusPageSubscriberReport.hbs"), {
          leaveOut: BRAND_VARIABLE_NAMES,
        })[0]!.variables,
        statusPageName: "Acme Status",
      }),
    );
    const style: string = previewLineStyle(rendered.body).replace(
      WHITESPACE,
      "",
    );

    expect(style).toContain("display:none");
    expect(style).not.toContain("color:");
    expect(lowContrastText(rendered.body)).toEqual([]);
  });
});

describe("every template, as MailService renders it", () => {
  test("a hundred-odd templates: enough for this to mean something", () => {
    expect(catalog.length).toBeGreaterThan(100);
  });

  test.each(catalog)("%s", async (name: string) => {
    const sets: Array<VariableSet> = variableSetsFor(readTemplate(name), {
      leaveOut: BRAND_VARIABLE_NAMES,
    });

    expect(sets.length).toBeGreaterThanOrEqual(3);

    const problems: Array<string> = [];

    for (const brandingCase of BRANDING_CASES) {
      brandAs(brandingCase.branding);

      for (const set of sets) {
        if (brandingCase.branding !== null && !CORE_SETS.includes(set.name)) {
          continue;
        }

        const rendered: RenderedEmail = await MailService.render(
          templateEmail(name, { ...set.variables }),
        );

        for (const found of lowContrastText(rendered.body)) {
          problems.push(
            `${brandingCase.label}, ${set.name}: ${describeText(found)}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe("every email starter a status page is offered", () => {
  test.each(Object.values(StatusPageSubscriberNotificationEventType))(
    "%s",
    async (event: StatusPageSubscriberNotificationEventType) => {
      const body: string | undefined = getDefaultSubscriberNotificationTemplate(
        event,
        StatusPageSubscriberNotificationMethod.Email,
      )?.body;

      expect(body).toBeTruthy();

      const problems: Array<string> = [];

      for (const set of variableSetsFor(body!)) {
        const rendered: RenderedEmail = await MailService.render({
          subject: "A notification",
          isSubjectLiteral: true,
          body: body!,
          vars: { ...set.variables } as EmailMessage["vars"],
        });

        for (const found of lowContrastText(rendered.body)) {
          problems.push(`${set.name}: ${describeText(found)}`);
        }
      }

      expect(problems).toEqual([]);
    },
  );
});
