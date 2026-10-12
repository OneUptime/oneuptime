import {
  AUTOMATIC_FIX_PULL_REQUESTS,
  AUTOMATIC_FIX_SWITCH_COLUMNS,
  AutomaticFixPullRequest,
  AutomaticFixPullRequestBlocker,
  AutomaticFixSwitchValues,
  getAutomaticFixPullRequestBlocker,
  getAutomaticFixPullRequestColumns,
  getAutomaticFixPullRequestSelect,
  getAutomaticFixSignal,
} from "../../../Types/AI/AutomaticFixSwitches";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import Project from "../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The one rule behind "Fix new incidents automatically" (and alerts) and the
 * two pull-request switches under it (Types/AI/AutomaticFixSwitches): a pull
 * request opens on its own only while its own switch AND the fix switch are
 * on. The server's triggers and the settings pages read the same columns
 * from here.
 */

const SIGNALS: Array<AutoRemediationTriggerEntity> = [
  AutoRemediationTriggerEntity.Incident,
  AutoRemediationTriggerEntity.Alert,
];

const PULL_REQUESTS: Array<AutomaticFixPullRequest> = [
  AutomaticFixPullRequest.CodeFix,
  AutomaticFixPullRequest.MissingTelemetry,
];

// The values a project row can hold for a switch, as read.
const VALUES: Array<boolean | null | undefined> = [
  true,
  false,
  null,
  undefined,
];

describe("the columns", () => {
  test("each signal has its fixing switch and the two pull requests under it", () => {
    expect(AUTOMATIC_FIX_SWITCH_COLUMNS).toEqual({
      [AutoRemediationTriggerEntity.Incident]: {
        fix: "enableAutomaticIncidentRemediation",
        pullRequests: {
          [AutomaticFixPullRequest.CodeFix]: "enableAutomaticIncidentCodeFixes",
          [AutomaticFixPullRequest.MissingTelemetry]:
            "enableIncidentInstrumentationFixTasks",
        },
      },
      [AutoRemediationTriggerEntity.Alert]: {
        fix: "enableAutomaticAlertRemediation",
        pullRequests: {
          [AutomaticFixPullRequest.CodeFix]: "enableAutomaticAlertCodeFixes",
          [AutomaticFixPullRequest.MissingTelemetry]:
            "enableAlertInstrumentationFixTasks",
        },
      },
    });
  });

  test("the pull requests are drawn code fix first, then missing telemetry", () => {
    expect(AUTOMATIC_FIX_PULL_REQUESTS).toEqual([
      AutomaticFixPullRequest.CodeFix,
      AutomaticFixPullRequest.MissingTelemetry,
    ]);
    expect(
      getAutomaticFixPullRequestColumns(AutoRemediationTriggerEntity.Incident),
    ).toEqual([
      "enableAutomaticIncidentCodeFixes",
      "enableIncidentInstrumentationFixTasks",
    ]);
    expect(
      getAutomaticFixPullRequestColumns(AutoRemediationTriggerEntity.Alert),
    ).toEqual([
      "enableAutomaticAlertCodeFixes",
      "enableAlertInstrumentationFixTasks",
    ]);
  });

  test("every one of them is a real boolean Project column that defaults off", () => {
    const project: Project = new Project();

    for (const signal of SIGNALS) {
      for (const column of [
        AUTOMATIC_FIX_SWITCH_COLUMNS[signal].fix,
        ...getAutomaticFixPullRequestColumns(signal),
      ]) {
        const metadata: ReturnType<Project["getTableColumnMetadata"]> =
          project.getTableColumnMetadata(column);

        expect([column, metadata?.type, metadata?.defaultValue]).toEqual([
          column,
          TableColumnType.Boolean,
          false,
        ]);
      }
    }
  });

  test("the two signals share no column", () => {
    const incident: Array<string> = [
      AUTOMATIC_FIX_SWITCH_COLUMNS[AutoRemediationTriggerEntity.Incident].fix,
      ...getAutomaticFixPullRequestColumns(
        AutoRemediationTriggerEntity.Incident,
      ),
    ];
    const alert: Array<string> = [
      AUTOMATIC_FIX_SWITCH_COLUMNS[AutoRemediationTriggerEntity.Alert].fix,
      ...getAutomaticFixPullRequestColumns(AutoRemediationTriggerEntity.Alert),
    ];

    expect(
      incident.filter((column: string): boolean => {
        return alert.includes(column);
      }),
    ).toEqual([]);
  });
});

describe("getAutomaticFixSignal", () => {
  const incidentId: ObjectID = ObjectID.generate();
  const alertId: ObjectID = ObjectID.generate();

  test("an incident or an alert, from the subject the investigation was about", () => {
    expect(getAutomaticFixSignal({ incidentId })).toBe(
      AutoRemediationTriggerEntity.Incident,
    );
    expect(getAutomaticFixSignal({ alertId })).toBe(
      AutoRemediationTriggerEntity.Alert,
    );
    expect(getAutomaticFixSignal({ incidentId, alertId: undefined })).toBe(
      AutoRemediationTriggerEntity.Incident,
    );
  });

  test("no subject, or both, is no signal: nothing may borrow either lane's switches", () => {
    expect(getAutomaticFixSignal({})).toBeNull();
    expect(getAutomaticFixSignal({ incidentId, alertId })).toBeNull();
    expect(
      getAutomaticFixSignal({ incidentId: undefined, alertId: null }),
    ).toBeNull();
  });
});

describe("getAutomaticFixPullRequestBlocker: the one rule", () => {
  /*
   * The whole truth table, for both signals and both kinds of pull request:
   * only true under true opens; the fixing switch is named first.
   */
  for (const signal of SIGNALS) {
    for (const pullRequest of PULL_REQUESTS) {
      for (const fix of VALUES) {
        for (const own of VALUES) {
          const expected: AutomaticFixPullRequestBlocker | null =
            fix !== true
              ? AutomaticFixPullRequestBlocker.FixOff
              : own !== true
                ? AutomaticFixPullRequestBlocker.PullRequestOff
                : null;

          test(`${signal} ${pullRequest}: fixing ${String(fix)}, its own switch ${String(own)} -> ${String(expected)}`, () => {
            const project: AutomaticFixSwitchValues = {
              [AUTOMATIC_FIX_SWITCH_COLUMNS[signal].fix]: fix,
              [AUTOMATIC_FIX_SWITCH_COLUMNS[signal].pullRequests[pullRequest]]:
                own,
            };

            expect(
              getAutomaticFixPullRequestBlocker({
                project,
                signal,
                pullRequest,
              }),
            ).toBe(expected);
          });
        }
      }
    }
  }

  test("the other signal's switches, all on, open nothing for this one", () => {
    for (const signal of SIGNALS) {
      const other: AutoRemediationTriggerEntity =
        signal === AutoRemediationTriggerEntity.Incident
          ? AutoRemediationTriggerEntity.Alert
          : AutoRemediationTriggerEntity.Incident;
      const project: AutomaticFixSwitchValues = {
        [AUTOMATIC_FIX_SWITCH_COLUMNS[other].fix]: true,
      };

      for (const column of getAutomaticFixPullRequestColumns(other)) {
        project[column] = true;
      }

      for (const pullRequest of PULL_REQUESTS) {
        expect(
          getAutomaticFixPullRequestBlocker({ project, signal, pullRequest }),
        ).toBe(AutomaticFixPullRequestBlocker.FixOff);
      }
    }
  });

  test("the other kind of pull request's switch does not open this one", () => {
    const project: AutomaticFixSwitchValues = {
      enableAutomaticIncidentRemediation: true,
      enableIncidentInstrumentationFixTasks: true,
    };

    expect(
      getAutomaticFixPullRequestBlocker({
        project,
        signal: AutoRemediationTriggerEntity.Incident,
        pullRequest: AutomaticFixPullRequest.CodeFix,
      }),
    ).toBe(AutomaticFixPullRequestBlocker.PullRequestOff);
    expect(
      getAutomaticFixPullRequestBlocker({
        project,
        signal: AutoRemediationTriggerEntity.Incident,
        pullRequest: AutomaticFixPullRequest.MissingTelemetry,
      }),
    ).toBeNull();
  });

  test("a Project row decides the same way as a plain object", () => {
    const project: Project = new Project();
    project.enableAutomaticAlertRemediation = true;
    project.enableAutomaticAlertCodeFixes = true;

    expect(
      getAutomaticFixPullRequestBlocker({
        project,
        signal: AutoRemediationTriggerEntity.Alert,
        pullRequest: AutomaticFixPullRequest.CodeFix,
      }),
    ).toBeNull();

    project.enableAutomaticAlertRemediation = false;

    expect(
      getAutomaticFixPullRequestBlocker({
        project,
        signal: AutoRemediationTriggerEntity.Alert,
        pullRequest: AutomaticFixPullRequest.CodeFix,
      }),
    ).toBe(AutomaticFixPullRequestBlocker.FixOff);
  });
});

describe("getAutomaticFixPullRequestSelect", () => {
  test("a server read selects the fixing switch and the pull request's own switch, nothing else", () => {
    expect(
      getAutomaticFixPullRequestSelect(
        AutoRemediationTriggerEntity.Incident,
        AutomaticFixPullRequest.CodeFix,
      ),
    ).toEqual({
      enableAutomaticIncidentRemediation: true,
      enableAutomaticIncidentCodeFixes: true,
    });
    expect(
      getAutomaticFixPullRequestSelect(
        AutoRemediationTriggerEntity.Incident,
        AutomaticFixPullRequest.MissingTelemetry,
      ),
    ).toEqual({
      enableAutomaticIncidentRemediation: true,
      enableIncidentInstrumentationFixTasks: true,
    });
    expect(
      getAutomaticFixPullRequestSelect(
        AutoRemediationTriggerEntity.Alert,
        AutomaticFixPullRequest.CodeFix,
      ),
    ).toEqual({
      enableAutomaticAlertRemediation: true,
      enableAutomaticAlertCodeFixes: true,
    });
    expect(
      getAutomaticFixPullRequestSelect(
        AutoRemediationTriggerEntity.Alert,
        AutomaticFixPullRequest.MissingTelemetry,
      ),
    ).toEqual({
      enableAutomaticAlertRemediation: true,
      enableAlertInstrumentationFixTasks: true,
    });
  });

  test("what it selects is exactly what the rule reads", () => {
    for (const signal of SIGNALS) {
      for (const pullRequest of PULL_REQUESTS) {
        const select: Record<string, unknown> =
          getAutomaticFixPullRequestSelect(signal, pullRequest);
        const project: AutomaticFixSwitchValues = {};

        for (const column of Object.keys(select)) {
          (project as Record<string, boolean>)[column] = true;
        }

        expect([
          signal,
          pullRequest,
          getAutomaticFixPullRequestBlocker({ project, signal, pullRequest }),
        ]).toEqual([signal, pullRequest, null]);
      }
    }
  });
});
