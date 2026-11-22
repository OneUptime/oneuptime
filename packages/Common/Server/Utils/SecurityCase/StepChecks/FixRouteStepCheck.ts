import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import {
  ResponseLink,
  ResponseLinkKind,
} from "../../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  SecurityCaseStepCheckSentence,
  readStepCheckDataTime,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  CHECK_FIX_CANNOT_NOT_FOLLOWED,
  CHECK_FIX_CANNOT_NO_DEPLOYS,
  CHECK_FIX_CANNOT_NO_SERVICE,
  CHECK_FIX_FACT_BEFORE_DATABASE,
  CHECK_FIX_FACT_BEFORE_THROUGH,
  CHECK_FIX_FACT_EDGE_STOPPED,
  CHECK_FIX_FACT_NONE_BEFORE,
  CHECK_FIX_FACT_TOO_FEW_BEFORE,
  CHECK_FIX_FACT_UNFOLLOWED,
  CHECK_FIX_FACT_WATCHING,
  CHECK_FIX_FACT_WATCHING_DATABASE,
  CHECK_FIX_FACT_WATCH_ENDED,
  CHECK_FIX_NOTHING_SHIPPED,
  CHECK_FIX_PULL_REQUEST_NOT_SHIPPED,
  CHECK_FIX_PULL_REQUEST_OPEN,
  CHECK_FIX_ROUTE_KEPT_OUT,
  CHECK_FIX_ROUTE_NO_ATTEMPTS,
  CHECK_FIX_ROUTE_REGRESSED,
  CHECK_FIX_ROUTE_REGRESSED_DATABASE,
  CHECK_FIX_ROUTE_STILL_DATABASE,
  CHECK_FIX_ROUTE_STILL_THROUGH,
  CHECK_FIX_ROUTE_TURNED_AWAY,
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  RouteAttackScope,
  getRouteAttackScope,
} from "../../../../Utils/SecurityCase/RouteAttackScope";
import { shortCommitSha } from "../../../../Utils/Telemetry/ChangeEventFields";
import { FIX_PRODUCTION_THRESHOLDS } from "../../AI/CodeFix/FixProductionVerdict";
import { readFailed } from "./AddressStepChecks";
import { FixChangesReading, FixPullRequest } from "./Evidence/FixChanges";
import {
  RouteAttackCounts,
  RouteAttacksReading,
} from "./Evidence/RouteAttacks";
import {
  STEP_CHECK_DOCS_PATH,
  StepCheck,
  StepCheckCase,
  StepCheckContext,
  StepCheckResult,
  StepCheckTarget,
  evidenceOf,
  getDoneSince,
  isStillRegressed,
  sentence,
} from "./StepCheck";

/*
 * "FIX HOW {{route}} HANDLES WHAT IT IS SENT" (#10347): whether the fix
 * worked, from the attack itself. A ticketing system can only say a fix was
 * merged; OneUptime holds the app's own requests, so it sees the same
 * attack on the same route (RouteAttackScope) turned away after the fix
 * shipped, where before it got through.
 *
 *   Verified    a change shipped to the service behind the route after the
 *               case opened - a fix OneUptime AI opened for the case
 *               (FixChanges) or any deploy or new version of the service -
 *               and since it shipped every attack request to the route was
 *               turned away, or kept out of the database where before they
 *               reached it, and enough of them to prove it (getNeededProof);
 *   Looks Done  a change shipped and no attack since got through, but too
 *               few came to prove the fix: none at all is "no attempts since
 *               the fix", never Verified. Watched FIX_ROUTE_WATCH_DAYS days
 *               after the change, and checked on after;
 *   Regressed   it was done - looked done, verified or ticked - and an
 *               attack got through since;
 *   Not Done    nothing shipped since the case opened (a fix may be waiting
 *               for review, or merged and not deployed), or what shipped
 *               did not stop the attack;
 *   Cannot Tell OneUptime records no deploys of the service, cannot tell
 *               which service answers the route, cannot follow the attacks
 *               into the app's traces, or could not read its data.
 *
 * Which change fixed it: the earliest that shipped after the last attack
 * that got through - so a later, unrelated deploy never resets the proof -
 * read again around that change when it is not the first.
 */

// How long after a change OneUptime watches for the attack to prove the fix.
export const FIX_ROUTE_WATCH_DAYS: number = 7;

/*
 * Old instances still answer as the old code did for a while after a deploy
 * starts: neither side of the change counts the requests in between.
 */
export const FIX_ROUTE_ROLLOUT_GRACE_MINUTES: number =
  FIX_PRODUCTION_THRESHOLDS.rolloutGraceMinutes;

/*
 * How much evidence counts as proof: so many attacks turned away that, had
 * nothing changed, at least one of them would have got through with this
 * likelihood - at the rate they got through before the change. Never fewer
 * than FIX_ROUTE_MIN_PROOF; past FIX_ROUTE_MAX_PROOF, so few got through
 * before that the attacks cannot prove a fix, and a person confirms it.
 */
export const FIX_ROUTE_PROOF_CONFIDENCE: number = 0.95;
export const FIX_ROUTE_MIN_PROOF: number = 3;
export const FIX_ROUTE_MAX_PROOF: number = 50;

// How far back the attacks are read: an hour before the case's first detection, at most 30 days.
export const FIX_ROUTE_WINDOW_LEAD_MINUTES: number = 60;
export const FIX_ROUTE_WINDOW_MAX_DAYS: number = 30;

/*
 * Changes this close together are one: a pipeline's deploy, the version the
 * service then reports, and the deploy OneUptime matched a fix's commit to.
 */
export const FIX_ROUTE_CHANGE_GROUP_MINUTES: number = 10;

const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

// What "worked" means for this case's attack.
export enum FixRouteCriterion {
  // Before the change the attack got past the app's checks: every one since is turned away.
  TurnedAway = "TurnedAway",
  /*
   * Before the change it reached the database: since, none reaches it, or
   * breaks anything - the app may answer it now, as a query that no longer
   * runs what it is sent does.
   */
  KeptOutOfDatabase = "KeptOutOfDatabase",
}

// A change that shipped to the service behind the route.
export interface ShippedChange {
  time: Date;
  // What names it, as written: its version, else its pull request, revision or commit.
  label: string;
  // The fix of OneUptime AI's it carried, when one did.
  pullRequest: FixPullRequest | null;
}

// What the case's fixes and its services' deploys name as shipped, oldest first.
export function getShippedChanges(data: {
  changes: FixChangesReading;
  since: Date;
}): Array<ShippedChange> {
  const all: Array<ShippedChange> = [];

  for (const pullRequest of data.changes.pullRequests) {
    if (
      pullRequest.state !== PullRequestState.Merged ||
      !pullRequest.deployedAt ||
      pullRequest.deployedAt.getTime() < data.since.getTime()
    ) {
      continue;
    }

    const label: string =
      pullRequest.deployedVersion ||
      getPullRequestLabel(pullRequest) ||
      shortCommitSha(pullRequest.deployedCommitSha);

    if (label) {
      all.push({ time: pullRequest.deployedAt, label, pullRequest });
    }
  }

  for (const deploy of data.changes.deploys) {
    if (deploy.time.getTime() >= data.since.getTime()) {
      all.push({ time: deploy.time, label: deploy.label, pullRequest: null });
    }
  }

  all.sort((left: ShippedChange, right: ShippedChange): number => {
    return left.time.getTime() - right.time.getTime();
  });

  /*
   * One change a deploy, at its first moment: the fix's pull request is
   * kept on it, and it is named by the version that shipped it - the
   * pull request's deploy's, else the service's own deploy's - before the
   * pull request's number.
   */
  const changes: Array<ShippedChange> = [];

  for (const change of all) {
    const last: ShippedChange | undefined = changes[changes.length - 1];

    if (
      !last ||
      change.time.getTime() - last.time.getTime() >
        FIX_ROUTE_CHANGE_GROUP_MINUTES * MINUTE
    ) {
      changes.push(change);
      continue;
    }

    const fix: ShippedChange | null = last.pullRequest
      ? last
      : change.pullRequest
        ? change
        : null;
    const other: ShippedChange = fix === last ? change : last;
    let label: string = last.label;

    if (fix && fix.pullRequest!.deployedVersion) {
      label = fix.pullRequest!.deployedVersion;
    } else if (fix) {
      label = other.label || fix.label;
    }

    changes[changes.length - 1] = {
      time: last.time,
      label,
      pullRequest: last.pullRequest || change.pullRequest,
    };
  }

  return changes;
}

// A pull request as a person names it: "#123", or its address.
export function getPullRequestLabel(pullRequest: FixPullRequest): string {
  return pullRequest.number !== null
    ? `#${pullRequest.number}`
    : pullRequest.url;
}

/*
 * How many attacks must be turned away since the change for OneUptime to
 * call the fix verified: had nothing changed, at least one of that many
 * would have got through with FIX_ROUTE_PROOF_CONFIDENCE, at the rate they
 * got through before. Null when the attacks cannot prove it: none got
 * through before, or so few that it would take more than
 * FIX_ROUTE_MAX_PROOF.
 */
export function getNeededProof(data: {
  // Before the change: the attacks that got through, of those followed.
  harmful: number;
  followed: number;
}): number | null {
  if (data.followed <= 0 || data.harmful <= 0) {
    return null;
  }

  const rate: number = Math.min(1, data.harmful / data.followed);

  if (rate >= 1) {
    return FIX_ROUTE_MIN_PROOF;
  }

  const needed: number = Math.max(
    FIX_ROUTE_MIN_PROOF,
    Math.ceil(Math.log(1 - FIX_ROUTE_PROOF_CONFIDENCE) / Math.log(1 - rate)),
  );

  return needed > FIX_ROUTE_MAX_PROOF ? null : needed;
}

// The end of a change's rollout grace: what comes after counts as the change's.
export function getSettledAt(change: ShippedChange): Date {
  return new Date(
    change.time.getTime() + FIX_ROUTE_ROLLOUT_GRACE_MINUTES * MINUTE,
  );
}

/*
 * The earliest change after which no attack got through - one whose
 * rollout was over by the last that did. -1 when an attack got through
 * after every one of them.
 */
export function pickFixingChange(data: {
  changes: Array<ShippedChange>;
  lastHarmAt: Date | null;
}): number {
  return data.changes.findIndex((change: ShippedChange): boolean => {
    return (
      !data.lastHarmAt ||
      data.lastHarmAt.getTime() < getSettledAt(change).getTime()
    );
  });
}

/*
 * What "worked" means here, from the attacks before the first change: kept
 * out of the database when some reached it, else turned away. With none
 * followed before it, the window's own say: any that reached the database.
 */
export function getFixCriterion(
  reading: RouteAttacksReading,
): FixRouteCriterion {
  const followedBefore: number =
    reading.before.requests - reading.before.unknown;
  const reachedDatabase: number =
    followedBefore > 0
      ? reading.before.reachedDatabase
      : reading.all.reachedDatabase;

  return reachedDatabase > 0
    ? FixRouteCriterion.KeptOutOfDatabase
    : FixRouteCriterion.TurnedAway;
}

// Of some attacks, the ones that did what the criterion says a fix stops.
export function countHarmful(
  counts: RouteAttackCounts,
  criterion: FixRouteCriterion,
): number {
  return criterion === FixRouteCriterion.KeptOutOfDatabase
    ? counts.errored + counts.reachedDatabase
    : counts.reachedApp + counts.errored + counts.reachedDatabase;
}

// Of some attacks, the ones the criterion says a fix stopped.
export function countStopped(
  counts: RouteAttackCounts,
  criterion: FixRouteCriterion,
): number {
  return criterion === FixRouteCriterion.KeptOutOfDatabase
    ? counts.rejected + counts.reachedApp
    : counts.rejected;
}

// The window the attacks are read over: from before the case's first detection to now.
export function getFixRouteWindow(data: {
  securityCase: Pick<StepCheckCase, "firstDetectedAt" | "createdAt">;
  now: Date;
}): { start: Date; end: Date } {
  const first: Date =
    data.securityCase.firstDetectedAt &&
    data.securityCase.firstDetectedAt.getTime() <
      data.securityCase.createdAt.getTime()
      ? data.securityCase.firstDetectedAt
      : data.securityCase.createdAt;

  return {
    start: new Date(
      Math.max(
        data.now.getTime() - FIX_ROUTE_WINDOW_MAX_DAYS * DAY,
        first.getTime() - FIX_ROUTE_WINDOW_LEAD_MINUTES * MINUTE,
      ),
    ),
    end: data.now,
  };
}

// Where the fix is: its pull request, on the host it is on.
function pullRequestLink(
  pullRequest: FixPullRequest | null,
): ResponseLink | null {
  return pullRequest?.url
    ? {
        kind: ResponseLinkKind.OpenProvider,
        provider: pullRequest.host,
        url: pullRequest.url,
      }
    : null;
}

// The traces of the attacks that got through after the change.
function throughTracesLink(reading: RouteAttacksReading): ResponseLink | null {
  return reading.throughAfterTraceIds.length > 0
    ? {
        kind: ResponseLinkKind.OpenTraces,
        traceIds: reading.throughAfterTraceIds,
        startTime: (reading.settledAt || reading.windowStart).toISOString(),
        endTime: reading.windowEnd.toISOString(),
      }
    : null;
}

/*
 * Nothing shipped since the case opened: a fix waiting to merge or to
 * deploy, OneUptime unable to see a deploy at all, or nothing done yet.
 */
export function decideNothingShipped(data: {
  scope: RouteAttackScope;
  changes: FixChangesReading;
}): StepCheckResult {
  const pullRequests: Array<FixPullRequest> = data.changes.pullRequests;
  const merged: FixPullRequest | undefined = pullRequests
    .filter((pullRequest: FixPullRequest): boolean => {
      return (
        pullRequest.state === PullRequestState.Merged &&
        Boolean(pullRequest.mergedAt)
      );
    })
    .sort((left: FixPullRequest, right: FixPullRequest): number => {
      return right.mergedAt!.getTime() - left.mergedAt!.getTime();
    })[0];
  const open: FixPullRequest | undefined = pullRequests.find(
    (pullRequest: FixPullRequest): boolean => {
      return pullRequest.state === PullRequestState.Open;
    },
  );
  const serviceId: string = data.scope.serviceIds[0] || "";
  const service: string = data.changes.serviceNames[serviceId] || serviceId;
  // A fix merged and not seen deploying: said beside why OneUptime cannot tell.
  const mergedFacts: Array<SecurityCaseStepCheckSentence> = merged
    ? [
        sentence(
          CHECK_FIX_PULL_REQUEST_NOT_SHIPPED,
          { pullRequest: getPullRequestLabel(merged) },
          { times: { time: merged.mergedAt } },
        ),
      ]
    : [];
  const mergedLinks: Array<ResponseLink | null> = merged
    ? [pullRequestLink(merged)]
    : [];

  if (open && !merged) {
    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: sentence(CHECK_FIX_PULL_REQUEST_OPEN, {
          pullRequest: getPullRequestLabel(open),
        }),
        links: [pullRequestLink(open)],
        data: { route: data.scope.route },
      }),
    };
  }

  /*
   * Where OneUptime cannot see the service's deploys, a merged fix may well
   * have shipped: it cannot tell, rather than say the fix is still to ship.
   */
  if (!serviceId) {
    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(CHECK_FIX_CANNOT_NO_SERVICE, {
          route: data.scope.route,
        }),
        facts: mergedFacts,
        links: mergedLinks,
        docsPath: STEP_CHECK_DOCS_PATH,
        data: { route: data.scope.route, reason: "NoService" },
      }),
    };
  }

  if (!data.changes.hasDeployData) {
    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(CHECK_FIX_CANNOT_NO_DEPLOYS, { service }),
        facts: mergedFacts,
        links: mergedLinks,
        docsPath: STEP_CHECK_DOCS_PATH,
        data: { route: data.scope.route, reason: "NoDeploys" },
      }),
    };
  }

  if (merged) {
    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: mergedFacts[0]!,
        links: mergedLinks,
        data: { route: data.scope.route, mergedAt: merged.mergedAt },
      }),
    };
  }

  return {
    state: SecurityCaseStepCheckState.NotDone,
    evidence: evidenceOf({
      sentence: sentence(CHECK_FIX_NOTHING_SHIPPED, { service }),
      data: { route: data.scope.route },
    }),
  };
}

export interface FixRouteInput {
  scope: RouteAttackScope;
  now: Date;
  target: StepCheckTarget;
  // The change judged: the one that fixed it, or the latest when none did.
  change: ShippedChange;
  // Whether no attack got through after `change`: it is the one that fixed it.
  isHolding: boolean;
  criterion: FixRouteCriterion;
  // The attacks, split at `change`.
  reading: RouteAttacksReading;
}

// What the attacks before and around the change say: the How We Know facts.
function beforeFacts(data: {
  input: FixRouteInput;
  harmfulBefore: number;
  followedBefore: number;
}): Array<SecurityCaseStepCheckSentence> {
  const isKeptOut: boolean =
    data.input.criterion === FixRouteCriterion.KeptOutOfDatabase;

  return data.harmfulBefore > 0
    ? [
        sentence(
          isKeptOut
            ? CHECK_FIX_FACT_BEFORE_DATABASE
            : CHECK_FIX_FACT_BEFORE_THROUGH,
          {},
          {
            numbers: { through: data.harmfulBefore },
            count: data.followedBefore,
          },
        ),
      ]
    : [];
}

function edgeFacts(input: FixRouteInput): Array<SecurityCaseStepCheckSentence> {
  return input.reading.edgeStoppedAfter > 0
    ? [
        sentence(
          CHECK_FIX_FACT_EDGE_STOPPED,
          { route: input.scope.route },
          { count: input.reading.edgeStoppedAfter },
        ),
      ]
    : [];
}

/*
 * What OneUptime found, from the attacks around the change it judges: the
 * state, and the evidence for it.
 */
export function decideFixRoute(input: FixRouteInput): StepCheckResult {
  const { scope, reading, change, criterion } = input;
  const isKeptOut: boolean = criterion === FixRouteCriterion.KeptOutOfDatabase;
  const settledAt: Date = getSettledAt(change);
  const harmfulBefore: number = countHarmful(reading.before, criterion);
  const followedBefore: number =
    reading.before.requests - reading.before.unknown;
  const harmfulAfter: number = countHarmful(reading.after, criterion);
  const stoppedAfter: number = countStopped(reading.after, criterion);
  const shipped: Record<string, string> = {
    route: scope.route,
    change: change.label,
  };
  /*
   * What the attacks since were: turned away, or - some answered now -
   * kept out of the database. "Turned away" says more, so it is said
   * whenever it is true.
   */
  const stoppedTemplate: SecurityCaseStepCheckSentence["template"] =
    isKeptOut && reading.after.reachedApp > 0
      ? CHECK_FIX_ROUTE_KEPT_OUT
      : CHECK_FIX_ROUTE_TURNED_AWAY;
  const facts: Array<SecurityCaseStepCheckSentence> = [
    ...beforeFacts({ input, harmfulBefore, followedBefore }),
    ...edgeFacts(input),
  ];
  const data: Record<string, string | number | boolean | Date | null> = {
    route: scope.route,
    change: change.label,
    shippedAt: change.time,
    criterion,
    harmfulBefore,
    followedBefore,
    harmfulAfter,
    stoppedAfter,
    edgeStoppedAfter: reading.edgeStoppedAfter,
    pullRequestUrl: change.pullRequest?.url || null,
  };

  // An attack got through after every change: not fixed, or no longer.
  if (!input.isHolding && harmfulAfter > 0) {
    const doneSince: Date | null = getDoneSince(input.target);
    const lastHarmAt: Date | null = isKeptOut
      ? reading.lastHarmAt
      : reading.lastThroughAt;
    const firstHarmAfterAt: Date | null = isKeptOut
      ? reading.firstHarmAfterAt
      : reading.firstThroughAfterAt;
    const isNew: boolean = Boolean(
      doneSince && lastHarmAt && lastHarmAt.getTime() > doneSince.getTime(),
    );

    if (isNew || isStillRegressed(input.target)) {
      const regressedAt: Date =
        (!isNew
          ? readStepCheckDataTime(
              input.target.previous?.evidence.data,
              "regressedAt",
            )
          : null) ||
        (doneSince &&
        firstHarmAfterAt &&
        firstHarmAfterAt.getTime() > doneSince.getTime()
          ? firstHarmAfterAt
          : lastHarmAt) ||
        input.now;

      return {
        state: SecurityCaseStepCheckState.Regressed,
        evidence: evidenceOf({
          sentence: sentence(
            isKeptOut
              ? CHECK_FIX_ROUTE_REGRESSED_DATABASE
              : CHECK_FIX_ROUTE_REGRESSED,
            shipped,
            { times: { time: regressedAt } },
          ),
          facts,
          links: [
            throughTracesLink(reading),
            pullRequestLink(change.pullRequest),
          ],
          data: { ...data, regressedAt },
        }),
      };
    }

    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: sentence(
          isKeptOut
            ? CHECK_FIX_ROUTE_STILL_DATABASE
            : CHECK_FIX_ROUTE_STILL_THROUGH,
          shipped,
          {
            numbers: { through: harmfulAfter },
            times: { time: change.time },
            count: reading.after.requests,
          },
        ),
        facts,
        links: [
          throughTracesLink(reading),
          pullRequestLink(change.pullRequest),
        ],
        data,
      }),
    };
  }

  // Held since the change: as far as OneUptime can see, the fix works.
  const needed: number | null = getNeededProof({
    harmful: harmfulBefore,
    followed: followedBefore,
  });
  const watchUntil: Date = new Date(
    change.time.getTime() + FIX_ROUTE_WATCH_DAYS * DAY,
  );
  const links: Array<ResponseLink | null> = [
    pullRequestLink(change.pullRequest),
  ];
  const holding: Record<string, string | number | boolean | Date | null> = {
    ...data,
    doneSince: settledAt,
    needed,
    watchUntil,
  };

  if (needed !== null && stoppedAfter >= needed) {
    return {
      state: SecurityCaseStepCheckState.Verified,
      evidence: evidenceOf({
        sentence: sentence(stoppedTemplate, shipped, {
          times: { time: change.time },
          count: stoppedAfter,
        }),
        facts: [...facts, ...unfollowedFacts(reading.after)],
        links,
        data: holding,
      }),
    };
  }

  // Why the attacks do not prove it yet - or cannot - said beside what OneUptime saw.
  const proofFacts: Array<SecurityCaseStepCheckSentence> = [];

  if (needed === null) {
    proofFacts.push(
      sentence(
        harmfulBefore > 0
          ? CHECK_FIX_FACT_TOO_FEW_BEFORE
          : CHECK_FIX_FACT_NONE_BEFORE,
        { route: scope.route },
      ),
    );
  } else if (input.now.getTime() < watchUntil.getTime()) {
    proofFacts.push(
      sentence(
        isKeptOut ? CHECK_FIX_FACT_WATCHING_DATABASE : CHECK_FIX_FACT_WATCHING,
        { route: scope.route },
        { times: { until: watchUntil }, count: needed },
      ),
    );
  } else {
    proofFacts.push(
      sentence(
        CHECK_FIX_FACT_WATCH_ENDED,
        { route: scope.route },
        { times: { until: watchUntil } },
      ),
    );
  }

  if (stoppedAfter === 0 && reading.after.unknown > 0) {
    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(CHECK_FIX_CANNOT_NOT_FOLLOWED, shipped, {
          count: reading.after.unknown,
        }),
        facts,
        links,
        docsPath: STEP_CHECK_DOCS_PATH,
        data: { ...holding, reason: "NotFollowed" },
      }),
    };
  }

  return {
    state: SecurityCaseStepCheckState.LooksDone,
    evidence: evidenceOf({
      sentence:
        stoppedAfter === 0
          ? sentence(CHECK_FIX_ROUTE_NO_ATTEMPTS, shipped, {
              times: { time: change.time },
            })
          : sentence(stoppedTemplate, shipped, {
              times: { time: change.time },
              count: stoppedAfter,
            }),
      facts: [
        ...proofFacts,
        ...facts,
        ...(stoppedAfter > 0 ? unfollowedFacts(reading.after) : []),
      ],
      links,
      data: holding,
    }),
  };
}

// The attacks since that could not be followed: neither turned away nor through.
function unfollowedFacts(
  after: RouteAttackCounts,
): Array<SecurityCaseStepCheckSentence> {
  return after.unknown > 0
    ? [sentence(CHECK_FIX_FACT_UNFOLLOWED, {}, { count: after.unknown })]
    : [];
}

// The route the step is about: as the plan names it.
export function getFixRoute(target: StepCheckTarget): string {
  return (target.step.text.values["route"] || "").trim();
}

const FixRouteStepCheck: StepCheck = {
  kind: RESPONSE_STEP_KINDS.fixPublicApp,
  intervalInMinutes: 15,
  check: async (context: StepCheckContext): Promise<StepCheckResult | null> => {
    // A case whose requests name no route has no attack on it to read.
    const scope: RouteAttackScope | null = getRouteAttackScope({
      matches: context.securityCase.matches,
      route: getFixRoute(context.target),
    });

    if (!scope) {
      return null;
    }

    const since: Date = context.securityCase.createdAt;
    const window: { start: Date; end: Date } = getFixRouteWindow({
      securityCase: context.securityCase,
      now: context.now,
    });

    try {
      const changes: FixChangesReading = await context.evidence.readFixChanges({
        serviceIds: scope.serviceIds,
        since,
      });
      const shipped: Array<ShippedChange> = getShippedChanges({
        changes,
        since,
      });

      if (shipped.length === 0) {
        return decideNothingShipped({ scope, changes });
      }

      const read: (change: ShippedChange) => Promise<RouteAttacksReading> = (
        change: ShippedChange,
      ): Promise<RouteAttacksReading> => {
        return context.evidence.readRouteAttacks({
          scope,
          start: window.start,
          end: window.end,
          splitAt: change.time,
          settledAt: getSettledAt(change),
        });
      };

      // Around the first change: what the attack did before anything shipped.
      const first: RouteAttacksReading = await read(shipped[0]!);
      const criterion: FixRouteCriterion = getFixCriterion(first);
      const fixing: number = pickFixingChange({
        changes: shipped,
        lastHarmAt:
          criterion === FixRouteCriterion.KeptOutOfDatabase
            ? first.lastHarmAt
            : first.lastThroughAt,
      });
      const judged: number = fixing === -1 ? shipped.length - 1 : fixing;
      const reading: RouteAttacksReading =
        judged === 0 ? first : await read(shipped[judged]!);

      return decideFixRoute({
        scope,
        now: context.now,
        target: context.target,
        change: shipped[judged]!,
        isHolding: fixing !== -1,
        criterion,
        reading,
      });
    } catch {
      return readFailed();
    }
  },
};

export default FixRouteStepCheck;
