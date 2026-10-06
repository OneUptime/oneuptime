import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Configuration a lower plan cannot use can still be seen, switched off and
 * removed.
 *
 * The server lets every plan read, switch off (isEnabled false, nothing
 * else) and delete the records of a plan-gated table a project already has
 * (Common/Types/Billing/PlanGatedTable, asked by BillingPermission). The
 * dashboard shows them where the feature is sold, once the project is known
 * to be below the plan:
 *
 *   - Settings > SSO, OIDC and SCIM, and a status page's SSO, OIDC and SCIM
 *     pages, under their Scale upsell (PlanGatedPage's and
 *     EnterprisePluginPage's belowPlan): the providers and connections the
 *     project still has, which keep signing people in and provisioning them
 *     (IdentityPlanLeftovers). A status page that still requires SSO gets
 *     its "Require SSO for Login" switch there too.
 *   - Settings > API Keys, On-Call Duty > Schedules and every product's
 *     Slack and Microsoft Teams page, below Growth: a plan note
 *     (PlanLeftoverPage) with the keys, schedules, rules and summaries the
 *     project still has under it.
 *
 * Each list is one PlanLeftoverTable: Turn off where the records have a
 * switch, Delete always, nothing to add or edit.
 *
 * This holds the pages to that wiring, and the new sentences to a
 * translation in every language. The behaviour is tested in Common/Tests:
 * PlanGatedTable, PlanGatedTableLeftovers, PlanGatedConfigRemovable (the
 * server), PlanLeftoverTable, PlanLeftoverPage, PlanLeftoverGrowthPages,
 * StatusPageRequireSsoLeftover, SsoPages and IdentityEnterpriseShells (the
 * dashboard).
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");
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

// Written once, in Components/Billing/PlanLeftoverCopy.ts.
const NEW_SENTENCES: Array<string> = [
  "Your plan does not include these any more. The ones that are on still work: you can turn them off or delete them. Turning them on again or adding new ones needs the {{planName}} plan.",
  "Your plan does not include these any more, but they still work. You can delete them. Changing them or adding new ones needs the {{planName}} plan.",
  "Turn off",
  "Turn this off?",
  "It stops working right away. Turning it on again needs the {{planName}} plan.",
  "Nothing is left here.",
  "Available on the {{planName}} plan",
  "This project's plan does not include this, so nothing new can be added here.",
  "SAML providers still set up",
  "OIDC providers still set up",
  "SCIM connections still set up",
  "API keys still set up",
  "On-call schedules still set up",
  "Notification rules still set up",
  "Summaries still set up",
];

// Source with comments dropped and whitespace collapsed.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

function readDashboard(relativePath: string): string {
  return readSource(path.join(DASHBOARD_SRC, relativePath));
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;
const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Locales" && entry.name !== "node_modules") {
        found.push(...listSources(full));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

describe("the server's rule, which the dashboard asks", () => {
  test("BillingPermission lets reads, deletes and switch-offs through below the plan, by the shared rule", () => {
    const billing: string = readSource(
      path.join(
        COMMON_ROOT,
        "Server",
        "Types",
        "Database",
        "Permissions",
        "BillingPermission.ts",
      ),
    );

    expect(billing).toContain(
      "if (BillingPermissions.isAllowedBelowPlan(model, type, updateData)) { return; }",
    );
    expect(billing).toContain("return canReadPlanGatedTableBelowPlan(model);");
    expect(billing).toContain(
      "return isPlanGatedTableSwitchOff(model, updateData);",
    );
  });

  test("the leftover table offers Turn off from the same switch, and writes it alone", () => {
    const table: string = readDashboard(
      "Components/Billing/PlanLeftoverTable.tsx",
    );

    expect(table).toContain(
      'import { getPlanGatedTableSwitchColumn } from "Common/Types/Billing/PlanGatedTable";',
    );
    expect(table).toContain(
      "const switchColumn: string | null = getPlanGatedTableSwitchColumn(model);",
    );
    expect(table).toContain("data: { [switchColumn]: false, },");
    expect(table).toContain("isCreateable={false}");
    expect(table).toContain("isEditable={false}");
    expect(table).toContain("isDeleteable={true}");
  });
});

describe("the Scale pages draw what is left under their upsell", () => {
  test.each([
    ["Pages/Settings/SSO.tsx", "ProjectSamlProvidersLeftover"],
    ["Pages/Settings/OIDC.tsx", "ProjectOidcProvidersLeftover"],
    ["Pages/Settings/SCIM.tsx", "ProjectScimConnectionsLeftover"],
    ["Pages/StatusPages/View/SSO.tsx", "StatusPageSamlProvidersLeftover"],
    ["Pages/StatusPages/View/OIDC.tsx", "StatusPageOidcProvidersLeftover"],
    ["Pages/StatusPages/View/SCIM.tsx", "StatusPageScimConnectionsLeftover"],
  ])(
    "%s hands its upsell %s, an element nothing is read for until it is drawn",
    (page: string, leftover: string) => {
      const source: string = readDashboard(page);

      expect(source).toContain(
        `import { ${leftover} } from "${page.startsWith("Pages/Settings") ? "../.." : "../../.."}/Components/Billing/IdentityPlanLeftovers";`,
      );
      expect(source).toMatch(new RegExp(`belowPlan=\\{ ?(<> )?.*<${leftover} />`));
    },
  );

  test("Settings > SSO keeps the project's Require SSO for Login leftover too", () => {
    expect(readDashboard("Pages/Settings/SSO.tsx")).toContain(
      "<RequireSsoForLoginLeftover projectId={ProjectUtil.getCurrentProjectId()!} /> <ProjectSamlProvidersLeftover />",
    );
  });

  test.each([
    ["ProjectSamlProvidersLeftover", "ProjectSSO", "SSO_REQUIRED_PLAN"],
    ["ProjectOidcProvidersLeftover", "ProjectOIDC", "SSO_REQUIRED_PLAN"],
    ["ProjectScimConnectionsLeftover", "ProjectSCIM", "IDENTITY_REQUIRED_PLAN"],
    ["StatusPageSamlProvidersLeftover", "StatusPageSSO", "SSO_REQUIRED_PLAN"],
    ["StatusPageOidcProvidersLeftover", "StatusPageOIDC", "SSO_REQUIRED_PLAN"],
    [
      "StatusPageScimConnectionsLeftover",
      "StatusPageSCIM",
      "IDENTITY_REQUIRED_PLAN",
    ],
  ])(
    "%s lists the project's %s, at the page's own plan",
    (component: string, model: string, plan: string) => {
      const source: string = readDashboard(
        "Components/Billing/IdentityPlanLeftovers.tsx",
      );

      const start: number = source.indexOf(`export const ${component}`);

      expect(start).toBeGreaterThan(-1);

      const next: number = source.indexOf("export const", start + 1);
      const body: string = source.slice(
        start,
        next === -1 ? source.length : next,
      );

      expect(body).toContain(`<PlanLeftoverTable<${model}> modelType={${model}}`);
      expect(body).toContain(`requiredPlan={${plan}}`);
      expect(body).toContain("projectId: ProjectUtil.getCurrentProjectId()!");
    },
  );

  test("a status page's SAML leftovers start with its Require SSO for Login switch", () => {
    const source: string = readDashboard(
      "Components/Billing/IdentityPlanLeftovers.tsx",
    );

    expect(source).toContain(
      "<StatusPageRequireSsoLeftover statusPageId={statusPageId} /> <PlanLeftoverTable<StatusPageSSO>",
    );
  });
});

describe("the Growth pages become the plan note below the plan", () => {
  test.each([
    ["Pages/Settings/APIKeys.tsx", "API_KEY_PLAN", "ApiKeysLeftover", "APIKeysPage", "APIKeys"],
    [
      "Pages/OnCallDuty/OnCallDutySchedules.tsx",
      "ON_CALL_SCHEDULE_PLAN",
      "OnCallSchedulesLeftover",
      "OnCallDutySchedulesPage",
      "OnCallDutyPage",
    ],
  ])(
    "%s",
    (
      page: string,
      plan: string,
      leftover: string,
      exported: string,
      inner: string,
    ) => {
      const source: string = readDashboard(page);

      expect(source).toContain(
        `<PlanLeftoverPage requiredPlan={${plan}} leftovers={<${leftover} />} > <${inner} {...props} /> </PlanLeftoverPage>`,
      );
      expect(source).toContain(`export default ${exported};`);
      // The plan is the model's own: the one the server asks.
      expect(source).toMatch(
        new RegExp(`const ${plan}: PlanType = new \\w+\\(\\)\\.getCreateBillingPlan\\(\\) \\|\\| PlanType\\.Growth;`),
      );
    },
  );

  const WORKSPACE_PAGES: Array<[string, string, Array<string>, Array<string>]> =
    [];

  for (const [folder, events, summaries] of [
    ["Incidents", ["Incident", "IncidentEpisode"], ["Incident", "IncidentEpisode"]],
    ["Alerts", ["Alert", "AlertEpisode"], ["Alert", "AlertEpisode"]],
    ["ScheduledMaintenanceEvents", ["ScheduledMaintenance"], []],
    ["OnCallDuty", ["OnCallDutyPolicy"], []],
    ["Monitor", ["Monitor"], []],
  ] as Array<[string, Array<string>, Array<string>]>) {
    for (const workspace of ["Slack", "MicrosoftTeams"]) {
      WORKSPACE_PAGES.push([
        `Pages/${folder}/WorkspaceConnection${workspace}.tsx`,
        workspace,
        events,
        summaries,
      ]);
    }
  }

  test.each(WORKSPACE_PAGES)(
    "%s wraps the page in its workspace's plan gate, for its own events and summaries",
    (
      page: string,
      workspace: string,
      events: Array<string>,
      summaries: Array<string>,
    ) => {
      const source: string = readDashboard(page);

      const expectedProps: string = [
        `workspaceType={WorkspaceType.${workspace}}`,
        `eventTypes={[${events
          .map((event: string): string => {
            return `NotificationRuleEventType.${event}`;
          })
          .join(", ")}]}`,
        ...(summaries.length > 0
          ? [
              `summaryTypes={[${summaries
                .map((summary: string): string => {
                  return `WorkspaceNotificationSummaryType.${summary}`;
                })
                .join(", ")}]}`,
            ]
          : []),
      ].join(" ");

      expect(source).toContain(
        `<WorkspacePlanLeftoverGate ${expectedProps} > <WorkspaceConnectionGate workspaceType={WorkspaceType.${workspace}}>`,
      );
      expect(source).toContain(
        "</WorkspaceConnectionGate> </WorkspacePlanLeftoverGate>",
      );
    },
  );

  test("every product's Slack and Microsoft Teams page is covered", () => {
    const pages: Array<string> = listSources(path.join(DASHBOARD_SRC, "Pages"))
      .filter((file: string): boolean => {
        return /WorkspaceConnection(Slack|MicrosoftTeams)\.tsx$/.test(file);
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
      })
      .sort();

    expect(pages).toEqual(
      WORKSPACE_PAGES.map(
        (row: [string, string, Array<string>, Array<string>]): string => {
          return row[0];
        },
      ).sort(),
    );
  });
});

describe("what is left is only ever drawn below the plan", () => {
  test("PlanLeftoverTable is drawn only by the leftover components the gates hand it to", () => {
    const drawnIn: Array<string> = listSources(DASHBOARD_SRC)
      .filter((file: string): boolean => {
        return readSource(file).includes("<PlanLeftoverTable<");
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
      })
      .sort();

    expect(drawnIn).toEqual([
      "Components/Billing/IdentityPlanLeftovers.tsx",
      "Components/Workspace/WorkspacePlanLeftoverGate.tsx",
      "Pages/OnCallDuty/OnCallDutySchedules.tsx",
      "Pages/Settings/APIKeys.tsx",
    ]);
  });

  test("the plan note waits until the project is known to be below the plan", () => {
    expect(readDashboard("Components/Billing/PlanLeftoverPage.tsx")).toContain(
      "if (!isKnownToBeBelowPlan(props.requiredPlan)) { return <>{props.children}</>; }",
    );
  });
});

describe("the new sentences", () => {
  test("are written once, in PlanLeftoverCopy", () => {
    const copy: string = readDashboard("Components/Billing/PlanLeftoverCopy.ts");

    for (const sentence of NEW_SENTENCES) {
      expect([sentence, copy.includes(`translationKey( "${sentence}"`) ||
        copy.includes(`translationKey("${sentence}"`)]).toEqual([
        sentence,
        true,
      ]);
    }
  });

  test("are keys of the English locale", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const sentence of NEW_SENTENCES) {
      expect([sentence, english[sentence]]).toEqual([sentence, sentence]);
    }
  });

  test.each(OTHER_LOCALES)(
    "are translated in %s, with the same placeholders",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const sentence of NEW_SENTENCES) {
        const translated: unknown = translations[sentence];

        expect([locale, sentence, typeof translated]).toEqual([
          locale,
          sentence,
          "string",
        ]);
        expect([locale, sentence, translated === sentence]).toEqual([
          locale,
          sentence,
          false,
        ]);
        expect(placeholdersOf(translated as string)).toEqual(
          placeholdersOf(sentence),
        );
      }
    },
  );
});
