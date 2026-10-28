import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Every word a case's Tasks page is drawn with, as English keys the locales
 * translate, and the test ids the offline browser suite reads. React-free.
 */
export const SECURITY_CASE_TASKS_COPY: {
  title: string;
  description: string;
  progress: string;
  addPlaceholder: string;
  addLabel: string;
  addButton: string;
  emptyTitle: string;
  emptyDescription: string;
  unassigned: string;
  doneBy: string;
  doneAt: string;
  markDone: string;
  markNotDone: string;
  moreActions: string;
  assignToMe: string;
  assignToSomeoneElse: string;
  unassign: string;
  editTask: string;
  deleteTask: string;
  assignTitle: string;
  assignDescription: string;
  assignField: string;
  assignSubmit: string;
  editTitle: string;
  titleField: string;
  saveChanges: string;
  deleteTitle: string;
  deleteDescription: string;
  deleteSubmit: string;
} = {
  title: translationKey("Tasks"),
  description: translationKey(
    "What has to be done on this case, and who is doing it. Tick a task off when it is done.",
  ),
  progress: translationKey("{{done}} of {{total}} done"),
  addPlaceholder: translationKey("Add a task, like Reset the user's password"),
  addLabel: translationKey("New task"),
  addButton: translationKey("Add Task"),
  emptyTitle: translationKey("No tasks yet"),
  emptyDescription: translationKey(
    "Add what this case needs done, then hand each task to whoever will do it.",
  ),
  unassigned: translationKey("Unassigned"),
  doneBy: translationKey("Done by {{name}} {{time}}"),
  doneAt: translationKey("Done {{time}}"),
  markDone: translationKey("Mark {{title}} done"),
  markNotDone: translationKey("Mark {{title}} not done"),
  moreActions: translationKey("More task actions"),
  assignToMe: translationKey("Assign to Me"),
  assignToSomeoneElse: translationKey("Assign to Someone Else"),
  unassign: translationKey("Unassign"),
  editTask: translationKey("Edit Task"),
  deleteTask: translationKey("Delete Task"),
  assignTitle: translationKey("Assign Task"),
  // As a case's own Assign to Someone Else asks it: "Pick a person to work".
  assignDescription: translationKey(
    "Pick a person to do {{title}}. They are notified.",
  ),
  assignField: translationKey("Assign To"),
  assignSubmit: translationKey("Assign"),
  editTitle: translationKey("Edit Task"),
  titleField: translationKey("Task"),
  saveChanges: translationKey("Save Changes"),
  deleteTitle: translationKey("Delete Task"),
  deleteDescription: translationKey(
    "Delete {{title}}? The case's timeline keeps a record that it was deleted.",
  ),
  deleteSubmit: translationKey("Delete Task"),
};

// The menu's count beside Tasks, and the Close Case dialog's reminder.
export const SECURITY_CASE_OPEN_TASKS: PluralTemplate = {
  one: "{{count}} task on this case is still open.",
  other: "{{count}} tasks on this case are still open.",
};

export const SECURITY_CASE_TASKS_TEST_IDS: {
  card: string;
  list: string;
  row: string;
  checkbox: string;
  title: string;
  assignee: string;
  assigneeLine: string;
  doneLine: string;
  more: string;
  progress: string;
  addInput: string;
  addButton: string;
  empty: string;
  error: string;
  closeHint: string;
  dialogTask: string;
} = {
  card: "security-case-tasks",
  list: "security-case-tasks-list",
  row: "security-case-task",
  checkbox: "security-case-task-done",
  title: "security-case-task-title",
  assignee: "security-case-task-assignee",
  // In a narrow list, who has it: a line under the task's title.
  assigneeLine: "security-case-task-assignee-line",
  doneLine: "security-case-task-done-line",
  more: "security-case-task-more",
  progress: "security-case-tasks-progress",
  addInput: "security-case-task-add-input",
  addButton: "security-case-task-add",
  empty: "security-case-tasks-empty",
  error: "security-case-tasks-error",
  closeHint: "security-case-close-open-tasks",
  // The task a dialog is about, in bold in its sentence.
  dialogTask: "security-case-task-dialog-name",
};
