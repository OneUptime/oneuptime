import SecurityCaseTask from "Common/Models/DatabaseModels/SecurityCaseTask";
import Select from "Common/Types/BaseDatabase/Select";
import ColumnLength from "Common/Types/Database/ColumnLength";

/*
 * A case's checklist (SecurityCaseTask), as its Tasks page reads it: the
 * tasks in the order they were added, how many are done, and the title a
 * new one may have. React-free, so the rules are pinned in a plain test.
 */

// The most tasks a case's page reads at once: far more than a checklist has.
export const SECURITY_CASE_TASKS_LIMIT: number = 200;

// What the page reads of each task.
export const SECURITY_CASE_TASK_SELECT: Select<SecurityCaseTask> = {
  _id: true,
  title: true,
  isDone: true,
  doneAt: true,
  createdAt: true,
  assignedToUserId: true,
  assignedToUser: {
    _id: true,
    name: true,
    email: true,
    profilePictureId: true,
  },
  doneByUserId: true,
  doneByUser: {
    _id: true,
    name: true,
    email: true,
  },
};

export interface SecurityCaseTaskProgress {
  done: number;
  total: number;
}

export function getSecurityCaseTaskProgress(
  tasks: ReadonlyArray<Pick<SecurityCaseTask, "isDone">>,
): SecurityCaseTaskProgress {
  return {
    done: tasks.filter((task: Pick<SecurityCaseTask, "isDone">): boolean => {
      return task.isDone === true;
    }).length,
    total: tasks.length,
  };
}

/*
 * A new task's title as it is sent: trimmed, and nothing when it is empty
 * or longer than a task keeps (the server says the same).
 */
export function readNewTaskTitle(value: string): string | null {
  const title: string = value.trim();

  if (!title || title.length > ColumnLength.LongText) {
    return null;
  }

  return title;
}

// The most a task's title holds, for the field that takes it.
export const SECURITY_CASE_TASK_TITLE_LIMIT: number = ColumnLength.LongText;
