import {
  ResponsePlaybook,
  ResponseStep,
  ResponseTask,
} from "./SecurityCaseResponseTypes";
import SecurityCaseTask from "Common/Models/DatabaseModels/SecurityCaseTask";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import Select from "Common/Types/BaseDatabase/Select";
import ColumnLength from "Common/Types/Database/ColumnLength";
import { JSONValue } from "Common/Types/JSON";
import SecurityCaseAiVerdict from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import { PillTone } from "Common/UI/Components/Pill/PillTone";

/*
 * What a case's Response Plan reads, and how it reads it: the case's tasks
 * (a step ticked off is one, keyed by the step), the project's playbooks
 * that are on (by what their steps do) and what its ticks write. React-free,
 * so a plain test pins each rule.
 */

export const RESPONSE_TASK_SELECT: Select<SecurityCaseTask> = {
  _id: true,
  title: true,
  isDone: true,
  doneAt: true,
  responseStepKey: true,
  doneByUserId: true,
  doneByUser: {
    _id: true,
    name: true,
    email: true,
  },
};

export const RESPONSE_PLAYBOOK_SELECT: Select<SecurityPlaybook> = {
  _id: true,
  name: true,
  steps: true,
};

// The case's tasks a step was made from: the ones that keep their step.
export function readResponseTasks(
  tasks: ReadonlyArray<SecurityCaseTask>,
): Array<ResponseTask> {
  const read: Array<ResponseTask> = [];

  for (const task of tasks) {
    const key: string = (task.responseStepKey || "").trim();
    const id: string = task._id?.toString() || task.id?.toString() || "";

    if (!key || !id) {
      continue;
    }

    read.push({
      id,
      responseStepKey: key,
      isDone: task.isDone === true,
      doneAt: task.doneAt ? new Date(task.doneAt) : undefined,
      doneByName:
        task.doneByUser?.name?.toString() ||
        task.doneByUser?.email?.toString() ||
        undefined,
    });
  }

  return read;
}

/*
 * The project's playbooks, by what each step of theirs does: a step whose
 * action cannot be read is left out, never a reason to drop the playbook.
 */
export function readResponsePlaybooks(
  playbooks: ReadonlyArray<SecurityPlaybook>,
): Array<ResponsePlaybook> {
  const read: Array<ResponsePlaybook> = [];

  for (const playbook of playbooks) {
    const id: string =
      playbook._id?.toString() || playbook.id?.toString() || "";

    if (!id) {
      continue;
    }

    const steps: Array<JSONValue> = Array.isArray(playbook.steps)
      ? (playbook.steps as Array<JSONValue>)
      : [];
    const actions: Array<string> = [];

    for (const step of steps) {
      const action: JSONValue | undefined =
        step && typeof step === "object" && !Array.isArray(step)
          ? (step as { [key: string]: JSONValue })["action"]
          : undefined;

      if (typeof action === "string" && action && !actions.includes(action)) {
        actions.push(action);
      }
    }

    read.push({ id, name: (playbook.name || "").trim() || id, actions });
  }

  return read;
}

/*
 * A ticked step's task: its words as the person who ticked it read them -
 * OneUptime AI's own for one of its steps - kept to a task's line.
 */
export function getResponseStepTitle(data: {
  step: Pick<ResponseStep, "aiText">;
  text: string;
}): string {
  const title: string = (data.step.aiText || data.text || "")
    .replace(/\s+/g, " ")
    .trim();

  return title.length > ColumnLength.LongText
    ? `${title.slice(0, ColumnLength.LongText - 1)}…`
    : title;
}

// The tone OneUptime AI's read of the case is drawn in: worried, calm, or unsure.
export function getCaseResponseVerdictTone(verdict: string): PillTone {
  switch (verdict) {
    case SecurityCaseAiVerdict.LikelyMalicious:
      return PillTone.Danger;
    case SecurityCaseAiVerdict.LikelyFalsePositive:
    case SecurityCaseAiVerdict.LikelyBenign:
      return PillTone.Success;
    default:
      return PillTone.Warning;
  }
}
