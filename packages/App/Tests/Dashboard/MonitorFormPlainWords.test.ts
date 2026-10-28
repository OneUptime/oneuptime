import {
  DATABASE_MONITOR_MORE_FIELDS,
  METRIC_GROUPS_TITLE,
  getDatabaseMonitorMoreFieldsItems,
} from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorMoreFields";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The simplicity audit of the monitor area: words that said nothing, or the
 * wrong thing, and settings most people never change that sat in the open.
 *
 *   - Request Body's help said "Request Headers to send in JSON."
 *   - "Do not follow redirects" was explained as "Please check this if you
 *     do not want to follow redirects."
 *   - Seven cards said "Configure the ... monitoring settings", and the
 *     address card "Configure what you want to monitor".
 *   - A Database Health monitor showed its seven Metric Groups switches in
 *     the open (all on, rarely changed), and long paragraphs in its
 *     privileges box; the groups wait under More fields now, and each engine
 *     gets one line on what goes wrong without its grant.
 *   - The criteria's folded Actions section, and its Enabled badge, read
 *     English in every language; a monitor's last criteria could not be
 *     deleted with "We cant delete one remaining criteria."
 *   - A manual monitor's Criteria page did not say how to set its status;
 *     the reset-key cards did not say what a reset breaks; Duplicate asked
 *     "Should the new monitor be disabled when it is duplicated?"; the
 *     probes page said "However, you can add some probes"; a secret value
 *     that failed to save said nothing at all.
 *
 * Every new sentence is held to its translations by the locale guard and
 * the per-feature suites (DatabaseAuthenticationChoice, SyntheticMonitorForm,
 * ProbeOnNewMonitorsName, MonitorGroupFirstSteps); this one holds the pages.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function readDashboard(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const STEP_FORM: string = readDashboard(
  "Components/Form/Monitor/MonitorStep.tsx",
);

describe("the request fields of an API or Website monitor", () => {
  test("Request Body says what it is, not 'Request Headers'", () => {
    expect(STEP_FORM).not.toContain("Request Headers to send in JSON.");
    expect(STEP_FORM).toContain('"Sent with every request, as JSON."');
    expect(STEP_FORM).toContain('"Sent with every request."');
  });

  test("the redirect and certificate options say what ticking them does", () => {
    expect(STEP_FORM).not.toContain(
      "Please check this if you do not want to follow redirects.",
    );
    expect(STEP_FORM).not.toContain(
      "Check this to skip TLS certificate validation (e.g. accept self-signed or untrusted certificates).",
    );
    // Both the API and the Website sections.
    expect(
      STEP_FORM.split(
        'description="Check the redirect response itself, not the page it leads to."',
      ).length - 1,
    ).toBe(2);
    expect(
      STEP_FORM.split(
        'description="Skip certificate validation for this host, so self-signed certificates work."',
      ).length - 1,
    ).toBe(2);
  });

  test("API Request Type always has a method: it says GET is the default and cannot be cleared", () => {
    expect(STEP_FORM).not.toContain("What is the type of the API request?");
    expect(STEP_FORM).toContain(
      'description={"GET unless the endpoint needs another method."}',
    );
    expect(STEP_FORM).toMatch(
      /isClearable=\{false\}\s+initialValue=\{requestTypeDropdownOptions\.find\(/,
    );
  });

  test("Test Monitor says what it does", () => {
    expect(STEP_FORM).not.toContain(
      "Verify your monitor configuration before saving",
    );
    expect(STEP_FORM).toContain(
      'description="Run one check now, before you save."',
    );
  });
});

describe("cards whose description said nothing", () => {
  const RETIRED: Array<string> = [
    "Configure what you want to monitor",
    "Configure the log monitoring settings",
    "Configure the security event monitoring settings",
    "Configure the metric monitoring settings",
    "Configure the trace monitoring settings",
    "Configure the exception monitoring settings",
    "Configure the DNS monitoring settings",
    "Configure the domain registration monitoring settings",
  ];

  test.each(RETIRED)("no card says %p", (description: string) => {
    expect(STEP_FORM).not.toContain(description);
  });

  test("the cards keep their titles, which the docs name", () => {
    for (const title of [
      "Monitor Target",
      /*
       * A telemetry monitor's card says what it holds: what the rule
       * counts or reads (the docs' Logs, Traces, Exceptions and Metrics
       * monitor pages name them).
       */
      "Logs to watch",
      "Metric to watch",
      "Spans to watch",
      "Exceptions to watch",
      "DNS Monitor Configuration",
      "Domain Monitor Configuration",
    ]) {
      expect(STEP_FORM).toContain(`title="${title}"`);
    }

    for (const retired of [
      "Log Monitor Configuration",
      "Metric Monitor Configuration",
      "Trace Monitor Configuration",
      "Exception Monitor Configuration",
    ]) {
      expect(STEP_FORM).not.toContain(`title="${retired}"`);
    }
  });
});

describe("a Database Health monitor", () => {
  const form: string = readDashboard(
    "Components/Form/Monitor/DatabaseMonitor/DatabaseMonitorStepForm.tsx",
  );

  test("folds its Metric Groups under More fields, with the timeouts", () => {
    const moreFields: number = form.indexOf(
      "title={MORE_FIELDS_SECTION_TITLE}",
    );
    const groups: number = form.indexOf('title="Metric Groups"');
    const connectionTimeout: number = form.indexOf(
      'title="Connection Timeout (ms)"',
    );

    expect(moreFields).toBeGreaterThan(0);
    expect(groups).toBeGreaterThan(moreFields);
    expect(connectionTimeout).toBeGreaterThan(groups);
    expect(form).toContain("getDatabaseMonitorMoreFieldsItems({");
  });

  test("says in one line per engine what goes wrong without its grant, keeping the facts", () => {
    expect(form).toContain(
      "Without pg_monitor, PostgreSQL shows only the monitoring session, so the groups that need it are reported as missing.",
    );
    expect(form).toContain(
      "Also switch performance_schema on (performance_schema = ON in my.cnf). Stock MySQL has no deadlock counter, so deadlocks are never collected.",
    );
    expect(form).toContain("Read access to your tables is not enough");
    expect(form).toContain(
      "The user does not have permission to perform this action",
    );
    // The paragraphs they replace.
    expect(form).not.toContain("would read as one and zero forever");
    expect(form).not.toContain(
      "The probe detects Azure SQL Database and shows its grant when one is missing.",
    );
  });

  test("its Database Type always names an engine", () => {
    expect(form).toContain("isClearable={false}");
  });
});

describe("More fields of a Database Health monitor", () => {
  const config: Record<string, unknown> = {
    connectionTimeoutInMs: 10000,
    statementTimeoutInMs: 10000,
  };

  function titles(items: Array<FoldedSectionItem>): Array<string> {
    return items.map((item: FoldedSectionItem) => {
      return item.title;
    });
  }

  test("lists the Metric Groups first, then the timeouts", () => {
    const items: Array<FoldedSectionItem> = getDatabaseMonitorMoreFieldsItems({
      config: config,
      enabledMetricGroupCount: 7,
      metricGroupCount: 7,
    });

    expect(titles(items)).toEqual([
      METRIC_GROUPS_TITLE,
      ...DATABASE_MONITOR_MORE_FIELDS.map((spec: { title: string }) => {
        return spec.title;
      }),
    ]);
    expect(METRIC_GROUPS_TITLE).toBe("Metric Groups");
  });

  test("every group on - a new monitor - is nothing to show while folded", () => {
    const items: Array<FoldedSectionItem> = getDatabaseMonitorMoreFieldsItems({
      config: config,
      enabledMetricGroupCount: 7,
      metricGroupCount: 7,
    });

    expect(items[0]?.isSet).toBe(false);
    expect(items[0]?.value).toBeUndefined();
  });

  test("a group turned off shows as a count, which reads the same in every language", () => {
    const items: Array<FoldedSectionItem> = getDatabaseMonitorMoreFieldsItems({
      config: config,
      enabledMetricGroupCount: 5,
      metricGroupCount: 7,
    });

    expect(items[0]).toEqual({
      key: "enabledMetricGroups",
      title: METRIC_GROUPS_TITLE,
      isSet: true,
      value: "5/7",
    });
  });

  test("the timeouts keep their own rule: set only off their defaults", () => {
    const items: Array<FoldedSectionItem> = getDatabaseMonitorMoreFieldsItems({
      config: { connectionTimeoutInMs: 20000, statementTimeoutInMs: 10000 },
      enabledMetricGroupCount: 7,
      metricGroupCount: 7,
    });

    expect(items[1]).toMatchObject({ isSet: true, value: "20000" });
    expect(items[2]).toMatchObject({ isSet: false });
  });
});

describe("the criteria editor", () => {
  const instance: string = readDashboard(
    "Components/Form/Monitor/MonitorCriteriaInstance.tsx",
  );
  const criteria: string = readDashboard(
    "Components/Form/Monitor/MonitorCriteria.tsx",
  );

  test("its folded Actions section says what it does in the reader's language", () => {
    expect(instance).not.toContain("actions.push(`Status: ${");
    expect(instance).not.toContain('alert${alertCount !== 1 ? "s" : ""}');
    expect(instance).toContain(
      'translator.translateTemplate("Status: {{status}}"',
    );
    expect(instance).toContain(
      '{ one: "{{count}} alert", other: "{{count}} alerts" }',
    );
    expect(instance).toContain(
      '{ one: "{{count}} incident", other: "{{count}} incidents" }',
    );
    expect(instance).toContain('translator.translateText("No actions")');
  });

  test("its Enabled badge is translated too", () => {
    expect(instance).not.toContain(
      'badge={isEnabled ? "Enabled" : "Disabled"}',
    );
    expect(instance).toContain(
      'translator.translateText(isEnabled ? "Enabled" : "Disabled")',
    );
  });

  test("the last criteria's dialog says why it stays, and what to do instead", () => {
    expect(criteria).not.toContain("We cant delete one remaining criteria.");
    expect(criteria).not.toContain("Cannot delete last remaining criteria.");
    expect(criteria).toContain('title="This is the only criteria"');
    expect(criteria).toContain(
      'description="A monitor needs at least one criteria. Change this one, or add another before you delete it."',
    );
  });
});

describe("a monitor's pages", () => {
  test("a manual monitor's Criteria page says where its status is set", () => {
    const page: string = readDashboard("Pages/Monitor/View/Criteria.tsx");

    expect(page).toContain('title={"No Criteria for Manual Monitors"}');
    expect(page).toContain(
      "A manual monitor has no criteria: you set its status yourself, from the ⋯ menu on its overview.",
    );
    expect(page).not.toContain(
      "You can have monitoring criteria on other monitor types.",
    );
  });

  test("the reset-key cards say what a reset breaks", () => {
    const page: string = readDashboard("Pages/Monitor/View/Settings.tsx");

    /*
     * Each in a <span>: a card draws its description in a <p>, and a <p>
     * inside one is invalid HTML (React's validateDOMNesting warning).
     */
    expect(page).not.toContain('<p className="mt-2">');

    expect(page).toContain('title={"Reset Incoming Request Secret Key"}');
    expect(page).toContain(
      "The key in this monitor's URL is {{key}}. Reset it if the URL leaks: the old URL stops working, so update every sender.",
    );
    expect(page).toContain('title={"Reset Server Monitor Secret Key"}');
    expect(page).toContain(
      "The agent on your server signs in with {{key}}. After a reset it stops reporting until you give it the new key.",
    );
    expect(page).not.toContain(
      "Resetting the secret key will generate a new key.",
    );
  });

  test("Duplicate's switch is named for what on does, and says why it starts on", () => {
    const page: string = readDashboard("Pages/Monitor/View/Settings.tsx");

    expect(page).not.toContain(
      "Should the new monitor be disabled when it is duplicated?",
    );
    /*
     * "Disable Monitor", explained as "The copy starts with monitoring
     * off", read wrong once the switch was turned off.
     */
    expect(page).not.toContain('title: "Disable Monitor"');
    expect(page).not.toContain(
      "The copy starts with monitoring off, so it does not alert twice.",
    );
    expect(page).toContain(
      '"So the copy does not alert twice for the same problem. Turn monitoring on later from its Settings."',
    );
    // Still the same field, and still on by default.
    expect(page).toMatch(
      /disableActiveMonitoring: true,\s*\},[\s\S]{0,400}title: "Start with monitoring off",[\s\S]{0,400}defaultValue: true,/,
    );
  });

  test("the Probes page says what probes do here, and the next step when there are none", () => {
    const page: string = readDashboard("Pages/Monitor/View/Probes.tsx");

    expect(page).toContain(
      '"The probes that check this monitor. Add one to check it from another location."',
    );
    expect(page).toContain(
      '"No probes check this monitor. Add a probe to start checking it."',
    );
    expect(page).not.toContain("However, you can add some probes");
  });

  test("Dependencies folds which parent statuses silence the monitor under More fields", () => {
    const page: string = readDashboard("Pages/Monitor/View/Dependencies.tsx");

    expect(page).toContain(
      "const DEPENDENCY_MORE_FIELDS: FormFieldCollapsibleSection<Monitor> =",
    );
    expect(page).toMatch(
      /title: "Suppress When Parent Status Is",[\s\S]{0,400}collapsibleSection: DEPENDENCY_MORE_FIELDS,/,
    );
  });

  test("Edit Dependencies opens a dialog of the same name, not Edit Monitor", () => {
    const page: string = readDashboard("Pages/Monitor/View/Dependencies.tsx");

    expect(page).toContain('editButtonText="Edit Dependencies"');
    expect(page).toContain('editModalTitle="Edit Dependencies"');
  });
});

describe("monitor secrets", () => {
  test("Update Secret Value says why a value was not saved, and stays open", () => {
    const page: string = readDashboard(
      "Pages/Monitor/Settings/MonitorSecrets.tsx",
    );

    expect(page).not.toContain("// do nothing");
    expect(page).toContain("setUpdateError(API.getFriendlyMessage(err));");
    expect(page).toContain("error={updateError || undefined}");
  });
});

describe("translations", () => {
  const words: Array<string> = [
    "Sent with every request, as JSON.",
    "Sent with every request.",
    "Check the redirect response itself, not the page it leads to.",
    "Skip certificate validation for this host, so self-signed certificates work.",
    "GET unless the endpoint needs another method.",
    "Run one check now, before you save.",
    "No actions",
    "This is the only criteria",
    "A monitor needs at least one criteria. Change this one, or add another before you delete it.",
    "A manual monitor has no criteria: you set its status yourself, from the ⋯ menu on its overview.",
    "The key in this monitor's URL is {{key}}. Reset it if the URL leaks: the old URL stops working, so update every sender.",
    "The agent on your server signs in with {{key}}. After a reset it stops reporting until you give it the new key.",
    "Start with monitoring off",
    "So the copy does not alert twice for the same problem. Turn monitoring on later from its Settings.",
    "The probes that check this monitor. Add one to check it from another location.",
    "No probes check this monitor. Add a probe to start checking it.",
    "Without pg_monitor, PostgreSQL shows only the monitoring session, so the groups that need it are reported as missing.",
    "Use a monitor secret, such as {{secret}}, to keep it encrypted.",
  ];

  test("en.json carries every new sentence as itself", () => {
    const en: Record<string, unknown> = readLocale("en");

    for (const word of words) {
      expect(en[word]).toBe(word);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s.json translates every new sentence",
    (locale: string) => {
      const json: Record<string, unknown> = readLocale(locale);

      for (const word of words) {
        expect(typeof json[word]).toBe("string");
        expect(json[word]).not.toBe(word);
      }
    },
  );

  test.each(OTHER_LOCALES)(
    "%s.json keeps every placeholder",
    (locale: string) => {
      const json: Record<string, unknown> = readLocale(locale);

      for (const word of words) {
        for (const placeholder of word.match(/\{\{\w+\}\}/g) || []) {
          expect(json[word] as string).toContain(placeholder);
        }
      }
    },
  );
});
