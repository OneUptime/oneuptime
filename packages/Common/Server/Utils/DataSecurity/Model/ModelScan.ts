import { getValuesForModel } from "../../../../Utils/DataSecurity/FieldClassifier";
import {
  ModelRecognitions,
  RecognizedEntity,
} from "../../../../Utils/DataSecurity/Model/RecognizedEntity";
import logger from "../../Logger";
import {
  EntityRecognizer,
  RecognitionMap,
  recognizeAsWritten,
  UnavailableRecognizer,
} from "./EntityRecognizer";
import { BudgetScope, ModelBudget, ModelStoreBudget } from "./ModelBudget";
import {
  getNameAddressRecognizer,
  RecognizerAvailability,
} from "./NameAddressRecognizer";

/*
 * WHAT A SCAN DOES WITH THE NAMES-AND-ADDRESSES MODEL.
 *
 * A scan whose project has the model on carries a ModelScanContext in its
 * options: the recogniser and the scan's model budget. Each scanner hands it
 * the free-text values of a store as it reads them - a database table's
 * free-text columns, a service's log bodies, an object's text - and passes
 * what comes back to the classifiers (FieldClassifier, ContentClassifier) as
 * `recognitions`. A scan without it, or a value the model did not read, is
 * classified as before. At the end, the store's warnings say whether the
 * model ran out of time, or could not run at all (getModelWarnings).
 *
 * This is a local model, not OneUptime AI: it runs in the scanner's own
 * process, sends nothing anywhere, and builds no prompt.
 */

export interface ModelScanContext {
  recognizer: EntityRecognizer;
  budget: ModelBudget;
}

// The key of a content scan's one store in its budget.
export const CONTENT_STORE_KEY: string = "store";

export type ModelPlace = "server" | "probe";

/*
 * The context for a scan of a project that has the model on: the process's
 * recogniser, or - where it cannot run - one that reads nothing and says
 * why in the warnings. Undefined when the project has it off.
 */
export async function createModelScanContext(data: {
  isEnabled: boolean;
  scope: BudgetScope;
  place: ModelPlace;
  getRecognizer?: (() => Promise<RecognizerAvailability>) | undefined;
}): Promise<ModelScanContext | undefined> {
  if (!data.isEnabled) {
    return undefined;
  }

  let availability: RecognizerAvailability;

  try {
    availability = await (data.getRecognizer || getNameAddressRecognizer)();
  } catch {
    availability = { reason: "the model could not start" };
  }

  return {
    recognizer:
      "recognizer" in availability
        ? availability.recognizer
        : new UnavailableRecognizer(
            `${availability.reason} on this ${data.place}`,
          ),
    budget: ModelBudget.forScope(data.scope),
  };
}

/*
 * What the model finds in these texts within the store's budget, for the
 * classifiers; undefined when it reads none of them. A recogniser that fails
 * part-way is logged by what failed - never a value - and the scan goes on
 * without it.
 */
export async function recognizeTexts(
  context: ModelScanContext | undefined,
  storeKey: string,
  texts: Iterable<string>,
): Promise<RecognitionMap | undefined> {
  if (!context) {
    return undefined;
  }

  const unique: Array<string> = Array.from(new Set(texts)).filter(
    (text: string): boolean => {
      return text.trim().length > 0;
    },
  );

  if (unique.length === 0) {
    return undefined;
  }

  const budget: ModelStoreBudget = context.budget.forStore(storeKey);

  try {
    // Each value as the model reads it: a URL's escapes read (#11034).
    const found: Map<
      string,
      Array<RecognizedEntity>
    > = await recognizeAsWritten(context.recognizer, unique, budget);

    return found.size > 0 ? new RecognitionMap(found) : undefined;
  } catch (error) {
    logger.error(
      `DataSecurity: the names-and-addresses model stopped part-way through a scan: ${
        error instanceof Error ? error.name : "unknown error"
      }`,
    );
    budget.noteUnavailable(
      "the model stopped part-way through this scan",
      unique.length,
    );
    return undefined;
  }
}

export interface FieldForModel {
  path: string;
  values: ReadonlyArray<unknown>;
  // A log body, a message, a prompt: read whatever its length.
  readWithModel?: boolean | undefined;
}

/*
 * The model's reading of the fields it reads (getValuesForModel: free-text
 * fields, those named for free text, and those marked readWithModel),
 * within the store's budget.
 */
export async function recognizeFields(
  context: ModelScanContext | undefined,
  storeKey: string,
  fields: ReadonlyArray<FieldForModel>,
): Promise<ModelRecognitions | undefined> {
  if (!context) {
    return undefined;
  }

  const texts: Array<string> = [];

  for (const field of fields) {
    for (const value of getValuesForModel(field.values, {
      readWithModel: field.readWithModel,
      fieldPath: field.path,
    })) {
      texts.push(value);
    }
  }

  return await recognizeTexts(context, storeKey, texts);
}

// What a store's warnings say about the model in this scan.
export function getModelWarnings(
  context: ModelScanContext | undefined,
  storeKey: string,
): Array<string> {
  return context ? context.budget.forStore(storeKey).getWarnings() : [];
}
