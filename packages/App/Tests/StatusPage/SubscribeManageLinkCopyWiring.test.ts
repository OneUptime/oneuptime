import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * POST /status-page/manage-subscription/:statusPageId answers with the same
 * empty success whether or not a subscription matched what the visitor typed,
 * and only ever sends the manage link to the contact stored on a matching
 * subscription. The subscribe pages used to share one success flag between
 * their "subscribe" and "manage existing subscription" tabs, so a manage
 * request told the visitor "You have been subscribed successfully." (or, on
 * the email page, asserted that an email had been sent) — wrong after a
 * manage request, and shown even when nothing matched.
 *
 * Rendering these pages needs the whole Status Page runtime, so this follows
 * the source-wiring convention of the other *Wiring.test.ts files here: each
 * tab must drive its own flag, and each flag must render its own copy.
 */

const STATUS_PAGE_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/StatusPage/src",
);

const LOCALES_DIR: string = path.join(STATUS_PAGE_SRC, "Locales");

const SUBSCRIBE_SUCCESS_FLAG: string = "isSuccess";
const MANAGE_SUCCESS_FLAG: string = "isManageLinkRequested";

const SUCCESS_PARAGRAPH_CLASSES: string =
  "text-center text-gray-400 mb-20 mt-20";

const MANAGE_KEY: string = "subscribe.manageLinkSent";
const MANAGE_EMAIL_KEY: string = "subscribe.manageLinkSentEmail";

interface SubscribePageCase {
  page: string;
  subscribeKey: string;
  manageKey: string;
}

const PAGES: ReadonlyArray<SubscribePageCase> = [
  {
    page: "Pages/Subscribe/EmailSubscribe.tsx",
    subscribeKey: "subscribe.emailSentCheckSpam",
    manageKey: MANAGE_EMAIL_KEY,
  },
  {
    page: "Pages/Subscribe/SmsSubscribe.tsx",
    subscribeKey: "subscribe.subscribedSuccessfully",
    manageKey: MANAGE_KEY,
  },
  {
    page: "Pages/Subscribe/SlackSubscribe.tsx",
    subscribeKey: "subscribe.subscribedSuccessfully",
    manageKey: MANAGE_KEY,
  },
  {
    page: "Pages/Subscribe/MicrosoftTeamsSubscribe.tsx",
    subscribeKey: "subscribe.subscribedSuccessfully",
    manageKey: MANAGE_KEY,
  },
];

const LOCALES: ReadonlyArray<string> = [
  "da",
  "de",
  "en",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

const ENGLISH_MANAGE_LINK_SENT: string =
  "If a subscription matches the details you entered, we have sent a link to manage it.";
const ENGLISH_MANAGE_LINK_SENT_EMAIL: string =
  "If this email address has a subscription, we have sent it a link to manage it. If you don't see the email, please check your spam folder.";

/** Source with comments stripped and whitespace collapsed to single spaces. */
function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(STATUS_PAGE_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

function occurrences(source: string, search: string): number {
  return source.split(search).length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function translationCall(key: string): string {
  return `t("${key}")`;
}

function onSuccessSetting(setter: string): string {
  return `onSuccess={() => { ${setter}(true); }}`;
}

/**
 * The text between `start` and `end`. Both markers must be present, in that
 * order, so a renamed section fails loudly instead of yielding "".
 */
function sliceBetween(source: string, start: string, end: string): string {
  const startIndex: number = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);

  const endIndex: number = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

interface SuccessParagraph {
  classes: string;
  body: string;
}

/** Every `{flag && ( <p className="..."> ... </p> )}` block in the source. */
function successParagraphs(
  source: string,
  flag: string,
): Array<SuccessParagraph> {
  const pattern: RegExp = new RegExp(
    `\\{${escapeRegExp(flag)} && \\( <p className="([^"]*)">(.*?)</p> \\)\\}`,
    "g",
  );

  const paragraphs: Array<SuccessParagraph> = [];
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    paragraphs.push({ classes: match[1]!, body: match[2]! });
    match = pattern.exec(source);
  }

  return paragraphs;
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function subscribeSection(locale: string): Record<string, unknown> {
  const subscribe: unknown = readLocale(locale)["subscribe"];

  expect(typeof subscribe).toBe("object");
  expect(subscribe).not.toBeNull();

  return subscribe as Record<string, unknown>;
}

describe.each(PAGES)(
  "$page keeps manage-link copy apart from subscribe copy",
  ({ page, subscribeKey, manageKey }: SubscribePageCase) => {
    const source: string = readCode(page);

    const subscribeForm: () => string = (): string => {
      return sliceBetween(
        source,
        "const getNewSubscriptionContentElement",
        "const getManageExistingSubscriptionContentElement",
      );
    };

    const manageForm: () => string = (): string => {
      return sliceBetween(
        source,
        "const getManageExistingSubscriptionContentElement",
        "return ( <Page",
      );
    };

    test("declares a separate flag for the manage tab", () => {
      expect(source).toContain(
        `const [${SUBSCRIBE_SUCCESS_FLAG}, setIsSuccess] = useState<boolean>(false);`,
      );
      expect(source).toContain(
        `const [${MANAGE_SUCCESS_FLAG}, setIsManageLinkRequested] = useState<boolean>(false);`,
      );
    });

    test("the subscribe form sets only the subscribe flag", () => {
      const form: string = subscribeForm();

      expect(form).toContain("/subscribe/${id.toString()}");
      expect(form).toContain(onSuccessSetting("setIsSuccess"));
      expect(form).not.toContain("setIsManageLinkRequested");
    });

    test("the manage form sets only the manage flag", () => {
      const form: string = manageForm();

      expect(form).toContain("/manage-subscription/${id.toString()}");
      expect(form).toContain(onSuccessSetting("setIsManageLinkRequested"));
      expect(form).not.toContain("setIsSuccess");
    });

    test("each flag is set from exactly one place", () => {
      expect(occurrences(source, "setIsSuccess(true)")).toBe(1);
      expect(occurrences(source, "setIsManageLinkRequested(true)")).toBe(1);
    });

    test("subscribe success still renders the original copy", () => {
      const paragraphs: Array<SuccessParagraph> = successParagraphs(
        source,
        SUBSCRIBE_SUCCESS_FLAG,
      );

      expect(paragraphs).toHaveLength(1);
      expect(paragraphs[0]!.classes).toBe(SUCCESS_PARAGRAPH_CLASSES);
      expect(paragraphs[0]!.body).toContain(translationCall(subscribeKey));
      expect(paragraphs[0]!.body).not.toContain(translationCall(manageKey));
    });

    test("manage success renders the manage-specific copy the same way", () => {
      const paragraphs: Array<SuccessParagraph> = successParagraphs(
        source,
        MANAGE_SUCCESS_FLAG,
      );

      expect(paragraphs).toHaveLength(1);
      expect(paragraphs[0]!.classes).toBe(SUCCESS_PARAGRAPH_CLASSES);
      expect(paragraphs[0]!.body).toContain(translationCall(manageKey));
      expect(paragraphs[0]!.body).not.toContain(translationCall(subscribeKey));
    });

    test("each success copy is rendered exactly once, and only the page's own manage copy", () => {
      const otherManageKey: string =
        manageKey === MANAGE_KEY ? MANAGE_EMAIL_KEY : MANAGE_KEY;

      expect(occurrences(source, translationCall(subscribeKey))).toBe(1);
      expect(occurrences(source, translationCall(manageKey))).toBe(1);
      expect(source).not.toContain(translationCall(otherManageKey));
    });

    test("the tabs are hidden after either kind of success", () => {
      expect(source).toContain(
        `{!${SUBSCRIBE_SUCCESS_FLAG} && !${MANAGE_SUCCESS_FLAG} ? ( <div className=""> <Card`,
      );
      expect(occurrences(source, "<Tabs")).toBe(1);
    });
  },
);

describe("Status Page locales carry the manage-link copy", () => {
  test("the pinned locale list matches the Locales directory", () => {
    const discovered: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      })
      .map((file: string): string => {
        return file.replace(/\.json$/, "");
      })
      .sort();

    expect(discovered).toEqual([...LOCALES].sort());
  });

  test.each(LOCALES)(
    "%s has non-empty manage-link strings under subscribe",
    (locale: string) => {
      const subscribe: Record<string, unknown> = subscribeSection(locale);

      for (const key of ["manageLinkSent", "manageLinkSentEmail"]) {
        expect(typeof subscribe[key]).toBe("string");
        expect((subscribe[key] as string).trim().length).toBeGreaterThan(0);
      }

      /*
       * The manage copy must not simply repeat the unconditional subscribe
       * copy it replaces.
       */
      expect(subscribe["manageLinkSent"]).not.toBe(
        subscribe["subscribedSuccessfully"],
      );
      expect(subscribe["manageLinkSentEmail"]).not.toBe(
        subscribe["emailSentCheckSpam"],
      );
    },
  );

  test("English uses the agreed wording", () => {
    const subscribe: Record<string, unknown> = subscribeSection("en");

    expect(subscribe["manageLinkSent"]).toBe(ENGLISH_MANAGE_LINK_SENT);
    expect(subscribe["manageLinkSentEmail"]).toBe(
      ENGLISH_MANAGE_LINK_SENT_EMAIL,
    );
  });
});
