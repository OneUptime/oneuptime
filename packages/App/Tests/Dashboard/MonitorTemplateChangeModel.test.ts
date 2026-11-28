import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MONITOR_NOT_REACHED_FAILED,
  MONITOR_NOT_REACHED_STOPPED,
  MONITOR_NO_LONGER_THE_POLICYS,
  MONITOR_TEMPLATE_CHANGE_OWN_REASONS,
  MonitorTemplateChangeKind,
  MonitorTemplateChangeLine,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeProgress,
  MonitorTemplateChangeSettings,
  MonitorTemplateChangeStatus,
  MonitorTemplateChangeView,
  emptyMonitorTemplateChangeProgress,
} from "Common/Types/Monitor/MonitorTemplateChange";
import { Translator, createTranslator } from "Common/Types/Translator";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";
import {
  APPLY_SETTINGS_DESCRIPTION,
  APPLY_SETTINGS_TITLE,
  DELETE_CHOICE_DESCRIPTIONS,
  DELETE_CHOICE_TITLES,
  DELETE_LINKED_QUESTION,
  DELETE_MOVE_FIRST_HINT,
  DeleteChoice,
  MONITOR_TEMPLATE_CHANGE_TRANSLATED_REASONS,
  MONITOR_TEMPLATE_CHANGE_WAITING_AFTER_MS,
  MonitorTemplateChangeIssueGroup,
  MonitorTemplateChangePhase,
  NEVER_MADE_AGAIN,
  POLICY_MOVE_BUTTON,
  POLICY_MOVE_BUTTON_UNCOUNTED,
  POLICY_MOVE_MONITORS,
  POLICY_MOVE_MONITORS_UNCOUNTED,
  POLICY_MOVE_TITLE,
  RETRY_BUTTON,
  RULE_MOVE_BUTTON,
  RULE_MOVE_CHOICE_DESCRIPTIONS,
  RULE_MOVE_CHOICE_TITLES,
  RULE_MOVE_QUESTION,
  RULE_MOVE_TITLE,
  RULE_SAVE_WITHOUT_MOVING_BUTTON,
  RuleMoveChoice,
  SETTINGS_KEPT,
  SETTINGS_REPLACED,
  UNLINK_CHOICE_DESCRIPTIONS,
  UNLINK_CHOICE_TITLES,
  UnlinkChoice,
  WHAT_STAYS,
  getIssueGroupTitle,
  getMonitorTemplateChangeCounts,
  getMonitorTemplateChangeDescription,
  getMonitorTemplateChangeIssueGroups,
  getMonitorTemplateChangeLine,
  getMonitorTemplateChangePercent,
  getMonitorTemplateChangePhase,
  getMonitorTemplateChangeTitle,
  getMonitorsReached,
  isMonitorTemplateChangePhaseActive,
} from "../../FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeModel";

/*
 * What the dialogs that change monitors' template say (issues #11260,
 * #11266): before anything changes, exactly what will - "a confirmation
 * warning that criteria will be replaced" - and what stays; then how far the
 * change on the server got, what it left out and why, and how many Retry
 * tries again. "851 of 851 monitors could not be linked" said none of it.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.replace(/\.json$/, "");
  })
  .sort();

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const values: Record<string, string> = locale(language);

  return createTranslator((text: string): string | undefined => {
    return values[text];
  }, language);
}

const ENGLISH: Translator = createTranslator(undefined, "en");

const CREATED_AT: string = "2026-11-28T09:00:00.000Z";
const CREATED_AT_MS: number = new Date(CREATED_AT).getTime();

const LINK: MonitorTemplateChangeSettings = {
  kind: MonitorTemplateChangeKind.Link,
  applyTemplateSettings: true,
  clearTemplateSettings: false,
  deleteTemplateWhenDone: false,
};

const UNLINK: MonitorTemplateChangeSettings = {
  kind: MonitorTemplateChangeKind.Unlink,
  applyTemplateSettings: false,
  clearTemplateSettings: false,
  deleteTemplateWhenDone: false,
};

const DELETE: MonitorTemplateChangeSettings = {
  kind: MonitorTemplateChangeKind.Unlink,
  applyTemplateSettings: false,
  clearTemplateSettings: true,
  deleteTemplateWhenDone: true,
};

function progress(
  values: Partial<MonitorTemplateChangeProgress>,
): MonitorTemplateChangeProgress {
  return { ...emptyMonitorTemplateChangeProgress(0), ...values };
}

function view(
  overrides: Partial<MonitorTemplateChangeView> = {},
): MonitorTemplateChangeView {
  return {
    id: "change-1",
    status: MonitorTemplateChangeStatus.Running,
    settings: LINK,
    monitorTemplateId: "template-b",
    monitorTemplateName: "Switches (new)",
    progress: progress({ total: 2000 }),
    lines: [],
    isLinesTruncated: false,
    isStopRequested: false,
    retryableCount: 0,
    isTemplateDeleted: false,
    isAutoImportRulePointed: false,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function title(
  change: MonitorTemplateChangeView,
  translator: Translator = ENGLISH,
): string {
  return getMonitorTemplateChangeTitle({
    translator: translator,
    view: change,
    phase: getMonitorTemplateChangePhase(change, CREATED_AT_MS + 1000),
  });
}

function description(change: MonitorTemplateChangeView): string {
  return getMonitorTemplateChangeDescription({
    translator: ENGLISH,
    view: change,
    phase: getMonitorTemplateChangePhase(change, CREATED_AT_MS + 1000),
  });
}

function line(
  monitorId: string,
  outcome: MonitorTemplateChangeLine["outcome"],
  reason: string,
  monitorName?: string,
): MonitorTemplateChangeLine {
  return {
    monitorId: monitorId,
    outcome: outcome,
    reason: reason,
    ...(monitorName ? { monitorName: monitorName } : {}),
  };
}

const IN_THE_WAY: string =
  "The device this monitor was made for already has a monitor linked to this template: core-sw-01 (new). Delete one of the two, or link this one to another template.";

describe("what a choice says before anything changes", () => {
  test("Unlink's two choices, for one monitor and for many", () => {
    expect(
      [UnlinkChoice.KeepSettings, UnlinkChoice.ClearCriteria].map(
        (choice: UnlinkChoice): Array<string> => {
          return [
            ENGLISH.translatePlural(UNLINK_CHOICE_TITLES[choice], 1),
            ENGLISH.translatePlural(UNLINK_CHOICE_TITLES[choice], 851),
          ];
        },
      ),
    ).toEqual([
      ["Keep its settings", "Keep their settings"],
      [
        "Clear the template's criteria",
        "Clear the template's criteria from them",
      ],
    ]);

    // Keep: still checking and alerting, as a monitor of its own.
    expect(
      ENGLISH.translatePlural(
        UNLINK_CHOICE_DESCRIPTIONS[UnlinkChoice.KeepSettings],
        1,
      ),
    ).toBe(
      "It keeps checking and alerting with the criteria it has now, as a monitor of its own, and no longer gets this template's updates.",
    );

    // Clear: still checking, but nothing fires - and what it left open is resolved.
    expect(
      ENGLISH.translatePlural(
        UNLINK_CHOICE_DESCRIPTIONS[UnlinkChoice.ClearCriteria],
        851,
      ),
    ).toBe(
      "They keep checking, but raise no incidents or alerts and set no status until you link them to a template again. Open incidents and alerts their criteria were set to resolve are resolved.",
    );
  });

  test("what always stays - the customer's history, labels, owners and incident links - is said under every choice", () => {
    for (const count of [1, 851]) {
      const stays: string = ENGLISH.translatePlural(WHAT_STAYS, count);

      for (const kept of ["history", "labels", "owners", "incidents"]) {
        expect({ count, kept, said: stays.includes(kept) }).toEqual({
          count,
          kept,
          said: true,
        });
      }
    }

    // And that whatever made the monitor never makes it again.
    expect(ENGLISH.translatePlural(NEVER_MADE_AGAIN, 1)).toBe(
      "If an import, an auto import rule or an alert policy made it, it is never made again.",
    );
    expect(ENGLISH.translatePlural(NEVER_MADE_AGAIN, 851)).toBe(
      "Those that an import, an auto import rule or an alert policy made are never made again.",
    );
  });

  test("a move says the criteria will be replaced, or that they are kept when the switch is off", () => {
    expect(APPLY_SETTINGS_TITLE).toBe(
      "Use the template's criteria and interval",
    );
    expect(APPLY_SETTINGS_DESCRIPTION).toContain(
      "criteria, interval and probe agreement",
    );
    expect(ENGLISH.translatePlural(SETTINGS_REPLACED, 851)).toMatch(
      /^Their criteria, interval and probe agreement are replaced by the template's\./,
    );
    expect(ENGLISH.translatePlural(SETTINGS_REPLACED, 851)).toContain(
      "the new criteria open new ones if the problem is still there",
    );
    expect(ENGLISH.translatePlural(SETTINGS_KEPT, 1)).toBe(
      "It keeps its criteria and interval until you sync the template.",
    );
  });

  test("a template's delete asks what happens to its monitors, keeping their settings first", () => {
    expect(Object.keys(DELETE_CHOICE_TITLES)).toEqual([
      DeleteChoice.KeepSettings,
      DeleteChoice.ClearCriteria,
    ]);
    expect(DELETE_CHOICE_TITLES[DeleteChoice.KeepSettings]).toBe(
      "Keep their settings",
    );
    expect(DELETE_CHOICE_DESCRIPTIONS[DeleteChoice.KeepSettings]).toContain(
      "keep checking and alerting",
    );
    expect(DELETE_CHOICE_DESCRIPTIONS[DeleteChoice.ClearCriteria]).toContain(
      "raise no incidents or alerts",
    );
    expect(
      ENGLISH.translatePlural(DELETE_LINKED_QUESTION, 851, {
        count: ENGLISH.formatNumber(851),
        templateName: "Switches",
      }),
    ).toBe(
      "Switches is linked to 851 monitors. What should happen to them when the template is deleted?",
    );
    expect(DELETE_MOVE_FIRST_HINT).toContain("Move to Another Template");
  });
});

describe("the phase of a change", () => {
  test("queued: starting, then - after a while - waiting for another change", () => {
    const queued: MonitorTemplateChangeView = view({
      status: MonitorTemplateChangeStatus.Queued,
    });

    expect(getMonitorTemplateChangePhase(queued, CREATED_AT_MS + 1000)).toBe(
      MonitorTemplateChangePhase.Starting,
    );
    expect(
      getMonitorTemplateChangePhase(
        queued,
        CREATED_AT_MS + MONITOR_TEMPLATE_CHANGE_WAITING_AFTER_MS + 1,
      ),
    ).toBe(MonitorTemplateChangePhase.Waiting);
    expect(title(queued)).toBe("Starting the change…");
    expect(
      getMonitorTemplateChangeTitle({
        translator: ENGLISH,
        view: queued,
        phase: MonitorTemplateChangePhase.Waiting,
      }),
    ).toBe("Waiting for another change of this project's monitors to finish…");
  });

  test("running, stopping, finished, stopped, failed - and which of them are still going", () => {
    const phases: Array<MonitorTemplateChangePhase> = [
      view({ status: MonitorTemplateChangeStatus.Running }),
      view({
        status: MonitorTemplateChangeStatus.Running,
        isStopRequested: true,
      }),
      view({ status: MonitorTemplateChangeStatus.Completed }),
      view({ status: MonitorTemplateChangeStatus.Stopped }),
      view({ status: MonitorTemplateChangeStatus.Failed }),
    ].map((change: MonitorTemplateChangeView): MonitorTemplateChangePhase => {
      return getMonitorTemplateChangePhase(change, CREATED_AT_MS);
    });

    expect(phases).toEqual([
      MonitorTemplateChangePhase.Running,
      MonitorTemplateChangePhase.Stopping,
      MonitorTemplateChangePhase.Finished,
      MonitorTemplateChangePhase.Stopped,
      MonitorTemplateChangePhase.Failed,
    ]);
    expect(phases.map(isMonitorTemplateChangePhaseActive)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("the bar fills with the monitors the change got to", () => {
  test("not reached is not progress", () => {
    const stopped: MonitorTemplateChangeProgress = progress({
      total: 2000,
      processed: 2000,
      changed: 400,
      notReached: 1600,
    });

    expect(getMonitorsReached(stopped)).toBe(400);
    expect(getMonitorTemplateChangePercent(stopped)).toBe(20);
  });

  test("a change of nothing is full, not a division by zero, and the bar never overflows", () => {
    expect(getMonitorTemplateChangePercent(progress({ total: 0 }))).toBe(100);
    expect(
      getMonitorTemplateChangePercent(
        progress({ total: 3, processed: 5, changed: 5 }),
      ),
    ).toBe(100);
    expect(
      getMonitorsReached(progress({ total: 3, processed: 1, notReached: 2 })),
    ).toBe(0);
  });
});

describe("the headline", () => {
  test("while it runs: what it does, and to which template", () => {
    expect(title(view())).toBe("Linking monitors to Switches (new)…");
    expect(title(view({ settings: UNLINK }))).toBe(
      "Unlinking monitors from their template…",
    );
    expect(title(view({ settings: DELETE, monitorTemplateName: "Old" }))).toBe(
      "Clearing Old's criteria from its monitors…",
    );
    expect(
      title(
        view({
          status: MonitorTemplateChangeStatus.Running,
          isStopRequested: true,
        }),
      ),
    ).toBe("Stopping before the next monitor…");
  });

  test("once done: how many of how many, linked to the template or unlinked", () => {
    const done: MonitorTemplateChangeView = view({
      status: MonitorTemplateChangeStatus.Completed,
      progress: progress({ total: 2000, processed: 2000, changed: 2000 }),
    });

    expect(title(done)).toBe("2,000 monitors are linked to Switches (new)");
    expect(
      title({
        ...done,
        progress: progress({
          total: 2000,
          processed: 2000,
          changed: 1990,
          unchanged: 3,
          skipped: 7,
        }),
      }),
    ).toBe("1,993 of 2,000 monitors are linked to Switches (new)");
    expect(
      title({
        ...done,
        settings: UNLINK,
        progress: progress({ total: 1, processed: 1, changed: 1 }),
      }),
    ).toBe("1 monitor is unlinked");
    expect(
      title({
        ...done,
        settings: UNLINK,
        progress: progress({ total: 3, processed: 3, changed: 2, failed: 1 }),
      }),
    ).toBe("2 of 3 monitors are unlinked");
  });

  test("stopped: after how many, of the monitors it got to", () => {
    expect(
      title(
        view({
          status: MonitorTemplateChangeStatus.Stopped,
          progress: progress({
            total: 2000,
            processed: 2000,
            changed: 400,
            notReached: 1600,
          }),
        }),
      ),
    ).toBe("Stopped after 400 of 2,000 monitors");
  });

  test("a delete that cleared its monitors first says whether the template went", () => {
    const finished: MonitorTemplateChangeView = view({
      status: MonitorTemplateChangeStatus.Completed,
      settings: DELETE,
      monitorTemplateName: "Old",
      progress: progress({ total: 5, processed: 5, changed: 5 }),
    });

    expect(title({ ...finished, isTemplateDeleted: true })).toBe(
      "Old was deleted",
    );
    expect(title({ ...finished, templateStillLinkedCount: 2 })).toBe(
      "Old was not deleted",
    );
    expect(description({ ...finished, templateStillLinkedCount: 2 })).toBe(
      "2 monitors are still linked to it, so it was kept. Unlink them, then delete the template.",
    );
    expect(
      description({
        ...finished,
        templateDeleteError: "Monitor template not found",
      }),
    ).toBe("Monitor template not found");
  });

  test("an unlink from the Monitors list, from each monitor's own template, names none", () => {
    expect(
      title(
        view({
          settings: UNLINK,
          monitorTemplateId: undefined,
          monitorTemplateName: undefined,
        }),
      ),
    ).toBe("Unlinking monitors from their template…");
    expect(
      title(
        view({
          monitorTemplateName: undefined,
        }),
      ),
    ).toBe("Linking monitors to the template…");
  });

  test("in the reader's language, numbers as it writes them", () => {
    const done: MonitorTemplateChangeView = view({
      status: MonitorTemplateChangeStatus.Completed,
      progress: progress({ total: 2000, processed: 2000, changed: 2000 }),
    });
    const german: string = title(done, translatorFor("de"));
    const persian: string = title(done, translatorFor("fa"));

    expect(german).not.toBe(title(done));
    expect(german).toContain("2.000");
    expect(german).toContain("Switches (new)");
    expect(persian).toContain("۲٬۰۰۰");
  });
});

describe("the line under the headline", () => {
  test("while it runs: closing the dialog does not stop it, and the Monitors list and the template's page show it (#11454)", () => {
    expect(description(view())).toBe(
      "The server makes the change. You can close this dialog: it keeps going, and the Monitors list and this template's page show how far it got.",
    );
  });

  test("an unlink from the Monitors list, from each monitor's own template, comes back on the Monitors list (#11454)", () => {
    /*
     * It belongs to no template's page: before #11454, once its dialog was
     * closed nothing showed how far it got.
     */
    expect(
      description(
        view({
          settings: UNLINK,
          monitorTemplateId: undefined,
          monitorTemplateName: undefined,
        }),
      ),
    ).toBe(
      "The server makes the change. You can close this dialog: it keeps going, and the Monitors list shows how far it got.",
    );
  });

  test("once done: what Retry would do, or that every monitor kept what it had", () => {
    expect(
      description(
        view({
          status: MonitorTemplateChangeStatus.Completed,
          retryableCount: 3,
        }),
      ),
    ).toBe(
      "What changed is kept. Retry changes the monitors that failed or were not reached.",
    );
    expect(
      description(view({ status: MonitorTemplateChangeStatus.Completed })),
    ).toBe("Each monitor kept its history, labels, owners and incidents.");
  });
});

describe("the counts under the bar", () => {
  test("each said only when it is not zero, in the words of a link", () => {
    expect(
      getMonitorTemplateChangeCounts({
        translator: ENGLISH,
        view: view({
          progress: progress({
            total: 2007,
            processed: 2007,
            changed: 1990,
            unchanged: 3,
            skipped: 5,
            failed: 2,
            notReached: 7,
            resolvedIncidents: 12,
            resolvedAlerts: 1,
          }),
        }),
      }),
    ).toEqual([
      "1,990 linked",
      "3 linked already",
      "5 left out",
      "2 failed",
      "7 not reached",
      "12 open incidents resolved",
      "1 open alert resolved",
    ]);
  });

  test("and in the words of an unlink", () => {
    expect(
      getMonitorTemplateChangeCounts({
        translator: ENGLISH,
        view: view({
          settings: UNLINK,
          progress: progress({
            total: 4,
            processed: 4,
            changed: 3,
            unchanged: 1,
          }),
        }),
      }),
    ).toEqual(["3 unlinked", "1 linked to no template"]);
  });
});

describe("what was left out, and why", () => {
  test("a thousand monitors refused for one reason are one group with a thousand names", () => {
    const lines: Array<MonitorTemplateChangeLine> = [];

    for (let index: number = 0; index < 1000; index++) {
      lines.push(
        line(
          `m-${index}`,
          MonitorTemplateChangeOutcome.Skipped,
          IN_THE_WAY,
          `switch-${index}`,
        ),
      );
    }

    const groups: Array<MonitorTemplateChangeIssueGroup> =
      getMonitorTemplateChangeIssueGroups(lines);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.monitors).toHaveLength(1000);
    expect(groups[0]!.monitors[0]).toEqual({ id: "m-0", name: "switch-0" });
    expect(getIssueGroupTitle(ENGLISH, groups[0]!)).toBe(
      "1,000 monitors were left out",
    );
  });

  test("groups come in the order their reason was first met; the same words for another outcome are another group", () => {
    const groups: Array<MonitorTemplateChangeIssueGroup> =
      getMonitorTemplateChangeIssueGroups([
        line("a", MonitorTemplateChangeOutcome.Failed, "Monitor not found"),
        line("b", MonitorTemplateChangeOutcome.Skipped, IN_THE_WAY),
        line("c", MonitorTemplateChangeOutcome.Failed, "Monitor not found"),
        line("d", MonitorTemplateChangeOutcome.Skipped, "Monitor not found"),
        line(
          "e",
          MonitorTemplateChangeOutcome.NotReached,
          MONITOR_NOT_REACHED_STOPPED,
        ),
      ]);

    expect(
      groups.map((group: MonitorTemplateChangeIssueGroup) => {
        return [
          group.outcome,
          group.reason,
          group.monitors.map((monitor: { id: string }): string => {
            return monitor.id;
          }),
        ];
      }),
    ).toEqual([
      [MonitorTemplateChangeOutcome.Failed, "Monitor not found", ["a", "c"]],
      [MonitorTemplateChangeOutcome.Skipped, IN_THE_WAY, ["b"]],
      [MonitorTemplateChangeOutcome.Skipped, "Monitor not found", ["d"]],
      [
        MonitorTemplateChangeOutcome.NotReached,
        MONITOR_NOT_REACHED_STOPPED,
        ["e"],
      ],
    ]);
    expect(
      groups.map((group: MonitorTemplateChangeIssueGroup): string => {
        return getIssueGroupTitle(ENGLISH, group);
      }),
    ).toEqual([
      "2 monitors could not be changed",
      "1 monitor was left out",
      "1 monitor was left out",
      "1 monitor was not reached",
    ]);
  });

  test("Retry says how many it tries again", () => {
    expect(
      ENGLISH.translatePlural(RETRY_BUTTON, 1600, {
        count: ENGLISH.formatNumber(1600),
      }),
    ).toBe("Retry 1,600 monitors");
  });
});

describe("the change's own reasons are in every language", () => {
  const english: Record<string, string> = locale("en");

  test("the Dashboard records exactly the reasons the change writes", () => {
    /*
     * The issue groups look each reason up in the reader's language. A
     * reason the runner writes that the Dashboard never recorded would read
     * English in every language.
     */
    expect([...MONITOR_TEMPLATE_CHANGE_TRANSLATED_REASONS].sort()).toEqual(
      [...MONITOR_TEMPLATE_CHANGE_OWN_REASONS].sort(),
    );
    expect(MONITOR_TEMPLATE_CHANGE_OWN_REASONS).toEqual([
      MONITOR_NOT_REACHED_STOPPED,
      MONITOR_NOT_REACHED_FAILED,
      // A policy's move (#11452): a monitor someone moved or unlinked meanwhile.
      MONITOR_NO_LONGER_THE_POLICYS,
    ]);
  });

  test("each is a key of en.json, mapped to itself, and reads right under a heading for one monitor or for hundreds", () => {
    for (const reason of MONITOR_TEMPLATE_CHANGE_OWN_REASONS) {
      expect([reason, english[reason]]).toEqual([reason, reason]);
      expect(reason).not.toMatch(/\bthis monitor\b/i);
      expect(reason.endsWith(".")).toBe(true);
    }
  });
});

describe("every sentence the dialogs say is worded in every language the Dashboard speaks", () => {
  const english: Record<string, string> = locale("en");

  const counted: Array<PluralTemplate> = [
    UNLINK_CHOICE_TITLES[UnlinkChoice.KeepSettings],
    UNLINK_CHOICE_TITLES[UnlinkChoice.ClearCriteria],
    UNLINK_CHOICE_DESCRIPTIONS[UnlinkChoice.KeepSettings],
    UNLINK_CHOICE_DESCRIPTIONS[UnlinkChoice.ClearCriteria],
    WHAT_STAYS,
    NEVER_MADE_AGAIN,
    SETTINGS_REPLACED,
    SETTINGS_KEPT,
    DELETE_LINKED_QUESTION,
    RETRY_BUTTON,
    POLICY_MOVE_MONITORS,
    POLICY_MOVE_BUTTON,
    RULE_MOVE_QUESTION,
    RULE_MOVE_BUTTON,
  ];

  const sentences: Array<string> = [
    APPLY_SETTINGS_TITLE,
    APPLY_SETTINGS_DESCRIPTION,
    DELETE_CHOICE_TITLES[DeleteChoice.KeepSettings],
    DELETE_CHOICE_TITLES[DeleteChoice.ClearCriteria],
    DELETE_CHOICE_DESCRIPTIONS[DeleteChoice.KeepSettings],
    DELETE_CHOICE_DESCRIPTIONS[DeleteChoice.ClearCriteria],
    DELETE_MOVE_FIRST_HINT,
    ...MONITOR_TEMPLATE_CHANGE_TRANSLATED_REASONS,
    POLICY_MOVE_TITLE,
    POLICY_MOVE_MONITORS_UNCOUNTED,
    POLICY_MOVE_BUTTON_UNCOUNTED,
    RULE_MOVE_TITLE,
    RULE_MOVE_CHOICE_TITLES[RuleMoveChoice.MoveFirst],
    RULE_MOVE_CHOICE_TITLES[RuleMoveChoice.Leave],
    RULE_MOVE_CHOICE_DESCRIPTIONS[RuleMoveChoice.MoveFirst],
    RULE_MOVE_CHOICE_DESCRIPTIONS[RuleMoveChoice.Leave],
    RULE_SAVE_WITHOUT_MOVING_BUTTON,
  ];

  test("English has each, each count form under its own key", () => {
    for (const template of counted) {
      expect([template.other, english[template.other]]).toEqual([
        template.other,
        template.other,
      ]);
      expect([template.one, english[`${template.other}_one`]]).toEqual([
        template.one,
        template.one,
      ]);
    }

    for (const sentence of sentences) {
      expect([sentence, english[sentence]]).toEqual([sentence, sentence]);
    }
  });

  test.each(LANGUAGES)(
    "%s words each in its own language",
    (language: string) => {
      const words: Record<string, string> = locale(language);
      const translator: Translator = translatorFor(language);

      const inEnglish: Array<string> = [
        ...counted.filter((template: PluralTemplate): boolean => {
          // Three of something, as each language says it: never the English.
          return (
            translator.translatePlural(template, 3) ===
            ENGLISH.translatePlural(template, 3)
          );
        }),
        ...sentences.filter((sentence: string): boolean => {
          return !words[sentence] || words[sentence] === sentence;
        }),
      ].map((item: PluralTemplate | string): string => {
        return typeof item === "string" ? item : item.other;
      });

      expect({ language, inEnglish }).toEqual({ language, inEnglish: [] });
    },
  );
});

/*
 * A network alert policy pointed at another template moves its monitors
 * there (#11452), and an auto import rule's devices' monitors can move to
 * the template the rule is pointed at (#11451). Each form says what happens
 * before it saves - what moves, what each monitor takes from the new
 * template and what it keeps - and the change then says how far it got, on
 * the Monitors list too (#11454).
 */
const POLICY_ID: string = "80000000-0000-4000-8000-000000000001";
const RULE_ID: string = "90000000-0000-4000-8000-000000000001";

function policyMove(
  overrides: Partial<MonitorTemplateChangeView> = {},
): MonitorTemplateChangeView {
  return view({
    networkAlertPolicyId: POLICY_ID,
    networkAlertPolicyName: "Core switches",
    ...overrides,
  });
}

function ruleMove(
  overrides: Partial<MonitorTemplateChangeView> = {},
): MonitorTemplateChangeView {
  return view({
    autoImportRuleId: RULE_ID,
    autoImportRuleName: "Warehouse switches",
    ...overrides,
  });
}

function lineOf(
  change: MonitorTemplateChangeView,
  translator: Translator = ENGLISH,
  now: number = CREATED_AT_MS + 1000,
): string {
  return getMonitorTemplateChangeLine({
    translator: translator,
    view: change,
    phase: getMonitorTemplateChangePhase(change, now),
  });
}

function descriptionIn(
  change: MonitorTemplateChangeView,
  translator: Translator,
): string {
  return getMonitorTemplateChangeDescription({
    translator: translator,
    view: change,
    phase: getMonitorTemplateChangePhase(change, CREATED_AT_MS + 1000),
  });
}

function counts(
  template: PluralTemplate,
  values: Array<number>,
): Array<string> {
  return values.map((count: number): string => {
    return ENGLISH.translatePlural(template, count, {
      count: ENGLISH.formatNumber(count),
      templateName: "Switches (new)",
      oldTemplateName: "Switches (old)",
    });
  });
}

describe("pointing a network alert policy at another template (#11452)", () => {
  test("the question names the template, how many monitors move, and that they stay the policy's", () => {
    expect(
      ENGLISH.translateTemplate(POLICY_MOVE_TITLE, {
        templateName: "Switches (new)",
      }),
    ).toBe("Move this policy's monitors to Switches (new)?");

    expect(counts(POLICY_MOVE_MONITORS, [1, 2000])).toEqual([
      "Its 1 monitor moves to Switches (new) on the server, and stays this policy's.",
      "Its 2,000 monitors move to Switches (new) on the server, and stay this policy's.",
    ]);
  });

  test("its button says what it does and to how many: no save leaves them on the old template", () => {
    expect(counts(POLICY_MOVE_BUTTON, [1, 2000])).toEqual([
      "Move 1 Monitor and Save",
      "Move 2,000 Monitors and Save",
    ]);
  });

  test("when how many could not be read, it says the same without the number", () => {
    expect(
      ENGLISH.translateTemplate(POLICY_MOVE_MONITORS_UNCOUNTED, {
        templateName: "Switches (new)",
      }),
    ).toBe(
      "Its monitors move to Switches (new) on the server, and stay this policy's.",
    );
    expect(POLICY_MOVE_BUTTON_UNCOUNTED).toBe("Move Monitors and Save");
  });

  test("what each monitor takes and keeps is said with it, as for any move", () => {
    // The dialog says these under the question, for the policy's count.
    expect(ENGLISH.translatePlural(SETTINGS_REPLACED, 2000)).toMatch(
      /^Their criteria, interval and probe agreement are replaced by the template's\./,
    );
    expect(ENGLISH.translatePlural(WHAT_STAYS, 2000)).toContain("history");
  });

  test("while it runs, its headline names the policy and the template", () => {
    expect(title(policyMove())).toBe(
      "Moving the monitors of the alert policy Core switches to Switches (new)…",
    );
  });

  test("a policy's move that clears a template's criteria is still said as a clear", () => {
    // The two never meet on the server; the clear's words win if they did.
    expect(title(policyMove({ settings: DELETE }))).toBe(
      "Clearing Switches (new)'s criteria from its monitors…",
    );
  });

  test("once done, each monitor kept its history and stays the policy's - or Retry says what is left", () => {
    expect(
      description(
        policyMove({ status: MonitorTemplateChangeStatus.Completed }),
      ),
    ).toBe(
      "Each monitor kept its history, labels, owners and incidents, and stays the policy's.",
    );
    expect(
      description(
        policyMove({
          status: MonitorTemplateChangeStatus.Completed,
          retryableCount: 4,
        }),
      ),
    ).toBe(
      "What changed is kept. Retry changes the monitors that failed or were not reached.",
    );
  });

  test("monitors someone moved or unlinked meanwhile are one group, its reason naming no monitor", () => {
    const groups: Array<MonitorTemplateChangeIssueGroup> =
      getMonitorTemplateChangeIssueGroups([
        line(
          "a",
          MonitorTemplateChangeOutcome.Skipped,
          MONITOR_NO_LONGER_THE_POLICYS,
          "core-sw-01",
        ),
        line(
          "b",
          MonitorTemplateChangeOutcome.Skipped,
          MONITOR_NO_LONGER_THE_POLICYS,
          "core-sw-02",
        ),
      ]);

    expect(groups).toHaveLength(1);
    expect(getIssueGroupTitle(ENGLISH, groups[0]!)).toBe(
      "2 monitors were left out",
    );
    expect(groups[0]!.reason).toBe(
      "Moved to another template or unlinked by someone since, so no longer the policy's.",
    );
    // Read under "1 monitor was left out" as under "300 monitors were left out".
    expect(groups[0]!.reason).not.toMatch(/\b(it|them|they|this monitor)\b/i);
  });
});

describe("pointing an auto import rule at another template (#11451)", () => {
  test("the question says how many of the rule's devices' monitors are on the template it uses now", () => {
    expect(
      ENGLISH.translateTemplate(RULE_MOVE_TITLE, {
        templateName: "Switches (new)",
      }),
    ).toBe("Move this rule's monitors to Switches (new)?");
    expect(counts(RULE_MOVE_QUESTION, [1, 120])).toEqual([
      "This rule's devices have 1 monitor from Switches (old).",
      "This rule's devices have 120 monitors from Switches (old).",
    ]);
  });

  test("two choices, moving first and recommended: each says what happens to the monitors and to the devices", () => {
    const values: Record<string, string> = {
      templateName: "Switches (new)",
      oldTemplateName: "Switches (old)",
    };

    expect(Object.keys(RULE_MOVE_CHOICE_TITLES)).toEqual([
      RuleMoveChoice.MoveFirst,
      RuleMoveChoice.Leave,
    ]);
    expect(
      [RuleMoveChoice.MoveFirst, RuleMoveChoice.Leave].map(
        (choice: RuleMoveChoice): Array<string> => {
          return [
            ENGLISH.translateTemplate(RULE_MOVE_CHOICE_TITLES[choice], values),
            ENGLISH.translateTemplate(
              RULE_MOVE_CHOICE_DESCRIPTIONS[choice],
              values,
            ),
          ];
        },
      ),
    ).toEqual([
      [
        "Move them to Switches (new) first (recommended)",
        "Each takes the criteria, interval and probe agreement of Switches (new), and keeps its name, history, labels, owners and incidents. The rule uses Switches (new) once they are moved, and gives a monitor only to devices that have none.",
      ],
      [
        "Leave them on Switches (old)",
        "They stay as they are, and the rule gives each of these devices a second monitor, from Switches (new).",
      ],
    ]);
  });

  test("the button says which choice it carries out", () => {
    expect(counts(RULE_MOVE_BUTTON, [1, 120])).toEqual([
      "Move 1 Monitor First",
      "Move 120 Monitors First",
    ]);
    expect(RULE_SAVE_WITHOUT_MOVING_BUTTON).toBe("Save Without Moving");
  });

  test("while it runs, its headline names the rule and the template", () => {
    expect(title(ruleMove())).toBe(
      "Moving the monitors of the auto import rule Warehouse switches to Switches (new)…",
    );
  });

  test("once done: the rule uses the new template now", () => {
    expect(
      description(
        ruleMove({
          status: MonitorTemplateChangeStatus.Completed,
          isAutoImportRulePointed: true,
        }),
      ),
    ).toBe(
      "Each monitor kept its history, labels, owners and incidents, and Warehouse switches uses Switches (new) now.",
    );
  });

  test("or it still uses the old one, with how many of its devices' monitors are not on the new one yet", () => {
    expect(
      [1, 37].map((count: number): string => {
        return description(
          ruleMove({
            status: MonitorTemplateChangeStatus.Completed,
            autoImportRuleMonitorsLeftCount: count,
          }),
        );
      }),
    ).toEqual([
      "Warehouse switches still uses its old template: 1 of its devices' monitors is not on Switches (new) yet. Retry it, or move it from its template's page, then save the rule again.",
      "Warehouse switches still uses its old template: 37 of its devices' monitors are not on Switches (new) yet. Retry them, or move them from their template's page, then save the rule again.",
    ]);
  });

  test("or why pointing it was refused, in the reader's words", () => {
    expect(
      description(
        ruleMove({
          status: MonitorTemplateChangeStatus.Completed,
          autoImportRuleError:
            "You do not have permission to edit network device auto import rules.",
        }),
      ),
    ).toContain(
      "You do not have permission to edit network device auto import rules.",
    );
  });

  test("a move that stopped or failed before it pointed the rule says the rule still uses its old template, and what to do", () => {
    expect(
      description(
        ruleMove({
          status: MonitorTemplateChangeStatus.Stopped,
          retryableCount: 12,
        }),
      ),
    ).toBe(
      "Warehouse switches still uses its old template. Retry the monitors that were not moved, then save the rule again.",
    );
    // A rule whose name was not read is "The rule".
    expect(
      description(
        ruleMove({
          status: MonitorTemplateChangeStatus.Failed,
          autoImportRuleName: undefined,
        }),
      ),
    ).toBe(
      "The rule still uses its old template. Retry the monitors that were not moved, then save the rule again.",
    );
  });

  test("while it runs, it says what any change says: it keeps going, and where it shows", () => {
    expect(description(ruleMove())).toBe(description(view()));
  });
});

describe("a change as one line of the Monitors list (#11454)", () => {
  const running: MonitorTemplateChangeProgress = progress({
    total: 2000,
    processed: 1200,
    changed: 1190,
    unchanged: 10,
  });

  test("while it runs: what it does, and how far it got", () => {
    expect(lineOf(view({ progress: running }))).toBe(
      "Linking monitors to Switches (new): 1,200 of 2,000 monitors done.",
    );
    expect(
      lineOf(
        view({
          settings: UNLINK,
          monitorTemplateId: undefined,
          monitorTemplateName: undefined,
          progress: running,
        }),
      ),
    ).toBe(
      "Unlinking monitors from their template: 1,200 of 2,000 monitors done.",
    );
    expect(lineOf(view({ settings: DELETE, progress: running }))).toBe(
      "Clearing Switches (new)'s criteria from its monitors: 1,200 of 2,000 monitors done.",
    );
    expect(lineOf(policyMove({ progress: running }))).toBe(
      "Moving the monitors of the alert policy Core switches to Switches (new): 1,200 of 2,000 monitors done.",
    );
    expect(lineOf(ruleMove({ progress: running }))).toBe(
      "Moving the monitors of the auto import rule Warehouse switches to Switches (new): 1,200 of 2,000 monitors done.",
    );
  });

  test("one monitor is said as one", () => {
    expect(lineOf(view({ progress: progress({ total: 1 }) }))).toBe(
      "Linking monitors to Switches (new): 0 of 1 monitor done.",
    );
    expect(
      lineOf(
        policyMove({
          progress: progress({ total: 1, processed: 1, changed: 1 }),
        }),
      ),
    ).toBe(
      "Moving the monitors of the alert policy Core switches to Switches (new): 1 of 1 monitor done.",
    );
  });

  test("monitors not reached are not progress", () => {
    expect(
      lineOf(
        view({
          progress: progress({
            total: 10,
            processed: 10,
            changed: 4,
            notReached: 6,
          }),
        }),
      ),
    ).toBe("Linking monitors to Switches (new): 4 of 10 monitors done.");
  });

  test("starting, waiting for another change and stopping still say how far it got", () => {
    const queued: MonitorTemplateChangeView = view({
      status: MonitorTemplateChangeStatus.Queued,
      progress: progress({ total: 300 }),
    });

    expect(lineOf(queued)).toBe(
      "Linking monitors to Switches (new): 0 of 300 monitors done.",
    );
    expect(
      lineOf(
        queued,
        ENGLISH,
        CREATED_AT_MS + MONITOR_TEMPLATE_CHANGE_WAITING_AFTER_MS + 1,
      ),
    ).toBe("Linking monitors to Switches (new): 0 of 300 monitors done.");
    expect(
      lineOf(
        view({
          isStopRequested: true,
          progress: progress({ total: 300, processed: 100, changed: 100 }),
        }),
      ),
    ).toBe("Linking monitors to Switches (new): 100 of 300 monitors done.");
  });

  test("once done, the line is its dialog's headline", () => {
    const finished: Array<MonitorTemplateChangeView> = [
      view({
        status: MonitorTemplateChangeStatus.Completed,
        progress: progress({ total: 5, processed: 5, changed: 3, skipped: 2 }),
      }),
      view({
        status: MonitorTemplateChangeStatus.Stopped,
        progress: progress({
          total: 5,
          processed: 5,
          changed: 2,
          notReached: 3,
        }),
      }),
      view({ status: MonitorTemplateChangeStatus.Failed }),
      ruleMove({
        status: MonitorTemplateChangeStatus.Completed,
        progress: progress({ total: 3, processed: 3, changed: 3 }),
      }),
    ];

    for (const change of finished) {
      expect(lineOf(change)).toBe(title(change));
    }

    expect(
      finished.map((change: MonitorTemplateChangeView): string => {
        return lineOf(change);
      }),
    ).toEqual([
      "3 of 5 monitors are linked to Switches (new)",
      "Stopped after 2 of 5 monitors",
      "The change stopped before it finished",
      "3 monitors are linked to Switches (new)",
    ]);
  });

  test("a template whose name could not be read is the template", () => {
    expect(
      lineOf(
        view({
          monitorTemplateName: undefined,
          progress: progress({ total: 2 }),
        }),
      ),
    ).toBe("Linking monitors to the template: 0 of 2 monitors done.");
  });

  test("in German, with German numbers", () => {
    const german: Translator = translatorFor("de");

    expect(lineOf(policyMove({ progress: running }), german)).toBe(
      "Die Monitore der Warnungsrichtlinie Core switches werden zu Switches (new) verschoben: 1.200 von 2.000 Monitoren erledigt.",
    );
    expect(
      lineOf(
        policyMove({
          progress: progress({ total: 1, processed: 1, changed: 1 }),
        }),
        german,
      ),
    ).toBe(
      "Die Monitore der Warnungsrichtlinie Core switches werden zu Switches (new) verschoben: 1 von 1 Monitor erledigt.",
    );
  });
});

describe("what a policy's or a rule's change says, in every language the Dashboard speaks", () => {
  // At counts that pick every form a language has: 1, 3, 21 (Russian's one), 2,000.
  const TOTALS: Array<number> = [1, 3, 21, 2000];

  function said(translator: Translator): Array<string> {
    const out: Array<string> = [];

    for (const total of TOTALS) {
      const running: MonitorTemplateChangeProgress = progress({
        total: total,
        processed: 1,
        changed: 1,
      });

      out.push(
        lineOf(view({ progress: running }), translator),
        lineOf(
          view({
            settings: UNLINK,
            monitorTemplateId: undefined,
            monitorTemplateName: undefined,
            progress: running,
          }),
          translator,
        ),
        lineOf(view({ settings: DELETE, progress: running }), translator),
        lineOf(policyMove({ progress: running }), translator),
        lineOf(ruleMove({ progress: running }), translator),
        descriptionIn(
          ruleMove({
            status: MonitorTemplateChangeStatus.Completed,
            autoImportRuleMonitorsLeftCount: total,
          }),
          translator,
        ),
      );

      for (const template of [
        POLICY_MOVE_MONITORS,
        POLICY_MOVE_BUTTON,
        RULE_MOVE_QUESTION,
        RULE_MOVE_BUTTON,
      ]) {
        out.push(
          translator.translatePlural(template, total, {
            count: translator.formatNumber(total),
            templateName: "Switches (new)",
            oldTemplateName: "Switches (old)",
          }),
        );
      }
    }

    out.push(
      title(policyMove(), translator),
      title(ruleMove(), translator),
      descriptionIn(view(), translator),
      descriptionIn(
        view({
          settings: UNLINK,
          monitorTemplateId: undefined,
          monitorTemplateName: undefined,
        }),
        translator,
      ),
      descriptionIn(
        policyMove({ status: MonitorTemplateChangeStatus.Completed }),
        translator,
      ),
      descriptionIn(
        ruleMove({
          status: MonitorTemplateChangeStatus.Completed,
          isAutoImportRulePointed: true,
        }),
        translator,
      ),
      descriptionIn(
        ruleMove({ status: MonitorTemplateChangeStatus.Stopped }),
        translator,
      ),
      descriptionIn(
        ruleMove({
          status: MonitorTemplateChangeStatus.Failed,
          autoImportRuleName: undefined,
          monitorTemplateName: undefined,
        }),
        translator,
      ),
    );

    return out;
  }

  const english: Array<string> = said(ENGLISH);

  test("English says each, with every value filled in", () => {
    expect(english.length).toBe(TOTALS.length * 10 + 8);

    for (const sentence of english) {
      expect(sentence).not.toContain("{{");
    }
  });

  test.each(LANGUAGES)(
    "%s says each in its own words, with every value filled in",
    (language: string) => {
      const words: Array<string> = said(translatorFor(language));
      const inEnglish: Array<string> = words.filter(
        (sentence: string, index: number): boolean => {
          return sentence === english[index];
        },
      );
      const unfilled: Array<string> = words.filter(
        (sentence: string): boolean => {
          return sentence.includes("{{");
        },
      );

      expect({ language, inEnglish, unfilled }).toEqual({
        language,
        inEnglish: [],
        unfilled: [],
      });
    },
  );

  test("Russian says 21 as it says 1, and 3 and 5 in its general words", () => {
    const russian: Translator = translatorFor("ru");

    expect(
      [1, 21, 3, 5].map((count: number): string => {
        return russian.translatePlural(RULE_MOVE_BUTTON, count, {
          count: russian.formatNumber(count),
        });
      }),
    ).toEqual([
      "Сначала перенести 1 монитор",
      "Сначала перенести 21 монитор",
      "Сначала перенести мониторы (3)",
      "Сначала перенести мониторы (5)",
    ]);
  });
});
