import DocsNav, { NavGroup } from "../../../FeatureSet/Docs/Utils/Nav";
import { getDocsCategoryFirstPage } from "../../../FeatureSet/Docs/Utils/Redirects";
import {
  DOCS_LANGUAGES,
  DocsHeading,
  DocsLink,
  NAV_PAGES,
  TRANSLATED_LANGUAGES,
  anchorsOf,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  CARD_LINE,
  anchorProblems,
  cardLines,
  cardTargets,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
} from "./DocsTranslationChecks";
import { parseYaml } from "Common/Tests/Helpers/Yaml";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Self-Hosting Guide (#6827): one page, followed top to bottom, from an
 * empty server to a OneUptime on HTTPS that has sent a test email and can
 * page. It goes first in the Installation group, so /docs/installation opens
 * it, and the long pages it links to stay as the reference.
 *
 * These tests keep it true. Every setting it names is in config.example.env
 * and is read by Docker Compose; every chart value is in the chart's
 * values.yaml; every command is the one the product, the README and the
 * chart's docs give; every Admin Dashboard label is one the Admin Dashboard
 * draws, in the reader's language; every step ends with how to tell it
 * worked; every link lands on a page and a heading; and every docs language
 * has the guide, in the English page's shape.
 */

const PAGE: string = "installation/self-hosting-guide";
const NAV_TITLE: string = "Self-Hosting Guide";
const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

function repoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const ENGLISH: string = readPage("en", PAGE);
const TEMPLATE: string = repoFile("config.example.env");
const COMPOSE: string =
  repoFile("docker-compose.base.yml") + repoFile("docker-compose.yml");

// The steps, in the order the guide walks them, and what follows them.
const SECTIONS: Array<string> = [
  "What you need",
  "Install OneUptime",
  "Turn on HTTPS",
  "Create the admin account",
  "Finish setting up the server",
  "Check your installation",
  "Monitor something and get paged",
  "Troubleshooting",
  "Next steps",
];

// The sections that are steps: each ends with how to tell it worked.
const STEP_SECTIONS: Array<string> = SECTIONS.slice(0, 6);
const WORKED: string = "**It worked when**";

// The server checklist's steps the guide walks, as H3 steps.
const CHECKLIST_STEPS: Array<string> = [
  "Set up email",
  "Choose who can sign up",
  "Set up SMS and calls, or use email and push only",
];

/*
 * The Admin Dashboard's words the guide names in bold, each the English of a
 * key of the Admin Dashboard's locale, so a translation names it as that
 * language's Admin Dashboard draws it. A menu path is one bold span of
 * labels joined by " > ".
 */
const ADMIN_LOCALE_KEYS: Record<string, Array<string>> = {
  "Finish setting up this server": ["Finish setting up this server"],
  "Server Setup": ["Server Setup"],
  "Set up email": ["Set up email"],
  "Settings > Notifications > Emails": ["Settings", "Notifications", "Emails"],
  "Send test email": ["Send test email"],
  "Let people sign up": ["pages.settings.authentication.signUpSwitchTitle"],
  "Settings > Authentication": ["Settings", "Authentication"],
  "Keep sign-ups open": ["Keep sign-ups open"],
  "Set up SMS and calls": ["Set up SMS and calls"],
  "Settings > Notifications > Call and SMS": [
    "Settings",
    "Notifications",
    "Call and SMS",
  ],
  "Send test SMS": ["Send test SMS"],
  "Make test call": ["Make test call"],
  "Use email and push only": ["Use email and push only"],
};

// Bold words that are not Admin Dashboard labels: leads, and what OneUptime prints.
const OTHER_BOLD: Array<string> = [
  "A server.",
  "A domain name",
  "Ports 80 and 443",
  "A way to send email",
  "A Twilio account",
  WORKED.slice(2, -2),
  "OneUptime is up!",
  "Everything looks right.",
];

// What OneUptime prints, quoted in English in every language.
const PRINTED: Array<string> = ["OneUptime is up!", "Everything looks right."];

type Locale = Record<string, unknown>;

function adminLocale(language: string): Locale {
  return JSON.parse(
    repoFile(
      `packages/App/FeatureSet/AdminDashboard/src/Locales/${language}.json`,
    ),
  ) as Locale;
}

// A locale's value for a key: a flat key ("Set up email") or a dotted path.
function localeValue(locale: Locale, key: string): string | undefined {
  if (typeof locale[key] === "string") {
    return locale[key] as string;
  }

  let value: unknown = locale;

  for (const part of key.split(".")) {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }

  return typeof value === "string" ? value : undefined;
}

// How the Admin Dashboard draws an English label in a language.
function drawnAdminLabel(language: string, english: string): string {
  const locale: Locale = adminLocale(language);

  return (ADMIN_LOCALE_KEYS[english] as Array<string>)
    .map((key: string): string => {
      const value: string | undefined = localeValue(locale, key);

      if (value === undefined) {
        throw new Error(`${language} Admin Dashboard has no "${key}"`);
      }

      return value;
    })
    .join(" > ");
}

function boldSpansOf(markdown: string): Array<string> {
  return Array.from(prose(markdown).matchAll(/\*\*([^*\n]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The text of a section, from its heading to the next heading of its level or above.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return (
      SECTION_HEADING.test(line) && line.replace(HEADING_MARK, "") === heading
    );
  });

  if (start === -1) {
    return "";
  }

  const level: number = (lines[start] as string).indexOf(" ");
  const end: number = lines.findIndex(
    (line: string, index: number): boolean => {
      const match: RegExpMatchArray | null = line.match(/^(#+) /);

      return index > start && match !== null && match[1]!.length <= level;
    },
  );

  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function fencesOf(markdown: string, lang?: string): Array<string> {
  return scanMarkdown(markdown)
    .fences.filter((fence: { lang: string }): boolean => {
      return lang === undefined || fence.lang === lang;
    })
    .map((fence: { code: string }): string => {
      return fence.code;
    });
}

const SECTION_HEADING: RegExp = /^#{2,3} /;
const HEADING_MARK: RegExp = /^#+ /;
const ASSIGNMENT_LINE: RegExp = /^[A-Z][A-Z0-9_]*=/;
// Inline code that names a chart value: `ssl.provision`, `httpProtocol: https`.
const CHART_VALUE_CODE: RegExp =
  /^(?:global\.storageClass|ssl\.provision|httpProtocol|host)(?::|$)/;

// SETTING or SETTING=value as the guide writes it: the settings it names.
const SETTING: RegExp = /^([A-Z][A-Z0-9_]*[A-Z0-9])(?:=.*)?$/;

/*
 * Upper-case words in code that are not settings: the line config.example.env
 * folds everything a self-hoster can leave under, and the severity
 * diagnose.sh sorts its findings by.
 */
const NOT_SETTINGS: Record<string, { file: string; text: string }> = {
  ADVANCED: {
    file: "config.example.env",
    text: "# ADVANCED: everything below works as it is.",
  },
  CRITICAL: { file: "HelmChart/Public/diagnose.sh", text: "CRITICAL" },
};

function settingsNamed(markdown: string): Array<string> {
  const fromInline: Array<string> = inlineCode(markdown);
  const fromIni: Array<string> = fencesOf(markdown, "ini").flatMap(
    (code: string): Array<string> => {
      return code.split("\n");
    },
  );

  return Array.from(
    new Set(
      [...fromInline, ...fromIni]
        .map((code: string): string | null => {
          const match: RegExpMatchArray | null = code.match(SETTING);

          return match ? (match[1] as string) : null;
        })
        .filter((name: string | null): name is string => {
          return name !== null;
        }),
    ),
  ).sort();
}

// "a.b.c" for every leaf and branch of a YAML document.
function yamlPaths(value: unknown, prefix: string = ""): Array<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]: [string, unknown]): Array<string> => {
      const here: string = prefix ? `${prefix}.${key}` : key;

      return [here, ...yamlPaths(child, here)];
    },
  );
}

const CHART_VALUES: unknown = parseYaml(
  repoFile("HelmChart/Public/oneuptime/values.yaml"),
);

describe("the Self-Hosting Guide in the nav", () => {
  const installation: NavGroup | undefined = DocsNav.find(
    (group: NavGroup): boolean => {
      return group.title === "Installation";
    },
  );

  it("is the Installation group's first page, so /docs/installation opens it, with Docker Compose next", () => {
    expect(installation?.links[0]).toEqual({
      title: NAV_TITLE,
      url: `/docs/${PAGE}`,
      // Followed from its first line to its last: docs search puts it above reference pages (#6822).
      isGuide: true,
    });
    expect(installation?.links[1]?.url).toBe(
      "/docs/installation/docker-compose",
    );
    expect(getDocsCategoryFirstPage("installation")).toBe(PAGE);
    expect(NAV_PAGES).toContain(PAGE);
  });

  it("is titled as its nav link", () => {
    expect(ENGLISH.split("\n")[0]).toBe(`# ${NAV_TITLE}`);
  });
});

describe("the Self-Hosting Guide, step by step", () => {
  it("walks the steps in order, then the product's first steps, troubleshooting and next steps", () => {
    expect(
      scanMarkdown(ENGLISH)
        .headings.filter((heading: DocsHeading): boolean => {
          return heading.level === 2;
        })
        .map((heading: DocsHeading): string => {
          return heading.text;
        }),
    ).toEqual(SECTIONS);
  });

  it.each(STEP_SECTIONS)(
    "%s ends with how to tell it worked",
    (section: string) => {
      const text: string = sectionOf(ENGLISH, section);

      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain(WORKED);
    },
  );

  it.each(CHECKLIST_STEPS)(
    "the server checklist's step %s ends with how to tell it worked",
    (step: string) => {
      const text: string = sectionOf(ENGLISH, step);

      expect(text.startsWith(`### ${step}`)).toBe(true);
      expect(text).toContain(WORKED);
    },
  );

  it("walks the server checklist in steps, email first", () => {
    const steps: Array<string> = scanMarkdown(
      sectionOf(ENGLISH, "Finish setting up the server"),
    )
      .headings.filter((heading: DocsHeading): boolean => {
        return heading.level === 3;
      })
      .map((heading: DocsHeading): string => {
        return heading.text;
      });

    expect(steps).toEqual(CHECKLIST_STEPS);
    expect(
      scanMarkdown(ENGLISH).containers.filter(
        (container: { name: string; steps: number }): boolean => {
          return container.name === "steps";
        },
      ),
    ).toEqual([expect.objectContaining({ steps: CHECKLIST_STEPS.length })]);
  });

  it("installs, turns on HTTPS and checks the installation on Docker Compose or Kubernetes, as tabs", () => {
    const tabs: Array<Array<string>> = scanMarkdown(ENGLISH)
      .containers.filter((container: { name: string }): boolean => {
        return container.name === "tabs";
      })
      .map((container: { tabs: Array<string> }): Array<string> => {
        return container.tabs;
      });

    expect(tabs).toEqual([
      ["Docker Compose", "Kubernetes"],
      ["Docker Compose", "Kubernetes"],
      ["Docker Compose", "Kubernetes"],
    ]);
  });

  it("ends on next steps that start with the Quickstart, the product's own first steps", () => {
    expect(cardTargets(cardLines(sectionOf(ENGLISH, "Next steps")))[0]).toBe(
      "/docs/introduction/quickstart",
    );
    expect(sectionOf(ENGLISH, "Monitor something and get paged")).toContain(
      "](/docs/introduction/quickstart)",
    );
  });
});

describe("what the Self-Hosting Guide names is what OneUptime has", () => {
  it("every setting it names is in config.example.env and read by Docker Compose", () => {
    const named: Array<string> = settingsNamed(ENGLISH).filter(
      (name: string): boolean => {
        return NOT_SETTINGS[name] === undefined;
      },
    );
    const assigned: Set<string> = new Set(
      TEMPLATE.split("\n")
        .map((line: string): string | null => {
          const match: RegExpMatchArray | null =
            line.match(/^([A-Z][A-Z0-9_]*)=/);

          return match ? (match[1] as string) : null;
        })
        .filter((name: string | null): name is string => {
          return name !== null;
        }),
    );

    expect(named).toEqual(
      expect.arrayContaining([
        "HOST",
        "HTTP_PROTOCOL",
        "PROVISION_SSL",
        "TRUSTED_PROXY_HOPS",
      ]),
    );
    for (const name of named) {
      expect({ name, inTemplate: assigned.has(name) }).toEqual({
        name,
        inTemplate: true,
      });
      expect({
        name,
        readByCompose: new RegExp(`\\$\\{${name}[:}]`).test(COMPOSE),
      }).toEqual({ name, readByCompose: true });
    }
  });

  it("the upper-case words in its code that are not settings are what the files it names print", () => {
    for (const name of settingsNamed(ENGLISH)) {
      const other: { file: string; text: string } | undefined =
        NOT_SETTINGS[name];

      if (other) {
        expect(repoFile(other.file)).toContain(other.text);
      }
    }
  });

  it("HOST is the only setting a new install must change, and config.example.env opens with it", () => {
    expect(ENGLISH).toContain(
      "Open `config.env` and set `HOST`, its first setting,",
    );
    expect(ENGLISH).toContain("It is the only setting you must change");
    expect(
      TEMPLATE.split("\n").find((line: string): boolean => {
        return ASSIGNMENT_LINE.test(line);
      }),
    ).toBe("HOST=localhost");
  });

  it("every chart value it sets is one the chart's values.yaml has", () => {
    const paths: Set<string> = new Set(yamlPaths(CHART_VALUES));
    const set: Array<string> = fencesOf(ENGLISH, "yaml").flatMap(
      (code: string): Array<string> => {
        return yamlPaths(parseYaml(code));
      },
    );
    const named: Array<string> = inlineCode(ENGLISH).filter(
      (code: string): boolean => {
        return CHART_VALUE_CODE.test(code);
      },
    );

    expect(set).toEqual(
      expect.arrayContaining(["host", "httpProtocol", "ssl.provision"]),
    );
    expect(named).toEqual(
      expect.arrayContaining(["global.storageClass", "ssl.provision"]),
    );
    for (const value of [
      ...set,
      ...named.map((code: string): string => {
        return code.split(":")[0] as string;
      }),
    ]) {
      expect({ value, inChart: paths.has(value) }).toEqual({
        value,
        inChart: true,
      });
    }
  });

  it("its install commands are the ones the README, the Docker Compose guide and the chart's docs give", () => {
    const bash: Array<string> = fencesOf(ENGLISH, "bash");
    const readme: string = repoFile("README.md");
    const compose: string = readPage("en", "installation/docker-compose");
    const chartReadme: string = repoFile(
      "HelmChart/Public/oneuptime/README.md",
    );
    const chartInstall: string = repoFile(
      "HelmChart/Public/oneuptime/docs/installation.md",
    );
    const chartTroubleshooting: string = repoFile(
      "HelmChart/Public/oneuptime/docs/troubleshooting.md",
    );
    const installer: string =
      "curl -fsSL https://oneuptime.com/install.sh | bash";

    expect(bash[0]).toBe(installer);
    expect(readme).toContain(installer);
    expect(compose).toContain(installer);
    // By hand, the README's first two steps.
    for (const line of (bash[1] as string).split("\n")) {
      expect(readme).toContain(line);
    }
    for (const line of [
      "helm repo add oneuptime https://helm-chart.oneuptime.com/",
      "helm install my-oneuptime oneuptime/oneuptime -f values.yaml",
    ]) {
      expect(ENGLISH).toContain(line);
      expect(chartReadme).toContain(line);
    }
    expect(ENGLISH).toContain(
      "helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml",
    );
    expect(chartInstall).toContain(
      "helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml",
    );
    /*
     * The Kubernetes check is the chart's diagnostics script, which looks
     * into a OneUptime that is slow or down, so that OneUptime cannot serve
     * it: the chart's troubleshooting guide is the one place that says where
     * to get it (Tests/Ops/InstallLinksNeverNameGitHub.test.js), and the
     * guide links to its "Run it" section instead of writing the download
     * again.
     */
    expect(
      bash.filter((code: string): boolean => {
        return code.includes("diagnose.sh");
      }),
    ).toEqual([]);
    expect(ENGLISH).toContain(
      "[chart's troubleshooting guide](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it)",
    );
    expect(chartTroubleshooting).toContain("\n## Run it\n");
    expect(chartTroubleshooting).toContain("\n./diagnose.sh\n");
    expect(
      fs.existsSync(path.join(REPO_ROOT, "HelmChart/Public/diagnose.sh")),
    ).toBe(true);
  });

  it("the commands it runs are package scripts, and they print what it quotes", () => {
    const scripts: Record<string, string> = (
      JSON.parse(repoFile("package.json")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    const doctor: string = repoFile("Scripts/Install/Doctor.js");

    expect(scripts["start"]).toContain("npm run status-check");
    expect(scripts["doctor"]).toBe("node ./Scripts/Install/Doctor.js");
    expect(repoFile("Tests/Scripts/status-check.sh")).toContain(
      "OneUptime is up!",
    );
    expect(doctor).toContain('return "Everything looks right.";');
    // 1 when something needs fixing, 0 otherwise, 2 when the doctor fails.
    expect(doctor).toContain(
      'return entry.level === "fix";\n  })\n    ? 1\n    : 0;',
    );
    expect(doctor).toContain(
      'process.exitCode = process.argv.indexOf("--after-start") !== -1 ? 0 : 2;',
    );
    for (const quoted of PRINTED) {
      expect(ENGLISH).toContain(`**${quoted}**`);
    }
    expect(ENGLISH).toContain("exits with `0`");
    expect(ENGLISH).toContain(
      "It exits with `1` when something needs fixing, and with `2`",
    );
  });

  it("the server checklist is at /admin/setup, and npm start ends by pointing there", () => {
    expect(
      repoFile("packages/App/FeatureSet/AdminDashboard/src/Utils/RouteMap.ts"),
    ).toContain("[PageMap.SERVER_SETUP]: new Route(`/admin/setup`),");
    expect(
      repoFile(
        "packages/App/FeatureSet/AdminDashboard/src/Components/NavBar/NavBar.tsx",
      ),
    ).toContain('title: "Server Setup",');
    expect(ENGLISH).toContain("at `/admin/setup`");
  });

  it("the checklist's required and recommended items are the ones the server checks", () => {
    const checklist: string = repoFile(
      "packages/Common/Types/ServerSetup/ServerSetupChecklist.ts",
    );
    const tierOf: (title: string) => string = (title: string): string => {
      const at: number = checklist.indexOf(`title: translationKey("${title}")`);
      const block: string = checklist.slice(
        checklist.lastIndexOf("tier:", at),
        at,
      );

      return block.includes("Required") ? "required" : "recommended";
    };

    expect(ENGLISH).toContain(
      "Email, HTTPS and who can sign up are required. SMS and calls, a global probe, backups and update checks are recommended.",
    );
    for (const title of ["Email", "HTTPS", "Sign-ups"]) {
      expect({ title, tier: tierOf(title) }).toEqual({
        title,
        tier: "required",
      });
    }
    for (const title of [
      "SMS and calls",
      "Probes",
      "Backups",
      "Update checks",
    ]) {
      expect({ title, tier: tierOf(title) }).toEqual({
        title,
        tier: "recommended",
      });
    }
  });

  it("every bold word is an Admin Dashboard label it knows, or a lead, or what OneUptime prints", () => {
    const unknown: Array<string> = boldSpansOf(ENGLISH).filter(
      (bold: string): boolean => {
        return (
          ADMIN_LOCALE_KEYS[bold] === undefined && !OTHER_BOLD.includes(bold)
        );
      },
    );

    expect(unknown).toEqual([]);
  });

  it("names each Admin Dashboard label as the Admin Dashboard draws it in English", () => {
    for (const label of Object.keys(ADMIN_LOCALE_KEYS)) {
      expect({ label, drawn: drawnAdminLabel("en", label) }).toEqual({
        label,
        drawn: label,
      });
      expect(ENGLISH).toContain(`**${label}**`);
    }
  });
});

describe("where people meet the Self-Hosting Guide", () => {
  it.each(DOCS_LANGUAGES)(
    "%s: the Docker Compose guide's first-account step and next steps send people to the server checklist, then the Quickstart",
    (language: string) => {
      const compose: string = readPage(language, "installation/docker-compose");
      const cards: Array<string> = cardTargets(
        cardLines(
          sectionOf(
            compose,
            scanMarkdown(compose).headings[
              scanMarkdown(compose).headings.length - 1
            ]!.text,
          ),
        ),
      );

      expect(cards.slice(0, 2)).toEqual([
        `/docs/${PAGE}`,
        "/docs/introduction/quickstart",
      ]);
      expect(compose).toContain("`/admin/setup`");
    },
  );

  it.each(DOCS_LANGUAGES)(
    "%s: Getting Started's Installation card opens the guide",
    (language: string) => {
      const gettingStarted: string = readPage(
        language,
        "introduction/getting-started",
      );

      expect(
        cardTargets(cardLines(gettingStarted)).filter((target: string) => {
          return target === `/docs/${PAGE}`;
        }),
      ).toHaveLength(1);
    },
  );

  it("the chart's quick start and production checklist lead to email and SMS at /admin/setup, and to the guide", () => {
    const chartReadme: string = repoFile(
      "HelmChart/Public/oneuptime/README.md",
    );
    const checklist: string = repoFile(
      "HelmChart/Public/oneuptime/docs/production-checklist.md",
    );
    const guideUrl: string =
      "(https://oneuptime.com/docs/installation/self-hosting-guide)";

    expect(chartReadme).toContain(
      "4. **Finish setting up the server** at `/admin/setup`",
    );
    expect(chartReadme).toContain(guideUrl);
    // Email comes first in the checklist, before pinning versions.
    expect(checklist.indexOf("## Reach people")).toBeGreaterThan(0);
    expect(checklist.indexOf("## Reach people")).toBeLessThan(
      checklist.indexOf("## Pin versions"),
    );
    expect(checklist).toContain("`https://<host>/admin/setup`");
    expect(checklist).toContain(guideUrl);
    // The Admin Dashboard's words it names are the ones it draws.
    for (const label of Object.keys(ADMIN_LOCALE_KEYS).filter(
      (key: string): boolean => {
        return checklist.includes(`**${key}**`);
      },
    )) {
      expect(drawnAdminLabel("en", label)).toBe(label);
    }
    for (const label of [
      "Set up email",
      "Send test email",
      "Set up SMS and calls",
      "Use email and push only",
      "Let people sign up",
    ]) {
      expect(checklist).toContain(`**${label}**`);
    }
  });

  it("the README and config.example.env send self-hosters to it", () => {
    expect(repoFile("README.md")).toContain(
      "(https://oneuptime.com/docs/installation/self-hosting-guide)",
    );
    expect(TEMPLATE).toContain(
      "https://oneuptime.com/docs/installation/self-hosting-guide",
    );
  });
});

describe.each(DOCS_LANGUAGES)(
  "the Self-Hosting Guide in %s",
  (language: string) => {
    const markdown: string = hasPage(language, PAGE)
      ? readPage(language, PAGE)
      : "";

    it("links only to pages in the nav, and to headings those pages have", () => {
      const links: Array<DocsLink> = scanMarkdown(markdown).links;

      expect(links.length).toBeGreaterThan(15);
      for (const link of links) {
        if (link.target.startsWith("#")) {
          continue;
        }

        const target: { page: string; anchor: string | null } | null =
          parseDocsLink(link.target);

        if (!target) {
          expect(new URL(link.target).protocol).toBe("https:");
          continue;
        }

        expect({
          link: link.target,
          inNav: NAV_PAGES.includes(target.page),
        }).toEqual({
          link: link.target,
          inNav: true,
        });
        if (target.anchor) {
          expect({
            link: link.target,
            heading: anchorsOf(language, target.page).has(target.anchor),
          }).toEqual({ link: link.target, heading: true });
        }
      }
      expect(anchorProblems(language, PAGE)).toEqual([]);
    });
  },
);

describe.each(TRANSLATED_LANGUAGES)(
  "the Self-Hosting Guide in %s",
  (language: string) => {
    it("is translated, under the nav link's title", () => {
      expect(hasPage(language, PAGE)).toBe(true);

      const translated: string = readPage(language, PAGE);

      expect(translated).not.toEqual(ENGLISH);
      expect(translated.split("\n")[0]).toBe(
        `# ${navTitle(language, NAV_TITLE)}`,
      );
      expect(navTitle(language, NAV_TITLE)).not.toBe(NAV_TITLE);
    });

    it("keeps the English page's headings, steps, tabs, lists and code", () => {
      const translated: string = readPage(language, PAGE);
      const english: ReturnType<typeof scanMarkdown> = scanMarkdown(ENGLISH);
      const scanned: ReturnType<typeof scanMarkdown> = scanMarkdown(translated);

      expect(
        scanned.headings.map((heading: DocsHeading): number => {
          return heading.level;
        }),
      ).toEqual(
        english.headings.map((heading: DocsHeading): number => {
          return heading.level;
        }),
      );
      expect(
        scanned.containers.map(
          (container: { name: string; tabs: Array<string>; steps: number }) => {
            return [container.name, container.tabs, container.steps];
          },
        ),
      ).toEqual(
        english.containers.map(
          (container: { name: string; tabs: Array<string>; steps: number }) => {
            return [container.name, container.tabs, container.steps];
          },
        ),
      );
      expect(fencesOf(translated)).toEqual(fencesOf(ENGLISH));
      expect(inlineCode(translated)).toEqual(inlineCode(ENGLISH));
      expect(listItemCount(translated)).toBe(listItemCount(ENGLISH));
      expect(translated.split("\n")).toHaveLength(ENGLISH.split("\n").length);
    });

    it("links to the pages the English links to, and writes its cards with an ASCII ': '", () => {
      const pagesOf: (text: string) => Array<string> = (
        text: string,
      ): Array<string> => {
        return scanMarkdown(text)
          .links.map((link: DocsLink): string => {
            const target: { page: string } | null = parseDocsLink(link.target);

            return target ? target.page : link.target.split("#")[0] || "#";
          })
          .sort();
      };
      const translated: string = readPage(language, PAGE);
      const cards: Array<string> = cardLines(translated);

      expect(pagesOf(translated)).toEqual(pagesOf(ENGLISH));
      expect(cards).toHaveLength(cardLines(ENGLISH).length);
      for (const line of cards) {
        expect({ line, ascii: CARD_LINE.test(line) }).toEqual({
          line,
          ascii: true,
        });
      }
      expect(cardTargets(cards)).toEqual(cardTargets(cardLines(ENGLISH)));
    });

    it("names every Admin Dashboard label as this language's Admin Dashboard draws it", () => {
      const translated: string = readPage(language, PAGE);
      const bold: Array<string> = boldSpansOf(translated);
      const missing: Array<string> = Object.keys(ADMIN_LOCALE_KEYS)
        .map((label: string): string => {
          return drawnAdminLabel(language, label);
        })
        .filter((drawn: string): boolean => {
          return !bold.includes(drawn);
        });

      expect(missing).toEqual([]);
    });

    it("quotes what OneUptime prints in English, and ends every step with how to tell it worked", () => {
      const translated: string = readPage(language, PAGE);
      const bold: Array<string> = boldSpansOf(translated);

      for (const quoted of PRINTED) {
        expect(bold).toContain(quoted);
      }
      /*
       * The lead the English writes as "It worked when", once per step, in
       * the same places.
       */
      const englishLines: Array<string> = ENGLISH.split("\n");
      const translatedLines: Array<string> = translated.split("\n");
      const workedLines: Array<number> = englishLines
        .map((line: string, index: number): number => {
          return line.startsWith(WORKED) ? index : -1;
        })
        .filter((index: number): boolean => {
          return index !== -1;
        });

      expect(workedLines).toHaveLength(
        STEP_SECTIONS.length + CHECKLIST_STEPS.length,
      );
      for (const index of workedLines) {
        const line: string = translatedLines[index] as string;

        expect({ line: index + 1, lead: line.startsWith("**") }).toEqual({
          line: index + 1,
          lead: true,
        });
      }
      // Each of those leads is one phrase, the same on every line.
      const leads: Set<string> = new Set(
        workedLines.map((index: number): string => {
          return (translatedLines[index] as string).match(
            /^\*\*([^*]+)\*\*/,
          )![1] as string;
        }),
      );

      expect(leads.size).toBe(1);
      expect(boldSpansOf(translated)).toHaveLength(boldSpansOf(ENGLISH).length);
    });
  },
);
