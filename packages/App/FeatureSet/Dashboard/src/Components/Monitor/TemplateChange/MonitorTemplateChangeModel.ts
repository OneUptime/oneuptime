import {
  MonitorTemplateChangeKind,
  MonitorTemplateChangeLine,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeProgress,
  MonitorTemplateChangeStatus,
  MonitorTemplateChangeView,
} from "Common/Types/Monitor/MonitorTemplateChange";
import { getErrorInSentenceText } from "Common/UI/Utils/ErrorInSentence";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT THE DIALOGS THAT CHANGE MONITORS' TEMPLATE SAY (issues #11260,
 * #11266).
 *
 * Move to Another Template, Link Existing Monitors, Link to Template and
 * Unlink from Template change one monitor or ten thousand, and a template's
 * Delete asks what happens to the monitors linked to it. Each says exactly
 * what changes before it changes anything - the customer's "a confirmation
 * warning that criteria will be replaced" - and, for many monitors, how far
 * the change on the server got, what it left out and why.
 *
 * React-free: tested from App.
 */

// A sentence of the locales in the reader's words: the English while it has none.
function translated(translator: Translator, key: string): string {
  return translator.translateText(key) || key;
}

// ---- What each choice does, said before anything changes.

export enum UnlinkChoice {
  // The monitor keeps the template's criteria and settings as its own.
  KeepSettings = "keep",
  // The template's criteria are cleared from the monitor.
  ClearCriteria = "clear",
}

export const UNLINK_CHOICE_TITLES: Record<UnlinkChoice, PluralTemplate> = {
  [UnlinkChoice.KeepSettings]: {
    one: "Keep its settings",
    other: "Keep their settings",
  },
  [UnlinkChoice.ClearCriteria]: {
    one: "Clear the template's criteria",
    other: "Clear the template's criteria from them",
  },
};

export const UNLINK_CHOICE_DESCRIPTIONS: Record<UnlinkChoice, PluralTemplate> =
  {
    [UnlinkChoice.KeepSettings]: {
      one: "It keeps checking and alerting with the criteria it has now, as a monitor of its own, and no longer gets this template's updates.",
      other:
        "They keep checking and alerting with the criteria they have now, as monitors of their own, and no longer get this template's updates.",
    },
    [UnlinkChoice.ClearCriteria]: {
      one: "It keeps checking, but raises no incidents or alerts and sets no status until you link it to a template again. Open incidents and alerts its criteria were set to resolve are resolved.",
      other:
        "They keep checking, but raise no incidents or alerts and set no status until you link them to a template again. Open incidents and alerts their criteria were set to resolve are resolved.",
    },
  };

// What stays whatever is chosen: said under every choice.
export const WHAT_STAYS: PluralTemplate = {
  one: "Its name, history, labels, owners and incidents stay as they are.",
  other: "Their names, history, labels, owners and incidents stay as they are.",
};

// A device's monitor an import made is never made again, said once moved.
export const NEVER_MADE_AGAIN: PluralTemplate = {
  one: "If an import, an auto import rule or an alert policy made it, it is never made again.",
  other:
    "Those that an import, an auto import rule or an alert policy made are never made again.",
};

// Link and Move: the template's settings come too, unless switched off.
export const APPLY_SETTINGS_TITLE: string = translationKey(
  "Use the template's criteria and interval",
);

export const APPLY_SETTINGS_DESCRIPTION: string = translationKey(
  "Replaces each monitor's criteria, interval and probe agreement with the template's. Off, they keep theirs until you sync.",
);

export const SETTINGS_REPLACED: PluralTemplate = {
  one: "Its criteria, interval and probe agreement are replaced by the template's. Open incidents and alerts its old criteria were set to resolve are resolved, and the new criteria open new ones if the problem is still there.",
  other:
    "Their criteria, interval and probe agreement are replaced by the template's. Open incidents and alerts their old criteria were set to resolve are resolved, and the new criteria open new ones if the problem is still there.",
};

export const SETTINGS_KEPT: PluralTemplate = {
  one: "It keeps its criteria and interval until you sync the template.",
  other: "They keep their criteria and intervals until you sync the template.",
};

// ---- Pointing a network alert policy at another template (#11452).

export const POLICY_MOVE_TITLE: string = translationKey(
  "Move this policy's monitors to {{templateName}}?",
);

export const POLICY_MOVE_MONITORS: PluralTemplate = {
  one: "Its {{count}} monitor moves to {{templateName}} on the server, and stays this policy's.",
  other:
    "Its {{count}} monitors move to {{templateName}} on the server, and stay this policy's.",
};

export const POLICY_MOVE_BUTTON: PluralTemplate = {
  one: "Move {{count}} Monitor and Save",
  other: "Move {{count}} Monitors and Save",
};

// The same, when how many monitors the policy has could not be read.
export const POLICY_MOVE_MONITORS_UNCOUNTED: string = translationKey(
  "Its monitors move to {{templateName}} on the server, and stay this policy's.",
);

export const POLICY_MOVE_BUTTON_UNCOUNTED: string = translationKey(
  "Move Monitors and Save",
);

// ---- Pointing an auto import rule at another template (#11451).

export enum RuleMoveChoice {
  // The rule's devices' monitors move to the new template first.
  MoveFirst = "move",
  // They stay on the old template; the rule gives each device another.
  Leave = "leave",
}

export const RULE_MOVE_TITLE: string = translationKey(
  "Move this rule's monitors to {{templateName}}?",
);

export const RULE_MOVE_QUESTION: PluralTemplate = {
  one: "This rule's devices have {{count}} monitor from {{oldTemplateName}}.",
  other:
    "This rule's devices have {{count}} monitors from {{oldTemplateName}}.",
};

export const RULE_MOVE_CHOICE_TITLES: Record<RuleMoveChoice, string> = {
  [RuleMoveChoice.MoveFirst]: translationKey(
    "Move them to {{templateName}} first (recommended)",
  ),
  [RuleMoveChoice.Leave]: translationKey("Leave them on {{oldTemplateName}}"),
};

export const RULE_MOVE_CHOICE_DESCRIPTIONS: Record<RuleMoveChoice, string> = {
  [RuleMoveChoice.MoveFirst]: translationKey(
    "Each takes the criteria, interval and probe agreement of {{templateName}}, and keeps its name, history, labels, owners and incidents. The rule uses {{templateName}} once they are moved, and gives a monitor only to devices that have none.",
  ),
  [RuleMoveChoice.Leave]: translationKey(
    "They stay as they are, and the rule gives each of these devices a second monitor, from {{templateName}}.",
  ),
};

export const RULE_MOVE_BUTTON: PluralTemplate = {
  one: "Move {{count}} Monitor First",
  other: "Move {{count}} Monitors First",
};

export const RULE_SAVE_WITHOUT_MOVING_BUTTON: string = translationKey(
  "Save Without Moving",
);

// ---- A template's delete.

export enum DeleteChoice {
  // The monitors keep the template's criteria and settings as their own.
  KeepSettings = "keep",
  // The template's criteria are cleared from them first.
  ClearCriteria = "clear",
}

export const DELETE_CHOICE_TITLES: Record<DeleteChoice, string> = {
  [DeleteChoice.KeepSettings]: translationKey("Keep their settings"),
  [DeleteChoice.ClearCriteria]: translationKey(
    "Clear this template's criteria from them",
  ),
};

export const DELETE_CHOICE_DESCRIPTIONS: Record<DeleteChoice, string> = {
  [DeleteChoice.KeepSettings]: translationKey(
    "They keep checking and alerting with the criteria they have now, as monitors of their own.",
  ),
  [DeleteChoice.ClearCriteria]: translationKey(
    "They keep checking, but raise no incidents or alerts and set no status until you link them to another template. Open incidents and alerts their criteria were set to resolve are resolved.",
  ),
};

export const DELETE_LINKED_QUESTION: PluralTemplate = {
  one: "{{templateName}} is linked to {{count}} monitor. What should happen to it when the template is deleted?",
  other:
    "{{templateName}} is linked to {{count}} monitors. What should happen to them when the template is deleted?",
};

export const DELETE_MOVE_FIRST_HINT: string = translationKey(
  "To move them to another template instead, select them under Linked Monitors and use Move to Another Template first.",
);

// ---- Where a change is.

export enum MonitorTemplateChangePhase {
  // Queued, and about to start.
  Starting = "Starting",
  // Queued behind another change of the project.
  Waiting = "Waiting",
  Running = "Running",
  // Running, and asked to stop.
  Stopping = "Stopping",
  Finished = "Finished",
  Stopped = "Stopped",
  Failed = "Failed",
}

/*
 * A queued change is normally picked up within a second or two. One still
 * queued after this long waits for an earlier change of the project.
 */
export const MONITOR_TEMPLATE_CHANGE_WAITING_AFTER_MS: number = 15 * 1000;

export function getMonitorTemplateChangePhase(
  view: MonitorTemplateChangeView,
  now: number = Date.now(),
): MonitorTemplateChangePhase {
  switch (view.status) {
    case MonitorTemplateChangeStatus.Queued: {
      const createdAt: number = new Date(view.createdAt || "").getTime();

      return Number.isFinite(createdAt) &&
        now - createdAt > MONITOR_TEMPLATE_CHANGE_WAITING_AFTER_MS
        ? MonitorTemplateChangePhase.Waiting
        : MonitorTemplateChangePhase.Starting;
    }
    case MonitorTemplateChangeStatus.Running:
      return view.isStopRequested
        ? MonitorTemplateChangePhase.Stopping
        : MonitorTemplateChangePhase.Running;
    case MonitorTemplateChangeStatus.Completed:
      return MonitorTemplateChangePhase.Finished;
    case MonitorTemplateChangeStatus.Stopped:
      return MonitorTemplateChangePhase.Stopped;
    default:
      return MonitorTemplateChangePhase.Failed;
  }
}

export function isMonitorTemplateChangePhaseActive(
  phase: MonitorTemplateChangePhase,
): boolean {
  return [
    MonitorTemplateChangePhase.Starting,
    MonitorTemplateChangePhase.Waiting,
    MonitorTemplateChangePhase.Running,
    MonitorTemplateChangePhase.Stopping,
  ].includes(phase);
}

// 0-100, of the monitors dealt with - those not reached are not progress.
export function getMonitorTemplateChangePercent(
  progress: MonitorTemplateChangeProgress,
): number {
  if (progress.total <= 0) {
    return 100;
  }

  const reached: number = Math.max(0, progress.processed - progress.notReached);

  return Math.min(100, Math.round((reached / progress.total) * 100));
}

// The monitors the change got to: what its bar fills with.
export function getMonitorsReached(
  progress: MonitorTemplateChangeProgress,
): number {
  return Math.max(0, progress.processed - progress.notReached);
}

/*
 * The change's headline, as it runs and once it is done: what it does, to
 * how many, and to which template.
 */
export function getMonitorTemplateChangeTitle(data: {
  translator: Translator;
  view: MonitorTemplateChangeView;
  phase: MonitorTemplateChangePhase;
}): string {
  const translator: Translator = data.translator;
  const view: MonitorTemplateChangeView = data.view;
  const progress: MonitorTemplateChangeProgress = view.progress;
  const templateName: string =
    view.monitorTemplateName ||
    translated(translator, translationKey("the template"));
  const isLink: boolean = view.settings.kind === MonitorTemplateChangeKind.Link;
  const isDelete: boolean = view.settings.deleteTemplateWhenDone;

  switch (data.phase) {
    case MonitorTemplateChangePhase.Starting:
      return translated(translator, translationKey("Starting the change…"));
    case MonitorTemplateChangePhase.Waiting:
      return translated(
        translator,
        translationKey(
          "Waiting for another change of this project's monitors to finish…",
        ),
      );
    case MonitorTemplateChangePhase.Stopping:
      return translated(
        translator,
        translationKey("Stopping before the next monitor…"),
      );
    case MonitorTemplateChangePhase.Running:
      if (isDelete) {
        return translator.translateTemplate(
          "Clearing {{templateName}}'s criteria from its monitors…",
          { templateName: templateName },
        );
      }

      if (view.networkAlertPolicyName) {
        return translator.translateTemplate(
          "Moving the monitors of the alert policy {{policyName}} to {{templateName}}…",
          {
            policyName: view.networkAlertPolicyName,
            templateName: templateName,
          },
        );
      }

      if (view.autoImportRuleName) {
        return translator.translateTemplate(
          "Moving the monitors of the auto import rule {{ruleName}} to {{templateName}}…",
          { ruleName: view.autoImportRuleName, templateName: templateName },
        );
      }

      return isLink
        ? translator.translateTemplate(
            "Linking monitors to {{templateName}}…",
            { templateName: templateName },
          )
        : translated(
            translator,
            translationKey("Unlinking monitors from their template…"),
          );
    case MonitorTemplateChangePhase.Stopped:
      return translator.translatePlural(
        {
          one: "Stopped after {{processed}} of {{count}} monitor",
          other: "Stopped after {{processed}} of {{count}} monitors",
        },
        progress.total,
        {
          processed: translator.formatNumber(getMonitorsReached(progress)),
          count: translator.formatNumber(progress.total),
        },
      );
    case MonitorTemplateChangePhase.Failed:
      return translated(
        translator,
        translationKey("The change stopped before it finished"),
      );
    default:
      break;
  }

  if (isDelete) {
    return view.isTemplateDeleted
      ? translator.translateTemplate("{{templateName}} was deleted", {
          templateName: templateName,
        })
      : translator.translateTemplate("{{templateName}} was not deleted", {
          templateName: templateName,
        });
  }

  const done: number = progress.changed + progress.unchanged;

  if (isLink) {
    return done === progress.total
      ? translator.translatePlural(
          {
            one: "{{count}} monitor is linked to {{templateName}}",
            other: "{{count}} monitors are linked to {{templateName}}",
          },
          done,
          {
            count: translator.formatNumber(done),
            templateName: templateName,
          },
        )
      : translator.translatePlural(
          {
            one: "{{done}} of {{count}} monitor is linked to {{templateName}}",
            other:
              "{{done}} of {{count}} monitors are linked to {{templateName}}",
          },
          progress.total,
          {
            done: translator.formatNumber(done),
            count: translator.formatNumber(progress.total),
            templateName: templateName,
          },
        );
  }

  return done === progress.total
    ? translator.translatePlural(
        {
          one: "{{count}} monitor is unlinked",
          other: "{{count}} monitors are unlinked",
        },
        done,
        { count: translator.formatNumber(done) },
      )
    : translator.translatePlural(
        {
          one: "{{done}} of {{count}} monitor is unlinked",
          other: "{{done}} of {{count}} monitors are unlinked",
        },
        progress.total,
        {
          done: translator.formatNumber(done),
          count: translator.formatNumber(progress.total),
        },
      );
}

// The line under the headline.
export function getMonitorTemplateChangeDescription(data: {
  translator: Translator;
  view: MonitorTemplateChangeView;
  phase: MonitorTemplateChangePhase;
}): string {
  const translator: Translator = data.translator;

  if (isMonitorTemplateChangePhaseActive(data.phase)) {
    /*
     * Every change shows on the Monitors list (#11454), and a change of one
     * template's monitors on that template's page too; an unlink from the
     * Monitors list, from each monitor's own template, has no page of its
     * own.
     */
    return data.view.monitorTemplateId
      ? translated(
          translator,
          translationKey(
            "The server makes the change. You can close this dialog: it keeps going, and the Monitors list and this template's page show how far it got.",
          ),
        )
      : translated(
          translator,
          translationKey(
            "The server makes the change. You can close this dialog: it keeps going, and the Monitors list shows how far it got.",
          ),
        );
  }

  // An auto import rule's change (#11451): whether the rule uses the template now.
  if (data.view.autoImportRuleId) {
    const ruleName: string =
      data.view.autoImportRuleName ||
      translated(translator, translationKey("The rule"));
    const templateName: string =
      data.view.monitorTemplateName ||
      translated(translator, translationKey("the template"));

    if (data.view.isAutoImportRulePointed) {
      return translator.translateTemplate(
        "Each monitor kept its history, labels, owners and incidents, and {{ruleName}} uses {{templateName}} now.",
        { ruleName: ruleName, templateName: templateName },
      );
    }

    if (data.view.autoImportRuleMonitorsLeftCount) {
      return translator.translatePlural(
        {
          one: "{{ruleName}} still uses its old template: {{count}} of its devices' monitors is not on {{templateName}} yet. Retry it, or move it from its template's page, then save the rule again.",
          other:
            "{{ruleName}} still uses its old template: {{count}} of its devices' monitors are not on {{templateName}} yet. Retry them, or move them from their template's page, then save the rule again.",
        },
        data.view.autoImportRuleMonitorsLeftCount,
        {
          count: translator.formatNumber(
            data.view.autoImportRuleMonitorsLeftCount,
          ),
          ruleName: ruleName,
          templateName: templateName,
        },
      );
    }

    if (data.view.autoImportRuleError) {
      return getErrorInSentenceText({
        message: data.view.autoImportRuleError,
        translator: translator,
      });
    }

    return translator.translateTemplate(
      "{{ruleName}} still uses its old template. Retry the monitors that were not moved, then save the rule again.",
      { ruleName: ruleName },
    );
  }

  if (
    data.view.settings.deleteTemplateWhenDone &&
    !data.view.isTemplateDeleted
  ) {
    if (data.view.templateStillLinkedCount) {
      return translator.translatePlural(
        {
          one: "{{count}} monitor is still linked to it, so it was kept. Unlink it, then delete the template.",
          other:
            "{{count}} monitors are still linked to it, so it was kept. Unlink them, then delete the template.",
        },
        data.view.templateStillLinkedCount,
        {
          count: translator.formatNumber(data.view.templateStillLinkedCount),
        },
      );
    }

    // Why the template could not be deleted, in the reader's language.
    if (data.view.templateDeleteError) {
      return getErrorInSentenceText({
        message: data.view.templateDeleteError,
        translator: translator,
      });
    }
  }

  if (data.view.retryableCount > 0) {
    return translated(
      translator,
      translationKey(
        "What changed is kept. Retry changes the monitors that failed or were not reached.",
      ),
    );
  }

  // A network alert policy's change (#11452): its monitors stay its own.
  return data.view.networkAlertPolicyId
    ? translated(
        translator,
        translationKey(
          "Each monitor kept its history, labels, owners and incidents, and stays the policy's.",
        ),
      )
    : translated(
        translator,
        translationKey(
          "Each monitor kept its history, labels, owners and incidents.",
        ),
      );
}

/*
 * A change as one line of a list (#11454): the Monitors list's, and the
 * alert policies' and auto import rules' pages. While it runs, what it does
 * and how far it got; once it is done, its headline, as its dialog says it.
 */
export function getMonitorTemplateChangeLine(data: {
  translator: Translator;
  view: MonitorTemplateChangeView;
  phase: MonitorTemplateChangePhase;
}): string {
  const translator: Translator = data.translator;
  const view: MonitorTemplateChangeView = data.view;

  if (!isMonitorTemplateChangePhaseActive(data.phase)) {
    return getMonitorTemplateChangeTitle(data);
  }

  const progress: MonitorTemplateChangeProgress = view.progress;
  const values: Record<string, string> = {
    done: translator.formatNumber(getMonitorsReached(progress)),
    count: translator.formatNumber(progress.total),
    templateName:
      view.monitorTemplateName ||
      translated(translator, translationKey("the template")),
  };

  if (view.networkAlertPolicyName) {
    return translator.translatePlural(
      {
        one: "Moving the monitors of the alert policy {{policyName}} to {{templateName}}: {{done}} of {{count}} monitor done.",
        other:
          "Moving the monitors of the alert policy {{policyName}} to {{templateName}}: {{done}} of {{count}} monitors done.",
      },
      progress.total,
      { ...values, policyName: view.networkAlertPolicyName },
    );
  }

  if (view.autoImportRuleName) {
    return translator.translatePlural(
      {
        one: "Moving the monitors of the auto import rule {{ruleName}} to {{templateName}}: {{done}} of {{count}} monitor done.",
        other:
          "Moving the monitors of the auto import rule {{ruleName}} to {{templateName}}: {{done}} of {{count}} monitors done.",
      },
      progress.total,
      { ...values, ruleName: view.autoImportRuleName },
    );
  }

  if (view.settings.deleteTemplateWhenDone) {
    return translator.translatePlural(
      {
        one: "Clearing {{templateName}}'s criteria from its monitors: {{done}} of {{count}} monitor done.",
        other:
          "Clearing {{templateName}}'s criteria from its monitors: {{done}} of {{count}} monitors done.",
      },
      progress.total,
      values,
    );
  }

  return view.settings.kind === MonitorTemplateChangeKind.Link
    ? translator.translatePlural(
        {
          one: "Linking monitors to {{templateName}}: {{done}} of {{count}} monitor done.",
          other:
            "Linking monitors to {{templateName}}: {{done}} of {{count}} monitors done.",
        },
        progress.total,
        values,
      )
    : translator.translatePlural(
        {
          one: "Unlinking monitors from their template: {{done}} of {{count}} monitor done.",
          other:
            "Unlinking monitors from their template: {{done}} of {{count}} monitors done.",
        },
        progress.total,
        values,
      );
}

// The counts under the bar, each said only when it is not zero.
export function getMonitorTemplateChangeCounts(data: {
  translator: Translator;
  view: MonitorTemplateChangeView;
}): Array<string> {
  const translator: Translator = data.translator;
  const progress: MonitorTemplateChangeProgress = data.view.progress;
  const isLink: boolean =
    data.view.settings.kind === MonitorTemplateChangeKind.Link;
  const parts: Array<string> = [];

  const add: (template: PluralTemplate, count: number) => void = (
    template: PluralTemplate,
    count: number,
  ): void => {
    if (count > 0) {
      parts.push(
        translator.translatePlural(template, count, {
          count: translator.formatNumber(count),
        }),
      );
    }
  };

  add(
    isLink
      ? { one: "{{count}} linked", other: "{{count}} linked" }
      : { one: "{{count}} unlinked", other: "{{count}} unlinked" },
    progress.changed,
  );
  add(
    isLink
      ? { one: "{{count}} linked already", other: "{{count}} linked already" }
      : {
          one: "{{count}} linked to no template",
          other: "{{count}} linked to no template",
        },
    progress.unchanged,
  );
  add(
    { one: "{{count}} left out", other: "{{count}} left out" },
    progress.skipped,
  );
  add({ one: "{{count}} failed", other: "{{count}} failed" }, progress.failed);
  add(
    { one: "{{count}} not reached", other: "{{count}} not reached" },
    progress.notReached,
  );
  add(
    {
      one: "{{count}} open incident resolved",
      other: "{{count}} open incidents resolved",
    },
    progress.resolvedIncidents,
  );
  add(
    {
      one: "{{count}} open alert resolved",
      other: "{{count}} open alerts resolved",
    },
    progress.resolvedAlerts,
  );

  return parts;
}

// ---- What was left out, and why: one group per reason.

export interface MonitorTemplateChangeIssueGroup {
  outcome: MonitorTemplateChangeLine["outcome"];
  // The server's sentence, as written.
  reason: string;
  monitors: Array<{ id: string; name?: string | undefined }>;
}

/*
 * The lines grouped by what happened and why, in the order each reason was
 * first met: a thousand monitors refused for one reason read as one line
 * with a thousand names behind it.
 */
export function getMonitorTemplateChangeIssueGroups(
  lines: ReadonlyArray<MonitorTemplateChangeLine>,
): Array<MonitorTemplateChangeIssueGroup> {
  const groups: Array<MonitorTemplateChangeIssueGroup> = [];
  const byKey: Map<string, MonitorTemplateChangeIssueGroup> = new Map<
    string,
    MonitorTemplateChangeIssueGroup
  >();

  for (const line of lines) {
    const key: string = `${line.outcome}\u0000${line.reason}`;
    let group: MonitorTemplateChangeIssueGroup | undefined = byKey.get(key);

    if (!group) {
      group = { outcome: line.outcome, reason: line.reason, monitors: [] };
      byKey.set(key, group);
      groups.push(group);
    }

    group.monitors.push({
      id: line.monitorId,
      ...(line.monitorName ? { name: line.monitorName } : {}),
    });
  }

  return groups;
}

export function getIssueGroupTitle(
  translator: Translator,
  group: MonitorTemplateChangeIssueGroup,
): string {
  const count: number = group.monitors.length;
  const values: { count: string } = { count: translator.formatNumber(count) };

  switch (group.outcome) {
    case MonitorTemplateChangeOutcome.Skipped:
      return translator.translatePlural(
        {
          one: "{{count}} monitor was left out",
          other: "{{count}} monitors were left out",
        },
        count,
        values,
      );
    case MonitorTemplateChangeOutcome.NotReached:
      return translator.translatePlural(
        {
          one: "{{count}} monitor was not reached",
          other: "{{count}} monitors were not reached",
        },
        count,
        values,
      );
    default:
      return translator.translatePlural(
        {
          one: "{{count}} monitor could not be changed",
          other: "{{count}} monitors could not be changed",
        },
        count,
        values,
      );
  }
}

/*
 * The reasons the change writes itself (MONITOR_TEMPLATE_CHANGE_OWN_REASONS),
 * as keys the Dashboard's locales word: the issue groups look each reason up
 * in the reader's language, and a reason the Dashboard never recorded would
 * read English in every one. Held to the shared list by a test.
 */
export const MONITOR_TEMPLATE_CHANGE_TRANSLATED_REASONS: ReadonlyArray<string> =
  [
    translationKey("The change was stopped."),
    translationKey("The change stopped before it finished."),
    translationKey(
      "Moved to another template or unlinked by someone since, so no longer the policy's.",
    ),
  ];

export const RETRY_BUTTON: PluralTemplate = {
  one: "Retry {{count}} monitor",
  other: "Retry {{count}} monitors",
};
