import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { hasPage, readPage } from "./DocsContentSupport";
import { lineShape } from "./DocsPageShape";
import {
  anchorProblems,
  boldSpans,
  cardLines,
  cardTargets,
  inlineCode,
  navTitle,
  tableShape,
} from "./DocsTranslationChecks";
import { describe, expect, it, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Self Hosted > Update and Security Checks: what the daily update check
 * sends, what master admins are shown and emailed, and how to turn the
 * check off or point it at a mirror - for an operator deciding whether
 * their server may contact GitHub. Each claim is held to the code that
 * makes it true:
 *
 *   - the two requests are GitHub's API, at the addresses the server uses
 *     unless told otherwise, with nothing about the installation in them;
 *   - the check runs on startup and daily, and asks again at most every 12
 *     hours, and at most once an hour after a failed attempt;
 *   - only master admins are told, by the footers' pill and the Admin
 *     Dashboard's notice, and master admins and the Admin Notification
 *     Email are emailed once per advisory;
 *   - DISABLE_UPDATE_CHECK / updateCheck.disabled turn it off, and the two
 *     mirror settings exist in the server, Docker Compose and the chart;
 *   - a failed request is logged at debug, and the last answer kept.
 *
 * Every translation keeps the English page's lines, code, tables, cards and
 * links, is titled as its nav link, and quotes the pill as that language's
 * Dashboard draws it and the settings path as its Admin Dashboard does.
 */

const PAGE: string = "self-hosted/update-checks";
const NAV_TITLE: string = "Update and Security Checks";

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// A Markdown link's address: [words](address).
const LINK_ADDRESS: RegExp = /\]\(([^)\s]+)\)/g;

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function repositoryFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_DIR, relativePath), "utf8");
}

function linksOut(markdown: string): Array<string> {
  return [...markdown.matchAll(LINK_ADDRESS)]
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .filter((address: string): boolean => {
      return !address.startsWith("#");
    });
}

function locale(
  app: "Dashboard" | "AdminDashboard",
  language: string,
): Record<string, unknown> {
  return JSON.parse(
    source(`App/FeatureSet/${app}/src/Locales/${language}.json`),
  ) as Record<string, unknown>;
}

const english: string = readPage("en", PAGE);

const environmentConfig: string = source("Common/Server/EnvironmentConfig.ts");
const job: string = source(
  "App/FeatureSet/Workers/Jobs/InstanceUpdate/CheckForNewVersion.ts",
);
const client: string = source(
  "Common/Server/Utils/UpdateCheck/GitHubUpdateCheck.ts",
);

describe("Update and Security Checks, in English", () => {
  test("is in the Self Hosted section of the nav, after Behind a VPN or Firewall", () => {
    const nav: string = source("App/FeatureSet/Docs/Utils/Nav.ts");
    const firewall: number = nav.indexOf(
      'url: "/docs/self-hosted/behind-a-firewall"',
    );
    const thisPage: number = nav.indexOf(`url: "/docs/${PAGE}"`);

    expect(firewall).toBeGreaterThan(-1);
    expect(thisPage).toBeGreaterThan(firewall);
    expect(nav).toContain(`title: "${NAV_TITLE}",`);
    expect(english.split("\n")[0]).toBe(`# ${NAV_TITLE}`);
  });

  test("names the two requests at the addresses the server asks by default", () => {
    for (const [setting, address] of [
      [
        "LATEST_RELEASE_CHECK_URL",
        "https://api.github.com/repos/OneUptime/oneuptime/releases/latest",
      ],
      [
        "SECURITY_ADVISORIES_CHECK_URL",
        "https://api.github.com/repos/OneUptime/oneuptime/security-advisories",
      ],
    ] as Array<[string, string]>) {
      expect(environmentConfig).toContain(
        `process.env["${setting}"] ||\n    "${address}",`,
      );
      expect(english).toContain(`| \`${setting}\` | \`${address}\` |`);
    }

    expect(english).toContain(
      "| `GET /repos/OneUptime/oneuptime/releases/latest` |",
    );
    expect(english).toContain(
      "| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` |",
    );
    expect(client).toContain('.addQueryParam("state", "published")');
  });

  test("sends nothing about the installation: no token, no version, OneUptime as the User-Agent", () => {
    expect(client).toContain('"User-Agent": "OneUptime",');
    expect(client).not.toContain("AppVersion");
    expect(client).not.toContain("Authorization");
    expect(english).toContain(
      "not the version you run, not its address, and nothing about your users, projects or monitoring data",
    );
    expect(english).toContain("a `User-Agent` that names OneUptime");
  });

  test("says when it asks, as the job is scheduled and gated", () => {
    expect(job).toContain(
      "schedule: IsDevelopment ? EVERY_THREE_HOURS : EVERY_DAY,",
    );
    expect(job).toContain("runOnStartup: true,");
    expect(job).toContain(
      "export const MIN_HOURS_BETWEEN_CHECKS: number = 12;",
    );
    expect(job).toContain(
      "export const MIN_MINUTES_BETWEEN_ATTEMPTS: number = 60;",
    );
    expect(english).toContain(
      "The check runs when the worker starts and once a day after that. It asks GitHub again at most every 12 hours, and at most once an hour after a request that failed.",
    );
  });

  test("tells master admins only, as the server answers only them", () => {
    const api: string = source("Common/Server/API/GlobalConfigAPI.ts");

    expect(api).toContain(
      "`${new this.entityType().getCrudApiPath()?.toString()}/update-status`,\n      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,",
    );
    expect(english).toContain("Only master admins are told.");
  });

  test("quotes the pill as the footers draw it, and the settings path as the Admin Dashboard does", () => {
    const pill: string = source(
      "Common/UI/Components/UpdateStatus/UpdateStatusPill.tsx",
    );

    expect(pill).toContain(
      'updateAvailable: translationKey("Update available"),',
    );
    expect(pill).toContain(
      'securityUpdate: translationKey("Security update"),',
    );
    expect(boldSpans(english)).toEqual([
      "Update available",
      "Security update",
      "Settings",
      "Emails",
    ]);
    expect(
      (locale("AdminDashboard", "en")["sideMenu"] as Record<string, string>)[
        "settingsEmails"
      ],
    ).toBe("Emails");
  });

  test("emails master admins and the Admin Notification Email, once per advisory", () => {
    const notification: string = source(
      "App/FeatureSet/Workers/Jobs/InstanceUpdate/SecurityAdvisoryNotification.ts",
    );

    expect(notification).toContain("isMasterAdmin: true,");
    expect(notification).toContain("data.adminNotificationEmail");
    expect(notification).toContain(
      '(update as Record<string, unknown>)["securityAdvisoriesEmailed"] = record;',
    );
    expect(english).toContain(
      "Your master admins and the Admin Notification Email (**Settings** > **Emails** in the Admin Dashboard) get one email about each advisory that affects your version, and never a second one.",
    );
  });

  test("turns it off with the settings the server, Docker Compose and the chart read", () => {
    expect(environmentConfig).toContain(
      'process.env["DISABLE_UPDATE_CHECK"] === "true"',
    );
    expect(job).toContain("if (DisableUpdateCheck) {");
    expect(repositoryFile("config.example.env")).toContain(
      "\nDISABLE_UPDATE_CHECK=false\n",
    );
    expect(repositoryFile("config.example.env")).toContain(
      "\nSECURITY_ADVISORIES_CHECK_URL=\n",
    );
    expect(repositoryFile("docker-compose.base.yml")).toContain(
      "SECURITY_ADVISORIES_CHECK_URL: ${SECURITY_ADVISORIES_CHECK_URL:-}",
    );

    const helpers: string = repositoryFile(
      "HelmChart/Public/oneuptime/templates/_helpers.tpl",
    );

    expect(helpers).toContain(
      "- name: DISABLE_UPDATE_CHECK\n  value: {{ default false $.Values.updateCheck.disabled | squote }}",
    );
    expect(helpers).toContain(
      '- name: LATEST_RELEASE_CHECK_URL\n  value: {{ default "" $.Values.updateCheck.url | quote }}',
    );
    expect(helpers).toContain(
      '- name: SECURITY_ADVISORIES_CHECK_URL\n  value: {{ default "" (($.Values.updateCheck).securityAdvisoriesUrl) | quote }}',
    );

    const values: string = repositoryFile(
      "HelmChart/Public/oneuptime/values.yaml",
    );

    expect(values).toContain(
      "updateCheck:\n  disabled: false\n  url:\n  securityAdvisoriesUrl:\n",
    );

    expect(english).toContain("```yaml\nupdateCheck:\n  disabled: true\n```");
    expect(english).toContain("```bash\nDISABLE_UPDATE_CHECK=true\n```");
    expect(english).toContain(
      "| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` |",
    );
    expect(english).toContain(
      "| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` |",
    );
  });

  test("says a failed request is logged at debug and the last answer kept", () => {
    expect(job).toContain("Keeping the last one read.");
    expect(job).toContain("Keeping the last ones read.");
    expect(job).not.toMatch(/logger\.(error|warn)\(/);
    expect(english).toContain(
      "The worker logs it at debug level, keeps what it read last, and tries again later.",
    );
  });

  test("is linked from the Architecture page's list of outbound connections", () => {
    expect(readPage("en", "self-hosted/architecture")).toContain(
      "([Update and Security Checks](/docs/self-hosted/update-checks))",
    );
  });

  test("links to the upgrade guide the footers and the notice open", () => {
    expect(linksOut(english)).toContain("/docs/installation/upgrading");
    expect(source("Common/UI/Utils/UpdateStatus.ts")).toContain(
      "return `${DOCS_URL.toString()}/installation/upgrading`;",
    );
    expect(source("Common/UI/Utils/UpdateStatus.ts")).toContain(
      `return \`\${DOCS_URL.toString()}/${PAGE}\`;`,
    );
  });
});

describe.each(TRANSLATIONS)(
  "Update and Security Checks, in %s",
  (language: string) => {
    it("is translated", () => {
      expect(hasPage(language, PAGE)).toBe(true);
    });

    const translated: () => string = (): string => {
      return readPage(language, PAGE);
    };

    it("is titled as its nav link", () => {
      const title: string = navTitle(language, NAV_TITLE);

      expect(title).toBeTruthy();
      expect(title).not.toBe(NAV_TITLE);
      expect(translated().split("\n")[0]).toBe(`# ${title}`);
    });

    it("keeps every line where the English page has it", () => {
      expect(lineShape(translated())).toEqual(lineShape(english));
    });

    it("keeps the English page's code, tables and links", () => {
      expect(inlineCode(translated())).toEqual(inlineCode(english));
      expect(tableShape(translated())).toEqual(tableShape(english));
      expect(linksOut(translated())).toEqual(linksOut(english));
      expect(cardTargets(cardLines(translated()))).toEqual(
        cardTargets(cardLines(english)),
      );
    });

    it("links only to headings it has", () => {
      expect(anchorProblems(language, PAGE)).toEqual([]);
    });

    it("quotes the pill as its Dashboard draws it, and the settings path as its Admin Dashboard does", () => {
      const dashboard: Record<string, unknown> = locale("Dashboard", language);
      const admin: Record<string, unknown> = locale("AdminDashboard", language);

      expect(boldSpans(translated())).toEqual([
        dashboard["Update available"],
        dashboard["Security update"],
        admin["Settings"],
        (admin["sideMenu"] as Record<string, string>)["settingsEmails"],
      ]);
    });

    it("links the Architecture page's outbound list to it, named as its nav link", () => {
      const line: string | undefined = readPage(
        language,
        "self-hosted/architecture",
      )
        .split("\n")
        .find((candidate: string): boolean => {
          return candidate.includes("DISABLE_UPDATE_CHECK=true");
        });

      expect(line).toContain(
        `[${navTitle(language, NAV_TITLE)}](/docs/self-hosted/update-checks)`,
      );
    });
  },
);
