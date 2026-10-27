import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY MORE SETTINGS FOLD NAMES WHAT IT HOLDS, AND WHAT IT HOLDS CAN BE
 * REACHED.
 *
 * "Move custom roles to More settings because it is an advanced feature.
 * Please audit the entire project for advanced features just like these and
 * move them to More as well, so it is hidden by default and it doesn't
 * cause frustration and decision paralysis to users." - the maintainer.
 *
 * Folding an advanced card away must never lose it. So every page's More
 * settings (AdvancedPageSection), in every frontend:
 *
 *   - names, folded, the cards it holds (its `items`): the header lists
 *     them, and draws the ones in force as chips, so nobody has to open a
 *     fold to learn what is in it or whether anything in it applies;
 *   - is opened, at the card, by a link that names a card's place after the
 *     page's "#" - and a suite proves it: the page is rendered at such a
 *     link and the fold is open. MoreSettingsOneCard does so for every page
 *     it holds (each name its folded header lists, with and without rows);
 *     a few pages have suites of their own.
 *
 * A new fold - or a page that moves a card into one - is listed here with
 * the suite that opens it at a place, or this fails.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

// Where a frontend's source is, and the ee/ halves of the Dashboards.
const SOURCE_ROOTS: Array<string> = [
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

const SUITES_DIR: string = "packages/Common/Tests/App/Dashboard";

// A run of spaces, tabs and line breaks.
const WHITESPACE_RUN: RegExp = /\s+/;

interface Coverage {
  /*
   * The suites, in Tests/App/Dashboard, that render the fold's page and
   * open it at a place.
   */
  suites: Array<string>;
  /*
   * What each suite imports to draw it: the page's module path, or - for a
   * fold a component draws on many pages - a page that draws it.
   */
  drawnBy: string;
}

const MORE_SETTINGS_ONE_CARD: string = "MoreSettingsOneCard.test.tsx";

/*
 * Every file that draws a More settings fold, and the suites that open it
 * at a place.
 */
const COVERED: Record<string, Coverage> = {
  "packages/App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiSettingsPage.tsx":
    {
      suites: [MORE_SETTINGS_ONE_CARD],
      drawnBy: "Pages/Profiles/AI/Settings",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/TelemetryResource/TelemetryResourceMoreSettings.tsx":
    {
      suites: [MORE_SETTINGS_ONE_CARD, "TelemetryRetentionShells.test.tsx"],
      drawnBy: "Pages/Host/View/Settings",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertAISettings.tsx":
    {
      suites: [MORE_SETTINGS_ONE_CARD],
      drawnBy: "Pages/Alerts/Settings/AlertAISettings",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/Code/Repository/Settings.tsx": {
    suites: ["CodeRepositorySettingsPage.test.tsx"],
    drawnBy: "Pages/Code/Repository/Settings",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Sharing.tsx": {
    suites: [MORE_SETTINGS_ONE_CARD],
    drawnBy: "Pages/Dashboards/View/Sharing",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Forms/View/Share.tsx": {
    suites: [MORE_SETTINGS_ONE_CARD, "FormsPages.test.tsx"],
    drawnBy: "Pages/Forms/View/Share",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings.tsx":
    {
      suites: [MORE_SETTINGS_ONE_CARD],
      drawnBy: "Pages/Incidents/Settings/IncidentAISettings",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Escalation.tsx":
    {
      suites: ["AcknowledgementTimeoutEscalationPage.test.tsx"],
      drawnBy: "Pages/OnCallDuty/OnCallDutyPolicy/Escalation",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/Rum/View/Settings.tsx": {
    suites: [MORE_SETTINGS_ONE_CARD, "TelemetryRetentionShells.test.tsx"],
    drawnBy: "Pages/Rum/View/Settings",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures.tsx": {
    suites: [MORE_SETTINGS_ONE_CARD],
    drawnBy: "Pages/Settings/AIFeatures",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/APIKeyView.tsx": {
    suites: [MORE_SETTINGS_ONE_CARD, "ApiKeyViewCommunityCustomRoles.test.tsx"],
    drawnBy: "Pages/Settings/APIKeyView",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/NotificationSettings.tsx":
    {
      suites: [
        MORE_SETTINGS_ONE_CARD,
        "NotificationSettingsOwnSenders.test.tsx",
      ],
      drawnBy: "Pages/Settings/NotificationSettings",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/TelemetrySettings.tsx":
    {
      suites: [MORE_SETTINGS_ONE_CARD, "TelemetryRetentionShells.test.tsx"],
      drawnBy: "Pages/Settings/TelemetrySettings",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/AuthenticationSettings.tsx":
    {
      suites: [MORE_SETTINGS_ONE_CARD, "StatusPageAccessPage.test.tsx"],
      drawnBy: "Pages/StatusPages/View/AuthenticationSettings",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Branding.tsx": {
    suites: [MORE_SETTINGS_ONE_CARD],
    drawnBy: "Pages/StatusPages/View/Branding",
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/EmbeddedStatus.tsx":
    {
      suites: [MORE_SETTINGS_ONE_CARD],
      drawnBy: "Pages/StatusPages/View/EmbeddedStatus",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/StatusPageSettings.tsx":
    {
      suites: [
        MORE_SETTINGS_ONE_CARD,
        "StatusPageAdvancedSettingsPage.test.tsx",
      ],
      drawnBy: "Pages/StatusPages/View/StatusPageSettings",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SubscriberSettings.tsx":
    {
      suites: ["StatusPageSubscriberSettingsPages.test.tsx"],
      drawnBy: "Pages/StatusPages/View/SubscriberSettings",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/Teams/View/Permissions.tsx": {
    suites: [MORE_SETTINGS_ONE_CARD, "TeamViewPermissions.test.tsx"],
    drawnBy: "Pages/Teams/View/Permissions",
  },
};

interface Fold {
  // Repository-relative, with "/" separators.
  file: string;
  line: number;
  attributes: Map<string, ts.JsxAttribute>;
}

function sourceFiles(root: string): Array<string> {
  const absolute: string = path.join(REPOSITORY_ROOT, root);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const found: Array<string> = [];
  const visit: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "Tests") {
        continue;
      }

      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.name.endsWith(".tsx")) {
        found.push(full);
      }
    }
  };

  visit(absolute);

  return found;
}

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

// Every <AdvancedPageSection> in the product's source.
function findFolds(): Array<Fold> {
  const folds: Array<Fold> = [];

  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(root)) {
      const text: string = fs.readFileSync(file, "utf8");

      if (!text.includes("<AdvancedPageSection")) {
        continue;
      }

      const source: ts.SourceFile = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          tagName(node) === "AdvancedPageSection"
        ) {
          const attributes: Map<string, ts.JsxAttribute> = new Map<
            string,
            ts.JsxAttribute
          >();

          for (const property of node.attributes.properties) {
            if (ts.isJsxAttribute(property)) {
              attributes.set(property.name.getText(), property);
            }
          }

          folds.push({
            file: path
              .relative(REPOSITORY_ROOT, file)
              .split(path.sep)
              .join("/"),
            line:
              source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            attributes: attributes,
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(source);
    }
  }

  return folds;
}

const FOLDS: Array<Fold> = findFolds();

const isEePresent: boolean = fs.existsSync(path.join(REPOSITORY_ROOT, "ee"));

describe("every More settings fold", () => {
  test("is found where it is drawn: the Dashboard has them", () => {
    expect(FOLDS.length).toBeGreaterThanOrEqual(19);
  });

  test("names, folded, the cards it holds: its items", () => {
    const unnamed: Array<string> = FOLDS.filter((fold: Fold): boolean => {
      const items: ts.JsxAttribute | undefined = fold.attributes.get("items");

      if (!items || !items.initializer) {
        return true;
      }

      // An empty list names nothing.
      const expression: ts.Expression | undefined = ts.isJsxExpression(
        items.initializer,
      )
        ? items.initializer.expression
        : undefined;

      return Boolean(
        expression &&
          ts.isArrayLiteralExpression(expression) &&
          expression.elements.length === 0,
      );
    }).map((fold: Fold): string => {
      return `${fold.file}:${fold.line}`;
    });

    expect(unnamed).toEqual([]);
  });

  test("has a test id of its own, so its suite can find it among the page's cards", () => {
    const anonymous: Array<string> = FOLDS.filter((fold: Fold): boolean => {
      return !fold.attributes.has("dataTestId");
    }).map((fold: Fold): string => {
      return `${fold.file}:${fold.line}`;
    });

    expect(anonymous).toEqual([]);
  });

  test("is listed with the suites that open it at a place", () => {
    const unlisted: Array<string> = FOLDS.filter((fold: Fold): boolean => {
      return !COVERED[fold.file];
    }).map((fold: Fold): string => {
      return `${fold.file}:${fold.line}`;
    });

    /*
     * List the new fold in COVERED, with a suite that renders its page at
     * "#<a card's place>" and finds the fold open - or add the page to
     * MoreSettingsOneCard's pages, which does that for each name its
     * folded header lists.
     */
    expect(unlisted).toEqual([]);
  });

  test("each file listed still draws one: nothing listed is stale", () => {
    const drawn: Set<string> = new Set<string>(
      FOLDS.map((fold: Fold): string => {
        return fold.file;
      }),
    );

    const stale: Array<string> = Object.keys(COVERED).filter(
      (file: string): boolean => {
        // CI's Common job deletes ee/.
        if (file.startsWith("ee/") && !isEePresent) {
          return false;
        }

        return !drawn.has(file);
      },
    );

    expect(stale).toEqual([]);
  });
});

describe.each(Object.entries(COVERED))(
  "%s: the suites that reach it",
  (file: string, coverage: Coverage) => {
    test.each(coverage.suites)(
      "%s draws it and opens it at a place",
      (suite: string) => {
        const suitePath: string = path.join(REPOSITORY_ROOT, SUITES_DIR, suite);

        expect([file, suite, fs.existsSync(suitePath)]).toEqual([
          file,
          suite,
          true,
        ]);

        // Read as one line: a long call is wrapped over several.
        const text: string = fs
          .readFileSync(suitePath, "utf8")
          .split(WHITESPACE_RUN)
          .join(" ");

        // It draws the page.
        expect([suite, text.includes(coverage.drawnBy)]).toEqual([suite, true]);

        /*
         * It opens the page at a place after its "#", and finds the fold
         * open: a link to a card in it never lands on a folded page.
         */
        expect([suite, text.includes('"aria-expanded", "true"')]).toEqual([
          suite,
          true,
        ]);
        expect([
          suite,
          text.includes("#${") || text.includes('replaceState(null, "", "#'),
        ]).toEqual([suite, true]);
      },
    );
  },
);
