import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import {
  BulkActionRunResult,
  BulkItemOutcome,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import { BulkActionOnClickProps } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { getSloBulkResultKey } from "Common/Utils/Slo/SloBulkRecommendedBurnRateRules";
import { getSloItemId } from "./SloBulkRecommendedRulesDetails";
import SloRecommendedRulesBatches from "./SloRecommendedRulesBatches";

/*
 * THE RUN OF A BULK "ADD RECOMMENDED ..." ON THE SLO LIST.
 *
 * Add recommended rules (#6310) and Use the recommended policy (#6358) run
 * the same way: every selected SLO through the shared runner
 * (runBulkAction), so the progress dialog moves SLO by SLO and Stop is
 * heard between them; the ones the confirmation said would get something
 * sent to the action's bulk add route a batch at a time
 * (SloRecommendedRulesBatches); and each SLO's outcome read from the
 * server's answer for it.
 *
 * The run sends only what the confirmation said it would: an SLO it found
 * needs nothing, or could not read, is reported as it said, with no
 * request. An SLO it did not hear about is sent, for the server to decide.
 */

// One SLO's answer, as either action's bulk routes give it.
export interface SloBulkAnswer {
  serviceLevelObjectiveId: string;
}

export interface RunSloBulkAddOptions<TAnswer extends SloBulkAnswer> {
  actionProps: BulkActionOnClickProps<ServiceLevelObjective>;
  // What the confirmation said of each SLO, by getSloBulkResultKey; null when it said nothing.
  preview: Map<string, TAnswer> | null;
  /*
   * Whether what the confirmation said of an SLO settles it - it gets
   * nothing, or could not be read - so it is not sent.
   */
  isSettledByPreview: (previewed: TAnswer) => boolean;
  // What happened to one SLO, read from the server's answer for it.
  getOutcome: (answer: TAnswer | undefined) => BulkItemOutcome;
  addMissingToMany: (ids: Array<ObjectID>) => Promise<Array<TAnswer>>;
  // How many SLOs one request adds to.
  batchSize: number;
  // Why an SLO with no id was not sent.
  noAnswerMessage: string;
  // Told each request's answer, as it comes.
  onResults?: ((results: Array<TAnswer>) => void) | undefined;
}

export async function runSloBulkAdd<TAnswer extends SloBulkAnswer>(
  options: RunSloBulkAddOptions<TAnswer>,
): Promise<BulkActionRunResult<ServiceLevelObjective>> {
  const batchSize: number = Math.max(1, Math.floor(options.batchSize) || 1);

  // What the confirmation said of an SLO, when that settles it.
  const settledByPreview: (key: string) => TAnswer | undefined = (
    key: string,
  ): TAnswer | undefined => {
    const previewed: TAnswer | undefined = options.preview?.get(key);

    return previewed && options.isSettledByPreview(previewed)
      ? previewed
      : undefined;
  };

  const keysToSend: Array<string> = [];

  for (const item of options.actionProps.items) {
    const id: string = getSloItemId(item);

    if (id && !settledByPreview(getSloBulkResultKey(id))) {
      keysToSend.push(getSloBulkResultKey(id));
    }
  }

  const batches: SloRecommendedRulesBatches<TAnswer> =
    new SloRecommendedRulesBatches<TAnswer>({
      ids: keysToSend,
      batchSize: batchSize,
      send: async (keys: Array<string>): Promise<Map<string, TAnswer>> => {
        const results: Array<TAnswer> = await options.addMissingToMany(
          keys.map((key: string): ObjectID => {
            return new ObjectID(key);
          }),
        );

        options.onResults?.(results);

        const byKey: Map<string, TAnswer> = new Map();

        for (const result of results) {
          byKey.set(
            getSloBulkResultKey(result.serviceLevelObjectiveId),
            result,
          );
        }

        return byKey;
      },
    });

  const onStop: () => void = (): void => {
    batches.onStop();
  };

  options.actionProps.stopSignal?.addEventListener("abort", onStop);

  try {
    return await runBulkAction<ServiceLevelObjective>({
      actionProps: options.actionProps,
      // A batch's SLOs run together, each waiting for the batch's answer.
      concurrency: batchSize,
      step: async (item: ServiceLevelObjective): Promise<BulkItemOutcome> => {
        const id: string = getSloItemId(item);

        if (!id) {
          throw new BadDataException(options.noAnswerMessage);
        }

        const key: string = getSloBulkResultKey(id);
        const settled: TAnswer | undefined = settledByPreview(key);

        if (settled) {
          return options.getOutcome(settled);
        }

        return options.getOutcome(await batches.run(key));
      },
    });
  } finally {
    options.actionProps.stopSignal?.removeEventListener("abort", onStop);
  }
}
