import { PluralTemplate, translationKey } from "../Translator";

/*
 * WHAT ASK AI'S DATA SECURITY ACTIONS SAY ON THEIR CARDS (#10378).
 *
 * Each action's approval card says, in words a person who has never seen
 * Data Security understands, what it changes, what stops working and what
 * it costs - each only where it applies - and, when it asks in every mode,
 * why (Types/AI/AIActionWords' AIActionEffects). These are those sentences:
 * English templates the Dashboard says in the reader's language (the
 * extractor reads this file's marks), each filled with data as it is
 * written - a store's name, a data type's name, a location, a reason
 * someone typed - never a value, a sample or a record. A store, a type and
 * a location are always in quotes, written as JSON strings, so a name with
 * words in it never reads as part of the sentence.
 *
 * The server builds the cards (Server/Utils/AI/Toolbox/DataSecurity*Tools);
 * AIActionWords lists these among the sentences a card may hold, so an
 * older Dashboard reads any of them as the English the action stores.
 */

// The cards' titles: what the action does, to what, by its name.
export const AI_DATA_SECURITY_ACTION_TITLES: {
  scrubFinding: string;
  scrubFindingUnnamed: string;
  confirmFinding: string;
  markFindingNotSensitive: string;
  judgeFindingUnnamed: string;
  acceptRisk: string;
  markNotAnIssue: string;
  reopenIssue: string;
  assignIssue: string;
  unassignIssue: string;
  changeIssueUnnamed: string;
  changeOwners: string;
  changeOwnersUnnamed: string;
  saveResidencyRule: string;
  saveOwnerRule: string;
  saveLabelRule: string;
  saveRuleUnnamed: string;
  blockPublicAccess: string;
  revokeSharing: string;
  turnOnVersioning: string;
  turnOnSoftDelete: string;
  turnOffObjectAcls: string;
  turnOnUniformAccess: string;
  requireSecureTransfer: string;
  turnOnPointInTimeRecovery: string;
  respondUnnamed: string;
  fixWithAi: string;
  fixWithAiUnnamed: string;
  approveProposal: string;
  dismissProposal: string;
  decideProposalUnnamed: string;
} = {
  scrubFinding: translationKey("Scrub {{dataType}} at {{location}} in {{store}}"),
  scrubFindingUnnamed: translationKey("Scrub a finding in telemetry"),
  confirmFinding: translationKey(
    "Confirm {{dataType}} at {{location}} in {{store}}",
  ),
  markFindingNotSensitive: translationKey(
    "Mark {{dataType}} at {{location}} in {{store}} as not sensitive",
  ),
  judgeFindingUnnamed: translationKey("Decide on a data security finding"),
  acceptRisk: translationKey("Accept the risk of {{issue}} until {{until}}"),
  markNotAnIssue: translationKey("Mark {{issue}} as not an issue"),
  reopenIssue: translationKey("Reopen {{issue}}"),
  assignIssue: translationKey("Assign {{issue}} to {{assignee}}"),
  unassignIssue: translationKey("Leave {{issue}} with nobody assigned"),
  changeIssueUnnamed: translationKey("Change a data security issue"),
  changeOwners: translationKey("Change the owners of {{store}}"),
  changeOwnersUnnamed: translationKey("Change a data store's owners"),
  saveResidencyRule: translationKey("Save residency rule {{name}}"),
  saveOwnerRule: translationKey("Save owner rule {{name}}"),
  saveLabelRule: translationKey("Save label rule {{name}}"),
  saveRuleUnnamed: translationKey("Save a data security rule"),
  // A response action on a store, as Fix it from here asks before it.
  blockPublicAccess: translationKey("Block public access to {{store}}"),
  revokeSharing: translationKey("Revoke the sharing of {{store}}"),
  turnOnVersioning: translationKey("Turn on versioning for {{store}}"),
  turnOnSoftDelete: translationKey("Turn on soft delete for {{store}}"),
  turnOffObjectAcls: translationKey("Turn off object ACLs for {{store}}"),
  turnOnUniformAccess: translationKey("Turn on uniform access for {{store}}"),
  requireSecureTransfer: translationKey(
    "Require secure transfer for {{store}}",
  ),
  turnOnPointInTimeRecovery: translationKey(
    "Turn on point-in-time recovery for {{store}}",
  ),
  respondUnnamed: translationKey("Change a data store through its cloud"),
  fixWithAi: translationKey("Ask OneUptime AI to fix {{issue}} in code"),
  fixWithAiUnnamed: translationKey(
    "Ask OneUptime AI to fix a data security issue in code",
  ),
  approveProposal: translationKey("Approve OneUptime AI's proposal: {{title}}"),
  dismissProposal: translationKey("Dismiss OneUptime AI's proposal: {{title}}"),
  decideProposalUnnamed: translationKey(
    "Decide on a proposal of OneUptime AI's",
  ),
};

// What changes: a sentence each, under the card's "What changes".
export const AI_DATA_SECURITY_ACTION_CHANGES: {
  scrubRule: string;
  scrubHashes: string;
  scrubProven: string;
  scrubNotProven: string;
  confirmFinding: string;
  notSensitiveFinding: string;
  acceptRisk: string;
  notAnIssueWithReason: string;
  notAnIssue: string;
  reopenIssue: string;
  assignIssue: string;
  unassignIssue: string;
  ownersAdded: string;
  ownersRemoved: string;
  residencyRule: string;
  residencyRuleForCountries: string;
  residencyIssuesOpen: string;
  ownerRule: string;
  labelRule: string;
  ruleAppliesToNewStores: string;
  ruleAppliedToStoresToday: string;
  blockPublicAccessS3: string;
  blockPublicAccessAzure: string;
  blockPublicAccessGcp: string;
  revokeSharingSnapshot: string;
  revokeSharingSnapshots: string;
  turnOnVersioning: string;
  turnOnSoftDelete: string;
  turnOffObjectAcls: string;
  turnOnUniformAccess: string;
  requireSecureTransfer: string;
  turnOnPointInTimeRecovery: string;
  checkedAgainRightAfter: string;
  fixPullRequest: string;
  fixPullRequestForService: string;
  fixPullRequestInStoreRepository: string;
  fixNothingMerged: string;
  approveProposal: string;
  dismissProposal: string;
  dismissProposalWithReason: string;
} = {
  scrubRule: translationKey(
    "Adds the scrub rule {{rule}}: it hides {{dataType}} at {{location}} in {{store}} as new data arrives.",
  ),
  scrubHashes: translationKey(
    "Adds the scrub rule {{rule}}: it replaces {{dataType}} at {{location}} in {{store}} with a hash as new data arrives, so it can still be matched but not read.",
  ),
  scrubProven: translationKey(
    "Tested on the records it was found in: it hides it in each of them, and changes nothing else.",
  ),
  scrubNotProven: translationKey(
    "It hides only this kind of data at this place, and leaves the rest of each record as it is.",
  ),
  confirmFinding: translationKey(
    "The finding counts as {{dataType}} for certain: the store's sensitivity and its issues count it, and OneUptime stops asking about it.",
  ),
  notSensitiveFinding: translationKey(
    "The finding is marked not sensitive, with your reason: {{reason}}",
  ),
  acceptRisk: translationKey(
    "The issue is accepted until {{until}}, with your reason: {{reason}} It opens again then if its check still fails.",
  ),
  notAnIssueWithReason: translationKey(
    "The issue is marked not an issue, with your reason: {{reason}} It stays closed.",
  ),
  notAnIssue: translationKey(
    "The issue is marked not an issue. It stays closed.",
  ),
  reopenIssue: translationKey(
    "The issue is open again and counts again. If its check passes now, it resolves on its own.",
  ),
  assignIssue: translationKey(
    "{{assignee}} is the one working on the issue. Nobody is notified, and nobody can read more than before.",
  ),
  unassignIssue: translationKey("Nobody is assigned to the issue."),
  ownersAdded: translationKey(
    "{{owners}} become owners of the store: each new issue on it is emailed to them.",
  ),
  ownersRemoved: translationKey(
    "{{owners}} stop being owners of the store: its new issues are no longer emailed to them.",
  ),
  residencyRule: translationKey(
    "{{categories}} may be kept only in {{regions}}.",
  ),
  residencyRuleForCountries: translationKey(
    "{{categories}} about people in {{countries}} may be kept only in {{regions}}.",
  ),
  residencyIssuesOpen: translationKey(
    "Each store that breaks it gets an issue at the next check.",
  ),
  ownerRule: translationKey(
    "{{owners}} become the owners of every store that matches: {{conditions}}",
  ),
  labelRule: translationKey(
    "Every store that matches gets the labels {{labels}}: {{conditions}}",
  ),
  ruleAppliesToNewStores: translationKey(
    "It applies to every store found from now on.",
  ),
  ruleAppliedToStoresToday: translationKey(
    "It is applied now to the stores it matches today, and to every store found from now on.",
  ),
  blockPublicAccessS3: translationKey(
    "Turns on the bucket's four Block Public Access settings, so nobody on the internet can read it. No object is changed.",
  ),
  blockPublicAccessAzure: translationKey(
    "Turns off anonymous blob access on the storage account, so no container is readable by anyone on the internet. No blob is changed.",
  ),
  blockPublicAccessGcp: translationKey(
    "Enforces public access prevention on the bucket, so nobody on the internet can read it. No object is changed.",
  ),
  revokeSharingSnapshot: translationKey(
    "Stops sharing the snapshot with everyone, and with any account outside the ones this project has connected. The snapshot itself is not changed.",
  ),
  revokeSharingSnapshots: translationKey(
    "Stops sharing every manual snapshot of it with everyone, and with any account outside the ones this project has connected. No snapshot or database is changed.",
  ),
  turnOnVersioning: translationKey(
    "Turns on versioning for the bucket, so an object that is overwritten or deleted can be restored from its earlier version. No object is changed.",
  ),
  turnOnSoftDelete: translationKey(
    "Turns on soft delete for the storage account's blobs and containers, for 14 days: a deleted blob or container can be restored in that time. No blob is changed.",
  ),
  turnOffObjectAcls: translationKey(
    "Sets the bucket's Object Ownership to Bucket owner enforced: object ACLs no longer grant access, and the bucket's policy alone decides who reads it. No object is changed.",
  ),
  turnOnUniformAccess: translationKey(
    "Turns on uniform bucket-level access: object ACLs no longer grant access, and the bucket's IAM policy alone decides who reads it. No object is changed.",
  ),
  requireSecureTransfer: translationKey(
    "Turns on Secure transfer required, and sets the minimum TLS version to 1.2: the storage account then takes HTTPS only, with TLS 1.2 or later. No blob is changed.",
  ),
  turnOnPointInTimeRecovery: translationKey(
    "Turns on point-in-time recovery for the table, so it can be restored to any second of the last 35 days. No item is changed.",
  ),
  checkedAgainRightAfter: translationKey(
    "OneUptime does this through the store's cloud connection and checks the store again right after: the issue resolves on its own once its check passes.",
  ),
  fixPullRequest: translationKey(
    "OneUptime AI writes the smallest change that fixes it and opens a pull request in {{repository}}.",
  ),
  fixPullRequestForService: translationKey(
    "OneUptime AI opens one pull request in {{repository}} that fixes every telemetry leak of {{service}} at once.",
  ),
  fixPullRequestInStoreRepository: translationKey(
    "OneUptime AI writes the smallest change that fixes it and opens a pull request in the repository connected under Code that holds its code.",
  ),
  fixNothingMerged: translationKey(
    "Nothing is merged or deployed: someone reviews the pull request and merges it.",
  ),
  approveProposal: translationKey(
    "Makes the change OneUptime AI proposed, with your permissions: {{change}}",
  ),
  dismissProposal: translationKey(
    "Turns the proposal down. It goes on the issue's timeline, and OneUptime AI does not propose it again.",
  ),
  dismissProposalWithReason: translationKey(
    "Turns the proposal down, with your reason: {{reason}} It goes on the issue's timeline, and OneUptime AI does not propose it again.",
  ),
};

// The same, counted: the findings a decision also settles, the stores a rule matches.
export const AI_DATA_SECURITY_ACTION_PLURAL_CHANGES: {
  alsoSimilarFindings: PluralTemplate;
  ruleMatchesStores: PluralTemplate;
  residencyMatchesStores: PluralTemplate;
  ruleMatchesNoStore: PluralTemplate;
  fixesIssues: PluralTemplate;
} = {
  alsoSimilarFindings: {
    one: translationKey(
      "The same decision, with the same reason, for {{count}} finding like it: {{findings}}",
    ),
    other: translationKey(
      "The same decision, with the same reason, for {{count}} findings like it: {{findings}}",
    ),
  },
  ruleMatchesStores: {
    one: translationKey("It matches {{count}} store today: {{stores}}"),
    other: translationKey("It matches {{count}} stores today: {{stores}}"),
  },
  residencyMatchesStores: {
    one: translationKey(
      "It covers {{count}} store today, and {{breaking}} break it: {{stores}}",
    ),
    other: translationKey(
      "It covers {{count}} stores today, and {{breaking}} break it: {{stores}}",
    ),
  },
  ruleMatchesNoStore: {
    one: translationKey("It matches no store you can see today."),
    other: translationKey("It matches no store you can see today."),
  },
  fixesIssues: {
    one: translationKey("It fixes {{count}} issue."),
    other: translationKey("It fixes {{count}} issues."),
  },
};

// What stops working: a sentence each, under the card's "What stops working".
export const AI_DATA_SECURITY_ACTION_STOPS_WORKING: {
  scrubReaders: string;
  scrubReadersUnknown: string;
  notSensitiveStopsCounting: string;
  acceptStopsCounting: string;
  notAnIssueStopsCounting: string;
  ownersStopBeingTold: string;
  labelsChangeWhoReads: string;
  blockPublicAccessS3: string;
  blockPublicAccessAzure: string;
  blockPublicAccessGcp: string;
  revokeSharing: string;
  turnOffObjectAcls: string;
  turnOnUniformAccess: string;
  requireSecureTransfer: string;
} = {
  scrubReaders: translationKey(
    "{{readers}} read {{location}}: they will see it hidden.",
  ),
  scrubReadersUnknown: translationKey(
    "OneUptime could not check what reads {{location}}: a monitor or a dashboard that does will see it hidden.",
  ),
  notSensitiveStopsCounting: translationKey(
    "The finding stops counting: the store's sensitivity and its issues no longer count it, and an issue that rested only on it resolves.",
  ),
  acceptStopsCounting: translationKey(
    "The issue stops counting until then: it leaves the open issues, the store's risk and the compliance scores, and its open alert resolves.",
  ),
  notAnIssueStopsCounting: translationKey(
    "The issue stops counting for good: it leaves the open issues, the store's risk and the compliance scores, and its open alert resolves.",
  ),
  ownersStopBeingTold: translationKey(
    "{{owners}} are no longer told about the store's new issues.",
  ),
  labelsChangeWhoReads: translationKey(
    "A team whose permissions are limited to {{labels}} can then read these stores and their issues.",
  ),
  blockPublicAccessS3: translationKey(
    "Anything that reads it publicly - a website, a download link - stops working.",
  ),
  blockPublicAccessAzure: translationKey(
    "Anything that reads it without a key stops working.",
  ),
  blockPublicAccessGcp: translationKey(
    "Anything that reads it publicly stops working.",
  ),
  revokeSharing: translationKey(
    "An account outside the ones this project has connected can no longer restore it.",
  ),
  turnOffObjectAcls: translationKey(
    "Anything that is given access through an ACL - another account, a public link - stops working.",
  ),
  turnOnUniformAccess: translationKey(
    "Anything that is given access through an ACL stops working, and after 90 days uniform access cannot be turned off again.",
  ),
  requireSecureTransfer: translationKey(
    "Anything that connects over HTTP, or with older TLS, stops working.",
  ),
};

// What it costs: a sentence each, under the card's "What it costs".
export const AI_DATA_SECURITY_ACTION_COSTS: {
  versioning: string;
  softDelete: string;
  pointInTimeRecovery: string;
  oneUptimeAi: string;
} = {
  versioning: translationKey(
    "Earlier versions are kept, and billed by the cloud, until a lifecycle rule removes them.",
  ),
  softDelete: translationKey(
    "Deleted data is kept, and billed by the cloud, for those 14 days.",
  ),
  pointInTimeRecovery: translationKey(
    "AWS bills point-in-time recovery by the table's size.",
  ),
  oneUptimeAi: translationKey(
    "It uses OneUptime AI: it counts toward the project's AI credits and daily limits.",
  ),
};

/*
 * Why an action asks in every mode, Auto-run included: the card's last
 * line, and what the MCP server says when it refuses one.
 */
export const AI_DATA_SECURITY_ACTION_ASKS_BECAUSE: {
  scrubIsRead: string;
  scrubNotChecked: string;
  confirmCanPage: string;
  notSensitive: string;
  acceptRisk: string;
  notAnIssue: string;
  owners: string;
  rule: string;
  respond: string;
  proposal: string;
} = {
  scrubIsRead: translationKey(
    "Asks first in every mode: something reads what it hides.",
  ),
  scrubNotChecked: translationKey(
    "Asks first in every mode: OneUptime could not check what reads what it hides.",
  ),
  confirmCanPage: translationKey(
    "Asks first in every mode: this project pages someone for a Critical issue, and confirming a finding can open one.",
  ),
  notSensitive: translationKey(
    "Asks first in every mode: it stops a finding counting.",
  ),
  acceptRisk: translationKey(
    "Asks first in every mode: it stops an issue counting.",
  ),
  notAnIssue: translationKey(
    "Asks first in every mode: it stops an issue counting for good.",
  ),
  owners: translationKey(
    "Asks first in every mode: it changes who is told about the store's issues.",
  ),
  rule: translationKey(
    "Asks first in every mode: you see what your words became before anything is saved.",
  ),
  respond: translationKey(
    "Asks first in every mode: it changes the store in its cloud, and what reads it may stop working.",
  ),
  proposal: translationKey(
    "Asks first in every mode: OneUptime AI proposed it, and a person decides.",
  ),
};

/*
 * Words a sentence above takes, translated with it: what a residency rule
 * covers when it names no category, and a condition no rule names.
 */
export const AI_DATA_SECURITY_ACTION_TERMS: {
  personalData: string;
  everyStore: string;
} = {
  personalData: translationKey("Personal data"),
  everyStore: translationKey("every store"),
};

/*
 * What reads an attribute a scrub would hide, by kind: a monitor, a
 * dashboard, a saved view, a recording rule or an SLO - each a term its
 * name follows (AI_ACTION_RESOURCE_BY_NAME), the words the Dashboard's
 * menus give them.
 */
export const AI_DATA_SECURITY_READER_KIND_TERMS: {
  Monitor: string;
  Dashboard: string;
  SavedView: string;
  RecordingRule: string;
  ServiceLevelObjective: string;
} = {
  Monitor: translationKey("Monitor"),
  Dashboard: translationKey("Dashboard"),
  SavedView: translationKey("Saved view"),
  RecordingRule: translationKey("Recording rule"),
  ServiceLevelObjective: translationKey("SLO"),
};

// More of what a scrub changes and takes away.
export const AI_DATA_SECURITY_SCRUB_SENTENCES: {
  alreadyHidden: string;
  securityEventsLoses: string;
} = {
  alreadyHidden: translationKey(
    "The scrub rule {{rule}} hides it already: nothing new is added, and the finding is marked scrubbed.",
  ),
  securityEventsLoses: translationKey(
    "Security Events reads it to tell who an attack or a sign-in came from, and loses that.",
  ),
};

export const AI_DATA_SECURITY_SCRUB_PLURAL_SENTENCES: {
  hiddenReaders: PluralTemplate;
} = {
  hiddenReaders: {
    one: translationKey(
      "{{count}} more that you cannot open reads {{location}} too.",
    ),
    other: translationKey(
      "{{count}} more that you cannot open read {{location}} too.",
    ),
  },
};

/*
 * The card an action leaves once it ran (WidgetBuilder.actionCard): the
 * kind of record over its heading, and a line of what happened to it.
 */
export const AI_DATA_SECURITY_CARD_KINDS: {
  dataStore: string;
  dataSecurityIssue: string;
  dataSecurityRule: string;
  dataSecurityProposal: string;
} = {
  dataStore: translationKey("Data store"),
  dataSecurityIssue: translationKey("Data security issue"),
  dataSecurityRule: translationKey("Data security rule"),
  dataSecurityProposal: translationKey("OneUptime AI proposal"),
};

export const AI_DATA_SECURITY_CARD_LINES: {
  scrubbed: string;
  findingConfirmed: string;
  findingNotSensitive: string;
  issueAccepted: string;
  issueNotAnIssue: string;
  issueReopened: string;
  issueAssigned: string;
  issueUnassigned: string;
  ownersChanged: string;
  ruleSaved: string;
  changedInCloud: string;
  alreadySoInCloud: string;
  fixStarted: string;
  fixOnItsWay: string;
  fixNotStarted: string;
  proposalApplied: string;
  proposalWaitsForSecondApproval: string;
  proposalDismissed: string;
} = {
  scrubbed: translationKey("Scrub rule {{rule}} hides it from now on"),
  findingConfirmed: translationKey("Confirmed: it counts"),
  findingNotSensitive: translationKey("Marked not sensitive: it stops counting"),
  issueAccepted: translationKey("Accepted until {{until}}"),
  issueNotAnIssue: translationKey("Marked not an issue"),
  issueReopened: translationKey("Open again"),
  issueAssigned: translationKey("Assigned to {{assignee}}"),
  issueUnassigned: translationKey("Nobody assigned"),
  ownersChanged: translationKey("Owners changed"),
  ruleSaved: translationKey("Saved and on"),
  changedInCloud: translationKey("Changed through its cloud connection"),
  alreadySoInCloud: translationKey("Already so: nothing changed"),
  fixStarted: translationKey("OneUptime AI is writing the pull request"),
  fixOnItsWay: translationKey("A fix is already on its way"),
  fixNotStarted: translationKey("Not started yet"),
  proposalApplied: translationKey("Approved and made"),
  proposalWaitsForSecondApproval: translationKey(
    "Approved once: it waits for a second person",
  ),
  proposalDismissed: translationKey("Dismissed"),
};

export const AI_DATA_SECURITY_CARD_PLURAL_LINES: {
  alsoForSimilar: PluralTemplate;
} = {
  alsoForSimilar: {
    one: translationKey("Also decided for {{count}} finding like it"),
    other: translationKey("Also decided for {{count}} findings like it"),
  },
};

/*
 * The chips under Sources an action or a read leaves (#7980): a rule
 * drafted or saved, and OneUptime AI's proposals.
 */
export const AI_DATA_SECURITY_CITATIONS: {
  ruleDraft: string;
  rule: string;
  proposals: string;
  proposal: string;
} = {
  ruleDraft: translationKey("Rule drafted from your words: {{name}}"),
  rule: translationKey("Data security rule {{name}}"),
  proposals: translationKey("OneUptime AI's proposals - {{count}} found"),
  proposal: translationKey("OneUptime AI's proposal {{title}}"),
};

// A condition of an owner or a label rule: what of a store it looks at, and what it matches.
export const AI_DATA_SECURITY_RULE_CONDITIONS: {
  nameMatches: string;
  descriptionMatches: string;
  cloudTagMatches: string;
  hasLabels: string;
} = {
  nameMatches: translationKey("its name matches {{pattern}}"),
  descriptionMatches: translationKey("its description matches {{pattern}}"),
  cloudTagMatches: translationKey("a cloud tag matches {{pattern}}"),
  hasLabels: translationKey("it has the labels {{labels}}"),
};

// A store a rule breaks, by its name and the region it is in.
export const AI_DATA_SECURITY_STORE_IN_REGION: string = translationKey(
  "{{store}} in {{region}}",
);

// A finding by its place: an attribute, a column or a field, in its store.
export const AI_DATA_SECURITY_FINDING_AT_PLACE: string = translationKey(
  "{{location}} in {{store}}",
);

// An issue by its title, on the store it is about: a title's {{issue}}.
export const AI_DATA_SECURITY_ISSUE_ON_STORE: string = translationKey(
  "{{issue}} on {{store}}",
);
