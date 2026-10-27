import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { TRIGGER_NAMES, TriggerDetailCopy } from "./RunbookTriggersCopy";

/*
 * What started a run that nobody started by hand - its schedule, its
 * webhook, or a security playbook's Run a runbook step - in words, for the
 * runbook's Overview, both Executions lists and the run's own page. Every
 * other run already says what started it through what it carries: the
 * incident, alert or maintenance event a rule or auto-remediation ran it
 * for, or the person who pressed Run Now.
 */

export interface UnattendedTriggerText {
  // "Schedule", "Webhook" or "Security playbook", in the reader's language.
  label: string;
  // What else is known about it, each a sentence in the reader's language.
  details: Array<string>;
}

// The fields of a run these read, for a list's or a page's select.
export const RUNBOOK_EXECUTION_TRIGGER_SELECT: {
  triggerType: true;
  triggerDetails: true;
} = {
  triggerType: true,
  triggerDetails: true,
};

const getDetails: (execution: RunbookExecution) => JSONObject = (
  execution: RunbookExecution,
): JSONObject => {
  const details: unknown = execution.triggerDetails;

  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as JSONObject)
    : {};
};

// A time the server wrote, as the reader reads times, or null.
const getTime: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const time: number = Date.parse(value);

  return Number.isNaN(time)
    ? null
    : OneUptimeDate.getDateAsLocalFormattedString(new Date(time));
};

export function getUnattendedTriggerText(
  translator: Translator,
  execution: RunbookExecution,
): UnattendedTriggerText | null {
  const details: JSONObject = getDetails(execution);

  if (execution.triggerType === RunbookTriggerType.Schedule) {
    const lines: Array<string> = [];
    const scheduledFor: string | null = getTime(details["scheduledFor"]);

    if (scheduledFor) {
      lines.push(
        translator.translateTemplate(TriggerDetailCopy.scheduledFor, {
          time: scheduledFor,
        }),
      );
    }

    if (details["isCatchUp"] === true) {
      lines.push(translator.translateText(TriggerDetailCopy.catchUp) || "");
    }

    if (details["waitedForPreviousRun"] === true) {
      lines.push(translator.translateText(TriggerDetailCopy.waited) || "");
    }

    return {
      label:
        translator.translateText(TRIGGER_NAMES[RunbookTriggerType.Schedule]) ||
        "",
      details: lines,
    };
  }

  if (execution.triggerType === RunbookTriggerType.Webhook) {
    const lines: Array<string> = [];
    const callerIp: unknown = details["callerIp"];

    if (typeof callerIp === "string" && callerIp) {
      lines.push(
        translator.translateTemplate(TriggerDetailCopy.fromAddress, {
          address: callerIp,
        }),
      );
    }

    return {
      label:
        translator.translateText(TRIGGER_NAMES[RunbookTriggerType.Webhook]) ||
        "",
      details: lines,
    };
  }

  // The case the playbook ran it for, and the playbook, as the step recorded them.
  if (execution.triggerType === RunbookTriggerType.SecurityPlaybook) {
    const lines: Array<string> = [];
    const caseNumber: unknown = details["caseNumber"];
    const playbookName: unknown = details["playbookName"];

    if (typeof caseNumber === "string" && caseNumber) {
      lines.push(
        translator.translateTemplate(TriggerDetailCopy.forSecurityCase, {
          caseNumber,
        }),
      );
    }

    if (typeof playbookName === "string" && playbookName) {
      lines.push(
        translator.translateTemplate(TriggerDetailCopy.byPlaybook, {
          playbookName,
        }),
      );
    }

    return {
      label:
        translator.translateText(
          TRIGGER_NAMES[RunbookTriggerType.SecurityPlaybook],
        ) || "",
      details: lines,
    };
  }

  return null;
}

// The values a run was started with, or null when it has none.
export function getRunInputs(execution: RunbookExecution): JSONObject | null {
  const inputs: unknown = execution.inputs;

  if (
    !inputs ||
    typeof inputs !== "object" ||
    Array.isArray(inputs) ||
    Object.keys(inputs).length === 0
  ) {
    return null;
  }

  return inputs as JSONObject;
}

// The Executions lists' "Triggered by" filter: each way a run starts.
export function getTriggerFilterOptions(): Array<DropdownOption> {
  return (Object.keys(TRIGGER_NAMES) as Array<RunbookTriggerType>).map(
    (trigger: RunbookTriggerType): DropdownOption => {
      return { value: trigger, label: TRIGGER_NAMES[trigger] };
    },
  );
}
