// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN ACTION THAT CHANGES SOMETHING SAYS IT WORKED, WITHOUT BLOCKING THE PAGE
 * (#9120).
 *
 * Product-wide there was no toast, so a change that worked either said
 * nothing - a card's edit closed, a row disappeared - or opened a dialog
 * that said so, with one button to click it away: "Saved" / "Runbook steps
 * saved successfully." / Got it, "Success", "Test Notification Sent", "Code
 * sent", "Telegram account verified". About a hundred ConfirmModals had no
 * Cancel, and among the errors and the details people open to read were the
 * ones that only announced success.
 *
 * A success is now a toast (Common/UI/Utils/Toast): it says what happened
 * and goes by itself. A dialog with one way out - a notice, a ConfirmModal
 * without onClose - stays only for what the person must read or act on:
 * what failed and why, a value shown once or to copy into another system,
 * a run's report, details they opened, or why nothing happened. This guard
 * reads every ConfirmModal in every frontend (listScanRoots: each feature
 * set's src, Common's UI, ee/ when the checkout has it) and holds that:
 *
 *   - no ConfirmModal is titled as a success ("Saved", "Success", "Email
 *     Sent", "... verified") unless SUCCESS_TITLE_EXCEPTIONS says why;
 *   - no notice says "successfully";
 *   - every notice is in NOTICES, file by file, with how many the file has
 *     and why each is one the person must read. A file with a new notice
 *     fails: make it a toast, or list it here with its reason. A file that
 *     has fewer than listed fails too, so the list stays true: lower its
 *     count.
 */

// packages/Common/Tests/UI -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// Why a notice stays a dialog: something the person must read or act on.
const WHY: {
  error: string;
  details: string;
  copy: string;
  testRun: string;
  report: string;
  nothingHappened: string;
} = {
  error:
    "What failed and why, with what to do next: the person has to see it to know that what they did did not happen.",
  details:
    "Details the person opened to read: a message, a root cause, a log line, help, a version.",
  copy: "A value shown once, or to copy into another system (a key, a token, an identity provider's URLs).",
  testRun:
    "A test or a run while it goes, then its result in the same place - what it came to, read before going on.",
  report:
    "A run's report: what it changed, what it skipped and what it could not do.",
  nothingHappened:
    "Why nothing happened, and what to do instead (nothing to add, the last criteria, a layer in use).",
};

interface NoticeEntry {
  count: number;
  why: string;
}

/*
 * Every notice - a ConfirmModal with no onClose - by file, as a path from the
 * repository's root.
 */
const NOTICES: Record<string, NoticeEntry> = {
  "packages/App/FeatureSet/AdminDashboard/src/Components/Footer/Footer.tsx": {
    count: 1,
    why: WHY.details,
  },
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/CallAndSmsGatewayCard.tsx":
    { count: 1, why: WHY.testRun },
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Settings/Probes/Index.tsx":
    { count: 1, why: WHY.copy },
  "packages/App/FeatureSet/Dashboard/src/Components/AILogs/LlmLogsTable.tsx": {
    count: 1,
    why: WHY.details,
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Alert/AlertsTable.tsx": {
    count: 1,
    why: WHY.error,
  },
  "packages/App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisodesTable.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementsTable.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/Footer/Footer.tsx": {
    count: 1,
    why: WHY.details,
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilters.tsx":
    { count: 1, why: WHY.nothingHappened },
  "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria.tsx":
    { count: 1, why: WHY.nothingHappened },
  "packages/App/FeatureSet/Dashboard/src/Components/Incident/IncidentsTable.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodesTable.tsx":
    { count: 1, why: WHY.error },
  // Nothing to add yet, what failed, and the add while it runs.
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/AddToDashboardModal.tsx":
    { count: 3, why: WHY.nothingHappened },
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricView.tsx": {
    count: 1,
    why: WHY.nothingHappened,
  },
  // The monitor's new address, to put into whatever sends it email.
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/IncomingEmailMonitor/IncomingEmailAddressSettings.tsx":
    { count: 1, why: WHY.copy },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkAutomation/RunAutoImportRuleModal.tsx":
    { count: 1, why: WHY.report },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkAutomation/RunRuleNowModal.tsx":
    { count: 1, why: WHY.report },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/CallLogsTable.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/EmailLogsTable.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/PushLogsTable.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/SmsLogsTable.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/TelegramLogsTable.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/WebhookLogsTable.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/WhatsAppLogsTable.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/WorkspaceLogsTable.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationMethods/CustomChannels.tsx":
    { count: 1, why: WHY.testRun },
  // Test message not sent: a sent one is a toast.
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationMethods/Mattermost.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationMethods/MicrosoftTeams.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationMethods/Slack.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationMethods/Webhook.tsx":
    { count: 1, why: WHY.testRun },
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTable.tsx":
    { count: 1, why: WHY.error },
  // The policies the person is on call for, which they asked to see.
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CurrentOnCallPolicyModal.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/Layers.tsx":
    { count: 1, why: WHY.nothingHappened },
  // Who the page went to next, or why it went to nobody; and what failed.
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/usePassOnPage.tsx":
    { count: 2, why: WHY.report },
  "packages/App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker.tsx":
    { count: 2, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityCase/useSecurityCaseListActions.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/Sso/ProjectOidcProviders.tsx":
    { count: 1, why: WHY.copy },
  // Reading the device, then what failed.
  "packages/App/FeatureSet/Dashboard/src/Components/Topology/AddNeighborToMonitoringModal.tsx":
    { count: 2, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/User/RemoveUserFromProject.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableTokenRefreshModal.tsx":
    { count: 2, why: WHY.testRun },
  "packages/App/FeatureSet/Dashboard/src/Components/Workspace/SendTestNotificationButton.tsx":
    { count: 1, why: WHY.error },
  // Test Failed: a test that went out is a toast.
  "packages/App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceNotificationRulesTable.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTable.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Pages/Alerts/View/StateTimeline.tsx": {
    count: 1,
    why: WHY.details,
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Dashboards/Settings/DataSourceView.tsx":
    { count: 1, why: WHY.testRun },
  "packages/App/FeatureSet/Dashboard/src/Pages/Dashboards/Settings/DataSources.tsx":
    { count: 1, why: WHY.testRun },
  "packages/App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/DeleteAccount.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Postmortem.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/View/Postmortem.tsx": {
    count: 1,
    why: WHY.error,
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/View/StateTimeline.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbes.tsx":
    { count: 1, why: WHY.copy },
  "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplatesView.tsx":
    { count: 1, why: WHY.report },
  "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/View/StatusTimeline.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView.tsx":
    { count: 1, why: WHY.error },
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/Index.tsx": {
    count: 1,
    why: WHY.error,
  },
  // Could not save: a save that worked is a toast.
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps.tsx": {
    count: 1,
    why: WHY.error,
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/Billing.tsx": {
    count: 1,
    why: WHY.error,
  },
  // What failed, and what happens next with a payment that has not settled.
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/Invoices.tsx": {
    count: 2,
    why: WHY.error,
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/SSO.tsx": {
    count: 1,
    why: WHY.copy,
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Slo/View/Monitors.tsx": {
    count: 1,
    why: WHY.nothingHappened,
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/OIDC.tsx": {
    count: 1,
    why: WHY.copy,
  },
  // Test email report not sent: a sent one is a toast.
  "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Reports.tsx": {
    count: 1,
    why: WHY.error,
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SSO.tsx": {
    count: 1,
    why: WHY.copy,
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallLogs.tsx": {
    count: 1,
    why: WHY.details,
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallLogsTimeline.tsx":
    { count: 1, why: WHY.details },
  "packages/App/FeatureSet/Dashboard/src/Pages/Users/Index.tsx": {
    count: 1,
    why: WHY.error,
  },
  "packages/App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder.tsx": {
    count: 1,
    why: WHY.error,
  },
  // A row action that ran at once and failed (a table draws it, #9513).
  "packages/Common/UI/Components/ActionButton/RowActionDialogs.tsx": {
    count: 1,
    why: WHY.error,
  },
  // A bulk change while it runs, then what it did to each row.
  "packages/Common/UI/Components/BulkUpdate/BulkUpdateForm.tsx": {
    count: 2,
    why: WHY.report,
  },
  "packages/Common/UI/Components/DuplicateModel/DuplicateModel.tsx": {
    count: 1,
    why: WHY.error,
  },
  "packages/Common/UI/Components/ImportExport/ExportModelCard.tsx": {
    count: 1,
    why: WHY.error,
  },
  "packages/Common/UI/Components/ModelDelete/ModelDelete.tsx": {
    count: 1,
    why: WHY.error,
  },
  "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx": {
    count: 1,
    why: WHY.error,
  },
  "packages/Common/UI/Components/ModelTable/TableView.tsx": {
    count: 1,
    why: WHY.error,
  },
  // What failed, and the new value, shown once.
  "packages/Common/UI/Components/ResetObjectID/ResetObjectID.tsx": {
    count: 2,
    why: WHY.copy,
  },
  "packages/Common/UI/Components/RuleRun/RunRuleNowModal.tsx": {
    count: 1,
    why: WHY.report,
  },
  "packages/Common/UI/Components/ShownOnceSecret/ShownOnceSecretModal.tsx": {
    count: 1,
    why: WHY.copy,
  },
  // What failed, and a root cause the person opened.
  "packages/Common/UI/Components/StatusTimeline/ModelStatusTimeline.tsx": {
    count: 2,
    why: WHY.details,
  },
  // Someone else saved the workflow first: which version to keep.
  "packages/Common/UI/Components/Workflow/WorkflowSaveConflictModal.tsx": {
    count: 1,
    why: WHY.error,
  },
  "ee/AdminDashboard/CustomChannels/CustomChannelsSettingsPage.tsx": {
    count: 1,
    why: WHY.testRun,
  },
  "ee/Dashboard/Identity/Components/SCIMLogs/ProjectSCIMLogsTable.tsx": {
    count: 1,
    why: WHY.details,
  },
  "ee/Dashboard/Identity/Components/SCIMLogs/StatusPageSCIMLogsTable.tsx": {
    count: 1,
    why: WHY.details,
  },
  // The SCIM URLs, what failed, and the new bearer token.
  /*
   * The SCIM URLs to copy into the identity provider, and why a reset
   * failed. A new bearer token is shown once by ShownOnceSecretModal
   * (#9012), not by a dialog of the page's own.
   */
  "ee/Dashboard/Identity/Pages/Settings/SCIM.tsx": { count: 2, why: WHY.copy },
  "ee/Dashboard/Identity/Pages/StatusPages/SCIM.tsx": {
    count: 2,
    why: WHY.copy,
  },
};

/*
 * A ConfirmModal titled as a success that stays a dialog, and why. Its
 * literal title, by file.
 */
const SUCCESS_TITLE_EXCEPTIONS: Record<string, string> = {
  /*
   * Says the monitor's new address, which the person puts into whatever
   * sends it email - and that the old one no longer works.
   */
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/IncomingEmailMonitor/IncomingEmailAddressSettings.tsx: Email address updated":
    WHY.copy,
  /*
   * Opened only for a phone, with something to do: how to turn critical
   * alerts on, or where to look when a critical test did not ring through.
   * A browser's test is a toast (Push.tsx, sayTestSent).
   */
  "packages/App/FeatureSet/Dashboard/src/Components/NotificationMethods/Push.tsx: Test Notification Sent":
    "Opened only for a phone, with what to do next: how to turn critical alerts on, or where to look when a critical test did not ring through.",
};

/*
 * A title that says something worked - "Saved", "Success", "Email Sent",
 * "Telegram account verified" - and nothing about it failing. The word is
 * its last: "Delete Saved View" asks about a saved view.
 */
const SUCCESS_TITLE: RegExp =
  /^(saved|success|successful|done)\.?$|\b(saved|sent|placed|updated|verified|created|added|deleted|removed|published|copied|succeeded)\.?$|\bsuccessful(ly)?\b/i;

const FAILURE_WORDS: RegExp =
  /\b(not|failed|fail|error|could|couldn't|cannot|can't|unable|nothing|no)\b/i;

export interface ConfirmModalSite {
  file: string;
  line: number;
  // The element's source, from <ConfirmModal to its end.
  source: string;
  isNotice: boolean;
  // The title, when it is written as a literal.
  literalTitle: string | null;
}

// The element starting at `start`, with its children when it has them.
const readElement: (code: string, start: number) => string = (
  code: string,
  start: number,
): string => {
  let depth: number = 0;

  for (let index: number = start + 1; index < code.length; index++) {
    const character: string = code[index]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
    } else if (depth === 0 && character === "/" && code[index + 1] === ">") {
      return code.slice(start, index + 2);
    } else if (depth === 0 && character === ">") {
      const end: number = code.indexOf("</ConfirmModal>", index);

      return code.slice(start, end < 0 ? code.length : end + 15);
    }
  }

  return code.slice(start);
};

// What may follow <ConfirmModal: not <ConfirmModalSomething.
const TAG_END: RegExp = /[\s/>]/;

// A dialog with a way out: Cancel, the X and Escape.
const ON_CLOSE: RegExp = /\bonClose\s*=/;

const SUCCESSFULLY: RegExp = /\bsuccessfully\b/i;

const TITLE_LITERAL: RegExp =
  /\btitle=(?:"([^"]*)"|\{\s*`([^`$]*)`\s*\}|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\})/;

export const readConfirmModals: (
  file: string,
  code: string,
) => Array<ConfirmModalSite> = (
  file: string,
  code: string,
): Array<ConfirmModalSite> => {
  const sites: Array<ConfirmModalSite> = [];
  let index: number = code.indexOf("<ConfirmModal");

  while (index >= 0) {
    const nextCharacter: string = code[index + "<ConfirmModal".length] || "";

    // <ConfirmModal, not <ConfirmModalSomething.
    if (TAG_END.test(nextCharacter)) {
      const source: string = readElement(code, index);
      const title: RegExpMatchArray | null = source.match(TITLE_LITERAL);

      sites.push({
        file: file,
        line: code.slice(0, index).split("\n").length,
        source: source,
        isNotice: !ON_CLOSE.test(source),
        literalTitle: title
          ? title[1] ?? title[2] ?? title[3] ?? title[4] ?? null
          : null,
      });
    }

    index = code.indexOf("<ConfirmModal", index + 1);
  }

  return sites;
};

export const isSuccessTitle: (title: string) => boolean = (
  title: string,
): boolean => {
  return SUCCESS_TITLE.test(title.trim()) && !FAILURE_WORDS.test(title);
};

const readAllSites: () => Array<ConfirmModalSite> =
  (): Array<ConfirmModalSite> => {
    const sites: Array<ConfirmModalSite> = [];

    for (const root of listScanRoots(REPOSITORY_ROOT)) {
      for (const file of listSourceFiles(root)) {
        if (!file.endsWith(".tsx")) {
          continue;
        }

        const code: string = fs.readFileSync(file, "utf8");

        if (!code.includes("<ConfirmModal")) {
          continue;
        }

        sites.push(
          ...readConfirmModals(toRelativePath(REPOSITORY_ROOT, file), code),
        );
      }
    }

    return sites;
  };

describe("a change that worked says so in a toast, not a dialog", () => {
  const sites: Array<ConfirmModalSite> = readAllSites();

  test("the scan reads every frontend's ConfirmModals", () => {
    // Not vacuous: the product has dozens, notices and confirmations both.
    expect(sites.length).toBeGreaterThan(100);
    expect(
      sites.filter((site: ConfirmModalSite) => {
        return site.isNotice;
      }).length,
    ).toBeGreaterThan(50);

    // The Delete dialog of every list, which asks first: not a notice.
    expect(
      sites.some((site: ConfirmModalSite) => {
        return (
          site.file ===
            "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx" &&
          !site.isNotice
        );
      }),
    ).toBe(true);
  });

  test("no dialog is titled as a success", () => {
    const found: Array<string> = sites
      .filter((site: ConfirmModalSite) => {
        return (
          site.literalTitle !== null &&
          isSuccessTitle(site.literalTitle) &&
          !SUCCESS_TITLE_EXCEPTIONS[`${site.file}: ${site.literalTitle}`]
        );
      })
      .map((site: ConfirmModalSite) => {
        return `${site.file}:${site.line} "${site.literalTitle}": say it with Toast.success (Common/UI/Utils/Toast), which goes by itself.`;
      });

    expect(found).toEqual([]);
  });

  test("no notice says something was done successfully", () => {
    const found: Array<string> = sites
      .filter((site: ConfirmModalSite) => {
        /*
         * A value shown once may say it was made: "Bearer token reset
         * successfully. Copy it now".
         */
        return (
          site.isNotice &&
          SUCCESSFULLY.test(site.source) &&
          NOTICES[site.file]?.why !== WHY.copy
        );
      })
      .map((site: ConfirmModalSite) => {
        return `${site.file}:${site.line}: a notice that says it worked is a toast (Toast.success).`;
      });

    expect(found).toEqual([]);
  });

  test("every notice is one the person must read, and is listed with why", () => {
    const counts: Map<string, number> = new Map<string, number>();

    for (const site of sites) {
      if (site.isNotice) {
        counts.set(site.file, (counts.get(site.file) || 0) + 1);
      }
    }

    const problems: Array<string> = [];

    for (const [file, count] of counts) {
      const entry: NoticeEntry | undefined = NOTICES[file];

      if (!entry) {
        problems.push(
          `${file}: ${count} dialog(s) with only one way out (no onClose). A success is a toast (Toast.success); a dialog stays only for what the person must read or act on. If it is one, list it in NOTICES with its reason.`,
        );
      } else if (count > entry.count) {
        problems.push(
          `${file}: ${count} dialogs with only one way out, ${entry.count} listed. Make the new one a toast, or raise the count with its reason.`,
        );
      } else if (count < entry.count) {
        problems.push(
          `${file}: ${count} dialogs with only one way out, ${entry.count} listed. Lower the count, so the list stays true.`,
        );
      }
    }

    for (const file of Object.keys(NOTICES)) {
      // ee/ is not in every checkout (the Community Edition, Common's tests).
      if (
        !counts.has(file) &&
        fs.existsSync(path.join(REPOSITORY_ROOT, file))
      ) {
        problems.push(
          `${file}: listed in NOTICES, and has no dialog with only one way out any more. Take it off the list.`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  test("every listed notice says why it stays a dialog", () => {
    for (const [file, entry] of Object.entries(NOTICES)) {
      expect({ file, hasReason: entry.why.length > 20 }).toEqual({
        file,
        hasReason: true,
      });
      expect({ file, count: entry.count > 0 }).toEqual({ file, count: true });
    }
  });
});

describe("what the guard counts as a success title", () => {
  test.each([
    "Saved",
    "Success",
    "Email Sent",
    "Test Notification Sent",
    "Telegram account verified",
    "Code sent",
    "Summary Sent",
    "Changes saved successfully",
  ])("%s is one", (title: string) => {
    expect(isSuccessTitle(title)).toBe(true);
  });

  test.each([
    "Test Failed",
    "Could not save",
    "Test message not sent",
    "Delete Error",
    "Nothing to Add",
    "Root Cause",
    "Probe Key",
    "Send test: SMS and call gateway",
  ])("%s is not", (title: string) => {
    expect(isSuccessTitle(title)).toBe(false);
  });

  test("a notice is a ConfirmModal with no onClose, and a title is read as written", () => {
    const sites: Array<ConfirmModalSite> = readConfirmModals(
      "Example.tsx",
      [
        '<ConfirmModal title="Saved" onSubmit={() => {}} />',
        "<ConfirmModal title={`Delete ${name}`} onClose={close} onSubmit={go} />",
        '<ConfirmModal title={"Root Cause"} description={<div>{x}</div>} onSubmit={() => {}}>',
        "  <p>child</p>",
        "</ConfirmModal>",
        "<ConfirmModalBody />",
      ].join("\n"),
    );

    expect(
      sites.map((site: ConfirmModalSite) => {
        return [site.literalTitle, site.isNotice, site.line];
      }),
    ).toEqual([
      ["Saved", true, 1],
      // A title with a value in it is not read as a literal.
      [null, false, 2],
      ["Root Cause", true, 3],
    ]);
  });
});

describe("the toast is on every app's page", () => {
  test.each([
    "Dashboard",
    "AdminDashboard",
    "Accounts",
    "StatusPage",
    "PublicDashboard",
  ])("%s mounts ToastRegion at its root", (app: string) => {
    const code: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages",
        "App",
        "FeatureSet",
        app,
        "src",
        "Index.tsx",
      ),
      "utf8",
    );

    expect(code).toContain("<ToastRegion />");
  });
});
