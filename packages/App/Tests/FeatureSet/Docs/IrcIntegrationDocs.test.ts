import DocsNav, {
  DocsNavSections,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { WORKFLOW_LOG_REDACTED_VALUE } from "../../../FeatureSet/Workflow/Utils/SecretRedaction";
import { searchWorkflowTemplates } from "../../../FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplatePickerUtil";
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
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import SendMessageToChannel from "Common/Server/Types/Workflow/Components/IRC/SendMessageToChannel";
import {
  RunOptions,
  RunReturnType,
} from "Common/Server/Types/Workflow/ComponentCode";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import IRCClient, {
  IRC_DEFAULT_PACING,
  IRCSendOptions,
} from "Common/Server/Utils/IRC/IRCClient";
import IRCMessageText from "Common/Server/Utils/IRC/IRCMessageText";
import {
  FakeIRCServer,
  FakeIRCServerOptions,
  linesSent,
  startFakeIRCServer,
} from "Common/Tests/Server/Utils/IRC/FakeIRCServer";
import {
  TestCertificate,
  createTestCertificate,
} from "Common/Tests/Server/Utils/IRC/TestCertificate";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ComponentMetadata, {
  Argument,
  ComponentCategory,
  ComponentType,
  Port,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import IRCComponents, {
  IRC_DEFAULT_NICKNAME,
  IRC_DEFAULT_PLAIN_TEXT_PORT,
  IRC_DEFAULT_TLS_PORT,
  IRC_MAX_LINES,
} from "Common/Types/Workflow/Components/IRC";
import {
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplates,
} from "Common/Types/Workflow/Templates";
import {
  ComponentSearchResult,
  getComponentSearchIndex,
  searchComponents,
} from "Common/UI/Components/Workflow/ComponentPicker/ComponentSearch";
import {
  POPULAR_COMPONENT_IDS,
  PickerCatalog,
  buildPickerCatalog,
} from "Common/UI/Components/Workflow/ComponentPicker/PickerCatalog";
import { loadComponentsAndCategories } from "Common/UI/Components/Workflow/Utils";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";
import tls from "tls";

/*
 * The IRC page of the docs' Integrations catalog, in all seventeen
 * languages, held to the product it describes.
 *
 * The page walks a reader through the "Send Message to IRC" workflow step:
 * what one run says to the server, the server and channel to pick, the
 * passwords to keep in secret global variables, the workflow built from the
 * "Tell IRC when an incident opens" template or from scratch, a test run,
 * tips and the errors the step reports. Markdown is not compiled, so nothing
 * else notices when the step gains a setting, a default changes, a template
 * is renamed or a Dashboard label is translated anew. These tests read the
 * page in every language and check it against the step's metadata, its
 * runtime, the template catalog, the component picker, the Dashboard's own
 * words in each language, and whole runs of the step against an IRC server
 * on 127.0.0.1 - so a sentence the page quotes is one the step really says.
 */

const DOCS_DIR: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const DOCS_LOCALES_DIR: string = path.join(DOCS_DIR, "Locales");
const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);
const BASE_MODEL_TABLE_FILE: string = path.resolve(
  __dirname,
  "../../../../Common/UI/Components/ModelTable/BaseModelTable.tsx",
);

const PAGE: string = "integrations/irc";
const CATALOG: string = "integrations/index";
const PAGE_URL: string = `/docs/${PAGE}`;
const COMPONENTS_PAGE: string = "workflows/components";
const VARIABLES_PAGE: string = "workflows/variables";

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const TRANSLATIONS: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// The Persian pages name the Dashboard's labels in English.
const ENGLISH_UI_LANGUAGES: ReadonlySet<string> = new Set<string>(["en", "fa"]);

const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const MENU_PATH_SEPARATOR: string = " → ";
const INLINE_CODE: RegExp = /`([^`\n]+)`/g;
const DETAILS_TITLE: RegExp = /^:::details[ \t]+"([^"]+)"[ \t]*$/;
const TABLE_ROW: RegExp = /^\|.*\|[ \t]*$/;
const CATALOG_LINK_CELL: RegExp = /^\[([^\]]+)\]\((\/docs\/[^)]+)\)$/;
const TEMPLATE_REFERENCE: RegExp =
  /\{\{local\.components\.incident-on-create-1\.returnValues\.model\.([A-Za-z.]+)\}\}/g;
const SEQUENCE_LABEL: RegExp =
  /^\s*(?:\w+\s*-{1,2}>{1,2}\s*\w+\s*:|opt\b|loop\b)/;
const DIAGRAM_COMMANDS: ReadonlyArray<string> = [
  "NICK",
  "USER",
  "JOIN",
  "PRIVMSG",
  "PING",
  "PONG",
  "QUIT",
];

// The sections of the English page, in order. Every translation has as many.
const ENGLISH_SECTIONS: ReadonlyArray<string> = [
  "How it works",
  "Before you begin",
  "Set up the integration",
  "Tips",
  "Troubleshooting",
  "Next steps",
];

const ENGLISH_STEPS: ReadonlyArray<string> = [
  "Choose a server and a channel",
  "Store any passwords as secret variables",
  "Build the workflow",
  "Turn it on and test it",
];

/*
 * The messages the Troubleshooting section quotes, as the step's run log
 * starts them. The step writes them in English whatever the reader's
 * language, so every language quotes them as they are; "…" stands for the
 * server's name and port.
 */
const TROUBLESHOOTING_TITLES: ReadonlyArray<string> = [
  "The IRC server refused the connection",
  "SASL sign-in failed",
  "Could not join #your-channel",
  "Could not send to #your-channel",
  "The TLS certificate of the IRC server … is not trusted",
];

// What the page uses as an example, and the log line it quotes for it.
const EXAMPLE_SERVER: string = "irc.libera.chat";
const EXAMPLE_CHANNEL: string = "#your-channel";
const QUOTED_LOG_LINE: string = `Sent 2 lines to ${EXAMPLE_CHANNEL}.`;
const LIBERA_SASL_GUIDE: string = "https://libera.chat/guides/sasl";

const TEMPLATE_ID: string = "incident-created-irc";

/*
 * The Dashboard labels the page names, in English. Each language's page
 * names them as that language's Dashboard draws them.
 */
const DASHBOARD_LABELS: ReadonlyArray<string> = [
  "Workflows",
  "Global Variables",
  "Name",
  "Next",
  "Content",
  "Secret",
  "Create Workflow",
  "Search templates…",
  "Use this template",
  "Start from scratch",
  "Builder",
  "Choose what starts this workflow",
  "Popular",
  "Add Component",
  "More fields",
  "Global variables",
  "Enabled",
  "Run Workflow",
  "Incident ID",
  "Run Workflow Manually",
  "Run",
  "Workflow Run",
  "Success",
  "Error",
  "Log",
];

// The Global Variables list's create button: "<verb> <noun>".
const CREATE_VARIABLE_NOUN: string = "Workflow Variable";

/*
 * ---------------------------------------------------------------- Helpers
 */

type ReadFunction = (language: string) => string;

const readIrcPage: ReadFunction = (language: string): string => {
  return readPage(language, PAGE);
};

const readCatalog: ReadFunction = (language: string): string => {
  return readPage(language, CATALOG);
};

type ScanFunction = (language: string) => ScannedPage;

const scanIrcPage: ScanFunction = (language: string): ScannedPage => {
  return scanMarkdown(readIrcPage(language));
};

type MatchesFunction = (text: string, pattern: RegExp) => Array<string>;

const matchesOf: MatchesFunction = (
  text: string,
  pattern: RegExp,
): Array<string> => {
  return Array.from(text.matchAll(pattern), (match: RegExpMatchArray) => {
    return match[1] as string;
  });
};

type TermsFunction = (text: string) => Set<string>;

/*
 * What a page names in bold. A menu path, "**Workflows → Global Variables**",
 * names each screen on it as well.
 */
const boldTermsOf: TermsFunction = (text: string): Set<string> => {
  const terms: Set<string> = new Set<string>();

  for (const term of matchesOf(text, BOLD)) {
    terms.add(term);

    for (const part of term.split(MENU_PATH_SEPARATOR)) {
      terms.add(part.trim());
    }
  }

  return terms;
};

const codeTermsOf: TermsFunction = (text: string): Set<string> => {
  return new Set(matchesOf(text, INLINE_CODE));
};

type HeadingsFunction = (
  scanned: ScannedPage,
  level: number,
) => Array<DocsHeading>;

const headingsAt: HeadingsFunction = (
  scanned: ScannedPage,
  level: number,
): Array<DocsHeading> => {
  return scanned.headings.filter((heading: DocsHeading): boolean => {
    return heading.level === level;
  });
};

type SectionFunction = (language: string, englishSection: string) => string;

/*
 * A "## " section of a language's page, found where the English page has
 * it: a translation keeps the English sections in the same order.
 */
const sectionOf: SectionFunction = (
  language: string,
  englishSection: string,
): string => {
  const index: number = ENGLISH_SECTIONS.indexOf(englishSection);

  if (index < 0) {
    throw new Error(`The English page has no "${englishSection}" section.`);
  }

  const scanned: ScannedPage = scanIrcPage(language);
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

type DiagramFunction = (language: string) => DocsFence;

const diagramOf: DiagramFunction = (language: string): DocsFence => {
  const diagrams: Array<DocsFence> = scanIrcPage(language).fences.filter(
    (fence: DocsFence): boolean => {
      return fence.lang === "mermaid";
    },
  );

  expect({ language, diagrams: diagrams.length }).toEqual({
    language,
    diagrams: 1,
  });

  return diagrams[0] as DocsFence;
};

interface CatalogRow {
  title: string;
  url: string;
  direction: string;
  description: string;
}

type CatalogRowsFunction = (language: string) => Array<CatalogRow>;

// The catalog table's rows that link a docs page, in order.
const catalogRowsOf: CatalogRowsFunction = (
  language: string,
): Array<CatalogRow> => {
  const rows: Array<CatalogRow> = [];

  for (const line of readCatalog(language).split("\n")) {
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

type StringsFunction = (language: string) => Record<string, unknown>;

const dashboardStringsOf: StringsFunction = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_LOCALES_DIR, `${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
};

const docsLocaleOf: StringsFunction = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(DOCS_LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

type DashboardWordFunction = (language: string, english: string) => string;

// A label as the Dashboard draws it in a language: its translation, or English.
const dashboardWord: DashboardWordFunction = (
  language: string,
  english: string,
): string => {
  if (ENGLISH_UI_LANGUAGES.has(language)) {
    return english;
  }

  const translated: unknown = dashboardStringsOf(language)[english];

  return typeof translated === "string" && translated.trim()
    ? translated
    : english;
};

/*
 * A list's create button, "<verb> <noun>", as BaseModelTable's
 * translateCreateAction draws it: the whole phrase if the language has it,
 * or else its "Create {{itemName}}" with its word for the noun in it.
 */
const createButtonWord: DashboardWordFunction = (
  language: string,
  noun: string,
): string => {
  const english: string = `Create ${noun}`;

  if (ENGLISH_UI_LANGUAGES.has(language)) {
    return english;
  }

  const strings: Record<string, unknown> = dashboardStringsOf(language);
  const whole: unknown = strings[english];

  if (typeof whole === "string" && whole.trim()) {
    return whole;
  }

  const template: unknown = strings["Create {{itemName}}"];
  const word: unknown = strings[noun];

  return (typeof template === "string" ? template : "Create {{itemName}}")
    .split("{{itemName}}")
    .join(typeof word === "string" && word.trim() ? word : noun);
};

const IRC_METADATA: ComponentMetadata = IRCComponents.find(
  (component: ComponentMetadata): boolean => {
    return component.id === ComponentID.IRCSendMessageToChannel;
  },
) as ComponentMetadata;

const ARGUMENTS: Array<Argument> = IRC_METADATA.arguments;

type ArgumentFunction = (name: string) => Argument;

const argumentNamed: ArgumentFunction = (name: string): Argument => {
  const argument: Argument | undefined = ARGUMENTS.find(
    (candidate: Argument): boolean => {
      return candidate.name === name;
    },
  );

  if (!argument) {
    throw new Error(`Send Message to IRC has no setting named "${name}".`);
  }

  return argument;
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

describe("the IRC page in the docs navigation", () => {
  test("is listed in the Integrations group, right after Telegram", () => {
    const urls: Array<string> = integrationsGroup().links.map(
      (link: NavLink): string => {
        return link.url;
      },
    );

    expect(urls).toContain(PAGE_URL);
    expect(urls.indexOf(PAGE_URL)).toBe(
      urls.indexOf("/docs/integrations/telegram") + 1,
    );
  });

  test("is titled IRC, the protocol's own name, and listed once", () => {
    const links: Array<NavLink> = DocsNav.flatMap(
      (group: NavGroup): Array<NavLink> => {
        return group.links.filter((link: NavLink): boolean => {
          return link.url === PAGE_URL;
        });
      },
    );

    expect(links).toEqual([{ title: "IRC", url: PAGE_URL }]);
  });

  test("sits in the sidebar's Integrations section", () => {
    expect(DocsNavSections).toContain("Integrations");
    expect(integrationsGroup().section).toBe("Integrations");
  });

  test.each(LANGUAGES)(
    "has its link title in the %s docs locale, as IRC",
    (language: string) => {
      const navLinks: Record<string, unknown> = docsLocaleOf(language)[
        "navLinks"
      ] as Record<string, unknown>;
      const keys: Array<string> = Object.keys(navLinks);

      expect(navLinks["IRC"]).toBe("IRC");
      // Beside Telegram, where the nav lists it.
      expect(keys.indexOf("IRC")).toBe(keys.indexOf("Telegram") + 1);
    },
  );

  test.each(LANGUAGES)(
    "has a page in %s, titled after IRC on its first line",
    (language: string) => {
      const firstLine: string = readIrcPage(language).split("\n")[0] || "";

      expect(firstLine.startsWith("# ")).toBe(true);
      expect(firstLine).toContain("IRC");
    },
  );
});

/*
 * ---------------------------------------------------------------- Catalog
 */

describe("the Integrations catalog", () => {
  test("lists IRC in English as an outbound integration that posts to a channel", () => {
    const row: CatalogRow | undefined = catalogRowsOf("en").find(
      (candidate: CatalogRow): boolean => {
        return candidate.url === PAGE_URL;
      },
    );

    expect(row).toEqual({
      title: "IRC",
      url: PAGE_URL,
      direction: "Outbound",
      description: "Post incident updates to an IRC channel.",
    });
  });

  test.each(LANGUAGES)(
    "has the IRC row right after Telegram's, as outbound as it, in %s",
    (language: string) => {
      const rows: Array<CatalogRow> = catalogRowsOf(language);
      const urls: Array<string> = rows.map((row: CatalogRow): string => {
        return row.url;
      });
      const telegramAt: number = urls.indexOf("/docs/integrations/telegram");
      const ircAt: number = urls.indexOf(PAGE_URL);

      expect(telegramAt).toBeGreaterThanOrEqual(0);
      expect(ircAt).toBe(telegramAt + 1);

      const telegram: CatalogRow = rows[telegramAt] as CatalogRow;
      const irc: CatalogRow = rows[ircAt] as CatalogRow;

      expect(irc.title).toBe("IRC");
      expect(irc.direction).toBe(telegram.direction);
      expect(irc.description).toContain("IRC");
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

describe("every translation of the IRC page keeps the English page's shape", () => {
  const english: ScannedPage = scanIrcPage("en");

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
    ).toEqual(ENGLISH_STEPS);

    expect(shapeOf(english).components).toEqual([
      "cards",
      "steps(4)",
      "tabs(2)",
      "details",
      "details",
      "details",
      "details",
      "details",
      "cards",
    ]);
    expect(shapeOf(english).fences).toEqual(["mermaid"]);
  });

  test.each(TRANSLATIONS)(
    "%s has the same '## ' sections and steps, at the same places",
    (language: string) => {
      const translated: ScannedPage = scanIrcPage(language);
      const levels: (scanned: ScannedPage) => Array<number> = (
        scanned: ScannedPage,
      ): Array<number> => {
        return scanned.headings.map((heading: DocsHeading): number => {
          return heading.level;
        });
      };

      expect(levels(translated)).toEqual(levels(english));
      expect(headingsAt(translated, 2)).toHaveLength(ENGLISH_SECTIONS.length);
      expect(headingsAt(translated, 3)).toHaveLength(ENGLISH_STEPS.length);
    },
  );

  test.each(TRANSLATIONS)(
    "%s has the same components, code, callouts and page links",
    (language: string) => {
      const ours: DocsPageShape = shapeOf(scanIrcPage(language));
      const theirs: DocsPageShape = shapeOf(english);

      expect(ours).toEqual(theirs);
    },
  );

  test.each(LANGUAGES)(
    "%s links the step's section of the Components guide, which has an #irc heading there",
    (language: string) => {
      const links: Array<DocsPageLink> = scanIrcPage(language)
        .links.map((link: DocsLink): DocsPageLink | null => {
          return parseDocsLink(link.target);
        })
        .filter((link: DocsPageLink | null): link is DocsPageLink => {
          return link !== null;
        });

      expect(links).toContainEqual({ page: COMPONENTS_PAGE, anchor: "irc" });
      expect(anchorsOf(language, COMPONENTS_PAGE).has("irc")).toBe(true);
      // ...from Next steps, the section a reader goes on from.
      expect(sectionOf(language, "Next steps")).toContain(
        `](/docs/${COMPONENTS_PAGE}#irc)`,
      );
    },
  );

  test.each(LANGUAGES)(
    "%s links Global variables at the heading its own Variables page has",
    (language: string) => {
      const anchors: Array<string | null> = scanIrcPage(language)
        .links.map((link: DocsLink): DocsPageLink | null => {
          return parseDocsLink(link.target);
        })
        .filter((link: DocsPageLink | null): link is DocsPageLink => {
          return link !== null && link.page === VARIABLES_PAGE;
        })
        .map((link: DocsPageLink): string | null => {
          return link.anchor;
        });

      // The Global variables section is the first of every Variables page.
      const globalVariables: DocsHeading | undefined = headingsAt(
        scanMarkdown(readPage(language, VARIABLES_PAGE)),
        2,
      )[0];

      expect(anchors.length).toBeGreaterThan(0);

      for (const anchor of anchors) {
        expect({ language, anchor }).toEqual({
          language,
          anchor: globalVariables?.slug,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s sends the reader to its own Troubleshooting section from the test step",
    (language: string) => {
      const troubleshooting: DocsHeading = headingsAt(scanIrcPage(language), 2)[
        ENGLISH_SECTIONS.indexOf("Troubleshooting")
      ] as DocsHeading;
      const step: string = sectionOf(language, "Set up the integration");

      expect(step).toContain(`](#${troubleshooting.slug})`);
    },
  );

  test.each(LANGUAGES)(
    "%s points Libera.Chat's SASL guide at the guide",
    (language: string) => {
      expect(sectionOf(language, "Tips")).toContain(`](${LIBERA_SASL_GUIDE})`);
    },
  );
});

/*
 * --------------------------------------------------------------- Settings
 */

describe("the IRC page names the step's settings as the step does", () => {
  test("the step is called Send Message to IRC, in the IRC category", () => {
    expect(IRC_METADATA.title).toBe("Send Message to IRC");
    expect(IRC_METADATA.category).toBe("IRC");
    expect(IRC_METADATA.componentType).toBe(ComponentType.Component);
  });

  test.each(LANGUAGES)(
    "%s names every setting of the step, in English bold, as the form does",
    (language: string) => {
      const bold: Set<string> = boldTermsOf(readIrcPage(language));

      expect(ARGUMENTS.length).toBe(11);

      for (const argument of ARGUMENTS) {
        expect({
          language,
          setting: argument.name,
          named: bold.has(argument.name),
        }).toEqual({
          language,
          setting: argument.name,
          named: true,
        });
      }

      expect(bold.has(IRC_METADATA.title)).toBe(true);
    },
  );

  test("the settings the page sends to More fields are under it, and the three it fills in first are not", () => {
    for (const name of ["IRC Server", "Channel", "Message Text"]) {
      expect({ name, folded: Boolean(argumentNamed(name).isAdvanced) }).toEqual(
        {
          name,
          folded: false,
        },
      );
      expect({ name, required: argumentNamed(name).required }).toEqual({
        name,
        required: true,
      });
    }

    for (const name of [
      "Nickname",
      "Port",
      "Disable TLS",
      "Channel Key",
      "Send Without Joining",
      "Server Password",
      "SASL Username",
      "SASL Password",
    ]) {
      expect({ name, folded: argumentNamed(name).isAdvanced }).toEqual({
        name,
        folded: true,
      });
    }
  });

  test("the passwords table lists exactly the step's secret settings", () => {
    const step: string = sectionOf("en", "Set up the integration");
    const tableSettings: Array<string> = step
      .split("\n")
      .filter((line: string): boolean => {
        return TABLE_ROW.test(line) && line.trim().startsWith("| **");
      })
      .map((line: string): string => {
        return matchesOf(line, BOLD)[0] as string;
      });

    const sensitive: Array<string> = ARGUMENTS.filter(
      (argument: Argument): boolean => {
        return Boolean(argument.isSensitive);
      },
    ).map((argument: Argument): string => {
      return argument.name;
    });

    expect([...tableSettings].sort()).toEqual([...sensitive].sort());
    expect(sensitive.sort()).toEqual([
      "Channel Key",
      "SASL Password",
      "Server Password",
    ]);
  });

  test("the outputs the page names are the step's own", () => {
    const outputs: Array<string> = IRC_METADATA.outPorts.map(
      (port: Port): string => {
        return port.title;
      },
    );

    expect(outputs).toEqual(["Success", "Error"]);

    const english: Set<string> = boldTermsOf(readIrcPage("en"));

    for (const output of outputs) {
      expect(english.has(output)).toBe(true);
    }
  });
});

/*
 * ------------------------------------------------- Defaults and behaviour
 */

describe("the IRC page states the step's defaults and limits as the step has them", () => {
  const english: string = readIrcPage("en");
  const code: Set<string> = codeTermsOf(english);

  test("TLS on 6697 unless Disable TLS is on, and then 6667", () => {
    expect(IRC_DEFAULT_TLS_PORT).toBe(6697);
    expect(IRC_DEFAULT_PLAIN_TEXT_PORT).toBe(6667);
    expect(SendMessageToChannel.getPort(undefined, true)).toBe(
      IRC_DEFAULT_TLS_PORT,
    );
    expect(SendMessageToChannel.getPort(undefined, false)).toBe(
      IRC_DEFAULT_PLAIN_TEXT_PORT,
    );
    expect(
      SendMessageToChannel.getSettings({
        server: EXAMPLE_SERVER,
        channel: EXAMPLE_CHANNEL,
        text: "Deploy finished",
      }).useTls,
    ).toBe(true);

    expect(code.has(String(IRC_DEFAULT_TLS_PORT))).toBe(true);
    expect(code.has(String(IRC_DEFAULT_PLAIN_TEXT_PORT))).toBe(true);
    expect(english).toContain(
      `connects over TLS on port \`${IRC_DEFAULT_TLS_PORT}\``,
    );
    expect(english).toContain(
      `the step then connects on port \`${IRC_DEFAULT_PLAIN_TEXT_PORT}\``,
    );
  });

  test("the nickname is OneUptime, and a taken one gets an underscore or a number", () => {
    expect(IRC_DEFAULT_NICKNAME).toBe("OneUptime");
    expect(
      SendMessageToChannel.getSettings({
        server: EXAMPLE_SERVER,
        channel: EXAMPLE_CHANNEL,
        text: "Deploy finished",
      }).nickname,
    ).toBe(IRC_DEFAULT_NICKNAME);

    const candidates: Array<string> =
      IRCClient.getNicknameCandidates(IRC_DEFAULT_NICKNAME);

    expect(candidates[0]).toBe(IRC_DEFAULT_NICKNAME);
    expect(candidates[1]).toBe(`${IRC_DEFAULT_NICKNAME}_`);
    expect(
      candidates.some((candidate: string): boolean => {
        return (
          candidate.startsWith(IRC_DEFAULT_NICKNAME) &&
          candidate.length > IRC_DEFAULT_NICKNAME.length &&
          !Number.isNaN(
            Number(candidate.substring(IRC_DEFAULT_NICKNAME.length)),
          )
        );
      }),
    ).toBe(true);

    expect(code.has(IRC_DEFAULT_NICKNAME)).toBe(true);
    expect(english).toContain("adds an underscore or a number");
  });

  test("IRC Server takes a host name only: no ircs:// and no port", () => {
    expect(SendMessageToChannel.getHost(EXAMPLE_SERVER)).toBe(EXAMPLE_SERVER);
    expect(() => {
      return SendMessageToChannel.getHost(`ircs://${EXAMPLE_SERVER}`);
    }).toThrow();
    expect(() => {
      return SendMessageToChannel.getHost(
        `${EXAMPLE_SERVER}:${IRC_DEFAULT_TLS_PORT}`,
      );
    }).toThrow();

    expect(code.has(EXAMPLE_SERVER)).toBe(true);
    expect(english).toContain("no `ircs://`, and no port");
  });

  test("Channel has to be a channel: a nickname typed there is refused", () => {
    expect(
      SendMessageToChannel.getSettings({
        server: EXAMPLE_SERVER,
        channel: EXAMPLE_CHANNEL,
        text: "Deploy finished",
      }).target,
    ).toBe(EXAMPLE_CHANNEL);
    expect(() => {
      return SendMessageToChannel.getSettings({
        server: EXAMPLE_SERVER,
        channel: EXAMPLE_CHANNEL.substring(1),
        text: "Deploy finished",
      });
    }).toThrow("is not a channel");

    expect(code.has(EXAMPLE_CHANNEL)).toBe(true);
    expect(english).toContain("A nickname typed there is refused");
  });

  test("it signs in with SASL when both SASL settings are filled in, and joins unless told not to", () => {
    const base: JSONObject = {
      server: EXAMPLE_SERVER,
      channel: EXAMPLE_CHANNEL,
      text: "Deploy finished",
    };

    expect(SendMessageToChannel.getSettings(base).sasl).toBeUndefined();
    expect(
      SendMessageToChannel.getSettings({
        ...base,
        "sasl-username": "deploy",
        "sasl-password": "correct horse",
      }).sasl,
    ).toEqual({ username: "deploy", password: "correct horse" });

    expect(SendMessageToChannel.getSettings(base).joinChannel).toBe(true);
    expect(
      SendMessageToChannel.getSettings({
        ...base,
        "send-without-joining": true,
      }).joinChannel,
    ).toBe(false);
  });

  test("a message is at most 15 IRC lines: a long line is split, blank lines are left out, and a longer one says it was cut", () => {
    expect(IRC_MAX_LINES).toBe(15);

    const maxBytesPerLine: number = 80;
    const longLine: string = "word ".repeat(40).trim();

    const split: Array<string> = IRCMessageText.prepare({
      text: `First\n\n   \nSecond\n${longLine}`,
      maxBytesPerLine: maxBytesPerLine,
      maxLines: IRC_MAX_LINES,
    }).lines;

    expect(split.slice(0, 2)).toEqual(["First", "Second"]);
    expect(split.length).toBeGreaterThan(3);
    expect(split.join(" ").replace(/\s+/g, " ")).toBe(
      `First Second ${longLine}`,
    );

    const tooLong: { lines: Array<string>; isTruncated: boolean } =
      IRCMessageText.prepare({
        text: Array.from(
          { length: IRC_MAX_LINES + 5 },
          (_value: unknown, index: number) => {
            return `Line ${index + 1}`;
          },
        ).join("\n"),
        maxBytesPerLine: maxBytesPerLine,
        maxLines: IRC_MAX_LINES,
      });

    expect(tooLong.isTruncated).toBe(true);
    expect(tooLong.lines).toHaveLength(IRC_MAX_LINES);
    expect(tooLong.lines[IRC_MAX_LINES - 1]).toBe(
      IRCMessageText.getTruncationNotice(IRC_MAX_LINES),
    );

    expect(english).toContain(`at most ${IRC_MAX_LINES} IRC lines`);
    expect(english).toContain(`**Mind the ${IRC_MAX_LINES}-line limit.**`);
    expect(english).toContain("a long line is split to fit");
    expect(english).toContain("blank lines are left out");
    expect(english).toContain("its last line says so");
  });

  test("four lines go at once and the rest one a second, so 15 lines take about 11 seconds", () => {
    expect(IRC_DEFAULT_PACING).toEqual({ burst: 4, intervalInMs: 1000 });

    const seconds: number =
      ((IRC_MAX_LINES - IRC_DEFAULT_PACING.burst) *
        IRC_DEFAULT_PACING.intervalInMs) /
      1000;

    expect(english).toContain(
      "The first four lines go out at once and the rest one a second",
    );
    expect(english).toContain(
      `so ${IRC_MAX_LINES} lines take about ${seconds} seconds`,
    );
  });

  test("a secret variable's value is replaced in run logs the way the page shows", () => {
    expect(WORKFLOW_LOG_REDACTED_VALUE).toBe("[REDACTED]");

    for (const language of LANGUAGES) {
      expect({
        language,
        quoted: codeTermsOf(readIrcPage(language)).has(
          WORKFLOW_LOG_REDACTED_VALUE,
        ),
      }).toEqual({ language, quoted: true });
    }
  });

  test("Before you begin: workflows and their variables need Growth on OneUptime Cloud", () => {
    expect(new Workflow().createBillingPlan).toBe(PlanType.Growth);
    expect(new WorkflowVariable().createBillingPlan).toBe(PlanType.Growth);

    expect(sectionOf("en", "Before you begin")).toContain(
      `**${PlanType.Growth}** plan or a higher one`,
    );
  });

  test("Before you begin: the roles it names can build workflows and their variables", () => {
    const roles: Array<[string, Permission]> = [
      ["Project Owner", Permission.ProjectOwner],
      ["Project Admin", Permission.ProjectAdmin],
      ["Workflow Admin", Permission.WorkflowAdmin],
    ];
    const section: string = sectionOf("en", "Before you begin");

    for (const [title, permission] of roles) {
      expect(section).toContain(`**${title}**`);
      expect(new Workflow().createRecordPermissions).toContain(permission);
      expect(new Workflow().updateRecordPermissions).toContain(permission);
      expect(new WorkflowVariable().createRecordPermissions).toContain(
        permission,
      );
    }

    // A Workflow Member runs workflows; it does not build them.
    expect(new Workflow().updateRecordPermissions).not.toContain(
      Permission.WorkflowMember,
    );
    expect(section).not.toContain("Workflow Member");
  });
});

/*
 * --------------------------------------------------------------- Template
 */

describe("the IRC page and the template it points to", () => {
  const template: WorkflowTemplate | null = getWorkflowTemplate(TEMPLATE_ID);
  type GraphSpec = NonNullable<ReturnType<typeof getTemplateGraphSpec>>;
  const graph: GraphSpec | null = getTemplateGraphSpec(TEMPLATE_ID);

  test("is the Incidents template 'Tell IRC when an incident opens'", () => {
    expect(template).not.toBeNull();
    expect(template!.name).toBe("Tell IRC when an incident opens");
    expect(template!.workflowName).toBe("Notify IRC on new incident");
    expect(template!.category).toBe(WorkflowTemplateCategory.Incidents);
  });

  test("asks for IRC Server and IRC Channel, saved as the variables ircServer and ircChannel", () => {
    expect(
      template!.variables.map(
        (variable: WorkflowTemplateVariable): [string, string, boolean] => {
          return [variable.title, variable.name, variable.isSecret];
        },
      ),
    ).toEqual([
      ["IRC Server", "ircServer", false],
      ["IRC Channel", "ircChannel", false],
    ]);
  });

  test("builds On Create Incident, then Send Message to IRC, with a Log step on its Error output", () => {
    expect(graph).not.toBeNull();

    const nodes: Array<{ componentId: string; metadataId: string }> =
      graph!.nodes;
    const byId: Map<string, string> = new Map(
      nodes.map((node: { componentId: string; metadataId: string }) => {
        return [node.componentId, node.metadataId];
      }),
    );

    expect(
      nodes.map((node: { metadataId: string }) => {
        return node.metadataId;
      }),
    ).toEqual([
      "incident-on-create",
      ComponentID.IRCSendMessageToChannel,
      ComponentID.Log,
    ]);

    const edges: Array<{ from: string; to: string; port: string }> =
      graph!.edges.map(
        (edge: {
          fromComponentId: string;
          toComponentId: string;
          fromPort: string;
        }) => {
          return {
            from: byId.get(edge.fromComponentId) as string,
            to: byId.get(edge.toComponentId) as string,
            port: edge.fromPort,
          };
        },
      );

    expect(edges).toEqual([
      {
        from: "incident-on-create",
        to: ComponentID.IRCSendMessageToChannel,
        port: "success",
      },
      {
        from: ComponentID.IRCSendMessageToChannel,
        to: ComponentID.Log,
        port: "error",
      },
    ]);
  });

  test("posts the incident's number, title, severity and state, in two lines", () => {
    const text: string = templateMessageText();
    const fields: Array<string> = matchesOf(text, TEMPLATE_REFERENCE);

    expect(text.split("\n")).toHaveLength(2);
    expect([...fields].sort()).toEqual(
      [
        "currentIncidentState.name",
        "incidentNumberWithPrefix",
        "incidentSeverity.name",
        "title",
      ].sort(),
    );

    expect(readIrcPage("en")).toContain(
      "posts the incident's number, title, severity and state in two lines",
    );
  });

  test("is what the template search finds first for IRC, as the page tells the reader to type", () => {
    const found: Array<WorkflowTemplate> = searchWorkflowTemplates(
      getWorkflowTemplates(),
      "IRC",
    );

    expect(found[0]?.id).toBe(TEMPLATE_ID);
    expect(codeTermsOf(readIrcPage("en")).has("IRC")).toBe(true);
  });

  test.each(LANGUAGES)(
    "%s names the template, its workflow, its settings and its variables as the Dashboard shows them",
    (language: string) => {
      const page: string = readIrcPage(language);
      const bold: Set<string> = boldTermsOf(page);
      const code: Set<string> = codeTermsOf(page);

      expect(bold.has(template!.name)).toBe(true);
      expect(bold.has(template!.workflowName)).toBe(true);

      for (const variable of template!.variables) {
        expect({
          language,
          title: variable.title,
          named: bold.has(variable.title),
        }).toEqual({
          language,
          title: variable.title,
          named: true,
        });
        expect({
          language,
          name: variable.name,
          quoted: code.has(variable.name),
        }).toEqual({
          language,
          name: variable.name,
          quoted: true,
        });
      }
    },
  );
});

/*
 * ----------------------------------------------------- The builder panels
 */

describe("the IRC page and the Builder panels it walks through", () => {
  const catalog: {
    components: Array<ComponentMetadata>;
    categories: Array<ComponentCategory>;
  } = loadComponentsAndCategories();

  const pickerOf: (componentsType: ComponentType) => PickerCatalog = (
    componentsType: ComponentType,
  ): PickerCatalog => {
    return buildPickerCatalog({
      components: catalog.components,
      categories: catalog.categories,
      componentsType: componentsType,
    });
  };

  const onCreateIncident: ComponentMetadata = catalog.components.find(
    (component: ComponentMetadata): boolean => {
      return component.id === "incident-on-create";
    },
  ) as ComponentMetadata;

  test("searching irc in Add Component puts Send Message to IRC first", () => {
    const picker: PickerCatalog = pickerOf(ComponentType.Component);
    const results: Array<ComponentSearchResult> = searchComponents(
      getComponentSearchIndex(picker),
      "irc",
    ).results;

    expect(results[0]?.component.id).toBe(ComponentID.IRCSendMessageToChannel);
    expect(codeTermsOf(readIrcPage("en")).has("irc")).toBe(true);
  });

  test("On Create Incident is under Popular in Add Trigger", () => {
    expect(POPULAR_COMPONENT_IDS[ComponentType.Trigger]).toContain(
      "incident-on-create",
    );

    const popular: Array<string> = pickerOf(ComponentType.Trigger).popular.map(
      (component: ComponentMetadata): string => {
        return component.title;
      },
    );

    expect(popular).toContain("On Create Incident");
  });

  test("On Create Incident reads Select Fields, leaves by Success, and is run by hand with an Incident ID", () => {
    expect(onCreateIncident.title).toBe("On Create Incident");
    expect(
      onCreateIncident.arguments.map((argument: Argument): string => {
        return argument.name;
      }),
    ).toContain("Select Fields");
    expect(
      onCreateIncident.outPorts.map((port: Port): string => {
        return port.title;
      }),
    ).toEqual(["Success"]);
    expect(
      (onCreateIncident.runWorkflowManuallyArguments || []).map(
        (argument: Argument): string => {
          return argument.name;
        },
      ),
    ).toEqual(["Incident ID"]);

    const bold: Set<string> = boldTermsOf(readIrcPage("en"));

    expect(bold.has("On Create Incident")).toBe(true);
    expect(bold.has("Select Fields")).toBe(true);
    expect(bold.has("Incident ID")).toBe(true);
  });

  test.each(LANGUAGES)(
    "%s names the trigger and its Select Fields as the Builder shows them",
    (language: string) => {
      const bold: Set<string> = boldTermsOf(readIrcPage(language));

      expect(bold.has("On Create Incident")).toBe(true);
      expect(bold.has("Select Fields")).toBe(true);
    },
  );
});

/*
 * -------------------------------------------------------- Dashboard words
 */

describe("the IRC page names Dashboard screens and buttons as each language's Dashboard draws them", () => {
  test("every label the English page names is a real Dashboard string", () => {
    const english: Record<string, unknown> = dashboardStringsOf("en");
    const bold: Set<string> = boldTermsOf(readIrcPage("en"));

    for (const label of DASHBOARD_LABELS) {
      expect({ label, inDashboard: label in english }).toEqual({
        label,
        inDashboard: true,
      });
      expect({ label, named: bold.has(label) }).toEqual({
        label,
        named: true,
      });
    }

    // The create button is built from these two, as BaseModelTable builds it.
    expect("Create {{itemName}}" in english).toBe(true);
    expect(CREATE_VARIABLE_NOUN in english).toBe(true);
    expect(bold.has(`Create ${CREATE_VARIABLE_NOUN}`)).toBe(true);
  });

  test("the create button is built the way the page's words assume", () => {
    const source: string = fs.readFileSync(BASE_MODEL_TABLE_FILE, "utf8");

    expect(source).toContain('Create: translationKey("Create {{itemName}}")');
    expect(source).toContain(
      'template: CREATE_BUTTON_TEMPLATES[verb] || "{{action}} {{itemName}}"',
    );
  });

  test.each(TRANSLATIONS)(
    "%s names each Dashboard label in its own Dashboard words",
    (language: string) => {
      const bold: Set<string> = boldTermsOf(readIrcPage(language));
      const missing: Array<string> = [];

      for (const label of DASHBOARD_LABELS) {
        const word: string = dashboardWord(language, label);

        if (!bold.has(word)) {
          missing.push(`${label} -> **${word}**`);
        }
      }

      const createButton: string = createButtonWord(
        language,
        CREATE_VARIABLE_NOUN,
      );

      if (!bold.has(createButton)) {
        missing.push(`Create ${CREATE_VARIABLE_NOUN} -> **${createButton}**`);
      }

      expect(missing).toEqual([]);
    },
  );
});

/*
 * ---------------------------------------------------------------- Diagram
 */

describe("the IRC page's diagram", () => {
  test.each(LANGUAGES)(
    "%s keeps every label whole: no '#' or ';', which would cut a mermaid sequence label short",
    (language: string) => {
      const diagram: DocsFence = diagramOf(language);

      expect(diagram.code.startsWith("sequenceDiagram")).toBe(true);
      expect(diagram.code).not.toContain("#");
      expect(diagram.code).not.toContain(";");
      expect(diagram.code).toContain("participant O as OneUptime");
      expect(diagram.code).toContain("participant S as ");
    },
  );

  test.each(LANGUAGES)(
    "%s shows the IRC commands in the order the step sends them",
    (language: string) => {
      const labels: Array<string> = diagramOf(language)
        .code.split("\n")
        .filter((line: string): boolean => {
          return SEQUENCE_LABEL.test(line);
        });
      const at: Array<number> = DIAGRAM_COMMANDS.map(
        (command: string): number => {
          return labels.findIndex((line: string): boolean => {
            return line.includes(command);
          });
        },
      );

      for (const [index, position] of at.entries()) {
        expect({
          language,
          command: DIAGRAM_COMMANDS[index],
          shown: position >= 0,
        }).toEqual({
          language,
          command: DIAGRAM_COMMANDS[index],
          shown: true,
        });
      }

      expect(
        [...at].sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual(at);
    },
  );

  test.each(LANGUAGES)(
    "%s draws the JOIN as optional on Send Without Joining, and the PRIVMSG as a loop of at most 15",
    (language: string) => {
      const lines: Array<string> = diagramOf(language).code.split("\n");
      const optAt: number = lines.findIndex((line: string): boolean => {
        return line.trim().startsWith("opt ");
      });
      const loopAt: number = lines.findIndex((line: string): boolean => {
        return line.trim().startsWith("loop ");
      });

      expect(lines[optAt]).toContain("Send Without Joining");
      expect(lines[optAt + 1]).toContain("JOIN");
      expect(lines[loopAt]).toContain("Message Text");
      expect(lines[loopAt]).toContain(String(IRC_MAX_LINES));
      expect(lines[loopAt + 1]).toContain("PRIVMSG");
    },
  );
});

/*
 * ----------------------------------------------------------- Every language
 */

describe("every language quotes what the product shows in English as it is", () => {
  test.each(LANGUAGES)(
    "%s quotes the troubleshooting messages, the log line and the values as the step writes them",
    (language: string) => {
      const page: string = readIrcPage(language);
      const code: Set<string> = codeTermsOf(page);
      const titles: Array<string> = page
        .split("\n")
        .map((line: string): string | null => {
          const match: RegExpMatchArray | null = line.match(DETAILS_TITLE);
          return match ? (match[1] as string) : null;
        })
        .filter((title: string | null): title is string => {
          return title !== null;
        });

      expect(titles).toEqual(TROUBLESHOOTING_TITLES);

      for (const value of [
        EXAMPLE_SERVER,
        EXAMPLE_CHANNEL,
        QUOTED_LOG_LINE,
        String(IRC_DEFAULT_TLS_PORT),
        String(IRC_DEFAULT_PLAIN_TEXT_PORT),
        IRC_DEFAULT_NICKNAME,
        "Reconnecting too fast",
        "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES",
        "NODE_EXTRA_CA_CERTS",
        "IRC_SERVER_PASSWORD",
        "IRC_SASL_PASSWORD",
        "IRC_CHANNEL_KEY",
        "+k",
        "+n",
        "-n",
      ]) {
        expect({ language, value, quoted: code.has(value) }).toEqual({
          language,
          value,
          quoted: true,
        });
      }
    },
  );
});

/*
 * ------------------------------------------------- What the step says
 */

const HOST_NAME: string = "irc.example.invalid";

let server: FakeIRCServer | undefined;

interface LoggedRun {
  options: RunOptions;
  logged: Array<string>;
}

const makeRun: () => LoggedRun = (): LoggedRun => {
  const logged: Array<string> = [];

  return {
    logged: logged,
    options: {
      log: ((item: unknown): void => {
        logged.push(item instanceof Error ? item.message : String(item));
      }) as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: ((exception: Exception): Exception => {
        return exception;
      }) as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    },
  };
};

type StartFunction = (options?: FakeIRCServerOptions) => Promise<FakeIRCServer>;

const start: StartFunction = async (
  options: FakeIRCServerOptions = {},
): Promise<FakeIRCServer> => {
  server = await startFakeIRCServer(options);
  return server;
};

// The guard "approves" loopback: the one address a test can listen on.
const approveLoopback: () => void = (): void => {
  jest
    .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
    .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
};

// Trust a test certificate, the way NODE_EXTRA_CA_CERTS would.
const trust: (certificate: TestCertificate) => void = (
  certificate: TestCertificate,
): void => {
  const realConnect: typeof tls.connect = tls.connect;

  jest.spyOn(tls, "connect").mockImplementation(((
    connectOptions: tls.ConnectionOptions,
  ) => {
    return realConnect({ ...connectOptions, ca: [certificate.cert] });
  }) as never);
};

// The template's message for an incident, the way the run fills it in.
const SAMPLE_INCIDENT: Record<string, string> = {
  incidentNumberWithPrefix: "INC-42",
  title: "Checkout is down",
  "incidentSeverity.name": "Critical",
  "currentIncidentState.name": "Identified",
};

function templateMessageText(): string {
  const graph: ReturnType<typeof getTemplateGraphSpec> =
    getTemplateGraphSpec(TEMPLATE_ID);
  const node:
    | { metadataId: string; args?: JSONObject | undefined }
    | undefined = graph?.nodes.find(
    (candidate: { metadataId: string }): boolean => {
      return candidate.metadataId === ComponentID.IRCSendMessageToChannel;
    },
  );

  return String(node?.args?.["text"] || "");
}

function resolvedTemplateMessage(): string {
  const resolved: string = templateMessageText().replace(
    TEMPLATE_REFERENCE,
    (_whole: string, field: string): string => {
      return SAMPLE_INCIDENT[field] || `<missing ${field}>`;
    },
  );

  expect(resolved).not.toContain("{{");
  expect(resolved).not.toContain("<missing");

  return resolved;
}

type CommandsFunction = (fakeServer: FakeIRCServer) => Array<string>;

// The commands the client sent, each run of the same one counted once.
const commandsSent: CommandsFunction = (
  fakeServer: FakeIRCServer,
): Array<string> => {
  const commands: Array<string> = linesSent(fakeServer).map(
    (line: string): string => {
      return (line.split(" ")[0] || "").toUpperCase();
    },
  );

  return commands.filter((command: string, index: number): boolean => {
    return index === 0 || commands[index - 1] !== command;
  });
};

type ErrorRunFunction = (
  runArgs: JSONObject,
) => Promise<{ message: string; run: LoggedRun }>;

// A run that takes the Error output, and the message it passes on.
const runToError: ErrorRunFunction = async (
  runArgs: JSONObject,
): Promise<{ message: string; run: LoggedRun }> => {
  const run: LoggedRun = makeRun();
  const result: RunReturnType = await new SendMessageToChannel().run(
    runArgs,
    run.options,
  );

  expect(result.executePort?.id).toBe("error");

  const message: string = String(result.returnValues["error"] || "");

  expect(run.logged).toContain(message);

  return { message: message, run: run };
};

type TroubleshootingFunction = (title: string) => string;

// The body of a Troubleshooting entry of the English page, by its title.
const troubleshootingEntry: TroubleshootingFunction = (
  title: string,
): string => {
  const section: Array<string> = sectionOf("en", "Troubleshooting").split("\n");
  const start: number = section.indexOf(`:::details "${title}"`);

  expect(start).toBeGreaterThanOrEqual(0);

  const end: number = section.indexOf(":::", start + 1);

  return section.slice(start + 1, end).join("\n");
};

type StartsLikeFunction = (message: string, title: string) => boolean;

// Whether a message starts as the title quotes it; "…" stands for the server.
const startsLike: StartsLikeFunction = (
  message: string,
  title: string,
): boolean => {
  const [before, after] = title.split("…") as [string, string | undefined];

  if (after === undefined) {
    return message.startsWith(before);
  }

  return (
    message.startsWith(before) &&
    message.indexOf(after, before.length) > before.length
  );
};

const environment: Record<string, string | undefined> = {};

const setEnvironment: (name: string, value: string | undefined) => void = (
  name: string,
  value: string | undefined,
): void => {
  if (!(name in environment)) {
    environment[name] = process.env[name];
  }

  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

afterEach(async () => {
  jest.restoreAllMocks();

  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }

    delete environment[name];
  }

  if (server) {
    await server.close();
    server = undefined;
  }
});

describe("whole runs of the step: what the page quotes is what it says", () => {
  let certificate: TestCertificate;

  beforeAll(() => {
    certificate = createTestCertificate({
      commonName: HOST_NAME,
      dnsNames: [HOST_NAME],
    });
  });

  test("the template's message, over TLS: joins, sends two lines, confirms, quits, and logs the line the page quotes", async () => {
    approveLoopback();
    const fakeServer: FakeIRCServer = await start({ tls: certificate });
    trust(certificate);
    const sendSpy: SpyInstance<typeof IRCClient.sendMessage> = jest.spyOn(
      IRCClient,
      "sendMessage",
    );
    const run: LoggedRun = makeRun();

    const result: RunReturnType = await new SendMessageToChannel().run(
      {
        server: HOST_NAME,
        port: fakeServer.port,
        channel: EXAMPLE_CHANNEL,
        text: resolvedTemplateMessage(),
      },
      run.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(run.logged[0]).toBe(
      `Connecting to the IRC server ${HOST_NAME}:${fakeServer.port} over TLS.`,
    );
    expect(run.logged).toContain(`Joined ${EXAMPLE_CHANNEL}.`);
    expect(run.logged[run.logged.length - 1]).toBe(QUOTED_LOG_LINE);

    // As the diagram draws it: register, join, a PRIVMSG a line, PING, QUIT.
    expect(commandsSent(fakeServer)).toEqual([
      "NICK",
      "USER",
      "JOIN",
      "PRIVMSG",
      "PING",
      "QUIT",
    ]);
    expect(
      linesSent(fakeServer).filter((line: string): boolean => {
        return line.startsWith("PRIVMSG ");
      }),
    ).toEqual([
      `PRIVMSG ${EXAMPLE_CHANNEL} :🚨 Incident INC-42 declared: Checkout is down`,
      `PRIVMSG ${EXAMPLE_CHANNEL} :Severity: Critical | State: Identified`,
    ]);

    // The step keeps the default pace and the 15-line cap the page states.
    const sent: IRCSendOptions = sendSpy.mock.calls[0]?.[0] as IRCSendOptions;

    expect(sendSpy).toHaveBeenCalledTimes(1);

    expect(sent.pacing).toBeUndefined();
    expect(sent.maxLines).toBe(IRC_MAX_LINES);
    expect(sent.useTls).toBe(true);
    expect(sent.nicknames[0]).toBe(IRC_DEFAULT_NICKNAME);
  });

  test("with Send Without Joining on, it posts without a JOIN, as the diagram's opt says", async () => {
    approveLoopback();
    const fakeServer: FakeIRCServer = await start();
    const run: LoggedRun = makeRun();

    const result: RunReturnType = await new SendMessageToChannel().run(
      {
        server: HOST_NAME,
        port: fakeServer.port,
        "disable-tls": true,
        channel: EXAMPLE_CHANNEL,
        text: "Deploy finished",
        "send-without-joining": true,
      },
      run.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(commandsSent(fakeServer)).toEqual([
      "NICK",
      "USER",
      "PRIVMSG",
      "PING",
      "QUIT",
    ]);
    expect(run.logged[0]).toBe(
      `Connecting to the IRC server ${HOST_NAME}:${fakeServer.port} without TLS.`,
    );
  });

  test("with SASL Username and SASL Password, it signs in before it joins", async () => {
    approveLoopback();
    const fakeServer: FakeIRCServer = await start({
      sasl: { username: "deploy", password: "correct horse battery" },
    });
    const run: LoggedRun = makeRun();

    const result: RunReturnType = await new SendMessageToChannel().run(
      {
        server: HOST_NAME,
        port: fakeServer.port,
        "disable-tls": true,
        channel: EXAMPLE_CHANNEL,
        text: "Deploy finished",
        "sasl-username": "deploy",
        "sasl-password": "correct horse battery",
      },
      run.options,
    );

    expect(result.executePort?.id).toBe("success");

    const commands: Array<string> = commandsSent(fakeServer);

    expect(commands.indexOf("AUTHENTICATE")).toBeGreaterThan(-1);
    expect(commands.indexOf("AUTHENTICATE")).toBeLessThan(
      commands.indexOf("JOIN"),
    );
    expect(run.logged).toContain('Signed in with SASL as "deploy".');
    expect(run.logged.join("\n")).not.toContain("correct horse battery");
  });

  test(`"${TROUBLESHOOTING_TITLES[0]}": a server that wants a password, and the page says to fill in Server Password`, async () => {
    approveLoopback();
    const fakeServer: FakeIRCServer = await start({ password: "bouncer-pass" });

    const { message } = await runToError({
      server: HOST_NAME,
      port: fakeServer.port,
      "disable-tls": true,
      channel: EXAMPLE_CHANNEL,
      text: "Deploy finished",
    });

    expect(startsLike(message, TROUBLESHOOTING_TITLES[0] as string)).toBe(true);
    expect(message).toContain("fill in Server Password");
    expect(troubleshootingEntry(TROUBLESHOOTING_TITLES[0] as string)).toContain(
      "fill in **Server Password**",
    );
  });

  test(`"${TROUBLESHOOTING_TITLES[1]}": a wrong SASL password, and the page says to check both SASL settings`, async () => {
    approveLoopback();
    const fakeServer: FakeIRCServer = await start({
      sasl: { username: "deploy", password: "the-real-one" },
    });

    const { message, run } = await runToError({
      server: HOST_NAME,
      port: fakeServer.port,
      "disable-tls": true,
      channel: EXAMPLE_CHANNEL,
      text: "Deploy finished",
      "sasl-username": "deploy",
      "sasl-password": "not-the-real-one",
    });

    expect(startsLike(message, TROUBLESHOOTING_TITLES[1] as string)).toBe(true);
    expect(message).toContain("Check SASL Username and SASL Password");
    expect(run.logged.join("\n")).not.toContain("not-the-real-one");
    expect(troubleshootingEntry(TROUBLESHOOTING_TITLES[1] as string)).toContain(
      "Check **SASL Username** and **SASL Password**",
    );
  });

  test(`"${TROUBLESHOOTING_TITLES[2]}": a channel with a key, and the page says it needs Channel Key`, async () => {
    approveLoopback();
    const fakeServer: FakeIRCServer = await start({ channelKey: "hunter2" });

    const { message } = await runToError({
      server: HOST_NAME,
      port: fakeServer.port,
      "disable-tls": true,
      channel: EXAMPLE_CHANNEL,
      text: "Deploy finished",
    });

    expect(startsLike(message, TROUBLESHOOTING_TITLES[2] as string)).toBe(true);
    expect(message).toContain("Check Channel Key");
    expect(troubleshootingEntry(TROUBLESHOOTING_TITLES[2] as string)).toContain(
      "**Channel Key**",
    );
  });

  test(`"${TROUBLESHOOTING_TITLES[3]}": a refused message with Send Without Joining on, and the page says to turn it off`, async () => {
    approveLoopback();
    const fakeServer: FakeIRCServer = await start({
      privmsgReply: `:irc.fake.test 404 {nick} ${EXAMPLE_CHANNEL} :Cannot send to nick/channel`,
    });

    const { message } = await runToError({
      server: HOST_NAME,
      port: fakeServer.port,
      "disable-tls": true,
      channel: EXAMPLE_CHANNEL,
      text: "Deploy finished",
      "send-without-joining": true,
    });

    expect(startsLike(message, TROUBLESHOOTING_TITLES[3] as string)).toBe(true);
    expect(message).toContain("turn off Send Without Joining");
    expect(troubleshootingEntry(TROUBLESHOOTING_TITLES[3] as string)).toContain(
      "With **Send Without Joining** on",
    );
  });

  test(`"${TROUBLESHOOTING_TITLES[4]}": an untrusted certificate, and the page names NODE_EXTRA_CA_CERTS`, async () => {
    approveLoopback();
    const fakeServer: FakeIRCServer = await start({ tls: certificate });

    const { message } = await runToError({
      server: HOST_NAME,
      port: fakeServer.port,
      channel: EXAMPLE_CHANNEL,
      text: "Deploy finished",
    });

    expect(startsLike(message, TROUBLESHOOTING_TITLES[4] as string)).toBe(true);
    expect(message).toContain("NODE_EXTRA_CA_CERTS");
    expect(troubleshootingEntry(TROUBLESHOOTING_TITLES[4] as string)).toContain(
      "`NODE_EXTRA_CA_CERTS`",
    );
    expect(fakeServer.lines).toEqual([]);
  });
});

describe("which servers the step may reach, as the page says", () => {
  test("loopback, link-local and cloud metadata addresses are refused everywhere, and the step takes Error", async () => {
    setEnvironment("BILLING_ENABLED", undefined);
    setEnvironment("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES", undefined);

    for (const address of ["127.0.0.1", "169.254.169.254"]) {
      const { message } = await runToError({
        server: address,
        channel: EXAMPLE_CHANNEL,
        text: "Deploy finished",
      });

      expect({ address, refused: message.includes("is not allowed") }).toEqual({
        address,
        refused: true,
      });
    }

    const step: string = sectionOf("en", "Set up the integration");

    expect(step).toContain(
      "Loopback (`localhost`, `127.0.0.1`), link-local and cloud metadata addresses are always refused.",
    );
  });

  test("a private address is refused on OneUptime Cloud, and reached by a self-hosted install unless DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES is true", async () => {
    const privateAddress: string = "10.20.30.40";
    const options: { targetLabel: string } = { targetLabel: "IRC server" };

    // OneUptime Cloud bills.
    setEnvironment("BILLING_ENABLED", "true");
    setEnvironment("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES", undefined);
    await expect(
      DataSourceEgressGuard.assertHostnameAllowed(privateAddress, options),
    ).rejects.toThrow("is not allowed");

    // A self-hosted install without billing reaches its own network...
    setEnvironment("BILLING_ENABLED", undefined);
    await expect(
      DataSourceEgressGuard.assertHostnameAllowed(privateAddress, options),
    ).resolves.toEqual([{ address: privateAddress, family: 4 }]);

    // ...unless it says not to.
    setEnvironment("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES", "true");
    await expect(
      DataSourceEgressGuard.assertHostnameAllowed(privateAddress, options),
    ).rejects.toThrow("is not allowed");

    const step: string = sectionOf("en", "Set up the integration");

    expect(step).toContain(
      "On OneUptime Cloud, a server on a private network address is refused too.",
    );
    expect(step).toContain(
      "A self-hosted installation can reach an IRC server on its own network, unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is set to `true`.",
    );
  });
});
