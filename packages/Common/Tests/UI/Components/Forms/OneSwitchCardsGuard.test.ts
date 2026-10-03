import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  getOnlyVisibleField,
  isOneSwitchForm,
  scanFormFiles,
  SourceFileSystem,
} from "../../../Helpers/FormStepsScan";

/*
 * One-switch settings save when they are flipped.
 *
 * A card whose Edit dialog holds a single switch takes Edit, flip, Save -
 * three presses and a dialog - for one yes or no. Such a card becomes a
 * ModelSwitchCard (Common/UI/Components/ModelSwitch): the card holds the
 * switch itself, which saves its column the moment it is flipped, says
 * "Saved", moves back with the reason when the server refuses, locks (by
 * the column's own permissions) for someone who may not change it, names
 * the plan it needs, and asks first where a flip can lock people out.
 *
 * This guard reads every CardModelDetail in the frontends (FormStepsScan)
 * and fails on a card whose form is one switch, unless the card is in
 * ONE_SWITCH_CARDS_LEFT below with the task converting it and what to watch
 * for. That list is a to-do list: when a card is converted its entry has to
 * go (the guard fails on an entry it no longer finds), so whoever lands a
 * conversion - first or second - removes what it retired.
 *
 * The monitor and status page areas are done: no card under the
 * Dashboard's Pages/Monitor may be listed, and under Pages/StatusPages only
 * the cards that decide who may see a status page, which the status page
 * access task turns into one choice. So are incidents, alerts, episodes,
 * scheduled maintenance, runbooks, SLOs and RUM: their reminders, privacy,
 * status page visibility and on/off switches save on flip, and no card
 * under those pages may be listed. So are the AI settings pages: every AI
 * behaviour there (Enable AI, investigating, drafting postmortems, opening
 * fix pull requests, AI Insights) is a switch that saves on flip. So are
 * Project Settings and the admin dashboard: customer support access,
 * monitor groups, requiring SSO, sign up, project creation and master
 * admin save on flip, and nothing under the Dashboard's Pages/Settings may
 * be listed, and nothing in the admin dashboard at all.
 *
 * Tables are not judged here: a table row's edit form with one switch (a
 * network interface's "Monitor this Interface") edits one row of many.
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const ADMIN_DASHBOARD: string = "packages/App/FeatureSet/AdminDashboard/src";

/*
 * The tasks of the feedback batch that convert the cards still listed, so
 * an entry's owner is a name someone can look up. "" for a card no task in
 * the batch converts yet.
 */
export const ONE_SWITCH_CARD_TASKS: ReadonlyArray<string> = [
  "dashboard-sharing-one-choice",
  "status-page-access-one-choice",
  "",
];

export interface OneSwitchCardLeft {
  // Repository-relative, with "/".
  file: string;
  // The column the card's one switch writes: with the file, the card.
  column: string;
  // The card as a reader finds it: its name or title.
  card: string;
  // The task converting it (ONE_SWITCH_CARD_TASKS).
  task: string;
  // Why it is still a dialog, and what its switch must do when converted.
  reason: string;
}

const STATUS_PAGE_ACCESS_TASK: string = "status-page-access-one-choice";
const DASHBOARD_SHARING_TASK: string = "dashboard-sharing-one-choice";

export const ONE_SWITCH_CARDS_LEFT: Array<OneSwitchCardLeft> = [
  // Who may see a dashboard.
  {
    file: `${DASHBOARD}/Pages/Dashboards/View/AuthenticationSettings.tsx`,
    column: "isPublicDashboard",
    card: "Dashboard > Authentication Settings (Is Visible to Public)",
    task: DASHBOARD_SHARING_TASK,
    reason:
      "Part of who may view a dashboard, which its task turns into one choice rather than a switch.",
  },
  {
    file: `${DASHBOARD}/Pages/Dashboards/View/AuthenticationSettings.tsx`,
    column: "enableMasterPassword",
    card: "Dashboard > Master Password",
    task: DASHBOARD_SHARING_TASK,
    reason: "Part of who may view a dashboard, with its public switch.",
  },

  // Who may see a status page.
  {
    file: `${DASHBOARD}/Pages/StatusPages/View/AuthenticationSettings.tsx`,
    column: "isPublicStatusPage",
    card: "Status Page > Authentication Settings (Is Visible to Public)",
    task: STATUS_PAGE_ACCESS_TASK,
    reason:
      "Who can see the status page: anyone, people who sign in, or anyone with the password, which its task makes one choice. A switch could hide a public page in one press.",
  },
  {
    file: `${DASHBOARD}/Pages/StatusPages/View/AuthenticationSettings.tsx`,
    column: "enableMasterPassword",
    card: "Status Page > Master Password",
    task: STATUS_PAGE_ACCESS_TASK,
    reason: "Part of who can see the status page, with its public switch.",
  },
  {
    file: `${DASHBOARD}/Pages/StatusPages/View/SSO.tsx`,
    column: "requireSsoForLogin",
    card: "SSO Settings (Force SSO for Login)",
    task: STATUS_PAGE_ACCESS_TASK,
    reason:
      "Requiring SSO for a status page's visitors is part of who can see it, and locks out anyone SSO does not let in.",
  },
];

// The cards one-switch cards are judged on.
function isCard(form: FormFacts): boolean {
  return form.host === "CardModelDetail";
}

function oneSwitchCards(forms: Array<FormFacts>): Array<FormFacts> {
  return forms.filter((form: FormFacts): boolean => {
    return isCard(form) && isOneSwitchForm(form);
  });
}

function columnOf(form: FormFacts): string {
  return getOnlyVisibleField(form)?.key || "";
}

function describeCard(form: FormFacts): string {
  return `${form.file}:${form.line} ${form.label} (${columnOf(form)})`;
}

const VIRTUAL_ROOT: string = "/repo";

function virtualFileSystem(files: Record<string, string>): SourceFileSystem {
  return {
    readFile: (filePath: string): string | null => {
      const relative: string = path
        .relative(VIRTUAL_ROOT, filePath)
        .split(path.sep)
        .join("/");

      return Object.prototype.hasOwnProperty.call(files, relative)
        ? (files[relative] as string)
        : null;
    },
  };
}

function scan(files: Record<string, string>): Array<FormFacts> {
  return scanFormFiles({
    repositoryRoot: VIRTUAL_ROOT,
    files: [path.join(VIRTUAL_ROOT, "Page.tsx")],
    fileSystem: virtualFileSystem(files),
  });
}

function only(source: string): FormFacts {
  const forms: Array<FormFacts> = scan({ "Page.tsx": source });

  expect(forms).toHaveLength(1);

  return forms[0]!;
}

const TOGGLE: string = `{ field: { isEnabled: true }, title: "Enabled", fieldType: FormFieldSchemaType.Toggle, required: false }`;
const CHECKBOX: string = `{ field: { isEnabled: true }, title: "Enabled", fieldType: FormFieldSchemaType.Checkbox }`;
const TEXT: string = `{ field: { name: true }, title: "Name", fieldType: FormFieldSchemaType.Text }`;

describe("the one-switch form detector", () => {
  test("a card whose form is one Toggle is one switch", () => {
    const form: FormFacts = only(
      `const Page = () => <CardModelDetail name="Settings" formFields={[${TOGGLE}]} />;`,
    );

    expect(isOneSwitchForm(form)).toBe(true);
    expect(columnOf(form)).toBe("isEnabled");
    expect(oneSwitchCards([form])).toEqual([form]);
  });

  test("so is a card whose form is one Checkbox", () => {
    expect(
      isOneSwitchForm(
        only(
          `const Page = () => <CardModelDetail name="Settings" formFields={[${CHECKBOX}]} />;`,
        ),
      ),
    ).toBe(true);
  });

  test("a switch and another field is a form, not a switch", () => {
    expect(
      isOneSwitchForm(
        only(
          `const Page = () => <CardModelDetail name="Settings" formFields={[${TOGGLE}, ${TEXT}]} />;`,
        ),
      ),
    ).toBe(false);
  });

  test("one field that is not a switch is not one switch", () => {
    expect(
      isOneSwitchForm(
        only(
          `const Page = () => <CardModelDetail name="Settings" formFields={[${TEXT}]} />;`,
        ),
      ),
    ).toBe(false);
  });

  test("a registration that is never shown does not count", () => {
    const form: FormFacts = only(
      `const Page = () => <CardModelDetail name="Settings" formFields={[${TOGGLE}, { field: { projectId: true }, title: "Project", fieldType: FormFieldSchemaType.Text, showIf: () => { return false; } }]} />;`,
    );

    expect(isOneSwitchForm(form)).toBe(true);
  });

  test("a field shown under a condition counts: the form can be longer", () => {
    expect(
      isOneSwitchForm(
        only(
          `const Page = () => <CardModelDetail name="Settings" formFields={[${TOGGLE}, { field: { password: true }, title: "Password", fieldType: FormFieldSchemaType.Password, showIf: (values) => { return Boolean(values.isEnabled); } }]} />;`,
        ),
      ),
    ).toBe(false);
  });

  test("fields kept in a constant are followed", () => {
    const form: FormFacts = only(
      `const FIELDS = [${TOGGLE}];
       const Page = () => <CardModelDetail name="Settings" formFields={FIELDS} />;`,
    );

    expect(isOneSwitchForm(form)).toBe(true);
  });

  test("fields it cannot follow are not judged", () => {
    const form: FormFacts = only(
      `const Page = (props) => <CardModelDetail name="Settings" formFields={props.fields} />;`,
    );

    expect(isOneSwitchForm(form)).toBe(false);
  });

  test("a table row's form with one switch is not a card", () => {
    const forms: Array<FormFacts> = scan({
      "Page.tsx": `const Page = () => <ModelTable name="Rows" isEditable={true} formFields={[${TOGGLE}]} />;`,
    });

    expect(isOneSwitchForm(forms[0]!)).toBe(true);
    expect(oneSwitchCards(forms)).toEqual([]);
  });
});

describe("one-switch cards in the frontends", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  const cards: Array<FormFacts> = oneSwitchCards(forms);

  const isListed: (form: FormFacts) => boolean = (form: FormFacts): boolean => {
    return ONE_SWITCH_CARDS_LEFT.some((entry: OneSwitchCardLeft): boolean => {
      return entry.file === form.file && entry.column === columnOf(form);
    });
  };

  // A broken walk must not pass by finding nothing.
  test("are really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(forms.filter(isCard).length).toBeGreaterThan(100);
    expect(cards.length).toBeGreaterThan(0);
  });

  test("every card that is one switch is converted, or listed with its task", () => {
    const unlisted: Array<string> = cards
      .filter((form: FormFacts): boolean => {
        return !isListed(form);
      })
      .map(describeCard);

    /*
     * A card whose Edit dialog holds one switch. Draw it as a
     * ModelSwitchCard (Common/UI/Components/ModelSwitch/ModelSwitchCard):
     * the switch saves when it is flipped. Only if it really cannot be one
     * yet, list it in ONE_SWITCH_CARDS_LEFT with why.
     */
    expect(unlisted).toEqual([]);
  });

  test("every listed card is still one switch: a converted card leaves the list", () => {
    const gone: Array<string> = ONE_SWITCH_CARDS_LEFT.filter(
      (entry: OneSwitchCardLeft): boolean => {
        return !cards.some((form: FormFacts): boolean => {
          return entry.file === form.file && entry.column === columnOf(form);
        });
      },
    ).map((entry: OneSwitchCardLeft): string => {
      return `${entry.file} (${entry.column}): ${entry.card}`;
    });

    expect(gone).toEqual([]);
  });

  test("each listed card is listed once, with its task and a reason", () => {
    const keys: Array<string> = ONE_SWITCH_CARDS_LEFT.map(
      (entry: OneSwitchCardLeft): string => {
        return `${entry.file}::${entry.column}`;
      },
    );

    expect(new Set(keys).size).toBe(keys.length);

    for (const entry of ONE_SWITCH_CARDS_LEFT) {
      expect([entry.card, ONE_SWITCH_CARD_TASKS.includes(entry.task)]).toEqual([
        entry.card,
        true,
      ]);
      expect(entry.card.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  test("no monitor page has a one-switch card", () => {
    const monitorCards: Array<string> = cards
      .filter((form: FormFacts): boolean => {
        return form.file.startsWith(`${DASHBOARD}/Pages/Monitor/`);
      })
      .map(describeCard);

    expect(monitorCards).toEqual([]);
    expect(
      ONE_SWITCH_CARDS_LEFT.filter((entry: OneSwitchCardLeft): boolean => {
        return entry.file.startsWith(`${DASHBOARD}/Pages/Monitor/`);
      }),
    ).toEqual([]);
  });

  test("a status page's one-switch cards are only who may see it, which the access task owns", () => {
    const statusPageCards: Array<FormFacts> = cards.filter(
      (form: FormFacts): boolean => {
        return form.file.startsWith(`${DASHBOARD}/Pages/StatusPages/`);
      },
    );

    for (const form of statusPageCards) {
      const entry: OneSwitchCardLeft | undefined = ONE_SWITCH_CARDS_LEFT.find(
        (candidate: OneSwitchCardLeft): boolean => {
          return (
            candidate.file === form.file && candidate.column === columnOf(form)
          );
        },
      );

      expect([describeCard(form), entry?.task]).toEqual([
        describeCard(form),
        STATUS_PAGE_ACCESS_TASK,
      ]);
    }

    // Embedded Status and MCP are switches that save when flipped.
    const converted: Array<string> = [
      `${DASHBOARD}/Pages/StatusPages/View/EmbeddedStatus.tsx`,
      `${DASHBOARD}/Pages/StatusPages/View/Mcp.tsx`,
    ];

    for (const file of converted) {
      expect([
        file,
        forms.filter((form: FormFacts): boolean => {
          return form.file === file && isCard(form);
        }).length,
      ]).toEqual([file, 0]);
    }
  });

  /*
   * Incidents, alerts, episodes, scheduled maintenance, runbooks, SLOs, RUM
   * and AI Insights: every one-switch card there saves on flip now, the
   * incident and alert AI settings included, and none may be listed.
   */
  test("the event, runbook, SLO, RUM and AI pages have no one-switch card", () => {
    const areas: Array<{ directory: string; ownedBy: Array<string> }> = [
      { directory: `${DASHBOARD}/Pages/Incidents/`, ownedBy: [] },
      { directory: `${DASHBOARD}/Pages/Alerts/`, ownedBy: [] },
      {
        directory: `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/`,
        ownedBy: [],
      },
      { directory: `${DASHBOARD}/Pages/Runbook/`, ownedBy: [] },
      { directory: `${DASHBOARD}/Pages/Slo/`, ownedBy: [] },
      { directory: `${DASHBOARD}/Pages/Rum/`, ownedBy: [] },
      { directory: `${DASHBOARD}/Pages/AIInsights/`, ownedBy: [] },
      { directory: `${DASHBOARD}/Components/AISettings/`, ownedBy: [] },
    ];

    for (const area of areas) {
      const unowned: Array<string> = cards
        .filter((form: FormFacts): boolean => {
          if (!form.file.startsWith(area.directory)) {
            return false;
          }

          const entry: OneSwitchCardLeft | undefined =
            ONE_SWITCH_CARDS_LEFT.find(
              (candidate: OneSwitchCardLeft): boolean => {
                return (
                  candidate.file === form.file &&
                  candidate.column === columnOf(form)
                );
              },
            );

          return !entry || !area.ownedBy.includes(entry.task);
        })
        .map(describeCard);

      expect([area.directory, unowned]).toEqual([area.directory, []]);

      const listed: Array<string> = ONE_SWITCH_CARDS_LEFT.filter(
        (entry: OneSwitchCardLeft): boolean => {
          return (
            entry.file.startsWith(area.directory) &&
            !area.ownedBy.includes(entry.task)
          );
        },
      ).map((entry: OneSwitchCardLeft): string => {
        return `${entry.file} (${entry.column})`;
      });

      expect([area.directory, listed]).toEqual([area.directory, []]);
    }
  });

  test("the cards the monitor, status page, event, runbook, SLO, RUM and AI areas converted stay converted", () => {
    const retired: Array<{ file: string; column: string }> = [
      {
        file: `${DASHBOARD}/Pages/Monitor/View/Settings.tsx`,
        column: "disableActiveMonitoring",
      },
      {
        file: `${DASHBOARD}/Pages/Monitor/Settings/MonitorProbes.tsx`,
        column: "doNotAddGlobalProbesByDefaultOnNewMonitors",
      },
      {
        file: `${DASHBOARD}/Pages/StatusPages/View/EmbeddedStatus.tsx`,
        column: "enableEmbeddedOverallStatus",
      },
      {
        file: `${DASHBOARD}/Pages/StatusPages/View/Mcp.tsx`,
        column: "enableMcpServer",
      },
      {
        file: `${DASHBOARD}/Pages/Incidents/View/Settings.tsx`,
        column: "enableReminders",
      },
      {
        file: `${DASHBOARD}/Pages/Alerts/View/Settings.tsx`,
        column: "isPrivate",
      },
      {
        file: `${DASHBOARD}/Pages/Alerts/View/Settings.tsx`,
        column: "enableReminders",
      },
      {
        file: `${DASHBOARD}/Pages/Incidents/EpisodeView/Settings.tsx`,
        column: "isVisibleOnStatusPage",
      },
      {
        file: `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/View/Settings.tsx`,
        column: "isVisibleOnStatusPage",
      },
      {
        file: `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/View/Settings.tsx`,
        column: "enableReminders",
      },
      {
        file: `${DASHBOARD}/Pages/Runbook/View/Settings.tsx`,
        column: "isEnabled",
      },
      {
        file: `${DASHBOARD}/Pages/Slo/View/Settings.tsx`,
        column: "isEnabled",
      },
      {
        file: `${DASHBOARD}/Pages/Rum/Settings/SessionReplay.tsx`,
        column: "isSessionReplayAllowed",
      },
      /*
       * The AI settings pages: every AI behaviour is a switch that saves on
       * flip (Components/AISettings), never a field of an Edit dialog again
       * - the incident and alert pages' Advanced cards hold only limits.
       */
      {
        file: `${DASHBOARD}/Pages/Settings/AIFeatures.tsx`,
        column: "enableAi",
      },
      ...[
        "enableAutomaticIncidentInvestigation",
        "enableAutomaticPostmortemDraft",
        "enableAutomaticIncidentCodeFixes",
        "enableIncidentInstrumentationFixTasks",
      ].map((column: string): { file: string; column: string } => {
        return {
          file: `${DASHBOARD}/Pages/Incidents/Settings/IncidentAISettings.tsx`,
          column,
        };
      }),
      ...[
        "enableAutomaticAlertInvestigation",
        "enableAutomaticAlertCodeFixes",
        "enableAlertInstrumentationFixTasks",
      ].map((column: string): { file: string; column: string } => {
        return {
          file: `${DASHBOARD}/Pages/Alerts/Settings/AlertAISettings.tsx`,
          column,
        };
      }),
      ...[
        "enableAiInsights",
        "enableInsightFixTasks",
        "autoArchiveNonActionableExceptions",
      ].map((column: string): { file: string; column: string } => {
        return {
          file: `${DASHBOARD}/Pages/AIInsights/Settings.tsx`,
          column,
        };
      }),
    ];

    for (const card of retired) {
      const fieldsWritingIt: Array<FormFieldFacts> = forms
        .filter((form: FormFacts): boolean => {
          return form.file === card.file && isCard(form);
        })
        .flatMap((form: FormFacts): Array<FormFieldFacts> => {
          return form.fields;
        })
        .filter((field: FormFieldFacts): boolean => {
          return field.key === card.column;
        });

      expect([card.file, card.column, fieldsWritingIt.length]).toEqual([
        card.file,
        card.column,
        0,
      ]);
    }
  });

  /*
   * Project Settings and the admin dashboard: customer support access,
   * monitor groups, requiring SSO (the project's and the whole server's),
   * sign up, project creation, master admin and Enable AI are switches
   * that save on flip, asking first where one can lock people out or
   * stop every AI feature. No card under the Dashboard's Pages/Settings
   * may be listed, the admin dashboard has none, and neither may an
   * Enterprise admin screen.
   */
  test("Project Settings and the admin dashboard have no one-switch card", () => {
    const areas: Array<{ directory: string; ownedBy: Array<string> }> = [
      { directory: `${DASHBOARD}/Pages/Settings/`, ownedBy: [] },
      { directory: `${ADMIN_DASHBOARD}/`, ownedBy: [] },
      { directory: "ee/AdminDashboard/", ownedBy: [] },
    ];

    for (const area of areas) {
      const unowned: Array<string> = cards
        .filter((form: FormFacts): boolean => {
          if (!form.file.startsWith(area.directory)) {
            return false;
          }

          const entry: OneSwitchCardLeft | undefined =
            ONE_SWITCH_CARDS_LEFT.find(
              (candidate: OneSwitchCardLeft): boolean => {
                return (
                  candidate.file === form.file &&
                  candidate.column === columnOf(form)
                );
              },
            );

          return !entry || !area.ownedBy.includes(entry.task);
        })
        .map(describeCard);

      expect([area.directory, unowned]).toEqual([area.directory, []]);

      const listed: Array<string> = ONE_SWITCH_CARDS_LEFT.filter(
        (entry: OneSwitchCardLeft): boolean => {
          return (
            entry.file.startsWith(area.directory) &&
            !area.ownedBy.includes(entry.task)
          );
        },
      ).map((entry: OneSwitchCardLeft): string => {
        return `${entry.file} (${entry.column})`;
      });

      expect([area.directory, listed]).toEqual([area.directory, []]);
    }

    // The walk really reads both dashboards' settings pages.
    for (const directory of [
      `${DASHBOARD}/Pages/Settings/`,
      `${ADMIN_DASHBOARD}/Pages/`,
    ]) {
      expect([
        directory,
        forms.filter((form: FormFacts): boolean => {
          return form.file.startsWith(directory) && isCard(form);
        }).length > 0,
      ]).toEqual([directory, true]);
    }
  });

  test("the cards Project Settings and the admin dashboard converted stay converted", () => {
    const retired: Array<{ file: string; column: string }> = [
      {
        file: `${DASHBOARD}/Pages/Settings/ProjectSettings.tsx`,
        column: "letCustomerSupportAccessProject",
      },
      {
        file: `${DASHBOARD}/Pages/Settings/FeatureFlags.tsx`,
        column: "isFeatureFlagMonitorGroupsEnabled",
      },
      {
        file: `${DASHBOARD}/Pages/Settings/SSO.tsx`,
        column: "requireSsoForLogin",
      },
      {
        file: `${ADMIN_DASHBOARD}/Pages/Projects/View/Support.tsx`,
        column: "letCustomerSupportAccessProject",
      },
      {
        file: `${ADMIN_DASHBOARD}/Pages/Settings/Authentication/Index.tsx`,
        column: "disableSignup",
      },
      {
        file: `${ADMIN_DASHBOARD}/Pages/Settings/Authentication/Index.tsx`,
        column: "requireSsoForLogin",
      },
      {
        file: `${ADMIN_DASHBOARD}/Pages/Settings/Authentication/Index.tsx`,
        column: "disableUserProjectCreation",
      },
      {
        file: `${ADMIN_DASHBOARD}/Pages/Users/View/Settings.tsx`,
        column: "isMasterAdmin",
      },
    ];

    for (const card of retired) {
      const fieldsWritingIt: Array<FormFieldFacts> = forms
        .filter((form: FormFacts): boolean => {
          return form.file === card.file && isCard(form);
        })
        .flatMap((form: FormFacts): Array<FormFieldFacts> => {
          return form.fields;
        })
        .filter((field: FormFieldFacts): boolean => {
          return field.key === card.column;
        });

      expect([card.file, card.column, fieldsWritingIt.length]).toEqual([
        card.file,
        card.column,
        0,
      ]);
    }
  });
});
