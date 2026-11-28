import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MONITOR_NOT_REACHED_FAILED,
  MONITOR_NOT_REACHED_STOPPED,
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
  RETRY_BUTTON,
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
  test("while it runs: closing the dialog does not stop it, and the template's page shows it", () => {
    expect(description(view())).toBe(
      "The server makes the change. You can close this dialog: it keeps going, and this template's page shows how far it got.",
    );
  });

  test("an unlink from the Monitors list, from each monitor's own template, names no page to come back to", () => {
    expect(
      description(
        view({
          settings: UNLINK,
          monitorTemplateId: undefined,
          monitorTemplateName: undefined,
        }),
      ),
    ).toBe(
      "The server makes the change. You can close this dialog: it keeps going.",
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
