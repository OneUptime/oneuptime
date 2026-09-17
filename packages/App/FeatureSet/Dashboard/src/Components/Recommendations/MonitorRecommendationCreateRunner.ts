import { MonitorRecommendationCreatePlanItem } from "./MonitorRecommendationCreateUtil";

/*
 * The batch-create loop, with React and the API client both kept out of it.
 *
 * Two things pushed this out of the component. The first is that the loop is
 * the only part of the recommendations page a user watches happen — eighteen
 * sequential creates take the better part of a minute, and until now the only
 * feedback was a "Created 3 of 5..." line that did not appear at all until the
 * first one had landed. A progress bar needs per-item state, and per-item
 * state that lives in a `.tsx` cannot be tested: the App suite runs in a plain
 * Node environment with no renderer.
 *
 * The second is that the loop used to abort on the first rejection. Monitor
 * creation runs label rules, owner rules and workspace notifications per
 * monitor, so one bad recommendation in a batch of eighteen is a perfectly
 * ordinary outcome — and throwing away the fourteen that would have succeeded
 * because the third one failed is not. Here a failure is a VALUE, not an
 * exception, so the run always reaches the end and the caller is told exactly
 * which ones landed.
 */

export enum MonitorRecommendationCreateItemStatus {
  // Queued, not started. Everything begins here.
  Pending = "Pending",
  // The create request for this one is in flight.
  Creating = "Creating",
  Created = "Created",
  Failed = "Failed",
}

export interface MonitorRecommendationCreateItemProgress {
  recommendationId: string;
  // The monitor's name, i.e. what the user will see in the monitor list.
  name: string;
  status: MonitorRecommendationCreateItemStatus;
  // Set only when status is Failed.
  errorMessage?: string | undefined;
}

export interface MonitorRecommendationCreateProgress {
  items: Array<MonitorRecommendationCreateItemProgress>;
  totalCount: number;
  createdCount: number;
  failedCount: number;
  /*
   * True once every item has reached Created or Failed. Progress is emitted
   * before each item starts as well as after it finishes, so a caller cannot
   * infer completion from the counts alone without also knowing the total —
   * this saves every caller that arithmetic.
   */
  isComplete: boolean;
}

/*
 * What one create attempt reports back. Deliberately a result rather than a
 * thrown error: an injected function that throws is still handled below, but
 * modelling the expected failure as a value is what keeps the loop honest
 * about continuing.
 */
export type MonitorRecommendationCreateOutcome =
  | { isCreated: true }
  | { isCreated: false; errorMessage: string };

export type MonitorRecommendationCreateFunction = (
  item: MonitorRecommendationCreatePlanItem,
) => Promise<MonitorRecommendationCreateOutcome>;

export type MonitorRecommendationCreateProgressListener = (
  progress: MonitorRecommendationCreateProgress,
) => void;

export default class MonitorRecommendationCreateRunner {
  /*
   * The progress every caller should start from, so the panel can render a
   * full list of pending rows the moment the batch is submitted rather than
   * popping into existence one row at a time.
   */
  public static getInitialProgress(
    plan: Array<MonitorRecommendationCreatePlanItem>,
  ): MonitorRecommendationCreateProgress {
    return {
      items: plan.map((item: MonitorRecommendationCreatePlanItem) => {
        return {
          recommendationId: item.recommendation.recommendationId,
          name: item.monitor.name || item.recommendation.name,
          status: MonitorRecommendationCreateItemStatus.Pending,
        };
      }),
      totalCount: plan.length,
      createdCount: 0,
      failedCount: 0,
      isComplete: plan.length === 0,
    };
  }

  /*
   * Runs the plan in order, one at a time.
   *
   * Sequential is deliberate and predates this file: monitor creation runs
   * label rules, owner rules and workspace notifications per monitor, and
   * firing eighteen of those at once is a burst the Free-plan monitor-count
   * check also has to serialize against. It is also what makes the progress
   * bar mean something — a parallel batch would sit at 0% and then jump to
   * 100%.
   */
  public static async run(data: {
    plan: Array<MonitorRecommendationCreatePlanItem>;
    createMonitor: MonitorRecommendationCreateFunction;
    onProgress?: MonitorRecommendationCreateProgressListener | undefined;
  }): Promise<MonitorRecommendationCreateProgress> {
    const items: Array<MonitorRecommendationCreateItemProgress> =
      this.getInitialProgress(data.plan).items;

    let createdCount: number = 0;
    let failedCount: number = 0;

    type EmitFunction = () => void;

    /*
     * Every emission carries a fresh array of fresh objects. A caller holding
     * this in React state and mutating in place would re-render nothing —
     * `setState` bails out on an identical reference, and the bar would sit
     * at zero for the whole run.
     */
    const emit: EmitFunction = (): void => {
      if (!data.onProgress) {
        return;
      }

      data.onProgress({
        items: items.map((item: MonitorRecommendationCreateItemProgress) => {
          return { ...item };
        }),
        totalCount: items.length,
        createdCount: createdCount,
        failedCount: failedCount,
        isComplete: createdCount + failedCount === items.length,
      });
    };

    emit();

    for (let index: number = 0; index < data.plan.length; index++) {
      const planItem: MonitorRecommendationCreatePlanItem = data.plan[index]!;
      const progressItem: MonitorRecommendationCreateItemProgress =
        items[index]!;

      progressItem.status = MonitorRecommendationCreateItemStatus.Creating;
      emit();

      let outcome: MonitorRecommendationCreateOutcome;

      try {
        outcome = await data.createMonitor(planItem);
      } catch (err) {
        /*
         * The injected function is expected to return a result, but it is
         * injected — a caller that lets an exception escape should not take
         * the rest of the batch down with it.
         */
        outcome = {
          isCreated: false,
          errorMessage:
            err instanceof Error && err.message
              ? err.message
              : "Something went wrong while creating this monitor.",
        };
      }

      if (outcome.isCreated) {
        progressItem.status = MonitorRecommendationCreateItemStatus.Created;
        createdCount = createdCount + 1;
      } else {
        progressItem.status = MonitorRecommendationCreateItemStatus.Failed;
        progressItem.errorMessage = outcome.errorMessage;
        failedCount = failedCount + 1;
      }

      emit();
    }

    return {
      items: items.map((item: MonitorRecommendationCreateItemProgress) => {
        return { ...item };
      }),
      totalCount: items.length,
      createdCount: createdCount,
      failedCount: failedCount,
      isComplete: true,
    };
  }

  /*
   * The selection to keep after a run that partly failed.
   *
   * Everything that was created is removed and everything else is left alone —
   * including recommendations the user had selected that never made it into
   * the plan (a teammate dismissed one between the click and the submit), so a
   * retry is a retry of exactly what did not happen. Re-offering a created one
   * would silently produce a duplicate monitor: `createOrUpdate` with
   * `FormType.Create` does not de-duplicate, and the coverage diff that would
   * have caught it only reloads after this returns.
   */
  public static getUnsuccessfulRecommendationIds(data: {
    progress: MonitorRecommendationCreateProgress;
    selectedRecommendationIds: Set<string>;
  }): Set<string> {
    const remaining: Set<string> = new Set<string>(
      data.selectedRecommendationIds,
    );

    for (const item of data.progress.items) {
      if (item.status === MonitorRecommendationCreateItemStatus.Created) {
        remaining.delete(item.recommendationId);
      }
    }

    return remaining;
  }

  /*
   * The one line that goes next to the progress bar.
   *
   * Kept here rather than in the panel because "which of these numbers is the
   * headline" is a decision, not a formatting detail: while the batch is
   * running the user wants to know how far along it is, and once it has
   * finished they want to know whether anything failed.
   */
  public static getSummaryText(
    progress: MonitorRecommendationCreateProgress,
  ): string {
    const monitorWord: (count: number) => string = (count: number): string => {
      return count === 1 ? "monitor" : "monitors";
    };

    /*
     * While it runs, the bar beside this line is already showing "N of M" and
     * a percentage — so the sentence does not repeat them. It answers the two
     * questions the bar cannot: why it is taking this long, and why Close is
     * greyed out.
     */
    if (!progress.isComplete) {
      return `Creating one monitor at a time so your notification rules are not flooded.`;
    }

    if (progress.failedCount === 0) {
      return `Created ${progress.createdCount} ${monitorWord(
        progress.createdCount,
      )}.`;
    }

    if (progress.createdCount === 0) {
      return `None of the ${progress.totalCount} ${monitorWord(
        progress.totalCount,
      )} could be created.`;
    }

    return `Created ${progress.createdCount} of ${
      progress.totalCount
    } ${monitorWord(progress.totalCount)}. ${progress.failedCount} failed.`;
  }
}
