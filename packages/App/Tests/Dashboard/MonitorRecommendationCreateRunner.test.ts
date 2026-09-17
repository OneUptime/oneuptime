import { describe, expect, test } from "@jest/globals";
import MonitorRecommendationCreateRunner, {
  MonitorRecommendationCreateFunction,
  MonitorRecommendationCreateItemProgress,
  MonitorRecommendationCreateItemStatus,
  MonitorRecommendationCreateOutcome,
  MonitorRecommendationCreateProgress,
  MonitorRecommendationCreateProgressListener,
} from "../../FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCreateRunner";
import MonitorRecommendationCreateUtil, {
  MonitorRecommendationCreatePlanItem,
} from "../../FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCreateUtil";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";

/*
 * The batch-create loop behind the "Create" button on the recommendations
 * page. A user picks up to eighteen recommendations and each one is a separate
 * API round trip that runs label rules, owner rules and workspace
 * notifications server side — so the loop takes the better part of a minute
 * and the user sits and watches it.
 *
 * Three things about it are load bearing, and all three are invisible to a
 * type checker:
 *
 *   1. It is SEQUENTIAL. Firing eighteen creates at once floods notification
 *      rules and makes the progress bar meaningless — it would sit at 0% and
 *      then jump to 100%. `Promise.all` is the obvious refactor and it is
 *      wrong, so the sequencing test uses deferred promises: it asserts the
 *      second create has not started while the first is still in flight, which
 *      a parallel implementation cannot pass.
 *
 *   2. Every emission is a fresh object graph. The caller holds this in React
 *      state; `setState` bails out on an identical reference, so a loop that
 *      mutated one progress object in place would render a bar stuck at zero
 *      for the whole minute while the monitors were in fact being created.
 *
 *   3. A failure is a VALUE, not an exception. The loop this replaced aborted
 *      on the first rejection and threw away the fourteen monitors that would
 *      have succeeded. Every failure test below is really the same assertion:
 *      the run reached the end.
 */

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();
const DEFAULT_STATUS_ID: ObjectID = ObjectID.generate();
const INCIDENT_SEVERITY_ID: ObjectID = ObjectID.generate();
const ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();

const RESOURCE_IDENTIFIER: string = ObjectID.generate().toString();
const RESOURCE_DISPLAY_NAME: string = "Prod Cluster";

const GENERIC_ERROR_MESSAGE: string =
  "Something went wrong while creating this monitor.";

const KUBERNETES_RECOMMENDATIONS: Array<MonitorRecommendation> =
  MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.Kubernetes,
  );

type BuildArgsFunction = () => MonitorRecommendationArgs;

const buildArgs: BuildArgsFunction = (): MonitorRecommendationArgs => {
  return {
    resourceIdentifier: RESOURCE_IDENTIFIER,
    onlineMonitorStatusId: ONLINE_STATUS_ID,
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
    monitorName: RESOURCE_DISPLAY_NAME,
  };
};

type BuildPlanFunction = (
  itemCount: number,
) => Array<MonitorRecommendationCreatePlanItem>;

/*
 * Real plan items, built the same way the page builds them, so the names and
 * recommendation ids under test are the ones a user would actually see rather
 * than strings invented here.
 */
const buildPlan: BuildPlanFunction = (
  itemCount: number,
): Array<MonitorRecommendationCreatePlanItem> => {
  return MonitorRecommendationCreateUtil.buildCreatePlan({
    recommendations: KUBERNETES_RECOMMENDATIONS,
    selectedRecommendationIds: KUBERNETES_RECOMMENDATIONS.slice(
      0,
      itemCount,
    ).map((recommendation: MonitorRecommendation) => {
      return recommendation.recommendationId;
    }),
    args: buildArgs(),
    resourceDisplayName: RESOURCE_DISPLAY_NAME,
    defaultMonitorStatusId: DEFAULT_STATUS_ID,
    notificationSettings: {},
  });
};

type PlanIdsFunction = (
  plan: Array<MonitorRecommendationCreatePlanItem>,
) => Array<string>;

const planIds: PlanIdsFunction = (
  plan: Array<MonitorRecommendationCreatePlanItem>,
): Array<string> => {
  return plan.map((item: MonitorRecommendationCreatePlanItem) => {
    return item.recommendation.recommendationId;
  });
};

type ProgressIdsFunction = (
  progress: MonitorRecommendationCreateProgress,
) => Array<string>;

const progressIds: ProgressIdsFunction = (
  progress: MonitorRecommendationCreateProgress,
): Array<string> => {
  return progress.items.map((item: MonitorRecommendationCreateItemProgress) => {
    return item.recommendationId;
  });
};

type StatusesOfFunction = (
  progress: MonitorRecommendationCreateProgress,
) => Array<MonitorRecommendationCreateItemStatus>;

const statusesOf: StatusesOfFunction = (
  progress: MonitorRecommendationCreateProgress,
): Array<MonitorRecommendationCreateItemStatus> => {
  return progress.items.map((item: MonitorRecommendationCreateItemProgress) => {
    return item.status;
  });
};

type StatusSequenceOfFunction = (
  emissions: Array<MonitorRecommendationCreateProgress>,
) => Array<Array<MonitorRecommendationCreateItemStatus>>;

const statusSequenceOf: StatusSequenceOfFunction = (
  emissions: Array<MonitorRecommendationCreateProgress>,
): Array<Array<MonitorRecommendationCreateItemStatus>> => {
  return emissions.map((progress: MonitorRecommendationCreateProgress) => {
    return statusesOf(progress);
  });
};

type CloneProgressFunction = (
  progress: MonitorRecommendationCreateProgress,
) => MonitorRecommendationCreateProgress;

const cloneProgress: CloneProgressFunction = (
  progress: MonitorRecommendationCreateProgress,
): MonitorRecommendationCreateProgress => {
  return {
    ...progress,
    items: progress.items.map(
      (item: MonitorRecommendationCreateItemProgress) => {
        return { ...item };
      },
    ),
  };
};

type RecordEmissionsIntoFunction = (
  emissions: Array<MonitorRecommendationCreateProgress>,
) => MonitorRecommendationCreateProgressListener;

const recordEmissionsInto: RecordEmissionsIntoFunction = (
  emissions: Array<MonitorRecommendationCreateProgress>,
): MonitorRecommendationCreateProgressListener => {
  return (progress: MonitorRecommendationCreateProgress): void => {
    emissions.push(progress);
  };
};

type CreatedOutcomeFunction = () => Promise<MonitorRecommendationCreateOutcome>;

const created: CreatedOutcomeFunction =
  (): Promise<MonitorRecommendationCreateOutcome> => {
    return Promise.resolve({ isCreated: true });
  };

type FailedOutcomeFunction = (
  errorMessage: string,
) => Promise<MonitorRecommendationCreateOutcome>;

const failedWith: FailedOutcomeFunction = (
  errorMessage: string,
): Promise<MonitorRecommendationCreateOutcome> => {
  return Promise.resolve({ isCreated: false, errorMessage: errorMessage });
};

type CreateAttemptFunction = (
  index: number,
) => Promise<MonitorRecommendationCreateOutcome>;

interface CreateMonitorRecorder {
  createMonitor: MonitorRecommendationCreateFunction;
  calls: Array<MonitorRecommendationCreatePlanItem>;
}

type BuildRecordingCreateMonitorFunction = (
  attempt: CreateAttemptFunction,
) => CreateMonitorRecorder;

/*
 * An injected create that records what it was handed. `calls` is the only way
 * to prove the loop ran every item and ran them in plan order — the progress
 * alone cannot distinguish "attempted and failed" from "skipped".
 */
const buildRecordingCreateMonitor: BuildRecordingCreateMonitorFunction = (
  attempt: CreateAttemptFunction,
): CreateMonitorRecorder => {
  const calls: Array<MonitorRecommendationCreatePlanItem> = [];

  return {
    calls: calls,
    createMonitor: (
      item: MonitorRecommendationCreatePlanItem,
    ): Promise<MonitorRecommendationCreateOutcome> => {
      const index: number = calls.length;
      calls.push(item);
      return attempt(index);
    },
  };
};

interface DeferredOutcome {
  promise: Promise<MonitorRecommendationCreateOutcome>;
  resolve: (outcome: MonitorRecommendationCreateOutcome) => void;
}

type BuildDeferredOutcomeFunction = () => DeferredOutcome;

/*
 * A create that never settles until the test says so. This is what turns "is
 * it sequential?" into an assertion instead of a hope: with the first create
 * held open, a parallel implementation would already have called the second.
 */
const buildDeferredOutcome: BuildDeferredOutcomeFunction =
  (): DeferredOutcome => {
    let settle: (
      outcome: MonitorRecommendationCreateOutcome,
    ) => void = (): void => {};

    const promise: Promise<MonitorRecommendationCreateOutcome> =
      new Promise<MonitorRecommendationCreateOutcome>(
        (
          resolve: (outcome: MonitorRecommendationCreateOutcome) => void,
        ): void => {
          settle = resolve;
        },
      );

    return { promise: promise, resolve: settle };
  };

type FlushPendingWorkFunction = () => Promise<void>;

/*
 * A macrotask boundary. Every microtask a just-resolved create queued has run
 * by the time this resolves, so an assertion after it sees the loop as far
 * along as it can possibly be — rather than asserting after an arbitrary
 * number of promise ticks, which would pass or fail on implementation detail.
 */
const flushPendingWork: FlushPendingWorkFunction = (): Promise<void> => {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
};

type BuildProgressFunction = (data: {
  createdCount: number;
  failedCount: number;
  pendingCount: number;
}) => MonitorRecommendationCreateProgress;

/*
 * A progress shaped by hand for the summary-text matrix. `getSummaryText`
 * reads only the counts and `isComplete`, but the items are built to match
 * anyway so a fixture can never assert a sentence about a state the runner
 * could not produce.
 */
const buildProgress: BuildProgressFunction = (data: {
  createdCount: number;
  failedCount: number;
  pendingCount: number;
}): MonitorRecommendationCreateProgress => {
  const statuses: Array<MonitorRecommendationCreateItemStatus> = [
    ...new Array<MonitorRecommendationCreateItemStatus>(data.createdCount).fill(
      MonitorRecommendationCreateItemStatus.Created,
    ),
    ...new Array<MonitorRecommendationCreateItemStatus>(data.failedCount).fill(
      MonitorRecommendationCreateItemStatus.Failed,
    ),
    ...new Array<MonitorRecommendationCreateItemStatus>(data.pendingCount).fill(
      MonitorRecommendationCreateItemStatus.Pending,
    ),
  ];

  return {
    items: statuses.map(
      (status: MonitorRecommendationCreateItemStatus, index: number) => {
        return {
          recommendationId: `Kubernetes:fixture-${index}`,
          name: `Prod Cluster - Fixture ${index}`,
          status: status,
        };
      },
    ),
    totalCount: statuses.length,
    createdCount: data.createdCount,
    failedCount: data.failedCount,
    isComplete: data.pendingCount === 0,
  };
};

type BuildItemFunction = (
  recommendationId: string,
  status: MonitorRecommendationCreateItemStatus,
) => MonitorRecommendationCreateItemProgress;

const buildItem: BuildItemFunction = (
  recommendationId: string,
  status: MonitorRecommendationCreateItemStatus,
): MonitorRecommendationCreateItemProgress => {
  return {
    recommendationId: recommendationId,
    name: `Prod Cluster - ${recommendationId}`,
    status: status,
  };
};

type BuildProgressFromItemsFunction = (
  items: Array<MonitorRecommendationCreateItemProgress>,
) => MonitorRecommendationCreateProgress;

const buildProgressFromItems: BuildProgressFromItemsFunction = (
  items: Array<MonitorRecommendationCreateItemProgress>,
): MonitorRecommendationCreateProgress => {
  const countOf: (status: MonitorRecommendationCreateItemStatus) => number = (
    status: MonitorRecommendationCreateItemStatus,
  ): number => {
    return items.filter((item: MonitorRecommendationCreateItemProgress) => {
      return item.status === status;
    }).length;
  };

  const createdCount: number = countOf(
    MonitorRecommendationCreateItemStatus.Created,
  );
  const failedCount: number = countOf(
    MonitorRecommendationCreateItemStatus.Failed,
  );

  return {
    items: items,
    totalCount: items.length,
    createdCount: createdCount,
    failedCount: failedCount,
    isComplete: createdCount + failedCount === items.length,
  };
};

describe("MonitorRecommendationCreateRunner", () => {
  describe("fixtures", () => {
    /*
     * Every plan-shaped assertion below is written against a plan of a known
     * size. If the Kubernetes catalog ever shrank below that, those tests
     * would quietly assert against a shorter plan and still pass.
     */
    test("the catalog can supply a plan of the sizes these tests assume", () => {
      expect(KUBERNETES_RECOMMENDATIONS.length).toBeGreaterThanOrEqual(4);
      expect(buildPlan(3)).toHaveLength(3);
      expect(new Set(planIds(buildPlan(3))).size).toBe(3);
    });
  });

  describe("getInitialProgress", () => {
    test("returns one item per plan entry, in plan order", () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(3);

      const progress: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress(plan);

      expect(progress.items).toHaveLength(3);
      expect(progressIds(progress)).toEqual(planIds(plan));
    });

    /*
     * The whole reason this exists as a separate function: the panel renders
     * the full list of rows the moment Create is pressed. If items started
     * empty, rows would pop into existence one at a time over a minute.
     */
    test("starts every item Pending", () => {
      const progress: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress(buildPlan(3));

      expect(statusesOf(progress)).toEqual([
        MonitorRecommendationCreateItemStatus.Pending,
        MonitorRecommendationCreateItemStatus.Pending,
        MonitorRecommendationCreateItemStatus.Pending,
      ]);
    });

    test("counts start at zero and totalCount is the plan length", () => {
      const progress: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress(buildPlan(3));

      expect(progress.totalCount).toBe(3);
      expect(progress.createdCount).toBe(0);
      expect(progress.failedCount).toBe(0);
    });

    test("is not complete for a non-empty plan", () => {
      expect(
        MonitorRecommendationCreateRunner.getInitialProgress(buildPlan(1))
          .isComplete,
      ).toBe(false);
      expect(
        MonitorRecommendationCreateRunner.getInitialProgress(buildPlan(3))
          .isComplete,
      ).toBe(false);
    });

    /*
     * An empty plan is complete before it starts. A caller that gated its
     * "Close" button on isComplete would otherwise leave the panel wedged
     * open after a submit where everything was already covered.
     */
    test("is complete for an empty plan", () => {
      const progress: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress([]);

      expect(progress.items).toEqual([]);
      expect(progress.totalCount).toBe(0);
      expect(progress.createdCount).toBe(0);
      expect(progress.failedCount).toBe(0);
      expect(progress.isComplete).toBe(true);
    });

    /*
     * The row has to read as the monitor the user is about to get — "Prod
     * Cluster - Node Not Ready" — not the bare template name, because a user
     * monitoring several clusters cannot tell the batches apart otherwise.
     */
    test("names each item after the monitor that will be created", () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(2);

      const progress: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress(plan);

      expect(progress.items[0]!.name).toBe(plan[0]!.monitor.name);
      expect(progress.items[0]!.name).toBe(
        `${RESOURCE_DISPLAY_NAME} - ${plan[0]!.recommendation.name}`,
      );
      expect(progress.items[1]!.name).toBe(plan[1]!.monitor.name);
    });

    /*
     * A monitor with no name would render a blank row. Falling back to the
     * recommendation name keeps the row identifiable rather than showing the
     * user an empty line they cannot match to anything they selected.
     */
    test("falls back to the recommendation name when the monitor has none", () => {
      const recommendation: MonitorRecommendation =
        KUBERNETES_RECOMMENDATIONS[0]!;

      const progress: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress([
          {
            recommendation: recommendation,
            monitor: new Monitor(),
            miscDataProps: {},
          },
        ]);

      expect(progress.items[0]!.name).toBe(recommendation.name);
    });

    test("falls back when the monitor name is an empty string", () => {
      const recommendation: MonitorRecommendation =
        KUBERNETES_RECOMMENDATIONS[1]!;

      const monitor: Monitor = new Monitor();
      monitor.name = "";

      const progress: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress([
          {
            recommendation: recommendation,
            monitor: monitor,
            miscDataProps: {},
          },
        ]);

      expect(progress.items[0]!.name).toBe(recommendation.name);
    });

    /*
     * A pending row must not render an error. If errorMessage were seeded
     * with anything, every row would show a failure before a single request
     * had been sent.
     */
    test("leaves errorMessage unset on every item", () => {
      const progress: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress(buildPlan(3));

      for (const item of progress.items) {
        expect(item.errorMessage).toBeUndefined();
      }
    });

    /*
     * Two calls must not hand back the same objects, or a component that
     * seeds state from one call and re-seeds from another would find its
     * "before" snapshot mutated underneath it.
     */
    test("returns a fresh object graph on every call", () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(2);

      const first: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress(plan);
      const second: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress(plan);

      expect(first).not.toBe(second);
      expect(first.items).not.toBe(second.items);
      expect(first.items[0]).not.toBe(second.items[0]);
      expect(first).toEqual(second);
    });

    test("mutating a returned progress does not affect the next call", () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(2);

      const first: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress(plan);

      first.items[0]!.status = MonitorRecommendationCreateItemStatus.Failed;
      first.items[0]!.name = "vandalised";
      first.createdCount = 99;

      const second: MonitorRecommendationCreateProgress =
        MonitorRecommendationCreateRunner.getInitialProgress(plan);

      expect(second.items[0]!.status).toBe(
        MonitorRecommendationCreateItemStatus.Pending,
      );
      expect(second.items[0]!.name).toBe(plan[0]!.monitor.name);
      expect(second.createdCount).toBe(0);
    });

    test("does not mutate the plan it was given", () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(2);
      const namesBefore: Array<string | undefined> = plan.map(
        (item: MonitorRecommendationCreatePlanItem) => {
          return item.monitor.name;
        },
      );

      MonitorRecommendationCreateRunner.getInitialProgress(plan);

      expect(plan).toHaveLength(2);
      expect(
        plan.map((item: MonitorRecommendationCreatePlanItem) => {
          return item.monitor.name;
        }),
      ).toEqual(namesBefore);
    });
  });

  describe("run - sequencing", () => {
    test("calls createMonitor exactly once per plan item, in plan order", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(3);
      const recorder: CreateMonitorRecorder =
        buildRecordingCreateMonitor(created);

      await MonitorRecommendationCreateRunner.run({
        plan: plan,
        createMonitor: recorder.createMonitor,
      });

      expect(recorder.calls).toHaveLength(3);
      expect(planIds(recorder.calls)).toEqual(planIds(plan));
    });

    test("hands the plan item straight through, untouched", () => {
      /*
       * The item carries the monitor AND the miscDataProps that owners ride
       * in. A loop that rebuilt or copied it would silently drop the owners,
       * and the monitor would still be created — so nothing would error.
       */
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(2);
      const recorder: CreateMonitorRecorder =
        buildRecordingCreateMonitor(created);

      return MonitorRecommendationCreateRunner.run({
        plan: plan,
        createMonitor: recorder.createMonitor,
      }).then((): void => {
        expect(recorder.calls[0]).toBe(plan[0]);
        expect(recorder.calls[1]).toBe(plan[1]);
      });
    });

    /*
     * The assertion this whole file exists to make impossible to break by
     * accident. With the first create held open, a `Promise.all` or a
     * `forEach(async ...)` would already have called the second one.
     *
     * Sequential is deliberate: monitor creation runs label rules, owner
     * rules and workspace notifications per monitor, and eighteen of those at
     * once is a burst the server has to serialize anyway — and a parallel
     * batch would leave the progress bar at 0% until it jumped to 100%.
     */
    test("does not start the second create until the first has resolved", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(2);

      const first: DeferredOutcome = buildDeferredOutcome();
      const second: DeferredOutcome = buildDeferredOutcome();
      const deferred: Array<DeferredOutcome> = [first, second];

      const recorder: CreateMonitorRecorder = buildRecordingCreateMonitor(
        (index: number): Promise<MonitorRecommendationCreateOutcome> => {
          return deferred[index]!.promise;
        },
      );

      const runPromise: Promise<MonitorRecommendationCreateProgress> =
        MonitorRecommendationCreateRunner.run({
          plan: plan,
          createMonitor: recorder.createMonitor,
        });

      await flushPendingWork();

      expect(recorder.calls).toHaveLength(1);

      first.resolve({ isCreated: true });
      await flushPendingWork();

      expect(recorder.calls).toHaveLength(2);

      second.resolve({ isCreated: true });

      expect((await runPromise).createdCount).toBe(2);
    });

    test("advances one item at a time across a three item plan", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(3);

      const deferred: Array<DeferredOutcome> = [
        buildDeferredOutcome(),
        buildDeferredOutcome(),
        buildDeferredOutcome(),
      ];

      const recorder: CreateMonitorRecorder = buildRecordingCreateMonitor(
        (index: number): Promise<MonitorRecommendationCreateOutcome> => {
          return deferred[index]!.promise;
        },
      );

      const runPromise: Promise<MonitorRecommendationCreateProgress> =
        MonitorRecommendationCreateRunner.run({
          plan: plan,
          createMonitor: recorder.createMonitor,
        });

      await flushPendingWork();
      expect(recorder.calls).toHaveLength(1);

      deferred[0]!.resolve({ isCreated: true });
      await flushPendingWork();
      expect(recorder.calls).toHaveLength(2);

      /*
       * A failure must not let the next create start early either — the
       * ordering guarantee has to hold on the error path as well.
       */
      deferred[1]!.resolve({
        isCreated: false,
        errorMessage: "Monitor limit reached on this plan.",
      });
      await flushPendingWork();
      expect(recorder.calls).toHaveLength(3);

      deferred[2]!.resolve({ isCreated: true });

      const progress: MonitorRecommendationCreateProgress = await runPromise;

      expect(planIds(recorder.calls)).toEqual(planIds(plan));
      expect(progress.createdCount).toBe(2);
      expect(progress.failedCount).toBe(1);
    });

    /*
     * The run must not resolve while a create is still in flight. A caller
     * that re-enabled Close on resolution would otherwise let the user close
     * the panel mid-batch and lose the result of the last monitor.
     */
    test("does not resolve while a create is still in flight", async () => {
      const deferred: DeferredOutcome = buildDeferredOutcome();

      let isSettled: boolean = false;

      const runPromise: Promise<MonitorRecommendationCreateProgress> =
        MonitorRecommendationCreateRunner.run({
          plan: buildPlan(1),
          createMonitor: (): Promise<MonitorRecommendationCreateOutcome> => {
            return deferred.promise;
          },
        }).then(
          (
            progress: MonitorRecommendationCreateProgress,
          ): MonitorRecommendationCreateProgress => {
            isSettled = true;
            return progress;
          },
        );

      await flushPendingWork();
      expect(isSettled).toBe(false);

      deferred.resolve({ isCreated: true });

      expect((await runPromise).isComplete).toBe(true);
      expect(isSettled).toBe(true);
    });
  });

  describe("run - progress emission", () => {
    /*
     * The exact sequence a caller observes. The old page showed nothing at
     * all until the first monitor had landed, which for a plan of eighteen is
     * several seconds of a dialog that looks frozen — so the first emission
     * carrying an all-Pending list is as important as the rest.
     */
    test("emits the exact status sequence for a two item plan", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(2),
        createMonitor: created,
        onProgress: recordEmissionsInto(emissions),
      });

      expect(statusSequenceOf(emissions)).toEqual([
        [
          MonitorRecommendationCreateItemStatus.Pending,
          MonitorRecommendationCreateItemStatus.Pending,
        ],
        [
          MonitorRecommendationCreateItemStatus.Creating,
          MonitorRecommendationCreateItemStatus.Pending,
        ],
        [
          MonitorRecommendationCreateItemStatus.Created,
          MonitorRecommendationCreateItemStatus.Pending,
        ],
        [
          MonitorRecommendationCreateItemStatus.Created,
          MonitorRecommendationCreateItemStatus.Creating,
        ],
        [
          MonitorRecommendationCreateItemStatus.Created,
          MonitorRecommendationCreateItemStatus.Created,
        ],
      ]);
    });

    test("emits before anything starts, with everything Pending", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];
      const deferred: DeferredOutcome = buildDeferredOutcome();

      const recorder: CreateMonitorRecorder = buildRecordingCreateMonitor(
        (): Promise<MonitorRecommendationCreateOutcome> => {
          return deferred.promise;
        },
      );

      const runPromise: Promise<MonitorRecommendationCreateProgress> =
        MonitorRecommendationCreateRunner.run({
          plan: buildPlan(2),
          createMonitor: recorder.createMonitor,
          onProgress: recordEmissionsInto(emissions),
        });

      /*
       * The first emission has to be observable while the first request is
       * still open — that is the whole point of emitting it before the loop.
       */
      expect(emissions[0]).toBeDefined();
      expect(statusesOf(emissions[0]!)).toEqual([
        MonitorRecommendationCreateItemStatus.Pending,
        MonitorRecommendationCreateItemStatus.Pending,
      ]);
      expect(emissions[0]!.totalCount).toBe(2);
      expect(emissions[0]!.createdCount).toBe(0);
      expect(emissions[0]!.isComplete).toBe(false);

      deferred.resolve({ isCreated: true });
      await runPromise;
    });

    test("emits 2N + 1 times for an N item plan", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(3),
        createMonitor: created,
        onProgress: recordEmissionsInto(emissions),
      });

      expect(emissions).toHaveLength(7);
    });

    test("counts climb by one as each item settles", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(3),
        createMonitor: (
          item: MonitorRecommendationCreatePlanItem,
        ): Promise<MonitorRecommendationCreateOutcome> => {
          return item.recommendation.recommendationId ===
            KUBERNETES_RECOMMENDATIONS[1]!.recommendationId
            ? failedWith("Nope.")
            : created();
        },
        onProgress: recordEmissionsInto(emissions),
      });

      expect(
        emissions.map((progress: MonitorRecommendationCreateProgress) => {
          return [progress.createdCount, progress.failedCount];
        }),
      ).toEqual([
        [0, 0],
        [0, 0],
        [1, 0],
        [1, 0],
        [1, 1],
        [1, 1],
        [2, 1],
      ]);
    });

    /*
     * isComplete is what a panel gates its Close button on. If it were true
     * on an intermediate emission the user could close the dialog while
     * monitors were still being created.
     */
    test("reports isComplete only on the final emission", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(3),
        createMonitor: created,
        onProgress: recordEmissionsInto(emissions),
      });

      expect(
        emissions.map((progress: MonitorRecommendationCreateProgress) => {
          return progress.isComplete;
        }),
      ).toEqual([false, false, false, false, false, false, true]);
    });

    test("every emission carries the full item list and the plan order", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(3);
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: plan,
        createMonitor: created,
        onProgress: recordEmissionsInto(emissions),
      });

      for (const progress of emissions) {
        expect(progress.items).toHaveLength(3);
        expect(progress.totalCount).toBe(3);
        expect(progressIds(progress)).toEqual(planIds(plan));
      }
    });

    /*
     * A failure has to show up on the row the moment it happens. Holding it
     * back until the end would leave the user staring at a "Creating" row for
     * the rest of the batch on a monitor that already failed.
     */
    test("emits a failure as it happens, not at the end", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(2),
        createMonitor: buildRecordingCreateMonitor(
          (index: number): Promise<MonitorRecommendationCreateOutcome> => {
            return index === 0 ? failedWith("Rate limited.") : created();
          },
        ).createMonitor,
        onProgress: recordEmissionsInto(emissions),
      });

      expect(statusesOf(emissions[2]!)).toEqual([
        MonitorRecommendationCreateItemStatus.Failed,
        MonitorRecommendationCreateItemStatus.Pending,
      ]);
      expect(emissions[2]!.items[0]!.errorMessage).toBe("Rate limited.");
      expect(emissions[2]!.failedCount).toBe(1);
      expect(emissions[2]!.isComplete).toBe(false);
    });

    test("emits exactly once for an empty plan", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: [],
        createMonitor: created,
        onProgress: recordEmissionsInto(emissions),
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0]!.items).toEqual([]);
      expect(emissions[0]!.isComplete).toBe(true);
    });
  });

  describe("run - emission identity", () => {
    /*
     * These four assertions are one bug: a runner that emitted the same
     * mutated object every time. React's setState bails out on an identical
     * reference, so the panel would render the initial all-Pending list and
     * then never update again — a progress bar frozen at zero for a minute
     * while the monitors really were being created.
     */
    test("no two emissions share a progress object", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(3),
        createMonitor: created,
        onProgress: recordEmissionsInto(emissions),
      });

      expect(new Set(emissions).size).toBe(emissions.length);
    });

    test("no two emissions share an items array", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(3),
        createMonitor: created,
        onProgress: recordEmissionsInto(emissions),
      });

      expect(
        new Set(
          emissions.map((progress: MonitorRecommendationCreateProgress) => {
            return progress.items;
          }),
        ).size,
      ).toBe(emissions.length);
    });

    test("consecutive emissions never share an item object", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(3),
        createMonitor: created,
        onProgress: recordEmissionsInto(emissions),
      });

      for (let index: number = 1; index < emissions.length; index++) {
        const previous: MonitorRecommendationCreateProgress =
          emissions[index - 1]!;
        const current: MonitorRecommendationCreateProgress = emissions[index]!;

        for (
          let itemIndex: number = 0;
          itemIndex < current.items.length;
          itemIndex++
        ) {
          expect(current.items[itemIndex]).not.toBe(previous.items[itemIndex]);
        }
      }
    });

    test("every item object across the whole run is distinct", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(3),
        createMonitor: created,
        onProgress: recordEmissionsInto(emissions),
      });

      const everyItem: Array<MonitorRecommendationCreateItemProgress> =
        emissions.flatMap((progress: MonitorRecommendationCreateProgress) => {
          return progress.items;
        });

      expect(new Set(everyItem).size).toBe(everyItem.length);
    });

    /*
     * A caller that sorts or filters the list it was handed — or a React dev
     * tool that freezes it — must not be able to corrupt the run in flight.
     */
    test("mutating a received emission does not corrupt later emissions", async () => {
      const snapshots: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(2),
        createMonitor: created,
        onProgress: (progress: MonitorRecommendationCreateProgress): void => {
          snapshots.push(cloneProgress(progress));

          progress.items[0]!.status =
            MonitorRecommendationCreateItemStatus.Failed;
          progress.items[0]!.errorMessage = "vandalised";
          progress.items[0]!.name = "vandalised";
          progress.items.length = 1;
          progress.createdCount = 99;
          progress.failedCount = 99;
          progress.totalCount = 99;
          progress.isComplete = true;
        },
      });

      expect(statusSequenceOf(snapshots)).toEqual([
        [
          MonitorRecommendationCreateItemStatus.Pending,
          MonitorRecommendationCreateItemStatus.Pending,
        ],
        [
          MonitorRecommendationCreateItemStatus.Creating,
          MonitorRecommendationCreateItemStatus.Pending,
        ],
        [
          MonitorRecommendationCreateItemStatus.Created,
          MonitorRecommendationCreateItemStatus.Pending,
        ],
        [
          MonitorRecommendationCreateItemStatus.Created,
          MonitorRecommendationCreateItemStatus.Creating,
        ],
        [
          MonitorRecommendationCreateItemStatus.Created,
          MonitorRecommendationCreateItemStatus.Created,
        ],
      ]);

      expect(snapshots[4]!.createdCount).toBe(2);
      expect(snapshots[4]!.totalCount).toBe(2);
      expect(snapshots[4]!.items[0]!.errorMessage).toBeUndefined();
    });

    test("mutating a received emission does not corrupt the returned progress", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(2);

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: plan,
          createMonitor: created,
          onProgress: (emitted: MonitorRecommendationCreateProgress): void => {
            emitted.items[0]!.status =
              MonitorRecommendationCreateItemStatus.Failed;
            emitted.items[0]!.errorMessage = "vandalised";
            emitted.items.length = 0;
            emitted.createdCount = 99;
          },
        });

      expect(statusesOf(progress)).toEqual([
        MonitorRecommendationCreateItemStatus.Created,
        MonitorRecommendationCreateItemStatus.Created,
      ]);
      expect(progress.items).toHaveLength(2);
      expect(progress.items[0]!.errorMessage).toBeUndefined();
      expect(progress.createdCount).toBe(2);
      expect(progressIds(progress)).toEqual(planIds(plan));
    });

    /*
     * The returned value is what the caller writes to state one last time. It
     * has to say the same thing as the final emission, and still be a
     * different object so that last setState is not a no-op.
     */
    test("the returned progress equals the final emission by value but not by reference", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(3),
          createMonitor: created,
          onProgress: recordEmissionsInto(emissions),
        });

      const finalEmission: MonitorRecommendationCreateProgress =
        emissions[emissions.length - 1]!;

      expect(progress).toEqual(finalEmission);
      expect(progress).not.toBe(finalEmission);
      expect(progress.items).not.toBe(finalEmission.items);
      expect(progress.items[0]).not.toBe(finalEmission.items[0]);
    });
  });

  describe("run - failures", () => {
    /*
     * The behaviour change this module exists for. The loop it replaced
     * aborted at the first rejection, so one bad recommendation in a batch of
     * eighteen threw away the seventeen that would have succeeded — and the
     * user had no way to tell which ones those were.
     */
    test("attempts every item even when one fails in the middle", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(3);

      const recorder: CreateMonitorRecorder = buildRecordingCreateMonitor(
        (index: number): Promise<MonitorRecommendationCreateOutcome> => {
          return index === 1
            ? failedWith("Monitor limit reached on this plan.")
            : created();
        },
      );

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: plan,
          createMonitor: recorder.createMonitor,
        });

      expect(recorder.calls).toHaveLength(3);
      expect(planIds(recorder.calls)).toEqual(planIds(plan));
      expect(statusesOf(progress)).toEqual([
        MonitorRecommendationCreateItemStatus.Created,
        MonitorRecommendationCreateItemStatus.Failed,
        MonitorRecommendationCreateItemStatus.Created,
      ]);
      expect(progress.createdCount).toBe(2);
      expect(progress.failedCount).toBe(1);
      expect(progress.totalCount).toBe(3);
      expect(progress.isComplete).toBe(true);
    });

    /*
     * The message is the only thing that tells the user WHY one row is red,
     * and it must land on that row only — an error smeared across the batch
     * would say three monitors failed when one did.
     */
    test("records the error message on the failed item only", async () => {
      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(3),
          createMonitor: buildRecordingCreateMonitor(
            (index: number): Promise<MonitorRecommendationCreateOutcome> => {
              return index === 1
                ? failedWith("Monitor limit reached on this plan.")
                : created();
            },
          ).createMonitor,
        });

      expect(progress.items[0]!.errorMessage).toBeUndefined();
      expect(progress.items[1]!.errorMessage).toBe(
        "Monitor limit reached on this plan.",
      );
      expect(progress.items[2]!.errorMessage).toBeUndefined();
    });

    test("keeps the plan order in the result when something fails", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(3);

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: plan,
          createMonitor: buildRecordingCreateMonitor(
            (index: number): Promise<MonitorRecommendationCreateOutcome> => {
              return index === 1 ? failedWith("Nope.") : created();
            },
          ).createMonitor,
        });

      expect(progressIds(progress)).toEqual(planIds(plan));
    });

    test("a failure on the very first item does not stop the rest", async () => {
      const recorder: CreateMonitorRecorder = buildRecordingCreateMonitor(
        (index: number): Promise<MonitorRecommendationCreateOutcome> => {
          return index === 0 ? failedWith("Bad request.") : created();
        },
      );

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(3),
          createMonitor: recorder.createMonitor,
        });

      expect(recorder.calls).toHaveLength(3);
      expect(progress.createdCount).toBe(2);
      expect(progress.failedCount).toBe(1);
    });

    test("a failure on the last item still reports the successes", async () => {
      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(3),
          createMonitor: buildRecordingCreateMonitor(
            (index: number): Promise<MonitorRecommendationCreateOutcome> => {
              return index === 2 ? failedWith("Bad request.") : created();
            },
          ).createMonitor,
        });

      expect(statusesOf(progress)).toEqual([
        MonitorRecommendationCreateItemStatus.Created,
        MonitorRecommendationCreateItemStatus.Created,
        MonitorRecommendationCreateItemStatus.Failed,
      ]);
      expect(progress.createdCount).toBe(2);
      expect(progress.isComplete).toBe(true);
    });

    test("every item failing gives createdCount 0 and a complete run", async () => {
      const recorder: CreateMonitorRecorder = buildRecordingCreateMonitor(
        (index: number): Promise<MonitorRecommendationCreateOutcome> => {
          return failedWith(`Failure ${index}.`);
        },
      );

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(3),
          createMonitor: recorder.createMonitor,
        });

      expect(recorder.calls).toHaveLength(3);
      expect(progress.createdCount).toBe(0);
      expect(progress.failedCount).toBe(3);
      expect(progress.isComplete).toBe(true);
      expect(
        progress.items.map((item: MonitorRecommendationCreateItemProgress) => {
          return item.errorMessage;
        }),
      ).toEqual(["Failure 0.", "Failure 1.", "Failure 2."]);
    });

    /*
     * The injected create is expected to return a result, but it is injected:
     * an API client that throws on a 500, or a null dereference in the
     * caller's own mapping code, must not take the rest of the batch down.
     */
    test("a rejected create promise becomes a Failed item and the batch continues", async () => {
      const recorder: CreateMonitorRecorder = buildRecordingCreateMonitor(
        (index: number): Promise<MonitorRecommendationCreateOutcome> => {
          return index === 1
            ? Promise.reject(new Error("Request failed with status code 500."))
            : created();
        },
      );

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(3),
          createMonitor: recorder.createMonitor,
        });

      expect(recorder.calls).toHaveLength(3);
      expect(progress.items[1]!.status).toBe(
        MonitorRecommendationCreateItemStatus.Failed,
      );
      expect(progress.items[1]!.errorMessage).toBe(
        "Request failed with status code 500.",
      );
      expect(progress.createdCount).toBe(2);
      expect(progress.failedCount).toBe(1);
      expect(progress.isComplete).toBe(true);
    });

    test("a synchronously thrown Error becomes a Failed item with its message", async () => {
      const calls: Array<MonitorRecommendationCreatePlanItem> = [];

      const createMonitor: MonitorRecommendationCreateFunction = (
        item: MonitorRecommendationCreatePlanItem,
      ): Promise<MonitorRecommendationCreateOutcome> => {
        calls.push(item);

        if (calls.length === 2) {
          throw new Error("Websocket closed before the create was sent.");
        }

        return created();
      };

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(3),
          createMonitor: createMonitor,
        });

      expect(calls).toHaveLength(3);
      expect(progress.items[1]!.errorMessage).toBe(
        "Websocket closed before the create was sent.",
      );
      expect(progress.createdCount).toBe(2);
      expect(progress.failedCount).toBe(1);
    });

    /*
     * A thrown string reaches the row as SOMETHING a human can read. Without
     * the fallback the row would show "undefined" next to a red icon, which
     * tells the user nothing at all.
     */
    test("a non-Error throw falls back to the generic message", async () => {
      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(2),
          createMonitor: buildRecordingCreateMonitor(
            (index: number): Promise<MonitorRecommendationCreateOutcome> => {
              return index === 0
                ? Promise.reject("something-that-is-not-an-error")
                : created();
            },
          ).createMonitor,
        });

      expect(progress.items[0]!.status).toBe(
        MonitorRecommendationCreateItemStatus.Failed,
      );
      expect(progress.items[0]!.errorMessage).toBe(GENERIC_ERROR_MESSAGE);
      expect(progress.createdCount).toBe(1);
    });

    test("a thrown object that merely looks like an Error falls back too", async () => {
      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(1),
          createMonitor: (): Promise<MonitorRecommendationCreateOutcome> => {
            return Promise.reject({ message: "Not a real Error instance." });
          },
        });

      expect(progress.items[0]!.errorMessage).toBe(GENERIC_ERROR_MESSAGE);
      expect(progress.failedCount).toBe(1);
    });

    /*
     * `new Error("")` is what an API client produces from a 500 with an empty
     * body. Copying its blank message onto the row would render a red row
     * with no explanation.
     */
    test("an Error with an empty message falls back to the generic message", async () => {
      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(1),
          createMonitor: (): Promise<MonitorRecommendationCreateOutcome> => {
            return Promise.reject(new Error(""));
          },
        });

      expect(progress.items[0]!.errorMessage).toBe(GENERIC_ERROR_MESSAGE);
    });

    test("a null throw falls back to the generic message", async () => {
      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(1),
          createMonitor: (): Promise<MonitorRecommendationCreateOutcome> => {
            return Promise.reject(null);
          },
        });

      expect(progress.items[0]!.errorMessage).toBe(GENERIC_ERROR_MESSAGE);
      expect(progress.items[0]!.status).toBe(
        MonitorRecommendationCreateItemStatus.Failed,
      );
    });

    test("run never rejects, whatever the injected create does", async () => {
      await expect(
        MonitorRecommendationCreateRunner.run({
          plan: buildPlan(3),
          createMonitor: (): Promise<MonitorRecommendationCreateOutcome> => {
            throw new Error("Everything is on fire.");
          },
        }),
      ).resolves.toMatchObject({
        createdCount: 0,
        failedCount: 3,
        isComplete: true,
      });
    });

    /*
     * A failure result carrying an empty message is not a thrown error, so it
     * is stored verbatim. Pinned so a future "tidy up" that starts
     * substituting the generic text here is a visible decision rather than an
     * accident.
     */
    test("an empty errorMessage on a failure result is stored as given", async () => {
      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(1),
          createMonitor: (): Promise<MonitorRecommendationCreateOutcome> => {
            return failedWith("");
          },
        });

      expect(progress.items[0]!.status).toBe(
        MonitorRecommendationCreateItemStatus.Failed,
      );
      expect(progress.items[0]!.errorMessage).toBe("");
    });
  });

  describe("run - edge cases", () => {
    test("an empty plan never calls createMonitor and returns zero counts", async () => {
      const recorder: CreateMonitorRecorder =
        buildRecordingCreateMonitor(created);

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: [],
          createMonitor: recorder.createMonitor,
        });

      expect(recorder.calls).toEqual([]);
      expect(progress.items).toEqual([]);
      expect(progress.totalCount).toBe(0);
      expect(progress.createdCount).toBe(0);
      expect(progress.failedCount).toBe(0);
      expect(progress.isComplete).toBe(true);
    });

    /*
     * onProgress is optional, and a caller that does not pass it (a retry
     * kicked off from somewhere with no panel open) must not hit a "not a
     * function" on the very first line of the loop.
     */
    test("runs to completion with no onProgress listener at all", async () => {
      const recorder: CreateMonitorRecorder = buildRecordingCreateMonitor(
        (index: number): Promise<MonitorRecommendationCreateOutcome> => {
          return index === 1 ? failedWith("Nope.") : created();
        },
      );

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(3),
          createMonitor: recorder.createMonitor,
        });

      expect(recorder.calls).toHaveLength(3);
      expect(progress.createdCount).toBe(2);
      expect(progress.failedCount).toBe(1);
      expect(progress.isComplete).toBe(true);
    });

    test("an empty plan with no listener still completes", async () => {
      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: [],
          createMonitor: created,
        });

      expect(progress.isComplete).toBe(true);
      expect(progress.totalCount).toBe(0);
    });

    test("a one item plan emits three times and reports one creation", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: buildPlan(1),
          createMonitor: created,
          onProgress: recordEmissionsInto(emissions),
        });

      expect(statusSequenceOf(emissions)).toEqual([
        [MonitorRecommendationCreateItemStatus.Pending],
        [MonitorRecommendationCreateItemStatus.Creating],
        [MonitorRecommendationCreateItemStatus.Created],
      ]);
      expect(progress.createdCount).toBe(1);
      expect(progress.isComplete).toBe(true);
    });

    /*
     * The plan carries its own names, so the runner must not go back to the
     * plan for anything after it has started. A monitor renamed in place mid
     * run would otherwise change the row the user is watching.
     */
    test("the returned items keep the names captured from the plan", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(2);
      const expectedNames: Array<string | undefined> = plan.map(
        (item: MonitorRecommendationCreatePlanItem) => {
          return item.monitor.name;
        },
      );

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: plan,
          createMonitor: created,
        });

      expect(
        progress.items.map((item: MonitorRecommendationCreateItemProgress) => {
          return item.name;
        }),
      ).toEqual(expectedNames);
    });
  });

  describe("getSummaryText", () => {
    /*
     * While the batch runs, the bar next to this line already shows "N of M"
     * and a percentage. The sentence's job is the one thing the bar cannot
     * say: why a batch of eighteen takes the better part of a minute.
     * Repeating the count here is what it used to do, and it made the line
     * noise.
     */
    test("the in-progress sentence explains the wait", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 3, failedCount: 0, pendingCount: 4 }),
        ),
      ).toBe(
        "Creating one monitor at a time so your notification rules are not flooded.",
      );
    });

    test("the in-progress sentence never repeats the N of M count", () => {
      const text: string = MonitorRecommendationCreateRunner.getSummaryText(
        buildProgress({ createdCount: 3, failedCount: 0, pendingCount: 4 }),
      );

      expect(text).not.toMatch(/\d/);
      expect(text).not.toContain("3 of 7");
      expect(text).not.toContain("Created 3");
    });

    test("the in-progress sentence is the same before anything has been created", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 0, failedCount: 0, pendingCount: 5 }),
        ),
      ).toBe(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 4, failedCount: 1, pendingCount: 1 }),
        ),
      );
    });

    /*
     * A run that is still going must never read as finished, even once every
     * request bar one has come back — that is the moment a user is most
     * likely to close the panel early.
     */
    test("one item still pending keeps the in-progress sentence", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 17, failedCount: 0, pendingCount: 1 }),
        ),
      ).not.toContain("Created 17");
    });

    test("a completed run with one creation uses the singular", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 1, failedCount: 0, pendingCount: 0 }),
        ),
      ).toBe("Created 1 monitor.");
    });

    test("a completed run with several creations uses the plural", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 5, failedCount: 0, pendingCount: 0 }),
        ),
      ).toBe("Created 5 monitors.");
    });

    test("a completed run that created nothing and failed nothing reads as zero", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 0, failedCount: 0, pendingCount: 0 }),
        ),
      ).toBe("Created 0 monitors.");
    });

    /*
     * Everything failing is its own sentence rather than "Created 0 of 3
     * monitors. 3 failed." — a user whose whole batch was rejected (an
     * expired session, a plan limit) needs one unambiguous line, not
     * arithmetic.
     */
    test("a completed run where everything failed says so plainly", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 0, failedCount: 3, pendingCount: 0 }),
        ),
      ).toBe("None of the 3 monitors could be created.");
    });

    test("a single total in the all-failed sentence uses the singular", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 0, failedCount: 1, pendingCount: 0 }),
        ),
      ).toBe("None of the 1 monitor could be created.");
    });

    /*
     * The partial sentence is the one the new loop made possible: it can only
     * be written because the run no longer stops at the first failure.
     */
    test("a partly failed run reports both halves", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 2, failedCount: 1, pendingCount: 0 }),
        ),
      ).toBe("Created 2 of 3 monitors. 1 failed.");
    });

    test("a partly failed run of two reports both halves", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 1, failedCount: 1, pendingCount: 0 }),
        ),
      ).toBe("Created 1 of 2 monitors. 1 failed.");
    });

    test("a full eighteen item batch with three failures reads correctly", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          buildProgress({ createdCount: 15, failedCount: 3, pendingCount: 0 }),
        ),
      ).toBe("Created 15 of 18 monitors. 3 failed.");
    });

    test("the summary of an initial progress is the in-progress sentence", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          MonitorRecommendationCreateRunner.getInitialProgress(buildPlan(3)),
        ),
      ).toContain("Creating one monitor at a time");
    });

    test("the summary of an empty plan's initial progress is already final", () => {
      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          MonitorRecommendationCreateRunner.getInitialProgress([]),
        ),
      ).toBe("Created 0 monitors.");
    });
  });

  describe("getUnsuccessfulRecommendationIds", () => {
    /*
     * The regression this guards is a duplicate monitor. `createOrUpdate` with
     * FormType.Create does not de-duplicate, so leaving a created
     * recommendation in the selection and letting the user press Retry
     * silently creates the same monitor twice.
     */
    test("drops the recommendations that were created", () => {
      const remaining: Set<string> =
        MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
          progress: buildProgressFromItems([
            buildItem("a", MonitorRecommendationCreateItemStatus.Created),
            buildItem("b", MonitorRecommendationCreateItemStatus.Created),
          ]),
          selectedRecommendationIds: new Set<string>(["a", "b"]),
        });

      expect(Array.from(remaining)).toEqual([]);
    });

    test("keeps the recommendations that failed", () => {
      const remaining: Set<string> =
        MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
          progress: buildProgressFromItems([
            buildItem("a", MonitorRecommendationCreateItemStatus.Created),
            buildItem("b", MonitorRecommendationCreateItemStatus.Failed),
            buildItem("c", MonitorRecommendationCreateItemStatus.Created),
          ]),
          selectedRecommendationIds: new Set<string>(["a", "b", "c"]),
        });

      expect(Array.from(remaining).sort()).toEqual(["b"]);
    });

    /*
     * Pending and Creating mean the run was abandoned partway — a closed tab,
     * a navigation. Those monitors were never created, so they must survive
     * into the retry selection.
     */
    test("keeps the recommendations that never got their turn", () => {
      const remaining: Set<string> =
        MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
          progress: buildProgressFromItems([
            buildItem("a", MonitorRecommendationCreateItemStatus.Created),
            buildItem("b", MonitorRecommendationCreateItemStatus.Creating),
            buildItem("c", MonitorRecommendationCreateItemStatus.Pending),
          ]),
          selectedRecommendationIds: new Set<string>(["a", "b", "c"]),
        });

      expect(Array.from(remaining).sort()).toEqual(["b", "c"]);
    });

    /*
     * A teammate can dismiss a recommendation between the click and the
     * submit, which drops it from the plan without it ever being attempted.
     * A retry has to be a retry of exactly what did not happen, so a
     * selection the plan never saw stays selected.
     */
    test("keeps ids that were selected but never appeared in the plan", () => {
      const remaining: Set<string> =
        MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
          progress: buildProgressFromItems([
            buildItem("a", MonitorRecommendationCreateItemStatus.Created),
          ]),
          selectedRecommendationIds: new Set<string>([
            "a",
            "dismissed-by-a-teammate",
          ]),
        });

      expect(Array.from(remaining)).toEqual(["dismissed-by-a-teammate"]);
    });

    /*
     * The selection lives in React state. Mutating the caller's Set in place
     * would change state without a re-render — the checkboxes would keep
     * showing monitors that had already been created.
     */
    test("does not mutate the selection it was given", () => {
      const selected: Set<string> = new Set<string>(["a", "b", "c"]);

      MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
        progress: buildProgressFromItems([
          buildItem("a", MonitorRecommendationCreateItemStatus.Created),
          buildItem("b", MonitorRecommendationCreateItemStatus.Created),
        ]),
        selectedRecommendationIds: selected,
      });

      expect(Array.from(selected).sort()).toEqual(["a", "b", "c"]);
    });

    test("returns a new Set, not the one it was given", () => {
      const selected: Set<string> = new Set<string>(["a"]);

      expect(
        MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
          progress: buildProgressFromItems([]),
          selectedRecommendationIds: selected,
        }),
      ).not.toBe(selected);
    });

    test("an empty progress leaves the whole selection intact", () => {
      expect(
        Array.from(
          MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
            progress: buildProgressFromItems([]),
            selectedRecommendationIds: new Set<string>(["a", "b"]),
          }),
        ).sort(),
      ).toEqual(["a", "b"]);
    });

    test("an empty selection stays empty", () => {
      expect(
        Array.from(
          MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
            progress: buildProgressFromItems([
              buildItem("a", MonitorRecommendationCreateItemStatus.Created),
            ]),
            selectedRecommendationIds: new Set<string>(),
          }),
        ),
      ).toEqual([]);
    });

    /*
     * A created id that is not in the selection can happen when the user
     * unticks a card while the batch is running. Removing it must be a no-op
     * rather than a throw.
     */
    test("a created id that is not in the selection is a no-op", () => {
      expect(
        Array.from(
          MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
            progress: buildProgressFromItems([
              buildItem("a", MonitorRecommendationCreateItemStatus.Created),
            ]),
            selectedRecommendationIds: new Set<string>(["b"]),
          }),
        ),
      ).toEqual(["b"]);
    });

    test("keeps the selection whole when every single item failed", () => {
      expect(
        Array.from(
          MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
            progress: buildProgressFromItems([
              buildItem("a", MonitorRecommendationCreateItemStatus.Failed),
              buildItem("b", MonitorRecommendationCreateItemStatus.Failed),
            ]),
            selectedRecommendationIds: new Set<string>(["a", "b"]),
          }),
        ).sort(),
      ).toEqual(["a", "b"]);
    });
  });

  describe("end to end", () => {
    /*
     * The three pieces as the panel uses them: run the batch, put a sentence
     * under the bar, and hand back a selection the user can press Retry on.
     * The retry must contain the failure and nothing that was created, or the
     * second press produces duplicate monitors.
     */
    test("a partly failed batch leaves exactly the failures selected", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(3);

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: plan,
          createMonitor: buildRecordingCreateMonitor(
            (index: number): Promise<MonitorRecommendationCreateOutcome> => {
              return index === 1
                ? failedWith("Monitor limit reached on this plan.")
                : created();
            },
          ).createMonitor,
        });

      expect(MonitorRecommendationCreateRunner.getSummaryText(progress)).toBe(
        "Created 2 of 3 monitors. 1 failed.",
      );

      expect(
        Array.from(
          MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
            progress: progress,
            selectedRecommendationIds: new Set<string>(planIds(plan)),
          }),
        ),
      ).toEqual([plan[1]!.recommendation.recommendationId]);
    });

    test("a fully successful batch leaves nothing selected", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(3);

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: plan,
          createMonitor: created,
        });

      expect(MonitorRecommendationCreateRunner.getSummaryText(progress)).toBe(
        "Created 3 monitors.",
      );
      expect(
        MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
          progress: progress,
          selectedRecommendationIds: new Set<string>(planIds(plan)),
        }).size,
      ).toBe(0);
    });

    test("a fully failed batch leaves the whole selection for the retry", async () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan(3);

      const progress: MonitorRecommendationCreateProgress =
        await MonitorRecommendationCreateRunner.run({
          plan: plan,
          createMonitor: (): Promise<MonitorRecommendationCreateOutcome> => {
            return failedWith("Your session has expired.");
          },
        });

      expect(MonitorRecommendationCreateRunner.getSummaryText(progress)).toBe(
        "None of the 3 monitors could be created.",
      );
      expect(
        Array.from(
          MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({
            progress: progress,
            selectedRecommendationIds: new Set<string>(planIds(plan)),
          }),
        ),
      ).toEqual(planIds(plan));
    });

    /*
     * The summary a user reads WHILE the batch is running has to come from a
     * real mid-run emission, not just from a hand-built fixture — this is the
     * only assertion that proves the two halves line up.
     */
    test("a mid-run emission summarises as in progress", async () => {
      const emissions: Array<MonitorRecommendationCreateProgress> = [];

      await MonitorRecommendationCreateRunner.run({
        plan: buildPlan(3),
        createMonitor: created,
        onProgress: recordEmissionsInto(emissions),
      });

      for (const progress of emissions.slice(0, emissions.length - 1)) {
        expect(
          MonitorRecommendationCreateRunner.getSummaryText(progress),
        ).toContain("Creating one monitor at a time");
      }

      expect(
        MonitorRecommendationCreateRunner.getSummaryText(
          emissions[emissions.length - 1]!,
        ),
      ).toBe("Created 3 monitors.");
    });
  });
});
