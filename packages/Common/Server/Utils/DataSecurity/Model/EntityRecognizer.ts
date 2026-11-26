import {
  ModelRecognitions,
  RecognizedEntity,
} from "../../../../Utils/DataSecurity/Model/RecognizedEntity";
import { ModelStoreBudget } from "./ModelBudget";

/*
 * WHAT A SCAN NEEDS OF A NAMES-AND-ADDRESSES RECOGNISER.
 *
 * The scanner hands a recogniser the free-text values of a store and the
 * store's share of the scan's model time, and gets back what it found in
 * each value it read whole. The real one runs the model
 * (NameAddressRecognizer.ts); the tests' fake stands behind the same
 * interface. A recogniser keeps nothing: what it is given and what it finds
 * stay in the scan.
 */

export interface EntityRecognizer {
  /*
   * The names and street addresses in each text it reads whole before the
   * budget runs out, by text: a text read with nothing in it maps to an
   * empty list, a text not read has no entry. Tells the budget how many of
   * the texts it read.
   */
  recognize(
    texts: ReadonlyArray<string>,
    budget: ModelStoreBudget,
  ): Promise<Map<string, Array<RecognizedEntity>>>;
}

// What a recogniser found, as the classifiers look it up.
export class RecognitionMap implements ModelRecognitions {
  private readonly entities: ReadonlyMap<
    string,
    ReadonlyArray<RecognizedEntity>
  >;

  public constructor(
    entities: ReadonlyMap<string, ReadonlyArray<RecognizedEntity>>,
  ) {
    this.entities = entities;
  }

  public get(text: string): ReadonlyArray<RecognizedEntity> | undefined {
    return this.entities.get(text);
  }

  public get size(): number {
    return this.entities.size;
  }

  // Whether the model found anything at all in what it read.
  public get hasEntities(): boolean {
    for (const found of this.entities.values()) {
      if (found.length > 0) {
        return true;
      }
    }

    return false;
  }
}

/*
 * The texts a classification would have the model read, noted as it asks:
 * what a first pass over content whose fields and free text are only known
 * once it is parsed (ContentClassifier.classifyContentWithModel) gives the
 * model to read.
 */
export class CollectingRecognitions implements ModelRecognitions {
  private readonly asked: Set<string> = new Set();

  public get(text: string): ReadonlyArray<RecognizedEntity> | undefined {
    this.asked.add(text);
    return undefined;
  }

  public get texts(): Array<string> {
    return Array.from(this.asked);
  }
}

/*
 * A recogniser for a server or probe that cannot run the model: it reads
 * nothing, and the scan's warnings say why once there was free text to read.
 */
export class UnavailableRecognizer implements EntityRecognizer {
  private readonly reason: string;

  public constructor(reason: string) {
    this.reason = reason;
  }

  public async recognize(
    texts: ReadonlyArray<string>,
    budget: ModelStoreBudget,
  ): Promise<Map<string, Array<RecognizedEntity>>> {
    budget.noteUnavailable(this.reason, texts.length);
    return new Map();
  }
}
