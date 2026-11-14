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
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import { SERVER_LOCALES } from "Common/Server/Utils/ServerTranslation";
import {
  DASHBOARD_SHARED_TEXT_SOURCES,
  findServerTextKeys,
  getDashboardSharedKeys,
  ServerTextKey,
} from "Common/Scripts/I18n/ServerLocales";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import { readStartTag } from "Common/Tests/Helpers/MarkupReferences";
import MailService, {
  RenderedEmail,
} from "../../FeatureSet/Notification/Services/MailService";
import {
  EMAIL_LANGUAGE_VARIABLE_NAMES,
  getEmailHtmlValue,
  getEmailLanguageFromRoot,
  getEmailLanguageVariables,
  getEmailValueDirection,
  registerEmailLanguageHelpers,
  writeEmailNumber,
} from "../../FeatureSet/Notification/Utils/EmailLanguage";
import "../../FeatureSet/Notification/Utils/Handlebars";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { StatusPageReport } from "Common/Types/StatusPage/StatusPageReport";
import StatusPageReportTreeUtil, {
  StatusPageReportStructure,
} from "Common/Utils/StatusPage/Report";

/*
 * AN EMAIL'S OWN WORDS, IN ITS READER'S LANGUAGE.
 *
 * A status page's subscriber emails are written in the subscriber's
 * language: the sender puts it on the email (EmailEnvelope.language),
 * MailService.render puts it on the email's root, and the templates word
 * their text through the email language helpers (Utils/EmailLanguage),
 * from the server's locale set (Common/Server/Locales). An email with no
 * language - every other email - reads exactly as it always has. A Persian
 * one reads from the right.
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

const TRANSLATED_LANGUAGES: Array<string> = Object.keys(SERVER_LOCALES).filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// Every email a status page's subscriber gets that is written in their language.
const SUBSCRIBER_TEMPLATES: Array<EmailTemplateType> = [
  EmailTemplateType.SubscriberIncidentCreated,
  EmailTemplateType.SubscriberIncidentStateChanged,
  EmailTemplateType.SubscriberIncidentNoteCreated,
  EmailTemplateType.SubscriberIncidentNoteUpdated,
  EmailTemplateType.SubscriberIncidentPostmortemCreated,
  EmailTemplateType.SubscriberEpisodeCreated,
  EmailTemplateType.SubscriberEpisodeStateChanged,
  EmailTemplateType.SubscriberEpisodeNoteCreated,
  EmailTemplateType.SubscriberEpisodeNoteUpdated,
  EmailTemplateType.SubscriberScheduledMaintenanceEventCreated,
  EmailTemplateType.SubscriberScheduledMaintenanceEventStateChanged,
  EmailTemplateType.SubscriberScheduledMaintenanceEventNoteCreated,
  EmailTemplateType.SubscriberScheduledMaintenanceEventNoteUpdated,
  EmailTemplateType.SubscriberAnnouncementCreated,
  EmailTemplateType.SubscriberAnnouncementUpdated,
  EmailTemplateType.ConfirmStatusPageSubscription,
  EmailTemplateType.SubscribedToStatusPage,
  EmailTemplateType.ManageExistingStatusPageSubscriberSubscription,
  EmailTemplateType.StatusPageSubscriberReport,
];

/*
 * The values a subscriber email is filled with: names that are no word of
 * any language, so what the email reads in English or not is OneUptime's
 * own words alone.
 */
const SUBSCRIBER_VARIABLES: Record<string, string> = {
  statusPageName: "Zorbex Status",
  statusPageUrl: "https://status.zorbex.example.test",
  detailsUrl: "https://status.zorbex.example.test/incidents/1",
  unsubscribeUrl: "https://status.zorbex.example.test/unsubscribe/1",
  confirmationUrl: "https://status.zorbex.example.test/confirm/1",
  manageSubscriptionUrl: "https://status.zorbex.example.test/manage/1",
  logoUrl: "",
  isPublicStatusPage: "true",
  emailTitle: "Zorbex heading",
  incidentTitle: "Zorbex checkout",
  incidentSeverity: "Zorbex severity",
  incidentState: "Zorbex state",
  incidentDescription: "<p>Zorbex description</p>",
  episodeTitle: "Zorbex episode",
  episodeSeverity: "Zorbex severity",
  episodeState: "Zorbex state",
  episodeDescription: "<p>Zorbex description</p>",
  eventTitle: "Zorbex upgrade",
  eventState: "Zorbex state",
  eventDescription: "<p>Zorbex description</p>",
  scheduledAt: "Zorbex time",
  announcementTitle: "Zorbex news",
  announcementDescription: "<p>Zorbex description</p>",
  resourcesAffected: "Zorbex API",
  note: "<p>Zorbex note</p>",
  postmortemNote: "<p>Zorbex postmortem</p>",
  subscriberEmailNotificationFooterText: "",
  year: "2026",
};

// A sentence of the server's locale set, and what one language words it as.
interface WordedSentence {
  english: string;
  worded: string;
}

// Every sentence the server's code and email templates look up.
const SERVER_TEXT_KEYS: Array<ServerTextKey> = findServerTextKeys();

/*
 * The words of a record the server makes for a person - a new monitor's
 * criteria, the name a status page starts with ("{{project}} Status") -
 * which the server's locale set copies from the Dashboard's
 * (DASHBOARD_SHARED_TEXT_SOURCES, #7247). No email looks one up (the first
 * test of the subscriber emails holds that), so they are no email's words,
 * and a name a subscriber reads ("Zorbex Status") is not one of them left
 * in English.
 */
const RECORD_WORDS: Set<string> = getDashboardSharedKeys(SERVER_TEXT_KEYS);

/*
 * The sentences a language words apart from the English, of two words or
 * more - a single word ("Incident") can be part of a name in any email -
 * that an email can show: not a record's words (RECORD_WORDS).
 */
const wordedApart: (language: string) => Array<WordedSentence> = (
  language: string,
): Array<WordedSentence> => {
  const english: Record<string, string> = SERVER_LOCALES["en"] as Record<
    string,
    string
  >;
  const locale: Record<string, string> = SERVER_LOCALES[language] as Record<
    string,
    string
  >;

  return Object.keys(english)
    .filter((key: string): boolean => {
      return (
        locale[key] !== english[key] &&
        key.trim().includes(" ") &&
        !RECORD_WORDS.has(key)
      );
    })
    .map((key: string): WordedSentence => {
      return { english: key, worded: locale[key]! };
    });
};

// The sentence's words around its placeholders: what an email shows of it.
const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;

const wordsOf: (sentence: string) => Array<string> = (
  sentence: string,
): Array<string> => {
  return sentence
    .split(PLACEHOLDER)
    .map((piece: string): string => {
      return piece.trim();
    })
    .filter((piece: string): boolean => {
      return piece.length > 3;
    });
};

const email: (
  templateType: EmailTemplateType,
  language: string | undefined,
  variables?: Record<string, string>,
) => EmailMessage = (
  templateType: EmailTemplateType,
  language: string | undefined,
  variables: Record<string, string> = SUBSCRIBER_VARIABLES,
): EmailMessage => {
  return {
    toEmail: new Email("alice@example.test"),
    subject: "A subject",
    isSubjectLiteral: true,
    templateType: templateType,
    vars: { ...variables } as EmailMessage["vars"],
    ...(language ? { language: language } : {}),
  };
};

const attributeOf: (tag: string, name: string) => string | undefined = (
  tag: string,
  name: string,
): string | undefined => {
  return readStartTag(tag).attributes.find(
    (attribute: { name: string; value: string }): boolean => {
      return attribute.name === name;
    },
  )?.value;
};

// The first start tag of an element named `name`, or of a class.
const startTagOf: (html: string, needle: string) => string = (
  html: string,
  needle: string,
): string => {
  const at: number = html.indexOf(needle);

  expect(at).toBeGreaterThanOrEqual(0);

  const start: number = html.lastIndexOf("<", at);

  return html.slice(start, html.indexOf(">", at) + 1);
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
  jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue(null);
});

describe("getEmailLanguageVariables", () => {
  test("English, and no language, add nothing: the email reads as it always has", () => {
    expect(getEmailLanguageVariables(undefined)).toEqual({});
    expect(getEmailLanguageVariables("en")).toEqual({});
    expect(getEmailLanguageVariables("en-GB")).toEqual({});
    expect(getEmailLanguageVariables("klingon")).toEqual({});
  });

  test("another language names itself", () => {
    expect(getEmailLanguageVariables("de")).toEqual({ emailLanguage: "de" });
    expect(getEmailLanguageVariables("zh-HK")).toEqual({
      emailLanguage: "zh-TW",
    });
  });

  test("a language read from the right says so", () => {
    expect(getEmailLanguageVariables("fa")).toEqual({
      emailLanguage: "fa",
      emailDirection: "rtl",
      isEmailRightToLeft: "true",
    });
  });

  test("Arabic is read from the right too", () => {
    expect(getEmailLanguageVariables("ar")).toEqual({
      emailLanguage: "ar",
      emailDirection: "rtl",
      isEmailRightToLeft: "true",
    });
    expect(getEmailLanguageVariables("ar-EG")).toEqual({
      emailLanguage: "ar",
      emailDirection: "rtl",
      isEmailRightToLeft: "true",
    });
  });

  test("names only the variables MailService reserves", () => {
    for (const name of Object.keys(getEmailLanguageVariables("fa"))) {
      expect(EMAIL_LANGUAGE_VARIABLE_NAMES).toContain(name);
    }
  });

  test("an email's language is read from its root, English without one", () => {
    expect(getEmailLanguageFromRoot({ data: { root: {} } })).toBe("en");
    expect(
      getEmailLanguageFromRoot({ data: { root: { emailLanguage: "ja" } } }),
    ).toBe("ja");
    expect(getEmailLanguageFromRoot(undefined)).toBe("en");
  });
});

describe("the email language helpers", () => {
  const engine: typeof Handlebars = Handlebars.create();
  registerEmailLanguageHelpers(engine);

  const render: (source: string, root: Record<string, unknown>) => string = (
    source: string,
    root: Record<string, unknown>,
  ): string => {
    return engine.compile(source)(root);
  };

  test("t: a fixed text in the email's language, escaped like any value", () => {
    expect(render('{{t "Unsubscribe"}}', {})).toBe("Unsubscribe");
    expect(render('{{t "Unsubscribe"}}', { emailLanguage: "de" })).toBe(
      "Abbestellen",
    );
    expect(render('{{t "<b>not a key</b>"}}', { emailLanguage: "de" })).toBe(
      "&lt;b&gt;not a key&lt;/b&gt;",
    );
  });

  test("tHtml: for a raw slot, escaped once", () => {
    expect(
      render(
        '{{{tHtml "This link expires in 24 hours. If you did not subscribe, you can ignore this email and you will not be subscribed."}}}',
        { emailLanguage: "fr" },
      ),
    ).toBe(
      "Ce lien expire dans 24 heures. Si vous ne vous êtes pas abonné, ignorez cet e-mail : vous ne serez pas abonné.",
    );
    expect(render('{{{tHtml "It\'s <b>"}}}', {})).toBe("It&#x27;s &lt;b&gt;");
  });

  test("tt: a sentence with its values put in as written", () => {
    expect(
      render('{{tt "[Incident] {{title}}" title=name}}', {
        emailLanguage: "de",
        name: "{{title}} <i>x</i>",
      }),
    ).toBe("[Vorfall] {{title}} &lt;i&gt;x&lt;/i&gt;");
    expect(
      render('{{tt "[Incident] {{title}}" title=name}}', { name: "Down" }),
    ).toBe("[Incident] Down");
  });

  test("ttHtml: the sentence and its values escaped once, for a raw slot", () => {
    expect(
      render(
        '{{{ttHtml "A new announcement has been posted for {{statusPageName}}." statusPageName=name}}}',
        { emailLanguage: "es", name: "<Acme & Co>" },
      ),
    ).toBe("Se ha publicado un nuevo anuncio para &lt;Acme &amp; Co&gt;.");
  });

  test("a missing value reads as nothing, never as its placeholder", () => {
    expect(render('{{tt "[Incident] {{title}}" title=nothing}}', {})).toBe(
      "[Incident] ",
    );
  });

  test("tp: a count's sentence in the language's form, English while unworded", () => {
    expect(render('{{tp "{{count}} row" "{{count}} rows" 1}}', {})).toBe(
      "1 row",
    );
    expect(render('{{tp "{{count}} row" "{{count}} rows" 3}}', {})).toBe(
      "3 rows",
    );
    expect(
      render('{{tp "{{count}} row" "{{count}} rows" 2}}', {
        emailLanguage: "de",
      }),
    ).toBe("2 rows");
  });

  test("emailStart and emailEnd: a table's own sides, mirrored from the right", () => {
    expect(render("{{emailStart}}|{{emailEnd}}", {})).toBe("left|right");
    expect(
      render("{{emailStart}}|{{emailEnd}}", {
        emailLanguage: "fa",
        isEmailRightToLeft: "true",
      }),
    ).toBe("right|left");
  });

  test("tNumber: a count as the email's language writes it, as it always was in English", () => {
    expect(render("{{tNumber n}}", { n: 1234 })).toBe("1234");
    expect(render("{{tNumber n}}", { n: 3, emailLanguage: "de" })).toBe("3");
    expect(render("{{tNumber n}}", { n: 1234, emailLanguage: "de" })).toBe(
      "1.234",
    );
    expect(render("{{tNumber n}}", { n: 1234, emailLanguage: "fa" })).toBe(
      "۱٬۲۳۴",
    );
    expect(render("{{tNumber n}}", { n: 0, emailLanguage: "fa" })).toBe("۰");
  });

  test("tNumber: nothing for a missing count, and anything else as it is", () => {
    expect(render("[{{tNumber n}}]", {})).toBe("[]");
    expect(render("[{{tNumber n}}]", { n: null, emailLanguage: "fa" })).toBe(
      "[]",
    );
    expect(render("{{tNumber n}}", { n: "12", emailLanguage: "fa" })).toBe(
      "12",
    );
    expect(render("{{tNumber n}}", { n: "<b>", emailLanguage: "de" })).toBe(
      "&lt;b&gt;",
    );
  });
});

describe("writeEmailNumber", () => {
  test("English writes a count exactly as Handlebars always did", () => {
    for (const value of [0, 7, 1234, 1000000, 2.5]) {
      expect(writeEmailNumber(value, "en")).toBe(String(value));
    }
  });

  test("every other language writes it its own way", () => {
    expect(writeEmailNumber(1234, "fr")).not.toBe("1234");
    expect(writeEmailNumber(1234, "ja")).toBe("1,234");
    expect(writeEmailNumber(12, "fa")).toBe("۱۲");
  });

  test("Arabic writes its counts in Latin digits", () => {
    expect(writeEmailNumber(12, "ar")).toBe("12");
    expect(writeEmailNumber(0, "ar")).toBe("0");
    expect(writeEmailNumber(1234, "ar")).toMatch(/^1\D?234$/);
  });

  test("a language OneUptime does not write in is English", () => {
    expect(writeEmailNumber(1234, "tlh")).toBe("1234");
  });

  test("a value that is not a finite number is written as it is", () => {
    expect(writeEmailNumber(Number.NaN, "de")).toBe("NaN");
    expect(writeEmailNumber(undefined, "de")).toBe("");
  });
});

describe("MailService.render", () => {
  test("an email with no language is English, laid out from the left, as always", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, undefined),
    );

    const html: string = startTagOf(rendered.body, "<html");

    expect(attributeOf(html, "lang")).toBe("en");
    expect(attributeOf(html, "dir")).toBeUndefined();
    expect(visibleText(rendered.body)).toContain(
      "New Incident: Zorbex checkout",
    );
    expect(visibleText(rendered.body)).toContain("Powered by OneUptime");
  });

  test("a German email says so, and reads in German", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, "de"),
    );

    const text: string = visibleText(rendered.body);

    expect(attributeOf(startTagOf(rendered.body, "<html"), "lang")).toBe("de");
    expect(text).toContain("Neuer Vorfall: Zorbex checkout");
    expect(text).toContain(
      "Ein neuer Vorfall wurde gemeldet, der die von Ihnen abonnierten Dienste betreffen kann.",
    );
    expect(text).toContain("Schweregrad");
    expect(text).toContain("Betroffene Ressourcen");
    expect(text).toContain("Vorfalldetails ansehen");
    expect(text).toContain("Abbestellen");
    expect(text).toContain("Bereitgestellt von OneUptime");
    expect(text).not.toContain("New Incident");
    expect(text).not.toContain("Powered by");
  });

  test("a Persian email reads from the right, its colour dot on the side the name starts", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, "fa", {
        ...SUBSCRIBER_VARIABLES,
        incidentSeverityColor: "#dc2626",
        incidentSeverityTextColor: "#b91c1c",
      }),
    );

    expect(attributeOf(startTagOf(rendered.body, "<html"), "dir")).toBe("rtl");
    expect(attributeOf(startTagOf(rendered.body, "<body"), "dir")).toBe("rtl");
    expect(
      attributeOf(startTagOf(rendered.body, 'class="st-Wrapper"'), "dir"),
    ).toBe("rtl");

    const dot: string = startTagOf(rendered.body, 'class="st-ColorDot"');

    expect(attributeOf(dot, "style")).toContain("margin: 0 0 0 8px;");
    // The title is isolated, so it reads its own way in the Persian heading.
    expect(visibleText(rendered.body)).toContain(
      "حادثه جدید: \u{2068}Zorbex checkout\u{2069}",
    );
  });

  test("an Arabic email reads from the right, in Arabic, its figures in Latin digits", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, "ar", {
        ...SUBSCRIBER_VARIABLES,
        incidentSeverityColor: "#dc2626",
        incidentSeverityTextColor: "#b91c1c",
      }),
    );

    expect(attributeOf(startTagOf(rendered.body, "<html"), "lang")).toBe("ar");
    expect(attributeOf(startTagOf(rendered.body, "<html"), "dir")).toBe("rtl");
    expect(attributeOf(startTagOf(rendered.body, "<body"), "dir")).toBe("rtl");

    expect(
      attributeOf(startTagOf(rendered.body, 'class="st-ColorDot"'), "style"),
    ).toContain("margin: 0 0 0 8px;");

    const text: string = visibleText(rendered.body);

    // The title is isolated, so it reads its own way in the Arabic heading.
    expect(text).toContain("حادثة جديدة: \u{2068}Zorbex checkout\u{2069}");
    expect(text).toContain(
      "أُبلغ عن حادثة جديدة قد تؤثر في الخدمات التي اشتركت فيها.",
    );
    expect(text).toContain("الخطورة Zorbex severity");
    expect(text).toContain("الموارد المتأثرة Zorbex API");
    expect(text).toContain("عرض تفاصيل الحادثة");
    expect(text).toContain("إلغاء الاشتراك");
    expect(text).toContain("مدعوم من OneUptime");
    expect(text).not.toContain("New Incident");
    expect(text).not.toContain("Powered by");
    expect(text).not.toMatch(/[٠-٩۰-۹]/);
  });

  test("an English email keeps its colour dot where it always was", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, undefined, {
        ...SUBSCRIBER_VARIABLES,
        incidentSeverityColor: "#dc2626",
        incidentSeverityTextColor: "#b91c1c",
      }),
    );

    expect(
      attributeOf(startTagOf(rendered.body, 'class="st-ColorDot"'), "style"),
    ).toContain("margin: 0 8px 0 0;");
  });

  test("the sender's own language variables are replaced by the email's", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, "de", {
        ...SUBSCRIBER_VARIABLES,
        emailLanguage: "fa",
        isEmailRightToLeft: "true",
        emailDirection: "rtl",
      }),
    );

    const html: string = startTagOf(rendered.body, "<html");

    expect(attributeOf(html, "lang")).toBe("de");
    expect(attributeOf(html, "dir")).toBeUndefined();
  });
});

/*
 * A Persian email is laid out from the right, and its values are what the
 * team wrote - most often English. Each value says which way it reads, by
 * most of its letters: a value of a line in its line (an isolate, which
 * keeps the card's right edge), a value of paragraphs as a block of its
 * own. An English title's full stop or bracket stays at its end.
 */
describe("values in an email read from the right", () => {
  const PERSIAN_TITLE: string =
    "\u{067E}\u{0631}\u{062F}\u{0627}\u{062E}\u{062A} \u{06A9}\u{0627}\u{0631} \u{0646}\u{0645}\u{06CC}\u{200C}\u{06A9}\u{0646}\u{062F}";

  test("an English title is an isolate that reads from the left", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, "fa", {
        ...SUBSCRIBER_VARIABLES,
        incidentTitle: "Zorbex checkout (EU).",
      }),
    );

    expect(rendered.body).toContain(
      '<span dir="ltr">Zorbex checkout (EU).</span>',
    );
  });

  test("a Persian title reads from the right", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, "fa", {
        ...SUBSCRIBER_VARIABLES,
        incidentTitle: PERSIAN_TITLE,
      }),
    );

    expect(rendered.body).toContain(`<span dir="rtl">${PERSIAN_TITLE}</span>`);
  });

  test("a description of paragraphs is a block laid out its own way", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, "fa"),
    );

    expect(rendered.body).toContain(
      '<div dir="ltr"><p>Zorbex description</p></div>',
    );
  });

  test("resources, a line of names, stay in their line", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, "fa", {
        ...SUBSCRIBER_VARIABLES,
        resourcesAffected: "Zorbex API<br/>Zorbex Web",
      }),
    );

    expect(rendered.body).toContain(
      '<span dir="ltr">Zorbex API<br/>Zorbex Web</span>',
    );
  });

  test("a coloured state's name says its direction on the name itself", async () => {
    const rendered: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentStateChanged, "fa", {
        ...SUBSCRIBER_VARIABLES,
        incidentState: "Zorbex state",
        incidentStateColor: "#16a34a",
        incidentStateTextColor: "#15803d",
      }),
    );

    expect(
      attributeOf(startTagOf(rendered.body, 'class="st-ColorText"'), "dir"),
    ).toBe("ltr");
  });

  test("the footer reads 'Powered by OneUptime', then its copyright", async () => {
    const persian: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, "fa"),
    );
    const english: RenderedEmail = await MailService.render(
      email(EmailTemplateType.SubscriberIncidentCreated, undefined),
    );

    expect(persian.body).toContain('<span dir="ltr">&copy; ');
    expect(english.body).not.toContain('<span dir="ltr">&copy; ');
  });

  test("an email read from the left gives no value a direction", async () => {
    for (const language of [undefined, "de", "ja"]) {
      const rendered: RenderedEmail = await MailService.render(
        email(EmailTemplateType.SubscriberIncidentCreated, language),
      );

      expect([language, rendered.body.includes(' dir="ltr"')]).toEqual([
        language,
        false,
      ]);
    }
  });

  test("a value's direction is its letters', the email's when it has none", () => {
    expect(getEmailValueDirection("Checkout API (EU).")).toBe("ltr");
    expect(getEmailValueDirection(PERSIAN_TITLE)).toBe("rtl");
    // Most of its letters: a Persian sentence that starts with "API".
    expect(getEmailValueDirection(`API ${PERSIAN_TITLE}`)).toBe("rtl");
    expect(getEmailValueDirection("<p>Checkout <b>API</b></p>")).toBe("ltr");
    expect(getEmailValueDirection("2026-11-08 02:00")).toBe("rtl");
    expect(getEmailValueDirection(undefined)).toBe("rtl");
    /*
     * A character reference's name is no English: a Persian note with quotes
     * (20 Persian letters, 7 English ones, and 21 more in its references).
     */
    expect(
      getEmailValueDirection(
        `<p>\u{0633}\u{0631}\u{0648}\u{06CC}\u{0633} \u{067E}\u{0631}\u{062F}\u{0627}\u{062E}\u{062A} &quot;API&quot; &quot;EU&quot; &amp; &#x27;DB&#x27; \u{0627}\u{0632} \u{06A9}\u{0627}\u{0631} \u{0627}\u{0641}\u{062A}\u{0627}\u{062F}</p>`,
      ),
    ).toBe("rtl");
    // A lone "&" is text, and the letters after it count.
    expect(getEmailValueDirection("R&D team & ops")).toBe("ltr");
  });

  test("trusted HTML: a block when it holds blocks, else an isolate", () => {
    expect(getEmailHtmlValue("<ul><li>One</li></ul>")).toBe(
      '<div dir="ltr"><ul><li>One</li></ul></div>',
    );
    expect(getEmailHtmlValue("One<br/>Two")).toBe(
      '<span dir="ltr">One<br/>Two</span>',
    );
    expect(getEmailHtmlValue("<b>One</b>")).toBe(
      '<span dir="ltr"><b>One</b></span>',
    );
    expect(getEmailHtmlValue("")).toBe("");
  });
});

describe("every subscriber email, in every language", () => {
  /*
   * The record words the check below leaves out are no email's: no
   * template, and no file but the ones the server shares with the
   * Dashboard, looks one up.
   */
  test("looks up none of the words of a record the server makes for a person", () => {
    expect(RECORD_WORDS.has("{{project}} Status")).toBe(true);
    expect(RECORD_WORDS.has("Check if {{monitorName}} is online")).toBe(true);

    const lookedUpElsewhere: Array<string> = SERVER_TEXT_KEYS.filter(
      (key: ServerTextKey): boolean => {
        return (
          RECORD_WORDS.has(key.key) &&
          !DASHBOARD_SHARED_TEXT_SOURCES.includes(key.file)
        );
      },
    ).map((key: ServerTextKey): string => {
      return `${key.file}: ${key.key}`;
    });

    expect(lookedUpElsewhere).toEqual([]);
  });

  test.each(SUBSCRIBER_TEMPLATES)(
    "%s reads none of OneUptime's English words in another language",
    async (templateType: EmailTemplateType) => {
      const english: string = visibleText(
        (await MailService.render(email(templateType, undefined))).body,
      );
      const problems: Array<string> = [];

      for (const language of TRANSLATED_LANGUAGES) {
        const text: string = visibleText(
          (await MailService.render(email(templateType, language))).body,
        );

        for (const sentence of wordedApart(language)) {
          for (const words of wordsOf(sentence.english)) {
            // Only the words this email shows in English.
            if (!english.includes(words)) {
              continue;
            }

            /*
             * Still there in the other language: the language's own
             * wording must hold them (a brand, a link's words).
             */
            if (text.includes(words) && !sentence.worded.includes(words)) {
              problems.push(`${language}: "${words}"`);
            }
          }
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test.each(SUBSCRIBER_TEMPLATES)(
    "%s keeps every value it is given, in every language",
    async (templateType: EmailTemplateType) => {
      const english: string = visibleText(
        (await MailService.render(email(templateType, undefined))).body,
      );
      const values: Array<string> = Object.values(SUBSCRIBER_VARIABLES).filter(
        (value: string): boolean => {
          return value.startsWith("Zorbex") && english.includes(value);
        },
      );

      expect(values.length).toBeGreaterThan(0);

      for (const language of TRANSLATED_LANGUAGES) {
        const text: string = visibleText(
          (await MailService.render(email(templateType, language))).body,
        );

        for (const value of values) {
          expect([language, value, text.includes(value)]).toEqual([
            language,
            value,
            true,
          ]);
        }
      }
    },
  );
});

/*
 * The email that pages a person on call (fu-i18n-larger), in the language
 * they picked: every word of OneUptime's own - the title, what happened,
 * the labels, the buttons, why they get it - and every value as written.
 * UserNotificationRuleService words its values (a default state, "No root
 * cause identified") and puts the language on the envelope.
 */
const ON_CALL_PAGE_TEMPLATES: Array<EmailTemplateType> = [
  EmailTemplateType.AcknowledgeIncident,
  EmailTemplateType.AcknowledgeAlert,
  EmailTemplateType.AcknowledgeIncidentEpisode,
  EmailTemplateType.AcknowledgeAlertEpisode,
];

// The values of all four, no word of any language.
const ON_CALL_PAGE_VARIABLES: Record<string, string> = {
  logoUrl: "",
  year: "2026",
  projectName: "Zorbex project",
  currentState: "Zorbex state",
  resourcesAffected: "Zorbex API",
  rootCause: "<p>Zorbex cause</p>",
  passOnLink: "https://zorbex.example.test/pass-on/1",
  incidentTitle: "Zorbex checkout",
  incidentNumber: "ZRB-1",
  incidentSeverity: "Zorbex severity",
  incidentDescription: "<p>Zorbex description</p>",
  acknowledgeIncidentLink: "https://zorbex.example.test/acknowledge/1",
  alertTitle: "Zorbex alert",
  alertNumber: "ZRB-2",
  alertSeverity: "Zorbex severity",
  alertDescription: "<p>Zorbex description</p>",
  acknowledgeAlertLink: "https://zorbex.example.test/acknowledge/2",
  episodeNumber: "ZRB-3",
  incidentEpisodeTitle: "Zorbex incident episode",
  incidentEpisodeSeverity: "Zorbex severity",
  incidentEpisodeDescription: "<p>Zorbex description</p>",
  acknowledgeIncidentEpisodeLink: "https://zorbex.example.test/acknowledge/3",
  incidentsList: "<p>Zorbex member</p>",
  incidentsCount: "2",
  alertEpisodeTitle: "Zorbex alert episode",
  alertEpisodeSeverity: "Zorbex severity",
  alertEpisodeDescription: "<p>Zorbex description</p>",
  acknowledgeAlertEpisodeLink: "https://zorbex.example.test/acknowledge/4",
  alertsList: "<p>Zorbex member</p>",
  alertsCount: "2",
};

describe("every on-call page email, in every language", () => {
  const LETTER: RegExp = /\p{L}/u;

  /*
   * Whether a text holds these words as words of their own - "Incident",
   * but not inside Spanish's "Incidente".
   */
  const holdsWords: (text: string, words: string) => boolean = (
    text: string,
    words: string,
  ): boolean => {
    let at: number = text.indexOf(words);

    while (at !== -1) {
      if (
        !LETTER.test(text.charAt(at - 1)) &&
        !LETTER.test(text.charAt(at + words.length))
      ) {
        return true;
      }

      at = text.indexOf(words, at + 1);
    }

    return false;
  };

  const renderPage: (
    templateType: EmailTemplateType,
    language: string | undefined,
  ) => Promise<RenderedEmail> = (
    templateType: EmailTemplateType,
    language: string | undefined,
  ): Promise<RenderedEmail> => {
    return MailService.render(
      email(templateType, language, ON_CALL_PAGE_VARIABLES),
    );
  };

  test.each(ON_CALL_PAGE_TEMPLATES)(
    "%s reads none of OneUptime's English words in another language",
    async (templateType: EmailTemplateType) => {
      const english: string = visibleText(
        (await renderPage(templateType, undefined)).body,
      );
      const problems: Array<string> = [];

      for (const language of TRANSLATED_LANGUAGES) {
        const text: string = visibleText(
          (await renderPage(templateType, language)).body,
        );

        for (const sentence of wordedApart(language)) {
          for (const words of wordsOf(sentence.english)) {
            if (!english.includes(words)) {
              continue;
            }

            if (holdsWords(text, words) && !sentence.worded.includes(words)) {
              problems.push(`${language}: "${words}"`);
            }
          }
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test.each(ON_CALL_PAGE_TEMPLATES)(
    "%s keeps every value it is given, in every language",
    async (templateType: EmailTemplateType) => {
      const english: string = visibleText(
        (await renderPage(templateType, undefined)).body,
      );
      const values: Array<string> = Object.values(
        ON_CALL_PAGE_VARIABLES,
      ).filter((value: string): boolean => {
        return (
          (value.startsWith("Zorbex") || value.startsWith("ZRB-")) &&
          english.includes(value)
        );
      });

      // Its title, number, project, state, resources and severity at least.
      expect(values.length).toBeGreaterThanOrEqual(6);

      for (const language of TRANSLATED_LANGUAGES) {
        const text: string = visibleText(
          (await renderPage(templateType, language)).body,
        );

        for (const value of values) {
          expect([language, value, text.includes(value)]).toEqual([
            language,
            value,
            true,
          ]);
        }
      }
    },
  );

  test("German: what happened, the details, the buttons and why you get it", async () => {
    const text: string = visibleText(
      (await renderPage(EmailTemplateType.AcknowledgeIncident, "de")).body,
    );

    expect(text).toContain("Vorfall ZRB-1: Zorbex checkout");
    expect(text).toContain(
      "Im Projekt Zorbex project wurde ein neuer Vorfall erstellt.",
    );
    expect(text).toContain("Vorfallstitel");
    expect(text).toContain("Aktueller Status");
    expect(text).toContain(
      "HANDLUNG ERFORDERLICH: Bitte bestätigen Sie diesen Vorfall mit der Schaltfläche unten.",
    );
    expect(text).toContain("Vorfall bestätigen");
    expect(text).toContain(
      "Keine Zeit? Eskalieren Sie, und Sie werden für diesen Vorfall nicht erneut alarmiert.",
    );
    expect(text).toContain("Eskalieren");
    expect(text).toContain("Warum erhalte ich diese E-Mail?");
    expect(text).not.toContain("Acknowledge Incident");
    expect(text).not.toContain("ACTION REQUIRED");
  });

  test("an episode's list is headed in the language, its count as the language writes it", async () => {
    const text: string = visibleText(
      (await renderPage(EmailTemplateType.AcknowledgeIncidentEpisode, "de"))
        .body,
    );

    expect(text).toContain("Vorfälle in dieser Episode (2)");
    expect(text).toContain("Zorbex member");
  });

  test.each(ON_CALL_PAGE_TEMPLATES)(
    "%s in Persian reads from the right",
    async (templateType: EmailTemplateType) => {
      const rendered: RenderedEmail = await renderPage(templateType, "fa");

      expect(attributeOf(startTagOf(rendered.body, "<html"), "lang")).toBe(
        "fa",
      );
      expect(attributeOf(startTagOf(rendered.body, "<html"), "dir")).toBe(
        "rtl",
      );
    },
  );

  test.each(ON_CALL_PAGE_TEMPLATES)(
    "%s without a language reads in English, laid out from the left",
    async (templateType: EmailTemplateType) => {
      const rendered: RenderedEmail = await renderPage(templateType, undefined);
      const text: string = visibleText(rendered.body);

      expect(attributeOf(startTagOf(rendered.body, "<html"), "lang")).toBe(
        "en",
      );
      expect(attributeOf(startTagOf(rendered.body, "<html"), "dir")).toBe(
        undefined,
      );
      expect(text).toContain("ACTION REQUIRED: Please acknowledge this");
      expect(text).toContain("You can also copy and paste this link:");
      expect(text).toContain("Why am I receiving this email?");
    },
  );

  /*
   * An observer's page (OnCallObserverPage): the service words what an
   * observer's page is and why they get it, and leaves the escalate link
   * out; the template words its own line and button. In every language.
   */
  const OBSERVER_VARIABLES: Record<string, string> = {
    ...ON_CALL_PAGE_VARIABLES,
    observerPageInfo: "Zorbex observer notice",
    observerPageWhy: "Zorbex observer why",
  };
  delete OBSERVER_VARIABLES["passOnLink"];

  const renderObserverPage: (
    templateType: EmailTemplateType,
    language: string | undefined,
  ) => Promise<RenderedEmail> = (
    templateType: EmailTemplateType,
    language: string | undefined,
  ): Promise<RenderedEmail> => {
    return MailService.render(
      email(templateType, language, OBSERVER_VARIABLES),
    );
  };

  test.each(ON_CALL_PAGE_TEMPLATES)(
    "%s as an observer's page reads none of OneUptime's English words in another language",
    async (templateType: EmailTemplateType) => {
      const english: string = visibleText(
        (await renderObserverPage(templateType, undefined)).body,
      );
      const problems: Array<string> = [];

      // The observer's own line and button are there in English, to be worded.
      expect(english).toContain("Seen it? Let the people responding know.");
      expect(english).toContain("I've seen it");
      expect(english).not.toContain("Escalate");

      for (const language of TRANSLATED_LANGUAGES) {
        const text: string = visibleText(
          (await renderObserverPage(templateType, language)).body,
        );

        for (const sentence of wordedApart(language)) {
          for (const words of wordsOf(sentence.english)) {
            if (!english.includes(words)) {
              continue;
            }

            if (holdsWords(text, words) && !sentence.worded.includes(words)) {
              problems.push(`${language}: "${words}"`);
            }
          }
        }

        // The button is one short sentence: worded too.
        if (text.includes("I've seen it")) {
          problems.push(`${language}: "I've seen it"`);
        }

        // What the service worded, and why they get it, as given.
        for (const value of ["Zorbex observer notice", "Zorbex observer why"]) {
          if (!text.includes(value)) {
            problems.push(`${language}: no "${value}"`);
          }
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test("German observer's page: seen it, the button, and nothing to escalate", async () => {
    const text: string = visibleText(
      (await renderObserverPage(EmailTemplateType.AcknowledgeIncident, "de"))
        .body,
    );

    expect(text).toContain(
      "Gesehen? Geben Sie den Zuständigen Bescheid. Der Vorfall wird dadurch nicht bestätigt.",
    );
    expect(text).toContain("Ich habe es gesehen");
    expect(text).not.toContain("Vorfall bestätigen");
    expect(text).not.toContain("Eskalieren");
    expect(text).not.toContain("HANDLUNG ERFORDERLICH");
  });

  /*
   * The header's name keeps its space from OneUptime's logo on the side it
   * meets it: the right, in an email laid out from the right.
   */
  test.each(ON_CALL_PAGE_TEMPLATES)(
    "%s in Persian keeps the logo's name apart from the logo, on the right",
    async (templateType: EmailTemplateType) => {
      const persian: string = (await renderPage(templateType, "fa")).body;
      const english: string = (await renderPage(templateType, undefined)).body;

      const nameCell: (html: string) => string = (html: string): string => {
        return attributeOf(startTagOf(html, 'aria-hidden="true"'), "style")!;
      };

      expect(nameCell(persian)).toContain("padding-right: 10px;");
      expect(nameCell(persian)).not.toContain("padding-left");
      // An email read from the left keeps it where it always was.
      expect(nameCell(english)).toContain("padding-left: 10px;");
      expect(nameCell(english)).not.toContain("padding-right");
    },
  );
});

/*
 * The uptime report, with a report in it: its stat strip, its table and a
 * group's count of resources - none of them in English in another
 * language, every name in it kept.
 */
describe("the uptime report, in every language", () => {
  // Between two words of a text.
  const WHITESPACE_REGEX: RegExp = /\s+/;

  const ZONE_GROUP: ObjectID = new ObjectID(
    "61000000-0000-4000-8000-000000000001",
  );

  const report: () => StatusPageReport = (): StatusPageReport => {
    const group: StatusPageGroup = new StatusPageGroup();
    group._id = ZONE_GROUP.toString();
    group.name = "Zorbex zone";
    group.order = 1;

    const resource: StatusPageResource = new StatusPageResource();
    resource.displayName = "Zorbex gateway";
    resource.statusPageGroupId = ZONE_GROUP;

    const otherResource: StatusPageResource = new StatusPageResource();
    otherResource.displayName = "Zorbex ledger";
    otherResource.statusPageGroupId = ZONE_GROUP;

    const structure: StatusPageReportStructure = StatusPageReportTreeUtil.build(
      {
        entries: [resource, otherResource].map(
          (statusPageResource: StatusPageResource) => {
            return {
              statusPageResource: statusPageResource,
              reportItem: {
                resourceName: statusPageResource.displayName || "",
                totalIncidentCount: 1,
                uptimePercent: 99.5,
                uptimePercentAsString: "99.5%",
                // No word of OneUptime's own ("minutes" is one: a page's durations).
                downtimeInHoursAndMinutes: "Zorbex span",
              },
            };
          },
        ),
        statusPageGroups: [group],
        groupMetricsByGroupId: {},
      },
    );

    return {
      reportDates: "Zorbex dates",
      reportPeriodName: "Zorbex period",
      reportStartDate: "Zorbex start",
      reportEndDate: "Zorbex end",
      reportTimezone: "UTC",
      totalResources: 2,
      totalIncidents: 2,
      averageUptimePercent: "99.5%",
      totalDowntimeInHoursAndMinutes: "Zorbex span",
      resources: structure.resources,
      groups: structure.groups,
      ungroupedResources: structure.resourcesWithoutGroup,
      rows: structure.rows,
      hasGroups: true,
    };
  };

  const reportEmail: (language: string | undefined) => EmailMessage = (
    language: string | undefined,
  ): EmailMessage => {
    return {
      toEmail: new Email("alice@example.test"),
      subject: "A subject",
      isSubjectLiteral: true,
      templateType: EmailTemplateType.StatusPageSubscriberReport,
      vars: {
        ...SUBSCRIBER_VARIABLES,
        hasResources: "true",
        report: report() as unknown as JSONObject,
      },
      ...(language ? { language: language } : {}),
    };
  };

  test("reads none of OneUptime's English words in another language", async () => {
    const english: string = visibleText(
      (await MailService.render(reportEmail(undefined))).body,
    );
    const problems: Array<string> = [];

    // The table and the strip are there in English, to be worded.
    expect(english).toContain("Breakdown by group");
    expect(english).toContain("Zorbex zone &middot; 2 resources");

    for (const language of TRANSLATED_LANGUAGES) {
      const text: string = visibleText(
        (await MailService.render(reportEmail(language))).body,
      );

      for (const sentence of wordedApart(language)) {
        for (const words of wordsOf(sentence.english)) {
          if (!english.includes(words)) {
            continue;
          }

          if (text.includes(words) && !sentence.worded.includes(words)) {
            problems.push(`${language}: "${words}"`);
          }
        }
      }

      // Its labels, one word each, are its own too: none is a word of it.
      const textWords: Array<string> = text.split(WHITESPACE_REGEX);

      for (const label of ["Downtime", "Uptime", "Resources"]) {
        const worded: string | undefined = SERVER_LOCALES[language]![label];

        if (worded !== label && textWords.includes(label)) {
          problems.push(`${language}: "${label}"`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("keeps every name and figure it is given, in every language", async () => {
    for (const language of [undefined, ...TRANSLATED_LANGUAGES]) {
      const text: string = visibleText(
        (await MailService.render(reportEmail(language))).body,
      );

      for (const value of [
        "Zorbex Status",
        "Zorbex zone",
        "Zorbex gateway",
        "Zorbex ledger",
        "Zorbex period",
        "Zorbex start",
        "Zorbex end",
        "Zorbex span",
        "99.5%",
      ]) {
        expect([language, value, text.includes(value)]).toEqual([
          language,
          value,
          true,
        ]);
      }
    }
  });
});
