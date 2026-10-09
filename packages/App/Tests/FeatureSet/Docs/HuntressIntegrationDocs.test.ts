import DocsNav, {
  DocsNavSections,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  HUNTRESS_OUTCOME_LABELS,
  HUNTRESS_PAGE_ON_CALL_FOR_LABELS,
  getHuntressWebhookUrl,
} from "../../../FeatureSet/Dashboard/src/Components/Huntress/HuntressConnectionDisplay";
import {
  HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES,
  HUNTRESS_DEFAULT_CONNECTION_NAME,
  getHuntressConnectionFormFields,
} from "../../../FeatureSet/Dashboard/src/Pages/Incidents/Integrations/HuntressConnectionFormFields";
import { DocsPageShape, shapeOf } from "./DocsContentRules";
import {
  DocsFence,
  DocsHeading,
  DocsLink,
  DocsPageLink,
  ScannedPage,
  anchorsOf,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import URL from "Common/Types/API/URL";
import HuntressIncidentReportOutcome from "Common/Types/Huntress/HuntressIncidentReportOutcome";
import HuntressSeverity, {
  AllHuntressSeverities,
  HUNTRESS_SEVERITY_WHEN_UNKNOWN,
} from "Common/Types/Huntress/HuntressSeverity";
import { HUNTRESS_WEBHOOK_ROUTE } from "Common/Types/Huntress/HuntressWebhook";
import StandardWebhookSignature, {
  STANDARD_WEBHOOK_TOLERANCE_IN_SECONDS,
  StandardWebhookVerification,
} from "Common/Server/Utils/Webhook/StandardWebhookSignature";
import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import fs from "fs";
import path from "path";

/*
 * The Huntress page of the docs' Integrations catalog, in all seventeen
 * languages, held to the product it describes.
 *
 * The page walks a reader through connecting Huntress: the connection in
 * OneUptime, the webhook endpoint in Huntress, its signing secret, a test;
 * then the settings, the reports list and the errors a connection reports.
 * Markdown is not compiled, so nothing else notices when the form gains a
 * field, a default changes, a label is reworded or translated anew, or the
 * webhook answers with other words. These tests read the page in every
 * language and check it against the form, the labels the Dashboard draws in
 * that language, the signature check and the sources of the webhook.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const DOCS_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);
const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);
const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src",
);

const PAGE: string = "integrations/huntress";
const CATALOG: string = "integrations/index";
const PAGE_URL: string = `/docs/${PAGE}`;
const ON_CALL_RULES_PAGE: string = "incidents/settings";

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const TRANSLATIONS: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const MENU_PATH_SEPARATOR: string = " → ";
const INLINE_CODE: RegExp = /`([^`\n]+)`/g;
const DETAILS_TITLE: RegExp = /^:::details[ \t]+"([^"]+)"[ \t]*$/;
const TABLE_ROW: RegExp = /^\|.*\|[ \t]*$/;
const CATALOG_LINK_CELL: RegExp = /^\[([^\]]+)\]\((\/docs\/[^)]+)\)$/;

// The sections of the English page, in order. Every translation has as many.
const ENGLISH_SECTIONS: ReadonlyArray<string> = [
  "How it works",
  "Before you begin",
  "Set up the integration",
  "Settings",
  "Reports on the connection's page",
  "Security",
  "Using email instead",
  "Troubleshooting",
  "Next steps",
];

const ENGLISH_SUBSECTIONS: ReadonlyArray<string> = [
  "Connect Huntress in OneUptime",
  "Add a webhook endpoint in Huntress",
  "Save the endpoint's signing secret",
  "Send a test",
  "Severities",
  "Organizations",
];

/*
 * The messages Troubleshooting quotes, as the webhook starts them. The
 * server writes them in English whatever the reader's language, so every
 * language quotes them as they are.
 */
const TROUBLESHOOTING_TITLES: ReadonlyArray<string> = [
  "A request arrived but was refused, because no signing secret is saved for this connection yet",
  "The request's signature does not match the signing secret",
  "The request was signed more than five minutes from now",
  "No Huntress connection has this address.",
  "This project has no incident severities, so a Huntress report cannot open an incident",
];

/*
 * The Dashboard's labels the page names, in English. Each language's page
 * names them as that language's Dashboard draws them.
 */
const DASHBOARD_LABELS: ReadonlyArray<string> = [
  "Incidents",
  "Integrations",
  "Huntress",
  "Connect Huntress",
  "On-Call Policies",
  "Page On-Call For",
  "High and critical reports",
  "Critical reports only",
  "Every report",
  "More fields",
  "Copy webhook URL",
  "Save Signing Secret",
  "Replace Signing Secret",
  "Connection",
  "Receiving reports",
  "Settings",
  "Edit Settings",
  "Name",
  "Severity For Critical Reports",
  "Severity For High Reports",
  "Severity For Low Reports",
  "Only These Organizations",
  "Labels",
  "Resolve When Huntress Closes The Report",
  "Incident Severity",
  "Incident Labels",
  "Incident Reports",
  "Outcome",
  "Incident opened",
  "Incident resolved",
  "View incident",
  "Paged on-call",
  "Skipped: organization not watched",
  "Skipped: already closed in Huntress",
  "The last request was refused",
  "On-Call Executions",
];

/*
 * Huntress's portal is English only: every language names its menus and
 * buttons as Huntress shows them, and the roles as OneUptime names them.
 */
const ENGLISH_EVERYWHERE: ReadonlyArray<string> = [
  "Account Admin",
  "Add an Integration",
  "Webhooks",
  "Add Endpoint",
  "Escalations",
  "Platform Actions",
  "Account Notices",
  "View Signing Secret",
  "Send Test",
  "View Delivery Attempts",
  "Project Owner",
  "Project Admin",
];

/*
 * ---------------------------------------------------------------- Helpers
 */

const readHuntressPage: (language: string) => string = (
  language: string,
): string => {
  return readPage(language, PAGE);
};

const scanHuntressPage: (language: string) => ScannedPage = (
  language: string,
): ScannedPage => {
  return scanMarkdown(readHuntressPage(language));
};

const matchesOf: (text: string, pattern: RegExp) => Array<string> = (
  text: string,
  pattern: RegExp,
): Array<string> => {
  return Array.from(text.matchAll(pattern), (match: RegExpMatchArray) => {
    return match[1] as string;
  });
};

/*
 * What a page names in bold. A menu path, "**Incidents → Integrations →
 * Huntress**", names each screen on it as well.
 */
const boldTermsOf: (text: string) => Set<string> = (
  text: string,
): Set<string> => {
  const terms: Set<string> = new Set<string>();

  for (const term of matchesOf(text, BOLD)) {
    terms.add(term);

    for (const part of term.split(MENU_PATH_SEPARATOR)) {
      terms.add(part.trim());
    }
  }

  return terms;
};

const headingsAt: (
  scanned: ScannedPage,
  level: number,
) => Array<DocsHeading> = (
  scanned: ScannedPage,
  level: number,
): Array<DocsHeading> => {
  return scanned.headings.filter((heading: DocsHeading): boolean => {
    return heading.level === level;
  });
};

// A "## " section of a language's page, found where the English page has it.
const sectionOf: (language: string, englishSection: string) => string = (
  language: string,
  englishSection: string,
): string => {
  const index: number = ENGLISH_SECTIONS.indexOf(englishSection);

  if (index < 0) {
    throw new Error(`The English page has no "${englishSection}" section.`);
  }

  const scanned: ScannedPage = scanHuntressPage(language);
  const sections: Array<DocsHeading> = headingsAt(scanned, 2);
  const start: DocsHeading | undefined = sections[index];

  if (!start) {
    throw new Error(`${language} has no section where "${englishSection}" is.`);
  }

  const next: DocsHeading | undefined = sections[index + 1];

  return scanned.lines
    .slice(start.line - 1, next ? next.line - 1 : scanned.lines.length)
    .join("\n");
};

interface CatalogRow {
  title: string;
  url: string;
  direction: string;
  description: string;
}

// The catalog table's rows that link a docs page, in order.
const catalogRowsOf: (language: string) => Array<CatalogRow> = (
  language: string,
): Array<CatalogRow> => {
  const rows: Array<CatalogRow> = [];

  for (const line of readPage(language, CATALOG).split("\n")) {
    if (!TABLE_ROW.test(line)) {
      continue;
    }

    const cells: Array<string> = line
      .trim()
      .slice(1, -1)
      .split("|")
      .map((cell: string): string => {
        return cell.trim();
      });

    const link: RegExpMatchArray | null = (cells[0] || "").match(
      CATALOG_LINK_CELL,
    );

    if (!link || cells.length !== 3) {
      continue;
    }

    rows.push({
      title: link[1] as string,
      url: link[2] as string,
      direction: cells[1] as string,
      description: cells[2] as string,
    });
  }

  return rows;
};

const readJson: (file: string) => Record<string, unknown> = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
};

// A label as the Dashboard draws it in a language: its translation, or English.
const dashboardWord: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  if (language === "en") {
    return english;
  }

  const translated: unknown = readJson(
    path.join(DASHBOARD_LOCALES_DIR, `${language}.json`),
  )[english];

  return typeof translated === "string" && translated.trim()
    ? translated
    : english;
};

const readSource: (...parts: Array<string>) => string = (
  ...parts: Array<string>
): string => {
  return fs.readFileSync(path.join(PACKAGES_DIR, ...parts), "utf8");
};

const integrationsGroup: () => NavGroup = (): NavGroup => {
  const group: NavGroup | undefined = DocsNav.find(
    (candidate: NavGroup): boolean => {
      return candidate.title === "Integrations";
    },
  );

  if (!group) {
    throw new Error("The docs nav has no Integrations group.");
  }

  return group;
};

/*
 * ------------------------------------------------------------- Navigation
 */

describe("the Huntress page in the docs navigation", () => {
  test("is listed in the Integrations group, right after Datadog", () => {
    const urls: Array<string> = integrationsGroup().links.map(
      (link: NavLink): string => {
        return link.url;
      },
    );

    expect(urls).toContain(PAGE_URL);
    expect(urls.indexOf(PAGE_URL)).toBe(
      urls.indexOf("/docs/integrations/datadog") + 1,
    );
    expect(DocsNavSections).toContain(integrationsGroup().section);
  });

  test("is titled Huntress, and listed once", () => {
    const links: Array<NavLink> = DocsNav.flatMap(
      (group: NavGroup): Array<NavLink> => {
        return group.links.filter((link: NavLink): boolean => {
          return link.url === PAGE_URL;
        });
      },
    );

    expect(links).toEqual([{ title: "Huntress", url: PAGE_URL }]);
  });

  test.each(LANGUAGES)(
    "has its link title in the %s docs locale, as Huntress, beside Datadog",
    (language: string) => {
      const navLinks: Record<string, unknown> = readJson(
        path.join(DOCS_LOCALES_DIR, `${language}.json`),
      )["navLinks"] as Record<string, unknown>;
      const keys: Array<string> = Object.keys(navLinks);

      expect(navLinks["Huntress"]).toBe("Huntress");
      expect(keys.indexOf("Huntress")).toBe(keys.indexOf("Datadog") + 1);
    },
  );

  test.each(LANGUAGES)(
    "has a page in %s, titled after Huntress on its first line",
    (language: string) => {
      const firstLine: string = readHuntressPage(language).split("\n")[0] || "";

      expect(firstLine.startsWith("# ")).toBe(true);
      expect(firstLine).toContain("Huntress");
    },
  );
});

/*
 * ---------------------------------------------------------------- Catalog
 */

describe("the Integrations catalog", () => {
  test("lists Huntress in English as an inbound integration that pages on-call", () => {
    const row: CatalogRow | undefined = catalogRowsOf("en").find(
      (candidate: CatalogRow): boolean => {
        return candidate.url === PAGE_URL;
      },
    );

    expect(row).toEqual({
      title: "Huntress",
      url: PAGE_URL,
      direction: "Inbound",
      description:
        "Page on-call for Huntress incident reports, and resolve the incident when the report closes.",
    });
  });

  test.each(LANGUAGES)(
    "has the Huntress row right after Datadog's, as inbound as it, in %s",
    (language: string) => {
      const rows: Array<CatalogRow> = catalogRowsOf(language);
      const urls: Array<string> = rows.map((row: CatalogRow): string => {
        return row.url;
      });
      const datadogAt: number = urls.indexOf("/docs/integrations/datadog");
      const huntressAt: number = urls.indexOf(PAGE_URL);

      expect(datadogAt).toBeGreaterThanOrEqual(0);
      expect(huntressAt).toBe(datadogAt + 1);

      const datadog: CatalogRow = rows[datadogAt] as CatalogRow;
      const huntress: CatalogRow = rows[huntressAt] as CatalogRow;

      expect(huntress.title).toBe("Huntress");
      expect(huntress.direction).toBe(datadog.direction);
      expect(huntress.description).toContain("Huntress");
      expect(
        urls.filter((url: string) => {
          return url === PAGE_URL;
        }),
      ).toHaveLength(1);
    },
  );
});

/*
 * ------------------------------------------------------------------ Shape
 */

describe("every translation of the Huntress page keeps the English page's shape", () => {
  const english: ScannedPage = scanHuntressPage("en");

  test("the English page has the sections and steps the guide is built from", () => {
    expect(
      headingsAt(english, 2).map((heading: DocsHeading): string => {
        return heading.text;
      }),
    ).toEqual(ENGLISH_SECTIONS);
    expect(
      headingsAt(english, 3).map((heading: DocsHeading): string => {
        return heading.text;
      }),
    ).toEqual(ENGLISH_SUBSECTIONS);

    expect(shapeOf(english).components).toEqual([
      "cards",
      "steps(4)",
      "details",
      "details",
      "details",
      "details",
      "details",
      "details",
      "cards",
    ]);
    expect(shapeOf(english).fences).toEqual(["mermaid"]);
    expect(shapeOf(english).alerts).toEqual(["NOTE", "TIP"]);
  });

  test.each(TRANSLATIONS)(
    "%s has the same headings, components, code, callouts and page links",
    (language: string) => {
      const ours: DocsPageShape = shapeOf(scanHuntressPage(language));

      expect(ours).toEqual(shapeOf(english));
    },
  );

  test.each(LANGUAGES)(
    "%s links the on-call rules section of its own Incident Settings page",
    (language: string) => {
      const anchors: Array<string | null> = scanHuntressPage(language)
        .links.map((link: DocsLink): DocsPageLink | null => {
          return parseDocsLink(link.target);
        })
        .filter((link: DocsPageLink | null): link is DocsPageLink => {
          return link !== null && link.page === ON_CALL_RULES_PAGE;
        })
        .map((link: DocsPageLink): string | null => {
          return link.anchor;
        });

      expect(anchors).toHaveLength(2);

      for (const anchor of anchors) {
        expect({
          language,
          anchor,
          exists: anchorsOf(language, ON_CALL_RULES_PAGE).has(anchor || ""),
        }).toEqual({ language, anchor, exists: true });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s's Mermaid diagram keeps Huntress's event names",
    (language: string) => {
      const diagram: string =
        scanHuntressPage(language).fences.find((fence: DocsFence): boolean => {
          return fence.lang === "mermaid";
        })?.code || "";

      for (const event of [
        "incident_report.created",
        "incident_report.comment_added",
        "incident_report.closed",
      ]) {
        expect({ language, event, kept: diagram.includes(event) }).toEqual({
          language,
          event,
          kept: true,
        });
      }
    },
  );
});

/*
 * ---------------------------------------------------- The Dashboard's words
 */

describe("the Huntress page names the Dashboard as it reads in each language", () => {
  test.each(LANGUAGES)(
    "%s names every Dashboard label in bold, as the Dashboard draws it",
    (language: string) => {
      const bold: Set<string> = boldTermsOf(readHuntressPage(language));

      for (const label of DASHBOARD_LABELS) {
        const word: string = dashboardWord(language, label);

        expect({ language, label, word, named: bold.has(word) }).toEqual({
          language,
          label,
          word,
          named: true,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s names Huntress's menus and the roles in English",
    (language: string) => {
      const bold: Set<string> = boldTermsOf(readHuntressPage(language));

      for (const word of ENGLISH_EVERYWHERE) {
        expect({ language, word, named: bold.has(word) }).toEqual({
          language,
          word,
          named: true,
        });
      }
    },
  );

  test("the Huntress words the page names are the ones the setup card tells the user", () => {
    const card: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "Huntress",
        "HuntressSetupCard.tsx",
      ),
      "utf8",
    );
    const dialog: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "Huntress",
        "HuntressSigningSecretModal.tsx",
      ),
      "utf8",
    );

    for (const word of [
      "Account Admin",
      "Add an Integration",
      "Webhooks",
      "Add Endpoint",
      "Incident Reports",
      "View Signing Secret",
      "Send Test",
    ]) {
      expect({ word, inCard: card.includes(word) }).toEqual({
        word,
        inCard: true,
      });
    }

    expect(dialog).toContain("View Signing Secret");
  });
});

/*
 * ------------------------------------------------------- What it promises
 */

describe("the Huntress page states what the product does", () => {
  const englishPage: string = readHuntressPage("en");
  const settings: string = sectionOf("en", "Settings");
  const code: Set<string> = new Set(matchesOf(englishPage, INLINE_CODE));

  test("its settings table names every field of the connection form", () => {
    const bold: Set<string> = boldTermsOf(settings);

    for (const field of getHuntressConnectionFormFields()) {
      expect({
        field: field.title,
        named: bold.has(field.title || ""),
      }).toEqual({ field: field.title, named: true });
    }
  });

  test("the defaults it states are the form's", () => {
    expect(HUNTRESS_DEFAULT_CONNECTION_NAME).toBe("Huntress");
    expect(code.has(HUNTRESS_DEFAULT_CONNECTION_NAME)).toBe(true);

    const pageOnCallForDefault: string =
      HUNTRESS_PAGE_ON_CALL_FOR_LABELS[
        HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES.pageOnCallFor as HuntressSeverity
      ];

    expect(pageOnCallForDefault).toBe("High and critical reports");
    expect(settings).toContain(
      `| **Page On-Call For** | Which reports page the policies: **Critical reports only**, **High and critical reports** or **Every report**. Every report opens an incident either way. | **${pageOnCallForDefault}** |`,
    );
    expect(sectionOf("en", "Set up the integration")).toContain(
      `starts on **${pageOnCallForDefault}**`,
    );

    expect(
      HUNTRESS_CONNECTION_CREATE_INITIAL_VALUES.resolveIncidentWhenReportCloses,
    ).toBe(true);
    expect(settings).toMatch(
      /\| \*\*Resolve When Huntress Closes The Report\*\* \|[^|]+\| On \|/,
    );
  });

  test("it offers every Page On-Call For choice the form offers", () => {
    for (const severity of AllHuntressSeverities) {
      expect(settings).toContain(
        `**${HUNTRESS_PAGE_ON_CALL_FOR_LABELS[severity]}**`,
      );
    }
  });

  test("a report without a severity is handled as high, as the page says", () => {
    expect(HUNTRESS_SEVERITY_WHEN_UNKNOWN).toBe(HuntressSeverity.High);
    expect(settings).toContain(
      "A report that names no severity is handled as high.",
    );
  });

  test("its outcomes are the ones the reports list draws", () => {
    const reports: string = sectionOf("en", "Reports on the connection's page");

    for (const outcome of [
      HuntressIncidentReportOutcome.IncidentOpened,
      HuntressIncidentReportOutcome.IncidentResolved,
      HuntressIncidentReportOutcome.OrganizationNotWatched,
      HuntressIncidentReportOutcome.ClosedBeforeReceived,
    ]) {
      expect(reports).toContain(`| **${HUNTRESS_OUTCOME_LABELS[outcome]}** |`);
    }
  });

  test("the webhook URL it shows is the route the API serves", () => {
    const url: string = getHuntressWebhookUrl({
      apiUrl: URL.fromString("https://oneuptime.com/api"),
      connectionId: "6d1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    });

    expect(HUNTRESS_WEBHOOK_ROUTE).toBe("/huntress/webhook");
    expect(url.startsWith("https://oneuptime.com/api/huntress/webhook/")).toBe(
      true,
    );
    expect(
      code.has("https://oneuptime.com/api/huntress/webhook/<connection-id>"),
    ).toBe(true);
    expect(readSource("App", "FeatureSet", "BaseAPI", "Index.ts")).toContain(
      "new HuntressConnectionAPI().getRouter()",
    );
    expect(
      readSource("Common", "Server", "API", "HuntressConnectionAPI.ts"),
    ).toContain("`${HUNTRESS_WEBHOOK_ROUTE}/:connectionId`");
  });

  test("the window it gives a signature is the server's: five minutes", () => {
    expect(STANDARD_WEBHOOK_TOLERANCE_IN_SECONDS).toBe(5 * 60);
    expect(sectionOf("en", "How it works")).toContain(
      "no more than five minutes before it arrives",
    );
    expect(sectionOf("en", "Security")).toContain(
      "signed more than five minutes earlier or later",
    );
  });

  test("the headers it names are the ones a Huntress delivery is checked by", () => {
    for (const header of ["svix-id", "svix-timestamp", "svix-signature"]) {
      expect(code.has(header)).toBe(true);
    }

    const secret: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;
    const body: string = JSON.stringify({
      event_type: "incident_report.created",
    });
    const now: Date = new Date();
    const timestamp: string = String(Math.floor(now.getTime() / 1000));

    const verification: StandardWebhookVerification =
      StandardWebhookSignature.verify({
        secret,
        headers: StandardWebhookSignature.readHeaders({
          "svix-id": "msg_1",
          "svix-timestamp": timestamp,
          "svix-signature": StandardWebhookSignature.sign({
            secret,
            messageId: "msg_1",
            timestamp,
            body,
          }),
        }),
        body,
        now,
      });

    expect(verification.verified).toBe(true);
  });
});

/*
 * --------------------------------------------------------- Troubleshooting
 */

describe("the Huntress page's troubleshooting quotes what the webhook says", () => {
  const SECRET: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;
  const OTHER_SECRET: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;
  const BODY: string = '{"event_type":"incident_report.created"}';

  function verifyWith(data: {
    signWith: string;
    signedAt: Date;
    now: Date;
  }): StandardWebhookVerification {
    const timestamp: string = String(
      Math.floor(data.signedAt.getTime() / 1000),
    );

    return StandardWebhookSignature.verify({
      secret: SECRET,
      headers: StandardWebhookSignature.readHeaders({
        "svix-id": "msg_1",
        "svix-timestamp": timestamp,
        "svix-signature": StandardWebhookSignature.sign({
          secret: data.signWith,
          messageId: "msg_1",
          timestamp,
          body: BODY,
        }),
      }),
      body: BODY,
      now: data.now,
    });
  }

  function messageOf(verification: StandardWebhookVerification): string {
    return verification.verified ? "" : verification.message;
  }

  test("the English page quotes exactly these messages, in this order", () => {
    const titles: Array<string> = scanHuntressPage("en")
      .lines.map((line: string): string | null => {
        const match: RegExpMatchArray | null = line.match(DETAILS_TITLE);
        return match ? (match[1] as string) : null;
      })
      .filter((title: string | null): title is string => {
        return title !== null;
      });

    expect(titles).toEqual(TROUBLESHOOTING_TITLES);
  });

  test("a delivery signed with another secret is refused in the words the page quotes", () => {
    const now: Date = new Date();

    expect(
      messageOf(verifyWith({ signWith: OTHER_SECRET, signedAt: now, now })),
    ).toMatch(
      new RegExp(
        `^${"The request's signature does not match the signing secret"}`,
      ),
    );
  });

  test("a delivery signed too long ago is refused in the words the page quotes", () => {
    const now: Date = new Date();
    const tenMinutesAgo: Date = new Date(now.getTime() - 10 * 60 * 1000);

    expect(
      messageOf(verifyWith({ signWith: SECRET, signedAt: tenMinutesAgo, now })),
    ).toMatch(
      new RegExp(
        `^${"The request was signed more than five minutes from now"}`,
      ),
    );
  });

  test("the webhook and the processor say the other three", () => {
    const handler: string = readSource(
      "Common",
      "Server",
      "Utils",
      "Huntress",
      "HuntressWebhookHandler.ts",
    );
    const processor: string = readSource(
      "Common",
      "Server",
      "Utils",
      "Huntress",
      "HuntressIncidentReportProcessor.ts",
    );

    expect(handler).toContain(`"${TROUBLESHOOTING_TITLES[0]}.`);
    expect(handler).toContain(`"${TROUBLESHOOTING_TITLES[3]}"`);
    expect(processor).toContain(`"${TROUBLESHOOTING_TITLES[4]}.`);
    expect(processor).toContain(
      "Add one under Incidents > Settings > Incident Severity.",
    );
    expect(sectionOf("en", "Troubleshooting")).toContain(
      "Add one under **Incidents → Settings → Incident Severity**.",
    );
  });

  test.each(TRANSLATIONS)(
    "%s quotes the same messages, in English",
    (language: string) => {
      const titles: Array<string> = scanHuntressPage(language)
        .lines.map((line: string): string | null => {
          const match: RegExpMatchArray | null = line.match(DETAILS_TITLE);
          return match ? (match[1] as string) : null;
        })
        .filter((title: string | null): title is string => {
          return title !== null;
        });

      expect(titles).toEqual(TROUBLESHOOTING_TITLES);
    },
  );
});
