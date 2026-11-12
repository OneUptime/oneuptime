import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * EVERY READER OF A SAMPLE PROJECT'S FLAG, LISTED (issue #6808).
 *
 * A sample project (Project.isSampleProject) can never notify anyone, never
 * be public and never be billed. That holds only while every place that
 * would notify, publish or bill asks the flag - so this guard lists them,
 * and fails when one stops asking, or when a new one appears that does not:
 *
 *   - every sender that hands a message to the Notification service (a
 *     `new Route("/api/notification/...")`), and the push sender, refuses a
 *     sample through BlockedProjectNotifications.getRefusal - a new channel
 *     that posts there without it fails here;
 *   - BlockedProjectNotifications asks isSampleProject, for getRefusal and
 *     for the workspace posts and direct messages (getSilencedReason);
 *   - wherever the probes' raw SQL leaves a blocked project out
 *     (`p."isBlocked" = false`), it leaves a sample out on the next line;
 *   - every analytics table is emptied when a sample is deleted;
 *   - and the named readers below each still read the flag.
 *
 * Behaviour is tested beside each reader; this holds the list together.
 * ---------------------------------------------------------------------------
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../../..");
const COMMON: string = path.join(REPO_ROOT, "packages", "Common");
const APP: string = path.join(REPO_ROOT, "packages", "App");
const EE: string = path.join(REPO_ROOT, "ee");

const read: (file: string) => string = (file: string): string => {
  return fs.readFileSync(file, "utf8");
};

// Code only: a comment may name the flag without reading it.
const stripComments: (text: string) => string = (text: string): string => {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
};

const listFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "build") {
        continue;
      }

      files.push(...listFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }

  return files;
};

interface Reader {
  // Relative to the repository root.
  file: string;
  // What it keeps from a sample, in a few words.
  keeps: string;
  // What its code must say.
  reads: RegExp;
}

/*
 * THE READERS. A new one goes here with what it keeps a sample from, and
 * its own behaviour test beside it.
 */
const READERS: ReadonlyArray<Reader> = [
  // Notifications.
  {
    file: "packages/Common/Server/Utils/Notification/BlockedProjectNotifications.ts",
    keeps: "every sender's refusal and every workspace post",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Utils/Workspace/Workspace.ts",
    keeps: "Slack, Microsoft Teams and Mattermost channel posts",
    reads: /BlockedProjectNotifications\.getSilencedReason\(/,
  },
  {
    file: "packages/Common/Server/Services/WorkspaceUserNotificationService.ts",
    keeps: "workspace direct messages",
    reads: /BlockedProjectNotifications\.getSilencedReason\(/,
  },
  {
    file: "packages/Common/Server/Services/WorkspaceNotificationSummaryService.ts",
    keeps: "workspace summaries",
    reads: /BlockedProjectNotifications\.getSilencedReason\(/,
  },
  {
    file: "packages/Common/Server/Services/MailService.ts",
    keeps: "email to a sample person's address",
    reads: /isSamplePersonEmail\(/,
  },
  {
    file: "packages/Common/Server/Services/OnCallTestPageService.ts",
    keeps: "test pages",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Services/WorkspaceProjectAuthTokenService.ts",
    keeps: "workspace connections",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Services/TeamMemberService.ts",
    keeps: "invitations, and sample people in other projects",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/App/FeatureSet/Workflow/Services/QueueWorkflow.ts",
    keeps: "workflow runs (email, chat, webhooks, any address)",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/App/FeatureSet/Workflow/Services/RunWorkflow.ts",
    keeps: "workflow runs that got past the queue",
    reads: /ProjectService\.isSampleProject\(/,
  },
  // Public pages.
  {
    file: "packages/Common/Server/Utils/StatusPage/SampleProjectStatusPages.ts",
    keeps: "the public status page",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Utils/StatusPage/BlockedProjectStatusPages.ts",
    keeps: "every public status page route",
    reads: /SampleProjectStatusPages\.getReadAccess\(/,
  },
  {
    file: "packages/Common/Server/Services/StatusPageService.ts",
    keeps: "status page reads",
    reads: /SampleProjectStatusPages\.getReadAccess\(/,
  },
  {
    file: "packages/Common/Server/Services/StatusPageDomainService.ts",
    keeps: "custom status page domains",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Services/DashboardService.ts",
    keeps: "public dashboard links",
    reads: /ProjectService\.isSampleProject\(/,
  },
  // Billing, plan limits and usage.
  {
    file: "packages/Common/Server/Services/ProjectService.ts",
    keeps:
      "the plan, the payment customer and subscription, the operator's notices",
    reads: /isSampleProject/,
  },
  {
    file: "packages/Common/Server/Types/Billing/MeteredPlan/ActiveMonitoringMeteredPlan.ts",
    keeps: "the active monitors meter",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Types/Billing/MeteredPlan/TelemetryMeteredPlan.ts",
    keeps: "the telemetry meter",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Types/Billing/MeteredPlan/WatchedTableMeteredPlan.ts",
    keeps: "the watched tables meter",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Utils/TelemetryUsage/TelemetryUsageMeter.ts",
    keeps: "the usage meter of a server with billing off",
    reads: /isSampleProject:\s*false/,
  },
  {
    file: "packages/Common/Server/Utils/TelemetryUsage/TelemetryUsageReads.ts",
    keeps: "the instance's telemetry usage (Admin Dashboard)",
    reads: /p\."isSampleProject" = false/,
  },
  {
    file: "packages/Common/Server/Services/TelemetryIngestionKeyService.ts",
    keeps: "telemetry ingestion",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Services/AIService.ts",
    keeps: "OneUptime AI, which costs money",
    reads: /isSampleProject === true/,
  },
  {
    file: "packages/Common/Server/Services/MonitorService.ts",
    keeps: "new monitors, which would never be checked",
    reads: /ProjectService\.isSampleProject\(/,
  },
  // Monitoring.
  {
    file: "packages/Common/Server/Utils/Monitor/MonitorResource.ts",
    keeps: "monitor results",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts",
    keeps: "the telemetry monitors' sweep",
    reads: /isSampleProject:\s*false/,
  },
  // Activation, feedback and setup.
  {
    file: "packages/Common/Server/Services/ProjectMilestoneService.ts",
    keeps: "activation milestones",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/UI/Utils/ProductEvents.ts",
    keeps: "the Dashboard's product events",
    reads: /isSampleProject === true/,
  },
  {
    file: "packages/Common/Server/Services/ProductFeedbackService.ts",
    keeps: "feedback questions",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Services/WelcomeChecklistService.ts",
    keeps: "the Welcome checklist",
    reads: /ProjectService\.isSampleProject\(/,
  },
  {
    file: "packages/Common/Server/Services/SetupHealthService.ts",
    keeps: "setup health findings",
    reads: /ProjectService\.isSampleProject\(/,
  },
  // Leaving nothing behind.
  {
    file: "packages/Common/Server/Utils/SampleProject/SampleProjectAnalyticsData.ts",
    keeps: "rows in the analytics database",
    reads: /deleteBy\(/,
  },
];

// The people counted on the server: a sample person is nobody (ee/, when present).
const USER_COUNTERS: ReadonlyArray<string> = [
  "ee/Server/License/LicenseProvider.ts",
  "ee/Server/License/Jobs/ReportUserCount.ts",
  "ee/Server/Marketplace/MarketplaceUsageRun.ts",
];

describe("SampleProjectReadersGuard", () => {
  test.each(READERS)("$file reads the flag: $keeps", (reader: Reader) => {
    const code: string = stripComments(read(path.join(REPO_ROOT, reader.file)));

    expect(code).toMatch(reader.reads);
  });

  test("every sender to the Notification service refuses a sample (getRefusal)", () => {
    const senders: Array<string> = listFiles(
      path.join(COMMON, "Server", "Services"),
    ).filter((file: string): boolean => {
      const code: string = stripComments(read(file));
      return (
        /new Route\(\s*"\/api\/notification\/[a-z-]+\/(send|make-call)"/.test(
          code,
        ) || path.basename(file) === "PushNotificationService.ts"
      );
    });

    // Email, SMS, call, WhatsApp, Telegram, webhook, custom channel, push.
    expect(senders.length).toBeGreaterThanOrEqual(8);

    for (const sender of senders) {
      expect({
        sender: path.relative(REPO_ROOT, sender),
        refuses: /BlockedProjectNotifications\.getRefusal\(/.test(
          stripComments(read(sender)),
        ),
      }).toEqual({ sender: path.relative(REPO_ROOT, sender), refuses: true });
    }
  });

  test("getRefusal asks the same reasons as the workspace posts", () => {
    const code: string = stripComments(
      read(
        path.join(
          COMMON,
          "Server/Utils/Notification/BlockedProjectNotifications.ts",
        ),
      ),
    );

    const getRefusal: string = code.slice(
      code.indexOf("public static async getRefusal("),
    );

    expect(getRefusal).toMatch(/getSilencedReason\(/);
    expect(code).toMatch(/BlockedProjectNotifications\.isSample\(/);
  });

  test("wherever a probe leaves a blocked project out, it leaves a sample out", () => {
    const files: Array<string> = listFiles(path.join(COMMON, "Server"));
    let claims: number = 0;

    for (const file of files) {
      const lines: Array<string> = read(file).split("\n");

      lines.forEach((line: string, index: number) => {
        if (!/p\."isBlocked" = false/.test(line)) {
          return;
        }

        claims++;

        expect({
          file: path.relative(REPO_ROOT, file),
          line: index + 1,
          next: (lines[index + 1] || "").trim(),
        }).toEqual({
          file: path.relative(REPO_ROOT, file),
          line: index + 1,
          next: 'AND p."isSampleProject" = false',
        });
      });
    }

    // MonitorProbeService, network devices, VMware, OpenStack twice, data observability and security.
    expect(claims).toBeGreaterThanOrEqual(7);
  });

  test("the query every monitoring path reads leaves a sample out", () => {
    const code: string = stripComments(
      read(path.join(COMMON, "Server/Services/ProjectService.ts")),
    );
    const query: string = code.slice(
      code.indexOf("public getActiveProjectStatusQuery()"),
    );
    const body: string = query.slice(0, query.indexOf("\n  }\n"));

    expect(body).toMatch(/isBlocked: false/);
    expect(body).toMatch(/isSampleProject: false/);
  });

  test("a deleted sample's rows are deleted from every analytics table", () => {
    // The services an array literal names, read from the code.
    const namesIn: (code: string, arrayStart: string) => Array<string> = (
      code: string,
      arrayStart: string,
    ): Array<string> => {
      const from: string = code.slice(code.indexOf(arrayStart));
      const opensAt: number = from.indexOf("= [") + 3;
      const body: string = from.slice(
        opensAt,
        opensAt + from.slice(opensAt).search(/\]\s*(as\b|;)/),
      );

      return (stripComments(body).match(/[A-Za-z0-9]+Service\b/g) || []).sort();
    };

    const everyTable: Array<string> = namesIn(
      read(path.join(COMMON, "Server/Services/Index.ts")),
      "export const AnalyticsServices",
    );
    const deleted: Array<string> = namesIn(
      read(
        path.join(
          COMMON,
          "Server/Utils/SampleProject/SampleProjectAnalyticsData.ts",
        ),
      ),
      "export const SAMPLE_PROJECT_ANALYTICS_SERVICES",
    );

    expect(everyTable.length).toBeGreaterThanOrEqual(30);
    expect(deleted).toEqual(everyTable);
  });

  test("the server's counts of people leave sample people out", () => {
    for (const counter of USER_COUNTERS) {
      const file: string = path.join(REPO_ROOT, counter);

      // ee/ is moved aside in some CI layouts: nothing to read then.
      if (!fs.existsSync(EE) || !fs.existsSync(file)) {
        continue;
      }

      expect({
        counter: counter,
        leavesOutSamplePeople:
          /sampleProjectId:\s*QueryHelper\.isNull\(\)/.test(
            stripComments(read(file)),
          ),
      }).toEqual({ counter: counter, leavesOutSamplePeople: true });
    }
  });

  test("the list names files that exist", () => {
    for (const reader of READERS) {
      expect(fs.existsSync(path.join(REPO_ROOT, reader.file))).toBe(true);
    }

    expect(fs.existsSync(APP)).toBe(true);
  });
});
