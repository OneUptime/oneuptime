import { AsyncLocalStorage } from "async_hooks";
import {
  getStoppedPatternQuestions,
  PatternWorkAllowance,
  providePatternWorkAllowance,
} from "../../Utils/LinearRegExp/PatternWork";
import logger from "./Logger";

/*
 * THE PIECE OF WORK A PROJECT'S PATTERN QUESTION BELONGS TO.
 *
 * The patterns a project writes share one work allowance per piece of work
 * (Utils/LinearRegExp/PatternWork.ts): one evaluation of its rules of one
 * kind for one resource, one batch of telemetry it sends. The questions of
 * one piece of work are spread over awaits - a rule engine reads a monitor
 * between two rules, ingest yields to the event loop between records - and
 * other pieces of work run in between. So the allowance is kept per
 * asynchronous context: run() gives a function its own, which every question
 * and compile inside it counts against, awaited work included, and nothing
 * else does.
 *
 * Rule engines mark their evaluation with @RuleEvaluation(); ingest marks
 * the handling of each batch with @TelemetryBatch(), and each step that hands
 * a record to the project's patterns says so (handOverRecord).
 */

const allowances: AsyncLocalStorage<PatternWorkAllowance> =
  new AsyncLocalStorage<PatternWorkAllowance>();

// The matcher asks here for the allowance of the question under way.
providePatternWorkAllowance((): PatternWorkAllowance | undefined => {
  return allowances.getStore();
});

export default class PatternWorkScope {
  /*
   * Runs `work` with this allowance: the pattern questions and compiles
   * inside it, synchronous or awaited, count against it. A run inside
   * another has its own allowance; the outer one is back when it ends.
   */
  public static run<T>(allowance: PatternWorkAllowance, work: () => T): T {
    return allowances.run(allowance, work);
  }

  // The allowance of the piece of work under way, if any.
  public static current(): PatternWorkAllowance | undefined {
    return allowances.getStore();
  }

  /*
   * How many questions of the piece of work under way have stopped without
   * an answer so far. Read before and after a rule is evaluated, it says
   * whether the rule's patterns were all answered.
   */
  public static stoppedQuestions(): number {
    return getStoppedPatternQuestions();
  }

  /*
   * A record of a batch of telemetry - a log row, a span, a metric point, a
   * text of a session replay - about to be handed to the project's patterns
   * by one step: its texts add their share to the batch's allowance when the
   * step's first question runs (PatternWorkAllowance.handOver).
   */
  public static handOverRecord(record: unknown): void {
    const allowance: PatternWorkAllowance | undefined = allowances.getStore();

    if (allowance !== undefined) {
      allowance.handOver(record);
    }
  }
}

type PieceOfWorkDecorator = (
  target: unknown,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<any>,
) => TypedPropertyDescriptor<any>;

/*
 * Says once, when a piece of work ends, that some of its questions stopped
 * without an answer: what the operators of a server can see of a project's
 * patterns needing more work than they may take.
 */
function reportStoppedQuestions(
  allowance: PatternWorkAllowance,
  pieceOfWork: string,
): void {
  if (allowance.stoppedQuestions === 0) {
    return;
  }

  logger.warn(
    `${pieceOfWork}: ${allowance.stoppedQuestions} pattern question(s) stopped without an answer - the patterns needed more work than this piece of work may take (used ${allowance.usedWork} of ${allowance.allowedWork}).`,
  );
}

// A decorator that runs the method with its own allowance.
function withOwnAllowance(
  newAllowance: () => PatternWorkAllowance,
): PieceOfWorkDecorator {
  return (
    target: unknown,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<any>,
  ): TypedPropertyDescriptor<any> => {
    const work: (...args: Array<unknown>) => unknown = descriptor.value;
    const owner: string =
      (typeof target === "function"
        ? (target as { name?: string }).name
        : (target as { constructor?: { name?: string } }).constructor?.name) ||
      "Unknown";
    const pieceOfWork: string = `${owner}.${propertyKey}`;

    descriptor.value = function (
      this: unknown,
      ...args: Array<unknown>
    ): unknown {
      const allowance: PatternWorkAllowance = newAllowance();
      const result: unknown = PatternWorkScope.run(allowance, (): unknown => {
        return work.apply(this, args);
      });

      if (result instanceof Promise) {
        return result.finally((): void => {
          reportStoppedQuestions(allowance, pieceOfWork);
        });
      }

      reportStoppedQuestions(allowance, pieceOfWork);

      return result;
    };

    return descriptor;
  };
}

/*
 * Marks a method as one evaluation of a project's rules of one kind - for
 * one new resource, or one resource a rule run reaches: the rules' pattern
 * questions inside it share one allowance of their own
 * (PatternWorkAllowance.forRuleEvaluation).
 */
export function RuleEvaluation(): PieceOfWorkDecorator {
  return withOwnAllowance((): PatternWorkAllowance => {
    return PatternWorkAllowance.forRuleEvaluation();
  });
}

/*
 * Marks a method as the handling of one batch of telemetry a project sent:
 * the drop filters, scrub rules, pipelines and metric rules asked about its
 * records share one allowance of their own
 * (PatternWorkAllowance.forTelemetryBatch), which each record handed to
 * them adds its share to (PatternWorkScope.handOverRecord).
 */
export function TelemetryBatch(): PieceOfWorkDecorator {
  return withOwnAllowance((): PatternWorkAllowance => {
    return PatternWorkAllowance.forTelemetryBatch();
  });
}
