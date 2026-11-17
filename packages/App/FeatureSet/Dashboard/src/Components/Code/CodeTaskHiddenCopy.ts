import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A CODE TASK A PAGE SHOWS BESIDE SOMETHING ELSE, HIDDEN FROM ITS READER.
 *
 * An exception's fix panel, the fix line of an investigation, the pull
 * request to the code under a fix's step and a trace's performance fix each
 * show a Code task beside something the reader may read. When a reply
 * carried a private incident or alert into that task which the reader may
 * not open, the task's own page answers it as not found, and so does the
 * server for these pages (CodeTaskThread.findTasksHiddenFrom): each says
 * the task is there and why nothing of it shows, rather than a state and a
 * link that lead nowhere.
 *
 * English keys (translationKey), translated where they are drawn. Nothing
 * else is imported, so the pages' pure helpers - read by App's tests in
 * Node, with no window - can use them.
 */

// Where a page draws a task's state: its state is hidden.
export const CODE_TASK_HIDDEN_LABEL: string = translationKey("Hidden");

// Where a page says how the task stands: why nothing of it shows.
export const CODE_TASK_HIDDEN_SENTENCE: string = translationKey(
  "A private incident or alert you can't open was added to this task, so its progress and pull request are hidden.",
);
