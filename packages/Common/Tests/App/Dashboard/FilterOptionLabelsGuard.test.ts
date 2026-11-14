// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FILTER_OPTIONS_PROPERTY,
  FilterOptionLabelFinding,
  FilterOptionsSite,
  REPOSITORY_ROOT,
  englishLocaleFor,
  findingsOf,
  formatFilterOptionLabelFindings,
  listFilterOptionsScanFiles,
  readFilterOptionsSites,
} from "../../FilterOptionLabels";

/*
 * A FILTER'S OPTION READS THE SAME IN ITS MENU AND IN ITS CHIP (#7690).
 *
 * An option's label reads by one rule (DropdownOption.isUserContent): left
 * unmarked, it is the product's words in English - a key of the front
 * end's locale - looked up in the reader's language in the menu, the value
 * picked and the chip the filter leaves above its table; marked, it is a
 * name - a record's, a value from data, a product's own ("AWS", "Resend")
 * - drawn as written in all three. A Spanish Health filter read "Con
 * problemas" in its menu and "Unhealthy" in its chip; the menus looked
 * records' and products' names up, so a monitor named "Network" read "Red"
 * and the email provider Resend read "Reenviar".
 *
 * This reads every filter's options in the front ends (FilterOptionLabels)
 * and fails on an option that is neither marked nor labelled with a key:
 * a name to mark isUserContent, or a word to add to every locale.
 * FilterChipAndMenuInSpanish draws the menus and chips themselves.
 */

// A module of the Dashboard's, as the reader reads one: its imports resolve from here.
const SNIPPET_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Pages/FilterOptionsSnippet.tsx";
const DASHBOARD_LOCALE: string =
  "packages/App/FeatureSet/Dashboard/src/Locales/en.json";

function onlySiteOf(text: string): FilterOptionsSite {
  const sites: Array<FilterOptionsSite> = readFilterOptionsSites(
    SNIPPET_FILE,
    text,
  );

  expect(sites).toHaveLength(1);

  return sites[0]!;
}

/*
 * Words the product's filters offer that are no key of the English locale
 * yet. Each reads in English for every reader - in the menu, the chip and
 * the rows alike, so the three never disagree - until it is added to every
 * locale, or, for a stored value with no words of its own ("TimedOut",
 * "MicrosoftTeams"), given a label of words. A follow-up of #7690.
 *
 * The list only shrinks: a word that becomes a key, or leaves its filter,
 * fails the guard until its entry goes too, and a word that is new here
 * fails it at once. ee's filters are read when the checkout has ee/.
 */
const SUBSCRIBER_EVENT_TYPES: ReadonlyArray<string> = [
  "Subscriber Subscription Confirmation",
  "Subscriber Subscribed",
  "Subscriber Manage Subscription",
  "Subscriber Incident Created",
  "Subscriber Incident State Changed",
  "Subscriber Incident Note Created",
  "Subscriber Incident Note Updated",
  "Subscriber Incident Postmortem Published",
  "Subscriber Episode Created",
  "Subscriber Episode State Changed",
  "Subscriber Episode Note Created",
  "Subscriber Episode Note Updated",
  "Subscriber Announcement Created",
  "Subscriber Announcement Updated",
  "Subscriber Scheduled Maintenance Created",
  "Subscriber Scheduled Maintenance State Changed",
  "Subscriber Scheduled Maintenance Note Created",
  "Subscriber Scheduled Maintenance Note Updated",
  "Subscriber Report",
];

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const WORDS_WITH_NO_KEY_YET: Readonly<Record<string, ReadonlyArray<string>>> = {
  "ee/Dashboard/AuditLogs/AuditLogsTable.tsx": [
    "Sign In",
    "Sign Out",
    "Session Timeout",
    "Session Revoked",
  ],
  [`${DASHBOARD}/Components/DataObservability/DataAssetTable.tsx`]: [
    "Materialized View",
    "Partitioned Table",
    "Foreign Table",
    "Storage Path",
  ],
  [`${DASHBOARD}/Components/NotificationLogs/WorkspaceLogsTable.tsx`]: [
    "MicrosoftTeams",
  ],
  [`${DASHBOARD}/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx`]:
    [
      "Executing",
      "Execution Completed",
      "Execution Completed - No One Notified",
    ],
  [`${DASHBOARD}/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable.tsx`]:
    ["Executing", "Successfully Acknowledged", "Notification Sent"],
  [`${DASHBOARD}/Pages/DataObservability/SchemaChanges.tsx`]: [
    "Column added",
    "Column removed",
    "Column renamed",
    "Type changed",
    "Nullability changed",
    "Table dropped",
    "Table restored",
  ],
  [`${DASHBOARD}/Pages/Kubernetes/View/AI/Logs.tsx`]: ["Claimed", "TimedOut"],
  [`${DASHBOARD}/Pages/Runbook/Executions.tsx`]: ["WaitingForManualStep"],
  [`${DASHBOARD}/Pages/Runbook/View/Executions.tsx`]: ["WaitingForManualStep"],
  [`${DASHBOARD}/Pages/Settings/Invoices.tsx`]: [
    "Paid",
    "Void",
    "Uncollectible",
  ],
  [`${DASHBOARD}/Pages/StatusPages/Settings/SubscriberNotificationTemplates.tsx`]:
    SUBSCRIBER_EVENT_TYPES,
  [`${DASHBOARD}/Pages/StatusPages/View/SubscriberSettings.tsx`]:
    SUBSCRIBER_EVENT_TYPES,
  [`${DASHBOARD}/Pages/UserSettings/OnCallLogs.tsx`]: ["Executing"],
  [`${DASHBOARD}/Pages/Workflow/Logs.tsx`]: [
    "Timeout",
    "Workflow Count Exceeded",
  ],
  [`${DASHBOARD}/Pages/Workflow/View/Logs.tsx`]: [
    "Timeout",
    "Workflow Count Exceeded",
  ],
};

// Every filter's options in the front ends, read once.
const ALL_SITES: ReadonlyArray<FilterOptionsSite> =
  listFilterOptionsScanFiles().flatMap(
    (file: string): Array<FilterOptionsSite> => {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      return text.includes(FILTER_OPTIONS_PROPERTY)
        ? readFilterOptionsSites(file, text)
        : [];
    },
  );

describe("the reader of a filter's options", () => {
  test("reads the labels of a list of options, through the name it is kept under", () => {
    const site: FilterOptionsSite = onlySiteOf(`
      const HEALTH_OPTIONS = [
        { label: "Unhealthy", value: "critical" },
        { label: "Degraded", value: "warning" },
      ];
      const filters = [{ title: "Health", filterDropdownOptions: HEALTH_OPTIONS }];
    `);

    expect(site.words).toEqual(["Unhealthy", "Degraded"]);
    expect(site.asWritten).toBe(0);
    expect(site.unread).toEqual([]);
  });

  test("counts an option marked isUserContent as written, and reads no label of it", () => {
    const site: FilterOptionsSite = onlySiteOf(`
      const filters = [{
        filterDropdownOptions: services.map((service: Service) => {
          return { label: service.name!, value: service.id!.toString(), isUserContent: true };
        }),
      }];
    `);

    expect(site.asWritten).toBe(1);
    expect(site.words).toEqual([]);
    expect(site.unread).toEqual([]);
  });

  test("cannot read a name from data that is not marked, and says where", () => {
    const site: FilterOptionsSite = onlySiteOf(`
      const filters = [{
        filterDropdownOptions: services.map((service: Service) => {
          return { label: service.name!, value: service.id!.toString() };
        }),
      }];
    `);

    // Where the reader stopped: the records, which only the page's data holds.
    expect(site.asWritten).toBe(0);
    expect(site.unread).toHaveLength(1);
    expect(site.unread[0]!.why).toContain("services");
    expect(site.unread[0]!.at).toBe(`${SNIPPET_FILE}:3`);

    const findings: Array<FilterOptionLabelFinding> = findingsOf(
      site,
      DASHBOARD_LOCALE,
    );

    expect(findings).toHaveLength(1);
    expect(formatFilterOptionLabelFindings(findings)).toContain(
      `${SNIPPET_FILE}:3`,
    );
  });

  test("reads an enum's options, as the Dashboard's helper labels them", () => {
    const site: FilterOptionsSite = onlySiteOf(`
      import DropdownUtil from "Common/UI/Utils/Dropdown";

      enum Fruit {
        Apple = "Apple",
        BloodOrange = "Blood Orange",
      }

      const filters = [{
        filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(Fruit),
      }];
    `);

    expect(site.words).toEqual(["Apple", "Blood Orange"]);
    expect(site.unread).toEqual([]);
  });

  test("follows options into the module they come from", () => {
    const site: FilterOptionsSite = onlySiteOf(`
      import { STORE_PROVIDER_OPTIONS } from "../Components/DataSecurity/StoreFieldOptions";

      const filters = [{ filterDropdownOptions: STORE_PROVIDER_OPTIONS }];
    `);

    // The clouds marked; the words beside them read.
    expect(site.asWritten).toBe(3);
    expect(site.words).toEqual(["Run by you", "OneUptime telemetry"]);
  });

  test("counts a mark chosen per option at run time, written on the option, as written", () => {
    const site: FilterOptionsSite = onlySiteOf(`
      const DEFAULT_NAMES: Set<string> = new Set(["High", "Low"]);

      const filters = [{
        filterDropdownOptions: priorities.map((priority: Priority) => {
          return {
            label: priority.name,
            value: priority.id,
            isUserContent: !DEFAULT_NAMES.has(priority.name),
          };
        }),
      }];
    `);

    expect(site.asWritten).toBe(1);
    expect(site.unread).toEqual([]);
  });

  test("never takes a mark it cannot read from what is spread into an option", () => {
    const site: FilterOptionsSite = onlySiteOf(`
      const filters = [{
        filterDropdownOptions: priorities.map((priority: Priority) => {
          return { ...priority.extra, label: priority.name, value: priority.id };
        }),
      }];
    `);

    expect(site.asWritten).toBe(0);
    expect(site.unread).toHaveLength(1);
  });

  test("finds a word that is no key, and lets a key and the empty label be", () => {
    const site: FilterOptionsSite = onlySiteOf(`
      const filters = [{
        filterDropdownOptions: [
          { label: "Unhealthy", value: "a" },
          { label: "", value: "b" },
          { label: "Hardly A Word Of The Dashboard's", value: "c" },
        ],
      }];
    `);
    const findings: Array<FilterOptionLabelFinding> = findingsOf(
      site,
      DASHBOARD_LOCALE,
    );

    expect(
      findings.map((finding: FilterOptionLabelFinding) => {
        return finding.word;
      }),
    ).toEqual(["Hardly A Word Of The Dashboard's"]);
  });
});

describe("the filters read", () => {
  test("are every filter of the Dashboard's, more than a hundred", () => {
    expect(ALL_SITES.length).toBeGreaterThan(100);
  });

  test("include the account Resources page's Health filter, by its words", () => {
    const health: FilterOptionsSite | undefined = ALL_SITES.find(
      (site: FilterOptionsSite): boolean => {
        return (
          site.file ===
            `${DASHBOARD}/Pages/Cloud/Accounts/View/Resources.tsx` &&
          site.written === "CLOUD_HEALTH_FILTER_OPTIONS"
        );
      },
    );

    expect(health?.words).toEqual(["Unhealthy", "Degraded"]);
    expect(
      englishLocaleFor(`${DASHBOARD}/Pages/Cloud/Accounts/View/Resources.tsx`),
    ).toBe(DASHBOARD_LOCALE);
  });
});

describe("every filter's options in the front ends", () => {
  const findings: Array<FilterOptionLabelFinding> = ALL_SITES.flatMap(
    (site: FilterOptionsSite): Array<FilterOptionLabelFinding> => {
      return findingsOf(site, englishLocaleFor(site.file));
    },
  );

  test("are each the product's words, a key of every locale, or a name marked isUserContent", () => {
    const outOfRule: Array<FilterOptionLabelFinding> = findings.filter(
      (finding: FilterOptionLabelFinding): boolean => {
        return !(
          finding.word !== undefined &&
          (WORDS_WITH_NO_KEY_YET[finding.file] || []).includes(finding.word)
        );
      },
    );

    expect(formatFilterOptionLabelFindings(outOfRule)).toBe("");
  });

  test("leave no word on the list of those with no key yet that has since got one, or gone", () => {
    const stale: Array<string> = [];

    for (const file of Object.keys(WORDS_WITH_NO_KEY_YET)) {
      // ee's filters are read only when the checkout has ee/.
      if (!fs.existsSync(path.join(REPOSITORY_ROOT, file))) {
        expect(file.startsWith("ee/")).toBe(true);
        continue;
      }

      for (const word of WORDS_WITH_NO_KEY_YET[file] || []) {
        const isStillFound: boolean = findings.some(
          (finding: FilterOptionLabelFinding): boolean => {
            return finding.file === file && finding.word === word;
          },
        );

        if (!isStillFound) {
          stale.push(`${file}: "${word}"`);
        }
      }
    }

    expect(stale).toEqual([]);
  });
});
