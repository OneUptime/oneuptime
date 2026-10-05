import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY STATUS PAGE EMAIL TAKES ITS LOGO FROM StatusPageEmailLogo.
 *
 * An email shows a status page's logo by its address on the page's logo
 * route, which serves only a logo of the page's own project. An email that
 * built the address from logoFileId alone would show a broken image for a
 * logo the route does not serve. So, across the server code:
 *
 *   - no file but StatusPageEmailLogo builds a /logo/<page> address;
 *   - every `logoUrl` an email is given comes from
 *     StatusPageEmailLogo.getLogoUrl;
 *   - every file that calls it reads its pages with the logo's project:
 *     with STATUS_PAGE_EMAIL_LOGO_SELECT, or through
 *     getStatusPagesToSendNotification, which selects it.
 */

// packages/Common/Tests/Server/Utils/StatusPage -> packages/Common.
const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
// packages/Common -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");

const SCAN_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, "packages", "Common", "Server"),
  path.join(REPOSITORY_ROOT, "packages", "App", "FeatureSet"),
  path.join(REPOSITORY_ROOT, "ee", "Server"),
];

const HELPER: string =
  "packages/Common/Server/Utils/StatusPage/StatusPageEmailLogo.ts";

// The one call a logoUrl may come from.
const LOGO_CALLS: ReadonlySet<string> = new Set<string>([
  "StatusPageEmailLogo.getLogoUrl",
]);

// How a sender's pages are read with the logo's project.
const PAGE_READS: Array<string> = [
  "STATUS_PAGE_EMAIL_LOGO_SELECT",
  "getStatusPagesToSendNotification(",
  // IncidentStatusPageScope reads its pages with getStatusPagesToSendNotification.
  "IncidentStatusPageScope.resolvePagesForIncidents(",
];

/*
 * Senders handed their pages by a caller: the incident email builder is
 * given pages the subscriber jobs and the preview read with
 * getStatusPagesToSendNotification.
 */
const HANDED_PAGES: Record<string, string> = {
  "packages/Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder.ts":
    "is handed pages read with getStatusPagesToSendNotification",
};

// A /logo/<page> address built in code: `/logo/${...}` or "/logo/" + ...
const LOGO_ADDRESS: RegExp = /\/logo\/\$\{|["'`]\/logo\/["'`]\s*\+/;

function listServerFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "build" ||
      entry.name === "dist" ||
      entry.name === "Tests" ||
      // A frontend's src/ runs in the browser, not in a sender.
      entry.name === "src"
    ) {
      continue;
    }

    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listServerFiles(entryPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

function toRelativePath(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

interface LogoUrl {
  file: string;
  line: number;
  value: string;
  fromHelper: boolean;
}

// `file` is the path relative to the repository root.
function logoUrlsOf(file: string, text: string): Array<LogoUrl> {
  if (!text.includes("logoUrl")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const found: Array<LogoUrl> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "logoUrl"
    ) {
      const initializer: ts.Expression = node.initializer;

      found.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        value: initializer.getText(source).replace(/\s+/g, " "),
        fromHelper:
          ts.isCallExpression(initializer) &&
          LOGO_CALLS.has(initializer.expression.getText(source)),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

const FILES: Array<{ file: string; text: string }> = SCAN_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listServerFiles(root);
  },
).map((file: string): { file: string; text: string } => {
  return { file: toRelativePath(file), text: fs.readFileSync(file, "utf8") };
});

const LOGO_URLS: Array<LogoUrl> = FILES.flatMap(
  (entry: { file: string; text: string }): Array<LogoUrl> => {
    return logoUrlsOf(entry.file, entry.text);
  },
);

describe("every status page email takes its logo from StatusPageEmailLogo", () => {
  test("finds the emails that show a status page's logo", () => {
    const senders: Array<string> = Array.from(
      new Set(
        LOGO_URLS.map((logoUrl: LogoUrl): string => {
          return logoUrl.file;
        }),
      ),
    );

    expect(senders).toEqual(
      expect.arrayContaining([
        "packages/App/FeatureSet/Identity/API/StatusPageAuthentication.ts",
        "packages/App/FeatureSet/Workers/Jobs/Announcement/SendNotificationToSubscribers.ts",
        "packages/App/FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts",
        "packages/App/FeatureSet/Workers/Jobs/IncidentEpisode/SendNotificationToSubscribers.ts",
        "packages/App/FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
        "packages/App/FeatureSet/Workers/Jobs/IncidentEpisodeStateTimeline/SendNotificationToSubscribers.ts",
        "packages/App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
        "packages/App/FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
        "packages/App/FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts",
        "packages/Common/Server/API/StatusPageAPI.ts",
        "packages/Common/Server/Services/ScheduledMaintenanceService.ts",
        "packages/Common/Server/Services/StatusPagePrivateUserService.ts",
        "packages/Common/Server/Services/StatusPageService.ts",
        "packages/Common/Server/Services/StatusPageSubscriberService.ts",
        "packages/Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder.ts",
      ]),
    );
  });

  test("no file but StatusPageEmailLogo builds a logo address", () => {
    expect(
      FILES.filter((entry: { file: string; text: string }): boolean => {
        return entry.file !== HELPER && LOGO_ADDRESS.test(entry.text);
      }).map((entry: { file: string }): string => {
        return entry.file;
      }),
    ).toEqual([]);

    // The helper still builds it, so the pattern still finds what it is for.
    expect(
      LOGO_ADDRESS.test(
        fs.readFileSync(path.join(REPOSITORY_ROOT, HELPER), "utf8"),
      ),
    ).toBe(true);
  });

  test("every logoUrl an email is given comes from StatusPageEmailLogo", () => {
    expect(
      LOGO_URLS.filter((logoUrl: LogoUrl): boolean => {
        return !logoUrl.fromHelper;
      }),
    ).toEqual([]);
  });

  test("every sender reads its pages with the logo's project", () => {
    const senders: Array<string> = Array.from(
      new Set(
        LOGO_URLS.map((logoUrl: LogoUrl): string => {
          return logoUrl.file;
        }),
      ),
    );

    for (const sender of senders) {
      if (HANDED_PAGES[sender]) {
        continue;
      }

      const text: string = (
        FILES.find((entry: { file: string }): boolean => {
          return entry.file === sender;
        }) as { text: string }
      ).text;

      expect({
        sender,
        readsLogoProject: PAGE_READS.some((read: string): boolean => {
          return text.includes(read);
        }),
      }).toEqual({ sender, readsLogoProject: true });
    }
  });

  test("the shared page reads select the logo's project", () => {
    const subscriberService: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/Common/Server/Services/StatusPageSubscriberService.ts",
      ),
      "utf8",
    );

    const notificationRead: string = subscriberService.slice(
      subscriberService.indexOf(
        "public async getStatusPagesToSendNotification(",
      ),
    );

    expect(
      notificationRead.indexOf("...STATUS_PAGE_EMAIL_LOGO_SELECT"),
    ).toBeGreaterThan(-1);
    expect(
      notificationRead.indexOf("...STATUS_PAGE_EMAIL_LOGO_SELECT"),
    ).toBeLessThan(notificationRead.indexOf("smtpConfig: {"));

    expect(
      fs.readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "packages/Common/Server/Utils/StatusPage/IncidentStatusPageScope.ts",
        ),
        "utf8",
      ),
    ).toContain("getStatusPagesToSendNotification(");
  });
});
