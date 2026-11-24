import { EntityRecognizer } from "../../../../../Server/Utils/DataSecurity/Model/EntityRecognizer";
import { ModelStoreBudget } from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import {
  RecognizedDataTypeId,
  RecognizedEntity,
} from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";

/*
 * A RECOGNISER FOR TESTS, BEHIND THE SAME INTERFACE AS THE MODEL.
 *
 * It "finds" the phrases it is told, wherever they appear in a text, as
 * names or street addresses with the score it is told, and charges the
 * budget a fixed time per text, so a scan can be run out of model time on
 * purpose. It reads texts in order and stops when the budget says so, as
 * the real one does, and remembers every text it was given, so a test can
 * see what the scanner handed it.
 */

export interface FakePhrase {
  text: string;
  dataTypeId: RecognizedDataTypeId;
  score?: number | undefined;
}

export const ISSUE_SENTENCE: string =
  "Refund approved for Maria Gonzalez, 14 Calle Mayor, Madrid";

export const ISSUE_PHRASES: Array<FakePhrase> = [
  { text: "Maria Gonzalez", dataTypeId: "person-name", score: 0.96 },
  { text: "14 Calle Mayor", dataTypeId: "postal-address", score: 0.99 },
];

export default class FakeEntityRecognizer implements EntityRecognizer {
  public readonly given: Array<string> = [];
  public calls: number = 0;
  private readonly phrases: ReadonlyArray<FakePhrase>;
  private readonly millisecondsPerText: number;
  private readonly failWith: Error | null;

  public constructor(
    data: {
      phrases?: ReadonlyArray<FakePhrase> | undefined;
      millisecondsPerText?: number | undefined;
      failWith?: Error | undefined;
    } = {},
  ) {
    this.phrases = data.phrases || ISSUE_PHRASES;
    this.millisecondsPerText = data.millisecondsPerText ?? 10;
    this.failWith = data.failWith || null;
  }

  public findIn(text: string): Array<RecognizedEntity> {
    const found: Array<RecognizedEntity> = [];

    for (const phrase of this.phrases) {
      let from: number = 0;

      for (;;) {
        const index: number = text.indexOf(phrase.text, from);

        if (index < 0) {
          break;
        }

        found.push({
          dataTypeId: phrase.dataTypeId,
          start: index,
          end: index + phrase.text.length,
          score: phrase.score ?? 0.95,
        });
        from = index + phrase.text.length;
      }
    }

    return found.sort((a: RecognizedEntity, b: RecognizedEntity): number => {
      return a.start - b.start;
    });
  }

  public async recognize(
    texts: ReadonlyArray<string>,
    budget: ModelStoreBudget,
  ): Promise<Map<string, Array<RecognizedEntity>>> {
    this.calls++;

    if (this.failWith) {
      throw this.failWith;
    }

    const found: Map<string, Array<RecognizedEntity>> = new Map();

    for (const text of texts) {
      this.given.push(text);

      if (!budget.canSpend()) {
        break;
      }

      budget.charge(this.millisecondsPerText);
      found.set(text, this.findIn(text));
    }

    budget.noteValues({ toRead: texts.length, read: found.size });

    return found;
  }
}
