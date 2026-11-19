import { PluralTemplate, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT ONEUPTIME AI LEARNED ABOUT A SERVICE, AND WHAT ITS TEAM TOLD IT, IN
 * THE READER'S WORDS (#7672). The two cards on a service's overview: the
 * failures the service keeps having (ServiceKnowledgeCard), and the notes
 * the team writes for OneUptime AI (ServiceAiNotesTable). Each word is a
 * key, worded in every Dashboard language; the record titles, causes and
 * notes are the team's own, drawn as written.
 */

export const KNOWLEDGE_CARD_TITLE: string = translationKey(
  "What OneUptime AI Learned",
);
export const KNOWLEDGE_CARD_DESCRIPTION: string = translationKey(
  "The failures this service keeps having, from its resolved incidents and alerts whose cause your team recorded or confirmed.",
);

export const NOTHING_LEARNED_TITLE: string = translationKey(
  "No failures learned yet.",
);
export const NOTHING_LEARNED_DESCRIPTION: string = translationKey(
  "OneUptime AI learns from this service's resolved incidents and alerts once their root cause is recorded, or once someone confirms its analysis.",
);

// How often a failure was seen, of the records the reader may see.
export const SEEN_TIMES: PluralTemplate = {
  one: "Seen {{count}} time",
  other: "Seen {{count}} times",
};

export const LAST_SEEN: string = translationKey("Last seen {{time}}");

// A failure whose records say what happened but not why.
export const CAUSE_NOT_RECORDED: string = translationKey("Cause not recorded");

// The cause is OneUptime AI's analysis, which someone on the team confirmed.
export const CONFIRMED_ANALYSIS: string = translationKey(
  "Confirmed AI analysis",
);

// The fix that worked: {{name}} is a runbook's name, {{commands}} the commands it ran.
export const FIXED_BY_RUNBOOK: string = translationKey(
  "Fixed by running the runbook {{name}}",
);
export const FIXED_BY_COMMANDS: string = translationKey(
  "Fixed by running {{commands}}",
);

// A record a failure was learned from: {{incident}} and {{alert}} are "#42".
export const INCIDENT_REFERENCE: string = translationKey(
  "Incident {{incident}}",
);
export const ALERT_REFERENCE: string = translationKey("Alert {{alert}}");

export const LOADING_KNOWLEDGE: string = translationKey(
  "Loading what OneUptime AI learned",
);
// The server's answer was not one the card can draw.
export const COULD_NOT_READ_KNOWLEDGE: string = translationKey(
  "The answer from the server could not be read. Reload the page, then try again.",
);
export const COULD_NOT_LOAD_KNOWLEDGE_WITH_ERROR: string = translationKey(
  "What OneUptime AI learned could not be loaded. {{error}}",
);
export const TRY_AGAIN: string = translationKey("Try again");

export const NOTES_TABLE_TITLE: string = translationKey(
  "Notes for OneUptime AI",
);
export const NOTES_TABLE_DESCRIPTION: string = translationKey(
  "What your team knows about this service. OneUptime AI reads these notes in every investigation of an incident or alert on it.",
);
export const NOTE_SINGULAR: string = translationKey("Note");
export const NOTE_PLURAL: string = translationKey("Notes");
export const NOTE_FIELD_TITLE: string = translationKey("Note");
export const NOTE_FIELD_DESCRIPTION: string = translationKey(
  "What OneUptime AI should know, in plain words. It reads it as your team's note, never as an instruction.",
);
export const NOTE_FIELD_PLACEHOLDER: string = translationKey(
  "Its database failover takes five minutes; don't page for it.",
);
export const NOTES_EMPTY_TITLE: string = translationKey("No notes yet.");
export const NOTES_EMPTY_DESCRIPTION: string = translationKey(
  "Tell OneUptime AI what your team knows about this service, such as what is normal for it or what to check first.",
);

// Who wrote a note, and when ({{time}}: "3 days ago").
export const ADDED_BY_PERSON: string = translationKey(
  "Added by {{name}} {{time}}",
);
export const ADDED_THROUGH_API: string = translationKey(
  "Added through the API {{time}}",
);

export const SERVICE_AI_MEMORY_TEST_IDS: {
  knowledgeCard: string;
  failure: string;
  loading: string;
  error: string;
  tryAgain: string;
  empty: string;
  notesTable: string;
  noteCell: string;
} = {
  knowledgeCard: "service-ai-knowledge-card",
  failure: "service-ai-knowledge-failure",
  loading: "service-ai-knowledge-loading",
  error: "service-ai-knowledge-error",
  tryAgain: "service-ai-knowledge-try-again",
  empty: "service-ai-knowledge-empty",
  notesTable: "service-ai-notes",
  noteCell: "service-ai-note",
};
