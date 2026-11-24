import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Every word a postmortem's Action Items are drawn with (#6801): the card on
 * an incident's Postmortem page, its dialogs, and Incidents > Action Items.
 * English keys the locales translate, and the test ids the tests read.
 * React-free. Words a case's Tasks already have - "{{done}} of {{total}}
 * done", "Assign to Me", "Done by {{name}} {{time}}" - are the same keys, so
 * they read the same in every language.
 */
export const POSTMORTEM_ACTION_ITEMS_COPY: {
  title: string;
  description: string;
  progress: string;
  addPlaceholder: string;
  addLabel: string;
  addButton: string;
  emptyTitle: string;
  emptyDescription: string;
  noOwner: string;
  due: string;
  overdue: string;
  doneBy: string;
  doneAt: string;
  doneByPullRequest: string;
  wontDo: string;
  wontDoBy: string;
  markDone: string;
  markNotDone: string;
  moreActions: string;
  assignToMe: string;
  assignToSomeoneElse: string;
  unassign: string;
  editActionItem: string;
  deleteActionItem: string;
  openPullRequest: string;
  writeTest: string;
  connectRepository: string;
  createMonitor: string;
  markWontDo: string;
  reopen: string;
  pullRequest: string;
  monitor: string;
  assignTitle: string;
  assignDescription: string;
  ownerField: string;
  assignSubmit: string;
  editTitle: string;
  titleField: string;
  dueDateField: string;
  descriptionField: string;
  descriptionHelp: string;
  saveChanges: string;
  deleteTitle: string;
  deleteDescription: string;
  deleteSubmit: string;
  trackHelp: string;
  pullRequestTitle: string;
  testTitle: string;
  pullRequestDescription: string;
  testDescription: string;
  repositoryField: string;
  repositoryHelp: string;
  instructionsField: string;
  instructionsHelp: string;
  instructionsPlaceholder: string;
  askSubmit: string;
  listTitle: string;
  listDescription: string;
  listEmptyTitle: string;
  listEmptyDescription: string;
  actionItemColumn: string;
  incidentColumn: string;
  statusColumn: string;
} = {
  title: translationKey("Action Items"),
  description: translationKey(
    "What the team will do so this does not happen again: who owns each, and when it is due.",
  ),
  progress: translationKey("{{done}} of {{total}} done"),
  addPlaceholder: translationKey(
    "Add an action item, like Alert on connection pool usage",
  ),
  addLabel: translationKey("New action item"),
  addButton: translationKey("Add Action Item"),
  emptyTitle: translationKey("No action items yet"),
  emptyDescription: translationKey(
    "Add what the team will change so this does not happen again, then give each one an owner and a due date.",
  ),
  noOwner: translationKey("No owner"),
  due: translationKey("Due {{date}}"),
  overdue: translationKey("Overdue, due {{date}}"),
  doneBy: translationKey("Done by {{name}} {{time}}"),
  doneAt: translationKey("Done {{time}}"),
  doneByPullRequest: translationKey(
    "Done {{time}}, when its pull request merged",
  ),
  wontDo: translationKey("Won't Do"),
  wontDoBy: translationKey("Won't do, decided by {{name}} {{time}}"),
  markDone: translationKey("Mark {{title}} done"),
  markNotDone: translationKey("Mark {{title}} not done"),
  moreActions: translationKey("More action item actions"),
  assignToMe: translationKey("Assign to Me"),
  assignToSomeoneElse: translationKey("Assign to Someone Else"),
  unassign: translationKey("Unassign"),
  editActionItem: translationKey("Edit Action Item"),
  deleteActionItem: translationKey("Delete Action Item"),
  openPullRequest: translationKey("Open Pull Request with AI"),
  writeTest: translationKey("Write a Test with AI"),
  connectRepository: translationKey("Connect a Repository"),
  createMonitor: translationKey("Create Monitor"),
  markWontDo: translationKey("Mark as Won't Do"),
  reopen: translationKey("Reopen"),
  pullRequest: translationKey("Pull request #{{number}}"),
  monitor: translationKey("Monitor"),
  assignTitle: translationKey("Assign Action Item"),
  assignDescription: translationKey("Pick a person to own {{title}}."),
  ownerField: translationKey("Owner"),
  assignSubmit: translationKey("Assign"),
  editTitle: translationKey("Edit Action Item"),
  titleField: translationKey("Action Item"),
  dueDateField: translationKey("Due Date"),
  descriptionField: translationKey("Description"),
  descriptionHelp: translationKey(
    "Why it matters, and how anyone will know it is done.",
  ),
  saveChanges: translationKey("Save Changes"),
  deleteTitle: translationKey("Delete Action Item"),
  deleteDescription: translationKey(
    "Delete {{title}}? The incident's feed keeps a record that it was deleted.",
  ),
  deleteSubmit: translationKey("Delete Action Item"),
  trackHelp: translationKey(
    "Each becomes an action item you can give an owner and a due date. Ticked boxes are tracked as done.",
  ),
  pullRequestTitle: translationKey("Open Pull Request with OneUptime AI"),
  testTitle: translationKey("Write a Test with OneUptime AI"),
  pullRequestDescription: translationKey(
    "OneUptime AI makes the change {{title}} asks for, and opens a pull request for review. The incident and its postmortem go with the request.",
  ),
  testDescription: translationKey(
    "For {{title}}, OneUptime AI writes a test that would have caught this incident and opens a pull request. The postmortem goes with the request.",
  ),
  repositoryField: translationKey("Repository"),
  repositoryHelp: translationKey("Where OneUptime AI makes the change."),
  instructionsField: translationKey("Instructions"),
  instructionsHelp: translationKey(
    "Where to look, or what to keep in mind. OneUptime AI reads it after the action item.",
  ),
  instructionsPlaceholder: translationKey(
    "For example: the retry belongs in the payments client.",
  ),
  askSubmit: translationKey("Ask OneUptime AI"),
  listTitle: translationKey("Action Items"),
  listDescription: translationKey(
    "Every postmortem's action items across the project: who owns each, when it is due, and whether it is done.",
  ),
  listEmptyTitle: translationKey("No action items yet"),
  listEmptyDescription: translationKey(
    "Action items added to an incident's postmortem, or tracked from its note, are listed here.",
  ),
  actionItemColumn: translationKey("Action Item"),
  incidentColumn: translationKey("Incident"),
  statusColumn: translationKey("Status"),
};

// "The postmortem lists 3 action items that are not tracked yet."
export const UNTRACKED_ACTION_ITEMS_SENTENCE: PluralTemplate = {
  one: translationKey(
    "The postmortem lists {{count}} action item that is not tracked yet.",
  ),
  other: translationKey(
    "The postmortem lists {{count}} action items that are not tracked yet.",
  ),
};

// "Track 3 Action Items"
export const TRACK_ACTION_ITEMS_BUTTON: PluralTemplate = {
  one: translationKey("Track {{count}} Action Item"),
  other: translationKey("Track {{count}} Action Items"),
};

// After the titles the suggestion names: "and 2 more".
export const MORE_UNTRACKED_ACTION_ITEMS: PluralTemplate = {
  one: translationKey("and {{count}} more"),
  other: translationKey("and {{count}} more"),
};

/*
 * The status names, as POSTMORTEM_ACTION_ITEM_STATUS_NAMES writes them in
 * English, marked here so the extractor finds them: the list's Status
 * column and filter look each up in the reader's language.
 */
export const POSTMORTEM_ACTION_ITEM_STATUS_WORDS: Array<string> = [
  translationKey("To Do"),
  translationKey("Done"),
  translationKey("Won't Do"),
];

export const POSTMORTEM_ACTION_ITEMS_TEST_IDS: {
  card: string;
  list: string;
  row: string;
  checkbox: string;
  title: string;
  owner: string;
  due: string;
  closedLine: string;
  codeTask: string;
  monitor: string;
  more: string;
  empty: string;
  error: string;
  addInput: string;
  addButton: string;
  progress: string;
  track: string;
  trackButton: string;
  dialogItem: string;
  repositoryPicker: string;
} = {
  card: "postmortem-action-items",
  list: "postmortem-action-items-list",
  row: "postmortem-action-item",
  checkbox: "postmortem-action-item-done",
  title: "postmortem-action-item-title",
  owner: "postmortem-action-item-owner",
  due: "postmortem-action-item-due",
  closedLine: "postmortem-action-item-closed",
  codeTask: "postmortem-action-item-code-task",
  monitor: "postmortem-action-item-monitor",
  more: "postmortem-action-item-more",
  empty: "postmortem-action-items-empty",
  error: "postmortem-action-items-error",
  addInput: "postmortem-action-items-add-input",
  addButton: "postmortem-action-items-add-button",
  progress: "postmortem-action-items-progress",
  track: "postmortem-action-items-track",
  trackButton: "postmortem-action-items-track-button",
  dialogItem: "postmortem-action-item-dialog-item",
  // The dialog's repository field, searched on the server (#10764).
  repositoryPicker: "postmortem-action-item-repository",
};
