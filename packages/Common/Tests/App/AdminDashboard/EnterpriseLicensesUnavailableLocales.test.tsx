import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement, ReactNode } from "react";

/*
 * THE ENTERPRISE LICENSES NOTICES, IN THE READER'S LANGUAGE (#7962).
 *
 * Admin Dashboard > Enterprise Licenses (/admin/enterprise-licenses, and
 * one license under it) draws one of two notices where the license server
 * does not run (EnterpriseLicensesUnavailable):
 *
 *   - a self-hosted server (billing off): "Only available on OneUptime
 *     Cloud", and that licenses are issued and tracked on oneuptime.com;
 *   - OneUptime Cloud built as the Community Edition: "Requires the
 *     OneUptime Enterprise Edition", and to deploy its image.
 *
 * The page handed EmptyState the four sentences in English, and none of
 * them was an entry of the Admin Dashboard's locales, so a Persian page
 * read «پروانه‌های سازمانی» over an English notice, and German, Japanese
 * and the rest the same. They are the page's entries now
 * (pages.enterpriseLicenses.*, as its title is), worded in every Admin
 * Dashboard language: Persian says پروانه for a license
 * (App/Tests/Dashboard/PersianLicenseWordInLocales), each language names
 * the Enterprise Edition as the Admin Dashboard already does (Arabic
 * إصدار المؤسسات, the rest "Enterprise Edition" in Latin letters), and
 * OneUptime Cloud and oneuptime.com are written as they are.
 *
 * This renders the notice with the Admin Dashboard's own i18next
 * (src/Utils/i18n.ts and its 18 locale files) in every language, both
 * ways. Only the page chrome is a stand-in.
 */

jest.setTimeout(60000);

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: {
      title?: string;
      children?: ReactNode | undefined;
    }): ReactElement => {
      return (
        <main data-testid="admin-page" data-title={props.title}>
          {props.children}
        </main>
      );
    },
  };
});

import EnterpriseLicensesUnavailable from "../../../../App/FeatureSet/AdminDashboard/src/Pages/EnterpriseLicenses/EnterpriseLicensesUnavailable";
import AdminI18n from "../../../../App/FeatureSet/AdminDashboard/src/Utils/i18n";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const ADMIN_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const LOCALES_DIR: string = path.join(ADMIN_SRC, "Locales");

const COMPONENT: string = path.join(
  ADMIN_SRC,
  "Pages",
  "EnterpriseLicenses",
  "EnterpriseLicensesUnavailable.tsx",
);

const KEY_PREFIX: string = "pages.enterpriseLicenses.";

interface Notice {
  name: string;
  isBillingEnabled: boolean;
  titleKey: string;
  descriptionKey: string;
  english: { title: string; description: string };
}

// The two notices, with the English the page has always shown.
const NOTICES: Array<Notice> = [
  {
    name: "a self-hosted server",
    isBillingEnabled: false,
    titleKey: "cloudOnlyTitle",
    descriptionKey: "cloudOnlyDescription",
    english: {
      title: "Only available on OneUptime Cloud",
      description:
        "Enterprise licenses are issued and tracked on the hosted oneuptime.com, where billing is enabled. This self-hosted instance does not manage licenses.",
    },
  },
  {
    name: "OneUptime Cloud built as the Community Edition",
    isBillingEnabled: true,
    titleKey: "enterpriseEditionRequiredTitle",
    descriptionKey: "enterpriseEditionRequiredDescription",
    english: {
      title: "Requires the OneUptime Enterprise Edition",
      description:
        "License management is part of the OneUptime Enterprise Edition. Deploy the Enterprise Edition image to issue and track licenses.",
    },
  },
];

const ENGLISH_SENTENCES: Array<string> = NOTICES.flatMap(
  (notice: Notice): Array<string> => {
    return [notice.english.title, notice.english.description];
  },
);

const NOTICE_KEYS: Array<string> = NOTICES.flatMap(
  (notice: Notice): Array<string> => {
    return [notice.titleKey, notice.descriptionKey];
  },
);

type Tree = { [key: string]: unknown };

function readLocale(code: string): Tree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Tree;
}

// The page's own entries in a locale (pages.enterpriseLicenses).
function noticeEntriesOf(code: string): Record<string, unknown> {
  const pages: Tree = (readLocale(code)["pages"] || {}) as Tree;

  return (pages["enterpriseLicenses"] || {}) as Record<string, unknown>;
}

function entry(code: string, key: string): string {
  const value: unknown = noticeEntriesOf(code)[key];

  expect(typeof value).toBe("string");

  return value as string;
}

// How a language names the Enterprise Edition, as its locale already does.
function enterpriseEditionIn(code: string): string {
  const named: unknown = readLocale(code)["Enterprise Edition"];

  expect(typeof named).toBe("string");

  return named as string;
}

// What a sentence may end with, per script.
const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

// The Admin Dashboard's i18next, in a language, as its language menu sets it.
async function readIn(code: string): Promise<void> {
  await act(async () => {
    await AdminI18n.changeLanguage(code);
  });

  expect(AdminI18n.resolvedLanguage).toBe(code);
}

// What the page draws, as a reader reads it.
function drawnText(): string {
  return withoutIsolateMarks(
    screen.getByTestId("admin-page").textContent || "",
  );
}

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await AdminI18n.changeLanguage("en");
});

describe("the Enterprise Licenses notices' entries", () => {
  test("say in English what the page has always said", () => {
    for (const notice of NOTICES) {
      expect(entry("en", notice.titleKey)).toBe(notice.english.title);
      expect(entry("en", notice.descriptionKey)).toBe(
        notice.english.description,
      );
    }
  });

  test("the Admin Dashboard has its 17 other languages", () => {
    expect(ADMIN_DASHBOARD_LANGUAGES).toHaveLength(17);
  });

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "are worded in %s, none of them as the English",
    (code: string) => {
      for (const key of NOTICE_KEYS) {
        const worded: string = entry(code, key);

        expect(worded.trim()).not.toBe("");
        expect(worded).not.toBe(entry("en", key));
        // Not an English sentence of the notices under another key.
        expect(ENGLISH_SENTENCES).not.toContain(worded);
      }
    },
  );

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "in %s, name OneUptime Cloud, oneuptime.com and the Enterprise Edition as written",
    (code: string) => {
      const enterpriseEdition: string = enterpriseEditionIn(code);

      expect(entry(code, "cloudOnlyTitle")).toContain("OneUptime Cloud");
      expect(entry(code, "cloudOnlyDescription")).toContain("oneuptime.com");
      expect(entry(code, "enterpriseEditionRequiredTitle")).toContain(
        "OneUptime",
      );
      expect(entry(code, "enterpriseEditionRequiredTitle")).toContain(
        enterpriseEdition,
      );
      expect(entry(code, "enterpriseEditionRequiredDescription")).toContain(
        "OneUptime",
      );
      expect(entry(code, "enterpriseEditionRequiredDescription")).toContain(
        enterpriseEdition,
      );
    },
  );

  test("Arabic names the Enterprise Edition in its own words, as the rest of its Admin Dashboard does", () => {
    expect(enterpriseEditionIn("ar")).toBe("إصدار المؤسسات");

    for (const key of NOTICE_KEYS.filter((key: string): boolean => {
      return key.startsWith("enterpriseEdition");
    })) {
      expect(entry("ar", key)).not.toContain("Enterprise Edition");
    }
  });

  test("Persian says پروانه for a license, never مجوز or the loanword", () => {
    for (const key of [
      "cloudOnlyDescription",
      "enterpriseEditionRequiredDescription",
    ]) {
      const persian: string = entry("fa", key);

      expect(persian).toContain("پروانه");
      expect(persian).not.toContain("مجوز");
      expect(persian).not.toMatch(/لایسنس|لیسانس/u);
    }
  });

  test("Persian writes Persian letters, and Arabic Arabic ones", () => {
    for (const key of NOTICE_KEYS) {
      // Arabic yeh and kaf, where Persian writes ی and ک.
      expect(entry("fa", key)).not.toMatch(/[يك]/u);
      // Persian yeh and keheh, where Arabic writes ي and ك.
      expect(entry("ar", key)).not.toMatch(/[یک]/u);
    }
  });

  test.each(["en", ...ADMIN_DASHBOARD_LANGUAGES])(
    "in %s, each description is whole sentences",
    (code: string) => {
      for (const notice of NOTICES) {
        const description: string = entry(code, notice.descriptionKey).trim();

        expect(
          SENTENCE_ENDINGS.some((ending: string): boolean => {
            return description.endsWith(ending);
          }),
        ).toBe(true);
      }
    },
  );

  test("the page draws the notices from these entries, not from English of its own", () => {
    const source: string = fs.readFileSync(COMPONENT, "utf8");

    for (const sentence of ENGLISH_SENTENCES) {
      expect(source).not.toContain(sentence);
    }

    for (const key of NOTICE_KEYS) {
      expect(source).toContain(`"${KEY_PREFIX}${key}"`);
    }

    // No title or description handed to EmptyState as written.
    expect(source).not.toMatch(/\b(title|description)="/);
  });
});

describe.each(NOTICES)(
  "Admin Dashboard > Enterprise Licenses on $name",
  (notice: Notice) => {
    test.each([...ADMIN_DASHBOARD_LANGUAGES])(
      "reads in %s, under the page's translated title",
      async (code: string) => {
        await readIn(code);

        render(
          <EnterpriseLicensesUnavailable
            isBillingEnabled={notice.isBillingEnabled}
          />,
        );

        const text: string = drawnText();

        expect(text).toContain(
          withoutIsolateMarks(entry(code, notice.titleKey)),
        );
        expect(text).toContain(
          withoutIsolateMarks(entry(code, notice.descriptionKey)),
        );

        for (const sentence of ENGLISH_SENTENCES) {
          expect(text).not.toContain(sentence);
        }

        // The title above the notice is the page's, in the same language.
        expect(screen.getByTestId("admin-page")).toHaveAttribute(
          "data-title",
          entry(code, "title"),
        );
      },
    );

    test("reads in English as it always has", async () => {
      await readIn("en");

      render(
        <EnterpriseLicensesUnavailable
          isBillingEnabled={notice.isBillingEnabled}
        />,
      );

      expect(screen.getByText(notice.english.title)).toBeInTheDocument();
      expect(drawnText()).toContain(notice.english.description);
    });

    test("draws only its own notice", async () => {
      await readIn("de");

      render(
        <EnterpriseLicensesUnavailable
          isBillingEnabled={notice.isBillingEnabled}
        />,
      );

      const other: Notice = NOTICES.find((candidate: Notice): boolean => {
        return candidate !== notice;
      }) as Notice;

      expect(drawnText()).not.toContain(entry("de", other.titleKey));
      expect(drawnText()).not.toContain(entry("de", other.descriptionKey));
    });
  },
);

describe("Admin Dashboard > Enterprise Licenses in German and Persian", () => {
  test("a self-hosted server's notice in German", async () => {
    await readIn("de");

    render(<EnterpriseLicensesUnavailable isBillingEnabled={false} />);

    expect(
      screen.getByText("Nur auf OneUptime Cloud verfügbar"),
    ).toBeInTheDocument();
    expect(drawnText()).toContain(
      "Diese selbst gehostete Instanz verwaltet keine Lizenzen.",
    );
  });

  test("a Community Edition build's notice in German", async () => {
    await readIn("de");

    render(<EnterpriseLicensesUnavailable isBillingEnabled={true} />);

    expect(
      screen.getByText("Erfordert die OneUptime Enterprise Edition"),
    ).toBeInTheDocument();
  });

  test("a self-hosted server's notice in Persian, under «پروانه‌های سازمانی»", async () => {
    await readIn("fa");

    render(<EnterpriseLicensesUnavailable isBillingEnabled={false} />);

    expect(screen.getByTestId("admin-page")).toHaveAttribute(
      "data-title",
      "پروانه‌های سازمانی",
    );
    expect(drawnText()).toContain("فقط در OneUptime Cloud در دسترس است");
    expect(drawnText()).toContain("پروانه‌های سازمانی در oneuptime.com");
  });

  test("a Community Edition build's notice in Persian", async () => {
    await readIn("fa");

    render(<EnterpriseLicensesUnavailable isBillingEnabled={true} />);

    expect(drawnText()).toContain("نیازمند OneUptime Enterprise Edition");
    expect(drawnText()).toContain("مدیریت پروانه‌ها");
  });
});
