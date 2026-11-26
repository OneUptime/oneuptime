import { toScannableValue } from "../../../../Utils/DataSecurity/FieldClassifier";
import {
  ModelRecognitions,
  RecognizedEntity,
} from "../../../../Utils/DataSecurity/Model/RecognizedEntity";
import logger from "../../Logger";
import { EntityRecognizer } from "./EntityRecognizer";
import { ModelBudget, ModelStoreBudget } from "./ModelBudget";
import {
  getNameAddressRecognizer,
  RecognizerAvailability,
} from "./NameAddressRecognizer";

/*
 * THE MODEL, WHERE A FINDING'S RECORDS ARE READ AGAIN (#10926).
 *
 * After a scan, a telemetry finding's records are read again, and the
 * scanner is asked of each value at the finding's place whether it holds
 * the finding's data: by Show the records it was seen in
 * (TelemetryFindingOccurrences), by Scrub It's proof of a rule and the
 * shapes OneUptime AI writes one from (TelemetryScrubProof), and by the
 * check that a code fix stopped a leak (AI/CodeFix/TelemetryLeakFixReads).
 * A person's name or a street address the names-and-addresses model found
 * matches no pattern a detector could run again: only the model can tell
 * it. So for a finding the model made, those reads hand the model the
 * values they read, and the classifier what it found - and the finding's
 * records are listed, its rules proven, as any other finding's are.
 *
 *  - Only for a finding the model made (DataStoreFinding.isFoundByModel):
 *    any other is read with its detectors alone, as before.
 *  - Within REREAD_MODEL_TIME_IN_MS of model time a read: a few hundred
 *    values at most. A value the model had no time for is not judged at
 *    all - a list shows fewer records, a proof counts fewer values - and
 *    is never taken for one that holds nothing.
 *  - Whatever the project's switches say about scans: the finding is
 *    there, and reading its own records again looks for nothing new.
 *  - The model the scans run (getNameAddressRecognizer): loaded once per
 *    process, nothing downloaded, nothing sent anywhere. A server where it
 *    cannot run says so (unavailableReason).
 *  - What the model found stays in this object, for the classifier.
 *    Nothing of a value - a token, an entity's text - is logged: a failure
 *    is logged by what failed.
 */

// The key of a re-read's one store in its budget.
const REREAD_STORE_KEY: string = "reread";

export class ModelRereads implements ModelRecognitions {
  private readonly recognizer: EntityRecognizer | null;
  private readonly budget: ModelStoreBudget;
  // What the model found in each value it read whole, by the value as the classifier reads it.
  private readonly found: Map<string, Array<RecognizedEntity>> = new Map();
  // Every value handed to the model, read or not: none is handed twice.
  private readonly given: Set<string> = new Set();
  private reason: string | null;

  public constructor(data: {
    recognizer: EntityRecognizer | null;
    // Why there is no recognizer, when there is none.
    unavailableReason?: string | undefined;
    budget?: ModelBudget | undefined;
  }) {
    this.recognizer = data.recognizer;
    this.reason = data.recognizer
      ? null
      : data.unavailableReason || "the model could not start on this server";
    this.budget = (data.budget || ModelBudget.forScope("reread")).forStore(
      REREAD_STORE_KEY,
    );
  }

  /*
   * The re-reads of a finding's records: null for a finding the model did
   * not make, which its detectors read alone. `getRecognizer` stands in for
   * the process's model in a test.
   */
  public static async forFinding(data: {
    isFoundByModel: boolean | null | undefined;
    getRecognizer?: (() => Promise<RecognizerAvailability>) | undefined;
    budget?: ModelBudget | undefined;
  }): Promise<ModelRereads | null> {
    if (data.isFoundByModel !== true) {
      return null;
    }

    let availability: RecognizerAvailability;

    try {
      availability = await (data.getRecognizer || getNameAddressRecognizer)();
    } catch {
      availability = { reason: "the model could not start" };
    }

    return "recognizer" in availability
      ? new ModelRereads({
          recognizer: availability.recognizer,
          budget: data.budget,
        })
      : new ModelRereads({
          recognizer: null,
          unavailableReason: `${availability.reason} on this server`,
          budget: data.budget,
        });
  }

  // Why the model cannot read here - not installed, would not start - or null.
  public get unavailableReason(): string | null {
    return this.reason;
  }

  public get isAvailable(): boolean {
    return this.reason === null;
  }

  // The model's time ran out before it read every value it was handed.
  public get isOutOfTime(): boolean {
    return this.reason === null && this.budget.ranOutBy !== null;
  }

  // How many values it read, and how many it was handed and had no time for.
  public get valuesRead(): number {
    return this.found.size;
  }

  public get valuesNotRead(): number {
    return Math.max(0, this.given.size - this.found.size);
  }

  /*
   * Hands the model the values it has not been handed yet, in order, and
   * keeps what it finds in each it reads whole within the budget. Values
   * as a record holds them: each is read as the classifier reads it
   * (toScannableValue), so what the model finds is found again there.
   */
  public async read(values: Iterable<string>): Promise<void> {
    const texts: Array<string> = [];

    for (const value of values) {
      const text: string | null = toScannableValue(value);

      if (text === null || this.given.has(text)) {
        continue;
      }

      this.given.add(text);
      texts.push(text);
    }

    // A model that cannot run, or stopped: what it was handed stays unread.
    if (texts.length === 0 || !this.recognizer || this.reason !== null) {
      return;
    }

    // No time left: nothing is tokenized for a model that will not run.
    if (!this.budget.canSpend()) {
      this.budget.noteValues({ toRead: texts.length, read: 0 });
      return;
    }

    try {
      const found: Map<
        string,
        Array<RecognizedEntity>
      > = await this.recognizer.recognize(texts, this.budget);

      for (const [text, entities] of found) {
        this.found.set(text, entities);
      }
    } catch (error) {
      logger.error(
        `DataSecurity: the names-and-addresses model stopped part-way through reading a finding's records again: ${
          error instanceof Error ? error.name : "unknown error"
        }`,
      );
      this.reason = "the model stopped part-way through this read";
    }
  }

  // What the model found in a value as the classifier reads it (ModelRecognitions).
  public get(text: string): ReadonlyArray<RecognizedEntity> | undefined {
    return this.found.get(text);
  }

  // Whether the model read this value, as a record holds it, whole.
  public isRead(value: string): boolean {
    const text: string | null = toScannableValue(value);

    return text !== null && this.found.has(text);
  }

  /*
   * What the model found in a value as a record holds it, at its places in
   * that value - the classifier reads it trimmed - or undefined for a
   * value it did not read.
   */
  public entitiesIn(value: string): Array<RecognizedEntity> | undefined {
    const text: string | null = toScannableValue(value);
    const entities: Array<RecognizedEntity> | undefined =
      text === null ? undefined : this.found.get(text);

    if (!entities) {
      return undefined;
    }

    const offset: number = value.length - value.trimStart().length;

    return entities.map((entity: RecognizedEntity): RecognizedEntity => {
      return {
        ...entity,
        start: entity.start + offset,
        end: entity.end + offset,
      };
    });
  }
}
