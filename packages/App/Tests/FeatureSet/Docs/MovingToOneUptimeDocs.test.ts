import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  TOOL_IMPORT_NOTE_TEMPLATES,
  TOOL_IMPORT_TOOL_COPY,
  ToolImportToolCopy,
} from "../../../FeatureSet/Dashboard/src/Components/ToolImport/ToolImportText";
import { getNumberedName } from "Common/Types/Database/UniqueName";
import { ToolImportNoteCode } from "Common/Types/ToolImport/ToolImportNote";
import {
  getToolImportSourceDefinition,
  isToolImportAddressGiven,
  isToolImportFileUpload,
  isToolImportStatusPageHost,
  ToolImportCategory,
  ToolImportSourceDefinition,
} from "Common/Types/ToolImport/ToolImportCatalog";
import {
  TOOL_IMPORT_MAX_ITEMS,
  TOOL_IMPORT_MAX_ITEMS_PER_KIND,
  TOOL_IMPORT_MAX_UPLOAD_BYTES,
  TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS,
} from "Common/Types/ToolImport/ToolImportLimits";
import ToolImportResourceKind from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Moving to OneUptime" pages - one per tool Project Settings > Advanced
 * > Import from another tool brings a team, monitors or status pages over from -
 * against the product they describe. Markdown is not compiled, so nothing else notices a tool added
 * without its page, a page that names a host the import never calls, a
 * limit that changed in code but not in the docs, or a button the page
 * tells a reader to select under a name the page does not show in their
 * language. Each fact is read from where it lives: the hosts and the kinds
 * from ToolImportCatalog, the limits from ToolImportLimits, the names of
 * the page's controls from the Dashboard's own locale files, and what the
 * page asks for - the key, its ID, the API's address - from the page's own
 * copy (ToolImportText).
 */

const DOCS_DIR: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const CONTENT_DIR: string = path.join(DOCS_DIR, "Content");
const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const NAV_GROUP_TITLE: string = "Moving to OneUptime";

const FENCE_LINE: RegExp = /^\s*```/;
const LEVEL_TWO_HEADING: RegExp = /^## (.+)$/;
const BOLD_TEXT: RegExp = /\*\*([^*]+)\*\*/g;
const TABLE_ROW: RegExp = /^\|/;
const TABLE_SEPARATOR: RegExp = /^\|\s*-/;
const WHOLE_NUMBER: RegExp = /\d+/g;
const NON_ASCII_DIGIT: RegExp = /[٠-٩۰-۹]/g;
const THOUSANDS_SEPARATOR: RegExp = /(\d)[.,\s٬'](?=\d{3}(?!\d))/g;
const TOOL_PLACEHOLDER: RegExp = /\{\{tool\}\}/g;

// The sections every page has, in this order, in every language.
const SECTION_INDEX: { comesOver: number; limits: number } = {
  comesOver: 3,
  limits: 5,
};

interface PageSection {
  heading: string;
  body: string;
}

function pagePathOf(source: ToolImportSource): string {
  return getToolImportSourceDefinition(source).docsPath.replace("/docs/", "");
}

function readPage(lang: string, source: ToolImportSource): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, `${pagePathOf(source)}.md`),
    "utf8",
  );
}

function readDashboardLocale(lang: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  ) as Record<string, string>;
}

// The page's level-two sections, outside fenced blocks.
function sectionsOf(markdown: string): Array<PageSection> {
  const sections: Array<PageSection> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const heading: RegExpMatchArray | null = inFence
      ? null
      : line.match(LEVEL_TWO_HEADING);

    if (heading) {
      sections.push({ heading: heading[1]!, body: "" });
    } else if (sections.length > 0) {
      sections[sections.length - 1]!.body += `${line}\n`;
    }
  }

  return sections;
}

function introOf(markdown: string): string {
  return markdown.split("\n").slice(1).join("\n").split(":::cards")[0]!;
}

// Every whole number in the text, written in ASCII digits without grouping.
function numbersIn(text: string): Set<number> {
  const normalized: string = text
    .replace(NON_ASCII_DIGIT, (digit: string): string => {
      const code: number = digit.charCodeAt(0);

      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(THOUSANDS_SEPARATOR, "$1");

  return new Set(
    Array.from(normalized.matchAll(WHOLE_NUMBER), (match: RegExpMatchArray) => {
      return Number(match[0]);
    }),
  );
}

function boldTextIn(markdown: string): Set<string> {
  return new Set(
    Array.from(markdown.matchAll(BOLD_TEXT), (match: RegExpMatchArray) => {
      return match[1]!;
    }),
  );
}

function tableRowsIn(text: string): Array<string> {
  return text.split("\n").filter((line: string): boolean => {
    return TABLE_ROW.test(line);
  });
}

const group: NavGroup | undefined = DocsNav.find((item: NavGroup): boolean => {
  return item.title === NAV_GROUP_TITLE;
});

describe("the Moving to OneUptime docs", () => {
  test("the nav lists one page per tool the import brings a team over from, at the tool's docs path", () => {
    expect(group).toBeDefined();
    expect(
      group!.links.map((link: NavLink): { title: string; url: string } => {
        return { title: link.title, url: link.url };
      }),
    ).toEqual(
      AllToolImportSources.map((source: ToolImportSource) => {
        const definition: ToolImportSourceDefinition =
          getToolImportSourceDefinition(source);

        return {
          title: `Moving from ${definition.title}`,
          url: definition.docsPath,
        };
      }),
    );
  });

  test("every tool's page is written in every docs language, with the same sections", () => {
    for (const source of AllToolImportSources) {
      const english: Array<PageSection> = sectionsOf(readPage("en", source));

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({
          lang,
          source,
          sections: sectionsOf(readPage(lang, source)).length,
        }).toEqual({ lang, source, sections: english.length });
      }
    }
  });
});

describe.each(AllToolImportSources)(
  "the page on moving from %s",
  (source: ToolImportSource) => {
    const definition: ToolImportSourceDefinition =
      getToolImportSourceDefinition(source);
    const otherHosts: Array<string> = AllToolImportSources.filter(
      (other: ToolImportSource): boolean => {
        return other !== source;
      },
    ).flatMap((other: ToolImportSource): Array<string> => {
      return getToolImportSourceDefinition(other).hosts;
    });

    test("names every host the import calls, and no other tool's, in every language", () => {
      /*
       * A tool whose address the person gives calls no fixed host, and one
       * read from a file calls nothing at all.
       */
      expect(definition.hosts.length === 0).toBe(
        isToolImportAddressGiven(definition) ||
          isToolImportFileUpload(definition),
      );

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const page: string = readPage(lang, source);

        for (const host of definition.hosts) {
          expect({ lang, host, named: page.includes(`\`${host}\``) }).toEqual({
            lang,
            host,
            named: true,
          });
        }

        for (const host of otherHosts) {
          expect({ lang, host, named: page.includes(host) }).toEqual({
            lang,
            host,
            named: false,
          });
        }
      }
    });

    test("lists one row per kind the import brings over, in every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const rows: Array<string> = tableRowsIn(
          sectionsOf(readPage(lang, source))[SECTION_INDEX.comesOver]!.body,
        ).filter((row: string): boolean => {
          return !TABLE_SEPARATOR.test(row);
        });

        // The header row, then one row per kind.
        expect({ lang, rows: rows.length - 1 }).toEqual({
          lang,
          rows: definition.kinds.length,
        });
      }
    });

    test("states the import's limits, in every language", () => {
      const expected: Array<number> = [
        TOOL_IMPORT_MAX_ITEMS,
        ...definition.kinds.map((kind: ToolImportResourceKind): number => {
          return TOOL_IMPORT_MAX_ITEMS_PER_KIND[kind];
        }),
      ];

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const stated: Set<number> = numbersIn(
          sectionsOf(readPage(lang, source))[SECTION_INDEX.limits]!.body,
        );

        expect({
          lang,
          missing: expected.filter((limit: number): boolean => {
            return !stated.has(limit);
          }),
        }).toEqual({ lang, missing: [] });
      }
    });

    test("shows what the address the person gives looks like, and that it is checked, in every language", () => {
      if (!isToolImportAddressGiven(definition)) {
        return;
      }

      expect(definition.apiUrlExample).toBeTruthy();

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const page: string = readPage(lang, source);

        expect({
          lang,
          example: page.includes(`\`${definition.apiUrlExample}\``),
          https: page.includes("`https://`"),
          privateNetworkAccess: page.includes(
            "](/docs/self-hosted/private-network-access)",
          ),
        }).toEqual({
          lang,
          example: true,
          https: true,
          privateNetworkAccess: true,
        });
      }
    });

    test("tells a reader to select the page's controls by the names the page shows in their language", () => {
      const copy: ToolImportToolCopy = TOOL_IMPORT_TOOL_COPY[source];
      const names: Array<string> = [
        "Project Settings",
        // The side menu's folded section the import page is in.
        "Advanced",
        "Import from another tool",
        "Start import",
        "Earlier imports",
        copy.keyLabel,
      ];

      // A file is chosen and read; an account is read with its key.
      if (isToolImportFileUpload(definition)) {
        names.push("Choose file", "Read the file");
      } else {
        names.push("Read my {{tool}} account", "Try again");
      }

      /*
       * An on-call tool's page walks through inviting people and checking
       * the schedules; an uptime tool's through the monitors it brings, and
       * the status pages for a tool that has them.
       */
      if (definition.category === ToolImportCategory.OnCall) {
        names.push(
          "Tick them too",
          "Invite new people to",
          "On-Call",
          "On-Call Schedules",
          "Readiness",
          // The report's test page of a policy it brought over (#7032).
          "Test this policy",
        );
      } else {
        if (!isToolImportStatusPageHost(definition)) {
          names.push("Monitors", "On-Call", "On-Call Policies");
        }

        if (definition.kinds.includes(ToolImportResourceKind.StatusPage)) {
          names.push(
            "Tick them too",
            "Status Pages",
            "Custom Domains",
            // Beside each imported page's address in the report (#7032).
            "Copy link",
          );
        }
      }

      // The key's ID and the API's address, for a tool that asks for them.
      if (copy.keyIdLabel) {
        names.push(copy.keyIdLabel);
      }

      if (copy.apiUrlLabel) {
        names.push(copy.apiUrlLabel);
      }

      if (definition.regions.length > 0) {
        expect(copy.regionQuestion).toBeTruthy();
        names.push(copy.regionQuestion!);
      }

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const locale: Record<string, string> = readDashboardLocale(lang);
        const bold: Set<string> = boldTextIn(readPage(lang, source));

        for (const name of names) {
          const shown: string | undefined = locale[name];

          expect({ lang, name, inLocale: shown !== undefined }).toEqual({
            lang,
            name,
            inLocale: true,
          });
          expect({
            lang,
            name,
            quoted: bold.has(
              shown!.replace(TOOL_PLACEHOLDER, definition.title),
            ),
          }).toEqual({ lang, name, quoted: true });
        }
      }
    });
  },
);

describe("what the pages promise in English", () => {
  test("Opsgenie's page says plainly that Atlassian is retiring it, in every language", () => {
    expect(introOf(readPage("en", ToolImportSource.OpsGenie))).toContain(
      "Atlassian is retiring Opsgenie: it stopped selling Opsgenie in June 2025 and ends support for it in April 2027.",
    );

    for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const intro: string = introOf(readPage(lang, ToolImportSource.OpsGenie));
      const years: Set<number> = numbersIn(intro);

      expect({
        lang,
        atlassian: intro.includes("Atlassian"),
        years: [years.has(2025), years.has(2027)],
      }).toEqual({ lang, atlassian: true, years: [true, true] });
    }
  });

  test("Grafana OnCall's page says plainly that Grafana Labs archived the open-source OnCall, in every language", () => {
    expect(introOf(readPage("en", ToolImportSource.GrafanaOnCall))).toContain(
      "Grafana Labs archived the open-source Grafana OnCall in March 2026, and on Grafana Cloud it lives on as part of Grafana Cloud IRM.",
    );

    for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const intro: string = introOf(
        readPage(lang, ToolImportSource.GrafanaOnCall),
      );

      expect({
        lang,
        grafanaLabs: intro.includes("Grafana Labs"),
        irm: intro.includes("Grafana Cloud IRM"),
        year: numbersIn(intro).has(2026),
      }).toEqual({ lang, grafanaLabs: true, irm: true, year: true });
    }
  });

  test("the pages name what the page asks for besides the key", () => {
    // Splunk On-Call pairs an API ID with the key; Grafana OnCall needs its address.
    expect(
      AllToolImportSources.filter((source: ToolImportSource): boolean => {
        return Boolean(TOOL_IMPORT_TOOL_COPY[source].keyIdLabel);
      }),
    ).toEqual([ToolImportSource.SplunkOnCall]);
    expect(
      AllToolImportSources.filter((source: ToolImportSource): boolean => {
        return Boolean(TOOL_IMPORT_TOOL_COPY[source].apiUrlLabel);
      }),
    ).toEqual([ToolImportSource.GrafanaOnCall]);
    expect(readPage("en", ToolImportSource.SplunkOnCall)).toContain(
      "Paste the API ID into **Splunk On-Call API ID** and the key into **Splunk On-Call API key**",
    );
    expect(readPage("en", ToolImportSource.GrafanaOnCall)).toContain(
      "Paste the address into **Grafana OnCall API URL** and the token into **Grafana OnCall API key**",
    );
  });

  test("a preview is kept for a day, as long as the import keeps one", () => {
    expect(TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS).toBe(24 * 60 * 60 * 1000);

    for (const source of AllToolImportSources) {
      expect(readPage("en", source)).toContain("A preview is kept for a day.");
    }
  });

  test("the limits are spelled out per kind, with the number in code", () => {
    const phrases: Record<ToolImportResourceKind, string> = {
      [ToolImportResourceKind.Person]: "people",
      [ToolImportResourceKind.Team]: "teams",
      [ToolImportResourceKind.OnCallSchedule]: "on-call schedules",
      [ToolImportResourceKind.OnCallPolicy]: "on-call policies",
      [ToolImportResourceKind.Service]: "services",
      [ToolImportResourceKind.IncidentCustomField]: "incident custom fields",
      [ToolImportResourceKind.IncidentSeverity]:
        "each of incident severities, states and roles",
      [ToolImportResourceKind.IncidentState]:
        "each of incident severities, states and roles",
      [ToolImportResourceKind.IncidentRole]:
        "each of incident severities, states and roles",
      [ToolImportResourceKind.Monitor]: "monitors",
      [ToolImportResourceKind.StatusPage]: "status pages",
      [ToolImportResourceKind.StatusPageSubscriber]: "subscribers",
    };

    for (const source of AllToolImportSources) {
      const limits: string = sectionsOf(readPage("en", source))[
        SECTION_INDEX.limits
      ]!.body;

      expect(limits).toContain(
        `One import creates at most ${TOOL_IMPORT_MAX_ITEMS.toLocaleString("en-US")} records`,
      );

      for (const kind of getToolImportSourceDefinition(source).kinds) {
        expect(limits).toContain(
          `${TOOL_IMPORT_MAX_ITEMS_PER_KIND[kind].toLocaleString("en-US")} ${phrases[kind]}`,
        );
      }
    }
  });

  test("a file tool's page states the largest file the upload reads, in every language", () => {
    const megabytes: number = TOOL_IMPORT_MAX_UPLOAD_BYTES / (1024 * 1024);

    expect(megabytes).toBe(10);

    for (const source of AllToolImportSources.filter(
      (candidate: ToolImportSource): boolean => {
        return isToolImportFileUpload(getToolImportSourceDefinition(candidate));
      },
    )) {
      expect(
        sectionsOf(readPage("en", source))[SECTION_INDEX.limits]!.body,
      ).toContain(`A file can be at most ${megabytes} MB.`);

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({
          lang,
          stated: numbersIn(
            sectionsOf(readPage(lang, source))[SECTION_INDEX.limits]!.body,
          ).has(megabytes),
        }).toEqual({ lang, stated: true });
      }
    }
  });

  test("the pages that bring subscribers over say they come only with the person's word, and nobody is emailed", () => {
    for (const source of AllToolImportSources.filter(
      (candidate: ToolImportSource): boolean => {
        return getToolImportSourceDefinition(candidate).kinds.includes(
          ToolImportResourceKind.StatusPageSubscriber,
        );
      },
    )) {
      const page: string = readPage("en", source);

      expect(page).toContain(
        "confirm under them that they agreed to get your updates and that you may move them. Nobody is emailed.",
      );
    }
  });

  test("the helpers read what they claim to", () => {
    expect([...numbersIn("2,000 · 2.000 · 2 000 · ۲٬۰۰۰ · 500, 200")]).toEqual([
      2000, 500, 200,
    ]);
    expect(
      sectionsOf("# T\n\n## A\nx\n```\n## not a heading\n```\n## B\ny\n").map(
        (section: PageSection): string => {
          return section.heading;
        },
      ),
    ).toEqual(["A", "B"]);
    expect(
      finishStepsOf(
        "## A\n:::steps\n### One\nx\n:::\n## Finish\n:::steps\n### Two\ny\n\n### Three\nz\n:::\n",
      ),
    ).toEqual([
      { heading: "Two", body: "y" },
      { heading: "Three", body: "z" },
    ]);
  });
});

/*
 * The report's last steps prove the switch works (#7032), and the pages'
 * Finish the switch says them as the report does: an on-call tool's sends
 * a test page once everyone can be paged, before the incident numbers;
 * a status page tool's says, in the step that moves the page to the team's
 * domain, where each imported page is live until then. Each in every
 * language, with the step and the button as that language's Dashboard
 * names them.
 */
interface FinishStep {
  heading: string;
  body: string;
}

// The steps of a page's last steps block: Finish the switch.
function finishStepsOf(markdown: string): Array<FinishStep> {
  const blocks: Array<string> = markdown.split(":::steps");
  const last: string = (blocks[blocks.length - 1] || "").split("\n:::")[0]!;

  return last
    .split("\n### ")
    .slice(1)
    .map((part: string): FinishStep => {
      const [heading, ...rest] = part.split("\n");

      return { heading: heading!.trim(), body: rest.join("\n").trim() };
    });
}

describe("Finish the switch ends on the report's next step", () => {
  const onCallTools: Array<ToolImportSource> = AllToolImportSources.filter(
    (source: ToolImportSource): boolean => {
      return (
        getToolImportSourceDefinition(source).category ===
        ToolImportCategory.OnCall
      );
    },
  );
  const statusPageTools: Array<ToolImportSource> = AllToolImportSources.filter(
    (source: ToolImportSource): boolean => {
      return getToolImportSourceDefinition(source).kinds.includes(
        ToolImportResourceKind.StatusPage,
      );
    },
  );

  test("the five on-call tools and the three status page tools have such a step", () => {
    expect(onCallTools).toEqual([
      ToolImportSource.OpsGenie,
      ToolImportSource.PagerDuty,
      ToolImportSource.IncidentIo,
      ToolImportSource.SplunkOnCall,
      ToolImportSource.GrafanaOnCall,
    ]);
    expect(statusPageTools).toEqual([
      ToolImportSource.UptimeRobot,
      ToolImportSource.AtlassianStatuspage,
      ToolImportSource.BetterStack,
    ]);
  });

  test.each(onCallTools)(
    "%s: Send a test page comes after making sure everyone can be paged, and names Test this policy, in every language",
    (source: ToolImportSource) => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const locale: Record<string, string> = readDashboardLocale(lang);
        const steps: Array<FinishStep> = finishStepsOf(readPage(lang, source));
        const at: number = steps.findIndex((step: FinishStep): boolean => {
          return step.heading === locale["Send a test page"];
        });

        expect({
          lang,
          steps: steps.length,
          at,
          afterReadiness: (steps[at - 1]?.body || "").includes(
            `**${locale["Readiness"]}**`,
          ),
          button: (steps[at]?.body || "").includes(
            `**${locale["Test this policy"]}**`,
          ),
          says: (steps[at]?.body || "").includes(
            lang === "en" ? "every message says TEST" : "",
          ),
        }).toEqual({
          lang,
          steps: 6,
          at: 2,
          afterReadiness: true,
          button: true,
          says: true,
        });
      }
    },
  );

  test.each(statusPageTools)(
    "%s: the step that moves the page to your domain says where it is live until then, with Copy link, in every language",
    (source: ToolImportSource) => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const locale: Record<string, string> = readDashboardLocale(lang);
        const domainSteps: Array<FinishStep> = finishStepsOf(
          readPage(lang, source),
        ).filter((step: FinishStep): boolean => {
          return step.body.includes(`**${locale["Custom Domains"]}**`);
        });

        expect({
          lang,
          domainSteps: domainSteps.length,
          copyLink: (domainSteps[0]?.body || "").includes(
            `**${locale["Copy link"]}**`,
          ),
        }).toEqual({ lang, domainSteps: 1, copyLink: true });
      }

      expect(
        finishStepsOf(readPage("en", source)).find((step: FinishStep) => {
          return (
            step.heading === "Point your status page's address at OneUptime"
          );
        })?.body,
      ).toContain(
        "Until then, the report shows where each page you brought over is live on OneUptime, with **Copy link**.",
      );
    },
  );

  test("a tool that brings no status page or policy says neither", () => {
    for (const source of [
      ToolImportSource.Pingdom,
      ToolImportSource.StatusCake,
      ToolImportSource.UptimeKuma,
    ]) {
      const page: string = readPage("en", source);

      expect(page).not.toContain("**Test this policy**");
      expect(page).not.toContain("**Copy link**");
    }
  });
});

/*
 * TWO RECORDS OF ONE IMPORT CALLED ALIKE (#9857).
 *
 * A team's, a schedule's and a policy's name is one record's in a project
 * (#9674, #9742), and another tool may call two alike. The import creates
 * the second numbered, as Duplicate numbers a copy (ToolImportApplier
 * .createNamed, through createWithFreeName and getNumberedName), and the
 * report says so on that item (ToolImportNoteCode.NameNumbered). Each
 * on-call tool's page says it in its Teams, Schedules and policies rows,
 * in every language, with the example numbered as the import numbers it.
 */
describe("two teams, schedules or policies of one import called alike", () => {
  const NUMBERED_KINDS: Array<ToolImportResourceKind> = [
    ToolImportResourceKind.Team,
    ToolImportResourceKind.OnCallSchedule,
    ToolImportResourceKind.OnCallPolicy,
  ];

  // The name the second of two is made with, as the import makes it.
  const EXAMPLES: Record<string, string> = {
    [ToolImportResourceKind.Team]: getNumberedName({
      name: "Platform",
      number: 2,
    }),
    [ToolImportResourceKind.OnCallSchedule]: getNumberedName({
      name: "Primary",
      number: 2,
    }),
    [ToolImportResourceKind.OnCallPolicy]: getNumberedName({
      name: "Primary",
      number: 2,
    }),
  };

  const tools: Array<ToolImportSource> = AllToolImportSources.filter(
    (source: ToolImportSource): boolean => {
      return NUMBERED_KINDS.every((kind: ToolImportResourceKind): boolean => {
        return getToolImportSourceDefinition(source).kinds.includes(kind);
      });
    },
  );

  test("are brought by the five on-call tools, numbered from 2, with a note on the report", () => {
    expect(tools).toEqual([
      ToolImportSource.OpsGenie,
      ToolImportSource.PagerDuty,
      ToolImportSource.IncidentIo,
      ToolImportSource.SplunkOnCall,
      ToolImportSource.GrafanaOnCall,
    ]);
    expect(Object.values(EXAMPLES)).toEqual([
      "Platform 2",
      "Primary 2",
      "Primary 2",
    ]);
    expect(TOOL_IMPORT_NOTE_TEMPLATES[ToolImportNoteCode.NameNumbered]).toBe(
      "Its name was already taken in this project, so it was created as {{name}}.",
    );
  });

  test.each(tools)(
    "%s: each of the three rows says the second comes over numbered, in every language",
    (source: ToolImportSource) => {
      const kinds: Array<ToolImportResourceKind> =
        getToolImportSourceDefinition(source).kinds;

      const dataRows: (lang: string) => Array<string> = (
        lang: string,
      ): Array<string> => {
        // The header row, then one row per kind, in the catalog's order.
        return tableRowsIn(
          sectionsOf(readPage(lang, source))[SECTION_INDEX.comesOver]!.body,
        )
          .filter((row: string): boolean => {
            return !TABLE_SEPARATOR.test(row);
          })
          .slice(1);
      };

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const rows: Array<string> = dataRows(lang);

        for (const kind of NUMBERED_KINDS) {
          const row: string = rows[kinds.indexOf(kind)] || "";

          expect({
            lang,
            kind,
            numbered: row.includes(`\`${EXAMPLES[kind]}\``),
          }).toEqual({ lang, kind, numbered: true });
        }
      }

      // And in English, what the report says of it.
      const english: Array<string> = dataRows("en");

      for (const kind of NUMBERED_KINDS) {
        expect(english[kinds.indexOf(kind)]).toContain(
          `the second comes over numbered, such as \`${EXAMPLES[kind]}\`, and the report says the name it was created with.`,
        );
      }
    },
  );
});
