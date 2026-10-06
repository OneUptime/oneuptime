import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * LOW-BALANCE MESSAGES SAY WHO CAN ADD BALANCE - EVERYWHERE, AND FOR GOOD.
 *
 * A project's balance for SMS, calls, WhatsApp and Telegram, and its AI
 * credits, can only be added to by a project owner or someone with Manage
 * Billing. Every message that said one ran low used to tell its reader to
 * recharge ("Your SMS balance is low. Please recharge your SMS balance in
 * Project Settings > Notification Settings.", "Insufficient AI balance.
 * Please recharge...", "Please enable auto recharge or recharge manually"),
 * and the AI agent pages linked a project admin - who may not - to AI
 * Credits. They now name who can, from one wording
 * (Common/Utils/Project/ProjectBalance), and link only for those people.
 *
 * This keeps it that way across the server, the Notification service and
 * the dashboard (and the Enterprise Edition, where present):
 *
 * - no user-facing string tells its reader to recharge, or offers
 *   auto-recharge as the way out of used-up AI credits (it is not one);
 * - every refusal and every not-sent log uses the shared wording;
 * - every dashboard place that links to the balance pages, or recharges,
 *   asks whether the reader may add balance first.
 *
 * String literals are read with the TypeScript scanner, so a comment that
 * quotes an old message does not count, and a sentence split over a
 * template literal does.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../..");
const REPO_ROOT: string = path.resolve(PACKAGES_ROOT, "..");

function read(relativeToPackages: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativeToPackages), "utf8");
}

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
  ".claude",
];

function sourceFilesUnder(root: string): Array<string> {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full: string = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...sourceFilesUnder(full));
      }
      continue;
    }

    if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(full);
    }
  }

  return files;
}

// Every user-facing text a file holds: its string and template literals.
function stringsIn(file: string): Array<string> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const strings: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node)
    ) {
      strings.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      // The sentence as a reader sees it, with a placeholder per value.
      strings.push(
        node.head.text +
          node.templateSpans
            .map((span: ts.TemplateSpan): string => {
              return `{value}${span.literal.text}`;
            })
            .join(""),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return strings;
}

const SCANNED_ROOTS: Array<string> = [
  path.join(PACKAGES_ROOT, "Common", "Server"),
  path.join(PACKAGES_ROOT, "Common", "Utils"),
  path.join(PACKAGES_ROOT, "Common", "Types"),
  path.join(PACKAGES_ROOT, "Common", "UI"),
  path.join(PACKAGES_ROOT, "App", "FeatureSet", "Notification"),
  path.join(PACKAGES_ROOT, "App", "FeatureSet", "Workers"),
  path.join(PACKAGES_ROOT, "App", "FeatureSet", "Dashboard", "src"),
  path.join(PACKAGES_ROOT, "App", "FeatureSet", "StatusPage", "src"),
  path.join(REPO_ROOT, "ee", "Server"),
  path.join(REPO_ROOT, "ee", "Dashboard"),
];

/*
 * Wordings that tell whoever reads them to recharge, or send them to
 * auto-recharge as the cure for used-up AI credits - the old messages and
 * their shapes. Not every "recharge": the owners' email saying "We have
 * tried to recharge your balance" narrates what OneUptime did, and the
 * Auto Recharge form says what its fields do.
 */
const TELLS_EVERYONE_TO_RECHARGE: Array<RegExp> = [
  /please recharge/i,
  /\byour (SMS|WhatsApp|notification|AI) balance is low\b/i,
  /recharge manually/i,
  /\bRecharge (it|your [A-Za-z]+ balance) in\b/,
  /Insufficient AI balance\./,
  /\(or enable auto-recharge\)/i,
  /, or turn on auto-recharge\./i,
  /does not have enough (SMS |Call )?balance/i,
];

describe("no user-facing string tells its reader to recharge", () => {
  const files: Array<string> = SCANNED_ROOTS.flatMap(sourceFilesUnder);

  test("the scan reads the server, the Notification service and the dashboard", () => {
    expect(files.length).toBeGreaterThan(500);

    for (const expected of [
      "Common/Server/Services/UserSmsService.ts",
      "Common/Server/Services/AIService.ts",
      "App/FeatureSet/Notification/Services/SmsService.ts",
      "App/FeatureSet/Dashboard/src/Pages/Settings/NotificationSettings.tsx",
    ]) {
      expect(files).toContain(path.join(PACKAGES_ROOT, expected));
    }
  });

  test("none of them, anywhere", () => {
    const offenders: Array<string> = [];

    for (const file of files) {
      for (const text of stringsIn(file)) {
        for (const pattern of TELLS_EVERYONE_TO_RECHARGE) {
          if (pattern.test(text)) {
            offenders.push(
              `${path.relative(REPO_ROOT, file)}: "${text.slice(0, 120)}"`,
            );
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("the server's refusals use the shared wording", () => {
  const METHOD_SERVICES: Array<[string, string]> = [
    ["UserSmsService.ts", "getProjectBalanceTooLowMessage("],
    ["UserCallService.ts", "getProjectBalanceTooLowMessage("],
    ["UserWhatsAppService.ts", "getProjectBalanceTooLowMessage("],
    ["UserTelegramService.ts", "getProjectBalanceTooLowMessage("],
    [
      "UserIncomingCallNumberService.ts",
      "INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE",
    ],
  ];

  test.each(METHOD_SERVICES)(
    "%s: every low-balance check throws the who-can-add message",
    (file: string, wording: string) => {
      const source: string = read(`Common/Server/Services/${file}`);
      const checks: number =
        source.split("smsOrCallCurrentBalanceInUSDCents as number) <= 100")
          .length - 1;
      // Uses outside the import: each one a refusal.
      const refusals: number = source
        .split("\n")
        .filter((line: string): boolean => {
          return !line.startsWith("import ") && line.includes(wording);
        }).length;

      expect(checks).toBeGreaterThan(0);
      expect(refusals).toBe(checks);
    },
  );

  test("the AI call refusal and its AI Logs row use the shared wording", () => {
    const source: string = read("Common/Server/Services/AIService.ts");

    expect(source).toContain(
      "logEntry.statusMessage = PROJECT_AI_CREDITS_USED_UP_MESSAGE;",
    );
    expect(source).toContain(
      "throw new BadDataException(PROJECT_AI_CREDITS_USED_UP_MESSAGE);",
    );
  });

  test("the AI gaps' next step is the shared who-can sentence", () => {
    expect(
      read("Common/Server/Services/KubernetesClusterAiAccessService.ts"),
    ).toContain(
      "export const AI_BALANCE_INSUFFICIENT_NEXT_STEP: string =\n  getProjectBalanceWhoCanAddSentence(ProjectBalanceType.AI);",
    );
  });
});

describe("a message not sent for want of balance", () => {
  test.each([
    ["SmsService.ts", "SmsStatus.LowBalance"],
    ["CallService.ts", "CallStatus.LowBalance"],
    ["WhatsAppService.ts", "WhatsAppStatus.LowBalance"],
    ["TelegramService.ts", "TelegramStatus.LowBalance"],
  ])(
    "%s: one low-balance branch, its log says who can add balance, its owners' email links to the page",
    (file: string, status: string) => {
      const source: string = read(`App/FeatureSet/Notification/Services/${file}`);

      expect(source.split(`.status = ${status};`).length - 1).toBe(1);
      expect(
        source.split("getProjectBalanceMessageNotSentReason(").length - 1,
      ).toBe(1);
      expect(source.split("ProjectBalanceOwnerNotice.getHtml(").length - 1).toBe(
        1,
      );
      expect(
        source.split("getProjectBalanceShortfallSentence(").length - 1,
      ).toBe(1);
    },
  );
});

describe("the dashboard links to the balance pages, and recharges, only for people who may", () => {
  const DASHBOARD: string = path.join(
    PACKAGES_ROOT,
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
  );

  /*
   * Where a balance page is a destination for everyone who can see the
   * settings: the routes, the menu, the breadcrumbs and the page search.
   * A link from a message, or the Recharge button, is not.
   */
  const NAVIGATION: Array<string> = [
    "Utils/RouteMap.ts",
    "Utils/PageMap.ts",
    "Routes/SettingsRoutes.tsx",
    "Pages/Settings/SideMenu.tsx",
    "Utils/Breadcrumbs/SettingsBreadcrumbs.ts",
    "Components/CommandPalette/PageSearchIndex.ts",
  ];

  const ASKS_FIRST: RegExp =
    /getProjectBalanceAccess\(|PROJECT_BALANCE_RECHARGE_PERMISSIONS|getRechargeBalanceButtons\(/;

  const files: Array<string> = sourceFilesUnder(DASHBOARD).filter(
    (file: string): boolean => {
      return !NAVIGATION.includes(path.relative(DASHBOARD, file));
    },
  );

  test("every link to AI Credits, and every recharge, asks first", () => {
    const unguarded: Array<string> = [];
    let found: number = 0;

    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");

      if (
        source.includes("PageMap.SETTINGS_AI_CREDITS") ||
        source.includes('"/notification/recharge"') ||
        source.includes('"/ai/recharge"')
      ) {
        found++;

        if (!ASKS_FIRST.test(source)) {
          unguarded.push(path.relative(DASHBOARD, file));
        }
      }
    }

    // The two balance pages, both AI agent pages and the AI card.
    expect(found).toBeGreaterThanOrEqual(5);
    expect(unguarded).toEqual([]);
  });

  test("no AI credits step sends the reader to a project admin", () => {
    for (const file of [
      "Components/ResourceAiAgent/ResourceAiAgentPage.tsx",
      "Pages/Kubernetes/View/AI/Agent.tsx",
    ]) {
      const source: string = fs.readFileSync(path.join(DASHBOARD, file), "utf8");
      const step: string = source.slice(
        source.indexOf('case "open_ai_credits":'),
      );
      const nextCase: number = step.indexOf("case ", 10);
      const block: string = step.slice(0, nextCase > 0 ? nextCase : undefined);

      expect(block).toContain("ProjectBalanceAccess.Yes");
      expect(block).toContain("ProjectBalanceAccess.No");
      expect(block).toContain("WHO_CAN_ADD_AI_CREDITS");
      expect(block).not.toContain("renderAsk()");
      expect(block).not.toContain("canChangeProjectSettings");
    }
  });
});
