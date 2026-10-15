/*
 * ON CREATE OR UPDATE: ONE TRIGGER FOR A NEW RECORD AND FOR A CHANGED ONE.
 *
 * Every model a workflow can watch has an On Create, an On Update and an On
 * Delete trigger. A workflow meant to act both when a record is created and
 * when it changes - keep another system in step with the incidents, post an
 * incident each time it is opened or edited - had to be built twice, once on
 * each trigger, and kept the same by hand. "On Create or Update Incident"
 * runs one workflow for both: once for each new record, and once for each
 * update that changes a field it watches.
 *
 * It has no route of its own. A create and an update already reach the
 * workflow service as an On Create and an On Update event
 * (DatabaseService.onTriggerWorkflow), and the workflows of this trigger are
 * started from those two (Server/Types/Workflow/Components/BaseModel/
 * OnTriggerBaseModel.initTrigger). So a save sends nothing more than it did,
 * and one save starts one run:
 *
 *   - a create starts it once, as "created" - also when OneUptime fills in
 *     more of the record while still creating it (an on-call policy run
 *     setting its status, say): those updates are part of the create, so
 *     they do not start it again (Server/Utils/Database/RecordsBeingCreated);
 *   - an update starts it once, as "updated", when it changes one of the
 *     fields in Fields to watch - or any field, with none watched. A create
 *     always starts it: Fields to watch is about updates.
 *
 * What started a run is its value What Happened: "created" or "updated",
 * which a later If / Else or Switch / Case can branch on, and a message can
 * say as it is ("INC-8 was created"). Run Workflow asks which of the two to
 * test it as.
 *
 * Pure: no server, no DOM.
 */

import Text from "../Text";

// The value that says what started the run, and the run value that asks it.
export const WHAT_HAPPENED_ID: string = "what-happened";
export const WHAT_HAPPENED_NAME: string = "What Happened";

// What What Happened holds.
export enum WhatHappened {
  Created = "created",
  Updated = "updated",
}

export const WHAT_HAPPENED_VALUES: ReadonlyArray<WhatHappened> = [
  WhatHappened.Created,
  WhatHappened.Updated,
];

// The most of a refused value the refusal quotes.
const QUOTED_VALUE_MAX_LENGTH: number = 40;

const WHITESPACE_PATTERN: RegExp = /\s+/g;

type QuoteFunction = (value: unknown) => string;

// A refused value, as the refusal quotes it: one line, cut short.
const quote: QuoteFunction = (value: unknown): string => {
  let text: string;

  try {
    text = typeof value === "string" ? value : String(JSON.stringify(value));
  } catch {
    text = String(value);
  }

  // Only the start is ever quoted, however long the value is.
  const characters: Array<string> = Array.from(
    (text || "")
      .slice(0, QUOTED_VALUE_MAX_LENGTH * 4)
      .replace(WHITESPACE_PATTERN, " ")
      .trim(),
  );

  return characters.length > QUOTED_VALUE_MAX_LENGTH
    ? `${characters.slice(0, QUOTED_VALUE_MAX_LENGTH - 1).join("")}…`
    : characters.join("");
};

export const CreateOrUpdateTriggerMessages: {
  notWhatHappened: (value: unknown) => string;
} = {
  notWhatHappened: (value: unknown): string => {
    return `${WHAT_HAPPENED_NAME} must be "${WhatHappened.Created}" or "${WhatHappened.Updated}", not "${quote(value)}".`;
  },
};

type ReadWhatHappenedFunction = (value: unknown) => WhatHappened | null;

/**
 * What a value says happened: "created" or "updated", in any case and with
 * space around it, as a Choice setting is read. Null for anything else.
 */
export const readWhatHappened: ReadWhatHappenedFunction = (
  value: unknown,
): WhatHappened | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized: string = value.trim().toLowerCase();

  return (
    WHAT_HAPPENED_VALUES.find((option: WhatHappened): boolean => {
      return option === normalized;
    }) || null
  );
};

export interface WhatHappenedForRun {
  // What the run is for, when it could be told.
  whatHappened: WhatHappened | null;
  // Why it could not, said to whoever started the run.
  error: string | null;
}

type GetWhatHappenedForRunFunction = (value: unknown) => WhatHappenedForRun;

/**
 * What a run started by hand is for: what Run Workflow, the API or another
 * workflow asked. Nothing asked is "created", as an empty choice is its
 * first; anything but the two is refused, with what it may be.
 */
export const getWhatHappenedForRun: GetWhatHappenedForRunFunction = (
  value: unknown,
): WhatHappenedForRun => {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return { whatHappened: WhatHappened.Created, error: null };
  }

  const whatHappened: WhatHappened | null = readWhatHappened(value);

  if (!whatHappened) {
    return {
      whatHappened: null,
      error: CreateOrUpdateTriggerMessages.notWhatHappened(value),
    };
  }

  return { whatHappened: whatHappened, error: null };
};

// What the trigger's id ends with, after the model's table name in dashes.
export const CREATE_OR_UPDATE_TRIGGER_SUFFIX: string = "on-create-or-update";

type GetCreateOrUpdateTriggerIdFunction = (tableName: string) => string;

/** "incident-on-create-or-update", for the table "Incident". */
export const getCreateOrUpdateTriggerId: GetCreateOrUpdateTriggerIdFunction = (
  tableName: string,
): string => {
  return `${Text.pascalCaseToDashes(tableName)}-${CREATE_OR_UPDATE_TRIGGER_SUFFIX}`;
};

type IsCreateOrUpdateTriggerFunction = (
  metadata: { id: string; tableName?: string | undefined } | null | undefined,
) => boolean;

/** Whether a step is a model's On Create or Update trigger. */
export const isCreateOrUpdateTrigger: IsCreateOrUpdateTriggerFunction = (
  metadata: { id: string; tableName?: string | undefined } | null | undefined,
): boolean => {
  return Boolean(
    metadata &&
      metadata.tableName &&
      metadata.id === getCreateOrUpdateTriggerId(metadata.tableName),
  );
};

type HasCreateOrUpdateTriggerFunction = (
  enableWorkflowOn:
    | { create?: boolean | undefined; update?: boolean | undefined }
    | null
    | undefined,
) => boolean;

/**
 * Whether a model has the trigger: exactly when it has both of the triggers
 * it combines, On Create and On Update.
 */
export const hasCreateOrUpdateTrigger: HasCreateOrUpdateTriggerFunction = (
  enableWorkflowOn:
    | { create?: boolean | undefined; update?: boolean | undefined }
    | null
    | undefined,
): boolean => {
  return Boolean(enableWorkflowOn?.create && enableWorkflowOn?.update);
};
