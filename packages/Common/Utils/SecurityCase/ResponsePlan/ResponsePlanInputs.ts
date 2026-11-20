import SecurityCaseTask from "../../../Models/DatabaseModels/SecurityCaseTask";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import Select from "../../../Types/BaseDatabase/Select";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { JSONValue } from "../../../Types/JSON";
import {
  ResponsePlaybook,
  ResponseStep,
  ResponseTask,
} from "./ResponsePlanTypes";

/*
 * What a case's Response Plan reads, and how it reads it - the same in the
 * browser and on the server: the case's tasks (a step ticked off is one,
 * keyed by the step), the project's playbooks that are on (by what their
 * steps do) and what a tick writes.
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
 * OneUptime AI's own for one of its steps, the rule's author's for one of
 * the rule's - kept to a task's line.
 */
export function getResponseStepTitle(data: {
  step: Pick<ResponseStep, "aiText" | "ruleText">;
  text: string;
}): string {
  const title: string = (
    data.step.aiText ||
    data.step.ruleText ||
    data.text ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();

  return title.length > ColumnLength.LongText
    ? `${title.slice(0, ColumnLength.LongText - 1)}…`
    : title;
}
