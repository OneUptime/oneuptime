/*
 * THE CLOSE A DATA EXPOSURE PLAYBOOK'S CHECKLIST, AND THE EXPOSURE
 * ASSESSMENT'S ANSWERS TO IT (#10377).
 *
 * The playbook template adds four tasks to the case Data Security opens
 * for an exposure (SecurityPlaybookTemplates, DATA_EXPOSURE_TEMPLATE): who
 * read the data, whether it is a breach to report, the secrets to rotate,
 * and what to write when the case closes. The exposure assessment answers
 * each (Types/DataSecurity/ExposureAssessment): the reads, what the law
 * may ask, the secrets to rotate and the internal summary. The template
 * writes its tasks from this file and the assessment matches a case's
 * tasks to its answers from it, so the two never drift.
 *
 * A task is matched by its key (SecurityCaseTask.responseStepKey), else by
 * its title as the template wrote it; a person who renames a task unlinks
 * it, and their checklist is still theirs to tick.
 *
 * Pure, and free of the rest of Data Security's types, so the playbook
 * templates the Dashboard draws carry nothing more.
 */

export enum ExposureChecklistItem {
  WhoReadIt = "who-read-it",
  MustReport = "must-report",
  RotateSecrets = "rotate-secrets",
  CloseTheCase = "close-the-case",
}

export const EXPOSURE_CHECKLIST_ITEMS: ReadonlyArray<ExposureChecklistItem> = [
  ExposureChecklistItem.WhoReadIt,
  ExposureChecklistItem.MustReport,
  ExposureChecklistItem.RotateSecrets,
  ExposureChecklistItem.CloseTheCase,
];

// The template's lines, as it adds them: the English a task's title holds.
export const DATA_EXPOSURE_CHECKLIST_TASKS: Readonly<
  Record<ExposureChecklistItem, string>
> = {
  [ExposureChecklistItem.WhoReadIt]:
    "Find who read the data while it was exposed, from the store's access logs and its Who Can Reach It page",
  [ExposureChecklistItem.MustReport]:
    "Decide whether this is a breach you must report, to whom and by when",
  [ExposureChecklistItem.RotateSecrets]:
    "Rotate every secret and key the store held",
  [ExposureChecklistItem.CloseTheCase]:
    "Close the case with what was exposed, for how long, and to whom",
};

// A task made from the checklist may keep its line's key (SecurityCaseTask.responseStepKey).
export const EXPOSURE_CHECKLIST_STEP_KEY_PREFIX: string = "exposure-checklist:";

export function getExposureChecklistStepKey(
  item: ExposureChecklistItem,
): string {
  return `${EXPOSURE_CHECKLIST_STEP_KEY_PREFIX}${item}`;
}

// The checklist line a case's task is, or null.
export function getExposureChecklistItemOfTask(task: {
  title?: string | null | undefined;
  responseStepKey?: string | null | undefined;
}): ExposureChecklistItem | null {
  const key: string = (task.responseStepKey || "").trim();

  for (const item of EXPOSURE_CHECKLIST_ITEMS) {
    if (key === getExposureChecklistStepKey(item)) {
      return item;
    }
  }

  const title: string = (task.title || "").trim().toLowerCase();

  for (const item of EXPOSURE_CHECKLIST_ITEMS) {
    if (title === DATA_EXPOSURE_CHECKLIST_TASKS[item].toLowerCase()) {
      return item;
    }
  }

  return null;
}

// A checklist line, and the case's task it matched, when the case has one.
export interface ExposureChecklistAnswer {
  item: ExposureChecklistItem;
  taskId?: string | undefined;
  taskTitle?: string | undefined;
  isDone?: boolean | undefined;
}

export interface ExposureChecklistTask {
  id: string;
  title?: string | null | undefined;
  responseStepKey?: string | null | undefined;
  isDone?: boolean | null | undefined;
}

// Every checklist line, each with the first of the case's tasks that is it.
export function getExposureChecklistAnswers(
  tasks: ReadonlyArray<ExposureChecklistTask>,
): Array<ExposureChecklistAnswer> {
  return EXPOSURE_CHECKLIST_ITEMS.map(
    (item: ExposureChecklistItem): ExposureChecklistAnswer => {
      const task: ExposureChecklistTask | undefined = tasks.find(
        (candidate: ExposureChecklistTask): boolean => {
          return getExposureChecklistItemOfTask(candidate) === item;
        },
      );

      return task
        ? {
            item,
            taskId: task.id,
            taskTitle: task.title || undefined,
            isDone: task.isDone === true,
          }
        : { item };
    },
  );
}

// The template's tasks, in the checklist's order.
export function getDataExposureChecklistTaskLines(): Array<string> {
  return EXPOSURE_CHECKLIST_ITEMS.map((item: ExposureChecklistItem): string => {
    return DATA_EXPOSURE_CHECKLIST_TASKS[item];
  });
}
