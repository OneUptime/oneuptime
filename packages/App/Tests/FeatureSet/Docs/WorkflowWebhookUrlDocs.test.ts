import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A workflow's webhook URL - and the secret key that is its last segment - is
 * no longer on the workflow's Settings page. It is shown, copied and reset in
 * the Webhook trigger's settings, in the Builder.
 *
 * A guide that still says "open Settings and copy the Webhook Secret Key"
 * renders perfectly and is wrong, in seventeen languages, most of which nobody
 * on the team can proofread. So this reads every copy of the pages that send
 * people for the URL, and holds the button names they quote to the ones the
 * dashboard draws in that language.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const PANEL_SOURCE: string = path.resolve(
  __dirname,
  "../../../../Common/UI/Components/Workflow/WebhookTriggerPanel.tsx",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const GUIDES: Array<string> = [
  "integrations/jira.md",
  "integrations/microsoft-dynamics-365.md",
];

// A webhook URL in a guide's code block, whatever host it shows.
const URL_LINE: RegExp =
  /^ {3}https:\/\/\S+\/workflow\/trigger\/<webhook secret key>$/;

// "webhook" in every script the docs are written in.
const MENTIONS_WEBHOOK: RegExp = /webhook|вебхук|웹훅|وب‌هوک|वेबहुक/i;

type ReadFunction = (language: string, page: string) => string;

const readDoc: ReadFunction = (language: string, page: string): string => {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
};

type DashboardLabelFunction = (language: string, english: string) => string;

// What the dashboard draws for a label in that language.
const dashboardLabel: DashboardLabelFunction = (
  language: string,
  english: string,
): string => {
  const translations: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_LOCALES_DIR, `${language}.json`),
      "utf8",
    ),
  );

  return translations[english] || english;
};

describe("docs for the webhook URL, now in the Webhook trigger", () => {
  test("every docs language is checked", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toContain("en");
  });

  test("the button names the docs quote are the panel's own", () => {
    const panel: string = fs.readFileSync(PANEL_SOURCE, "utf8");

    for (const label of ["Copy URL", "Reset URL", "Show"]) {
      expect(panel).toContain(`"${label}"`);
    }
  });

  test.each(LANGUAGES)(
    "%s: the workflow menu's Settings item no longer lists a webhook secret",
    (language: string) => {
      const settingsWords: Array<string> = Array.from(
        new Set(["Settings", dashboardLabel(language, "Settings")]),
      );

      const settingsBullets: Array<string> = readDoc(
        language,
        "workflows/index.md",
      )
        .split("\n")
        .filter((line: string) => {
          return settingsWords.some((word: string) => {
            return line.startsWith(`- **${word}**`);
          });
        });

      expect(settingsBullets).toHaveLength(1);
      expect(settingsBullets[0]).not.toMatch(MENTIONS_WEBHOOK);
    },
  );

  describe.each(GUIDES)("%s", (guide: string) => {
    test.each(LANGUAGES)(
      "%s: every URL comes from the Webhook trigger, with the dashboard's own button names",
      (language: string) => {
        const lines: Array<string> = readDoc(language, guide).split("\n");
        const blocks: Array<number> = lines
          .map((line: string, index: number) => {
            return URL_LINE.test(line) ? index : -1;
          })
          .filter((index: number) => {
            return index > 3;
          });

        expect(blocks.length).toBeGreaterThan(0);

        for (const at of blocks) {
          // The numbered step that introduces the code block.
          const step: string = lines[at - 3]!;
          // The note under the block, when there is one.
          const after: string = lines[at + 3] || "";

          expect({ language, step: step.slice(0, 3) }).toEqual({
            language,
            step: "2. ",
          });
          expect(step).toContain("**Webhook**");
          expect(step).toContain(`**${dashboardLabel(language, "Copy URL")}**`);

          // Not the Settings page, and not the card that used to be there.
          expect(step).not.toContain(
            `**${dashboardLabel(language, "Settings")}**`,
          );
          expect(step).not.toContain("**Settings**");

          if (after.startsWith("   ")) {
            expect(after).toContain(
              `**${dashboardLabel(language, "Reset URL")}**`,
            );
          }
        }

        // Somewhere, the guide says how to reset a leaked URL.
        expect(readDoc(language, guide)).toContain(
          `**${dashboardLabel(language, "Reset URL")}**`,
        );
      },
    );

    test.each(LANGUAGES)(
      "%s: never sends the reader for a Webhook Secret Key, or to the card's Reset Secret Key",
      (language: string) => {
        const page: string = readDoc(language, guide);

        expect(page).not.toContain("Webhook Secret Key");
        expect(page).not.toContain(
          dashboardLabel(language, "Webhook Secret Key"),
        );
        expect(page).not.toContain("**Reset Secret Key**");
        expect(page).not.toContain(
          `**${dashboardLabel(language, "Reset Secret Key")}**`,
        );
      },
    );
  });

  test("the English trigger page says how to show, copy and reset the URL, and who may", () => {
    const triggers: string = readDoc("en", "workflows/triggers.md");
    const webhook: string = triggers.slice(
      triggers.indexOf("## Webhook"),
      triggers.indexOf("\n## ", triggers.indexOf("## Webhook") + 1),
    );

    expect(webhook).toContain("**Copy URL**");
    expect(webhook).toContain("**Show**");
    expect(webhook).toContain("**Reset URL**");
    expect(webhook).toContain("the old one stops working at once");
    expect(webhook).not.toMatch(/Settings page/);
    expect(webhook).toContain(
      "(/docs/workflows/configuration#webhook-security)",
    );
    expect(readDoc("en", "workflows/configuration.md")).toContain(
      "\n## Webhook security\n",
    );
  });

  test("the permissions the docs name for the URL are the ones that can read the key", () => {
    /*
     * If the column's access control changes, the sentence telling people
     * who can see the URL has to change with it.
     */
    const accessControl: ColumnAccessControl | null =
      new Workflow().getColumnAccessControlFor("webhookSecretKey");
    const titles: Array<string> = PermissionHelper.getPermissionTitles(
      accessControl?.read || [],
    );

    expect(titles.sort()).toEqual(
      ["Edit Workflow", "Project Admin", "Project Owner"].sort(),
    );

    const configuration: string = readDoc("en", "workflows/configuration.md");
    const security: string = configuration.slice(
      configuration.indexOf("## Webhook security"),
      configuration.indexOf(
        "\n## ",
        configuration.indexOf("## Webhook security") + 1,
      ),
    );

    for (const title of titles) {
      expect(security).toContain(`**${title}**`);
    }

    expect(accessControl?.read).not.toContain(Permission.Viewer);
  });

  test("the English permissions list names no permission that does not exist", () => {
    /*
     * It used to list a "Run Workflow" permission. Running a workflow by hand
     * needs the workflow's update permissions; there is no Run Workflow.
     */
    const configuration: string = readDoc("en", "workflows/configuration.md");

    expect(configuration).not.toContain("**Run Workflow** —");
    expect(
      PermissionHelper.getAllPermissionProps().some(
        (props: { title: string }) => {
          return props.title === "Run Workflow";
        },
      ),
    ).toBe(false);
  });
});
