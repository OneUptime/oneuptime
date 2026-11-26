import SecurityUserErasureRequest from "../../../../Models/DatabaseModels/SecurityUserErasureRequest";
import ProjectService from "../../../Services/ProjectService";
import SecurityUserErasureRequestService, {
  SecurityUserErasureCounts,
  readErasureRequestNames,
  readErasureRequestProgress,
  readErasureRequestTokens,
} from "../../../Services/SecurityUserErasureRequestService";
import SecurityUserVaultService, {
  SecurityUserVaultEntry,
} from "../../../Services/SecurityUserVaultService";
import PartialEntity from "../../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityUserErasureRequestStatus,
  getErasureSpellings,
} from "../../../../Types/SecurityEvent/SecurityUserErasure";
import { ErasedName } from "../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import JobDeadline, { JOB_DEADLINE_GRACE_MS } from "../../JobDeadline";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ScrubHashToken from "../../Telemetry/ScrubHashToken";
import { SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS } from "../SecurityProjectWork";
import { ERASED_TOKENS_CACHE_TTL_MS } from "./SecurityUserErasedTokens";
import SecurityUserErasureEvents, {
  SecurityUserErasurePair,
} from "./SecurityUserErasureEvents";
import SecurityUserErasureFindings, {
  FindingsScanProgress,
  FindingsScanStep,
} from "./SecurityUserErasureFindings";
import {
  SecurityUserErasureFindingsPass,
  SecurityUserErasureProgress,
  getEventsUnnamed,
} from "./SecurityUserErasureProgress";
import SecurityUserErasureRecords, {
  SecurityUserErasureRecordCounts,
} from "./SecurityUserErasureRecords";

/*
 * THE ERASURE WORKER (#10908): carries out the erasure requests filed to
 * take one person out of Security Events' user vault
 * (Models/DatabaseModels/SecurityUserErasureRequest).
 *
 * A request moves on its own, run after run of the cron
 * (Workers/Jobs/SecurityEvents/EraseSecurityUsers):
 *
 *   Pending. The vault refuses the person's tokens from the moment the
 *     request is filed (SecurityUserErasedTokens): ingest keeps them no
 *     more and no scan names them. Each process hears of it within
 *     ERASED_TOKENS_CACHE_TTL_MS, so the worker waits SUPPRESSION_SETTLE_MS
 *     before it deletes anything - a row written by a process that had not
 *     heard yet is deleted with the rest, never after them.
 *
 *   InProgress. Claimed (one worker does it), then told (runErasure):
 *     1. who the vault named: what the requester typed, the vault's own
 *        rows of the tokens, the users the events it named hold - the
 *        names Security Events may have copied onward - and the names an
 *        earlier run kept on the request;
 *     2. Postgres: the person taken out of detections, cases, entity risk
 *        and proposals, and every fingerprint of a value that named them
 *        rewritten - a detection's, an alert's, an incident's, a firing's
 *        (SecurityUserErasureRecords, #11130). Synchronous, and the counts
 *        kept at once, so a run that fails later loses none. The names are
 *        kept on the request with them, encrypted (namesToErase): the
 *        vault's rows and the events that hold them go with this run, and
 *        later runs need them (#11044);
 *     3. ClickHouse: the events the vault named counted and the token put
 *        back in them (SecurityUserErasureEvents), the vault's rows of the
 *        tokens counted and deleted. Queued mutations, durable from then
 *        on.
 *     Then, this run and every one after it, the project's Detection
 *     Findings are read and changed (SecurityUserErasureFindings: they
 *     carry no token to be found by), in passes from the first to the last,
 *     each run going on where the last one stopped (#11160,
 *     SecurityUserErasureProgress) - so a project too large to read in one
 *     run is read over several, and never fails for it.
 *
 *   Completed, once a pass of the findings that started after no vault row
 *     and no event had named the person for DETECTION_TURN_SETTLE_MS - no
 *     detection that read the name before it went can still be writing - has
 *     read every one and found nothing to change. Postgres is gone through
 *     once more first, for a detection a rule wrote from the events before
 *     they lost the name. What the requester typed, and the names, are
 *     wiped. A request whose vault rows or events are still not done
 *     RESUBMIT_AFTER_MS after ClickHouse was told is told again: every step
 *     finds only what still names the person.
 *
 *   Failed, after MAX_ERASURE_ATTEMPTS failed runs, spaced out
 *     (RETRY_BACKOFF_MS more each time): the project's owners are emailed,
 *     because a right-to-erasure obligation must not die on a log line.
 *     What the requester typed is wiped; the tokens are still refused. A
 *     run that fails keeps where its read of the findings got to, and the
 *     next run goes on from there.
 *
 * Every ClickHouse statement names tokens, never the person
 * (SecurityUserVaultService says why): the findings are matched to the
 * names here, in the worker, and changed by their ids.
 *
 * A run that runs out of the cron job's time (its deadline) stops where it
 * is, with nothing counted against the request: what it read of the
 * findings is kept, and the next run carries on.
 */

// How many failed runs a request survives before it is marked Failed.
export const MAX_ERASURE_ATTEMPTS: number = 5;

// The most requests one run works on, oldest first.
export const MAX_ERASURE_REQUESTS_PER_RUN: number = 50;

/*
 * How long after a request is filed its rows are first deleted: every
 * process refuses the tokens by then (twice the time it takes one to hear).
 */
export const SUPPRESSION_SETTLE_MS: number = 2 * ERASED_TOKENS_CACHE_TTL_MS;

/*
 * How long a started request waits for ClickHouse to apply what it was
 * told before it is told again: mutations on a busy cluster take a while,
 * and telling it again changes nothing that was done.
 */
export const RESUBMIT_AFTER_MS: number = 30 * 60 * 1000;

// How much longer each failed run waits than the one before it: 10, 20, 30... minutes.
export const RETRY_BACKOFF_MS: number = 10 * 60 * 1000;

/*
 * How long after no event names the person the final read of the findings
 * starts: a detection turn - a rule's or a feed's, scheduled or in real
 * time - that read the events before they lost the name may write a finding
 * naming the person until its job's time is up (SecurityProjectWork's
 * timeout, and the grace to finish what is in flight). One that starts
 * after they lost it reads none.
 */
export const DETECTION_TURN_SETTLE_MS: number =
  SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS + JOB_DEADLINE_GRACE_MS;

// What one run of a request found and changed.
export interface SecurityUserErasureRunResult {
  names: Array<ErasedName>;
  counts: SecurityUserErasureCounts;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function timeOf(value: Date | string | undefined | null): number {
  if (!value) {
    return 0;
  }

  const time: number = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

// Each name once, and only names that are not what the rule left.
function distinctNames(names: Array<ErasedName>): Array<ErasedName> {
  const seen: Map<string, ErasedName> = new Map<string, ErasedName>();

  for (const name of names) {
    const named: string = (name.named || "").trim();
    const hashed: string = (name.hashed || "").trim();

    if (named && hashed && named !== hashed) {
      seen.set(`${named}\u0000${hashed}`, { named, hashed });
    }
  }

  return Array.from(seen.values());
}

// A request's counts as they stand.
function countsOf(request: SecurityUserErasureRequest): SecurityUserErasureCounts {
  return {
    vaultEntriesDeleted: request.vaultEntriesDeleted || 0,
    eventsUnnamed: request.eventsUnnamed || 0,
    casesUnnamed: request.casesUnnamed || 0,
    proposalsWithdrawn: request.proposalsWithdrawn || 0,
  };
}

export default class SecurityUserErasure {
  /*
   * One run: every open request, oldest first, each on its own. Never
   * throws for one request's failure.
   */
  @CaptureSpan()
  public static async processOpenRequests(
    now: Date = OneUptimeDate.getCurrentDate(),
    deadline: JobDeadline = JobDeadline.none(),
  ): Promise<void> {
    const requests: Array<SecurityUserErasureRequest> =
      await SecurityUserErasureRequestService.getOpenRequests({
        limit: MAX_ERASURE_REQUESTS_PER_RUN,
      });

    for (const request of requests) {
      // Out of time: the rest wait for the next run.
      if (deadline.hasPassed()) {
        return;
      }

      await this.processRequest({ request, now, deadline });
    }
  }

  // Whether the request's last run failed: a run that succeeds clears why.
  public static didLastRunFail(request: SecurityUserErasureRequest): boolean {
    return Boolean((request.failureReason || "").trim());
  }

  // Whether a request whose last run failed waits out its backoff on this run.
  public static isBackingOff(
    request: SecurityUserErasureRequest,
    now: Date,
  ): boolean {
    const attempts: number = Math.max(1, request.attempts || 0);

    return (
      this.didLastRunFail(request) &&
      timeOf(request.updatedAt) + attempts * RETRY_BACKOFF_MS > now.getTime()
    );
  }

  // Moves one request on, as far as it can on this run. See the file's comment.
  @CaptureSpan()
  public static async processRequest(data: {
    request: SecurityUserErasureRequest;
    now: Date;
    deadline?: JobDeadline | undefined;
  }): Promise<void> {
    const request: SecurityUserErasureRequest = data.request;
    const deadline: JobDeadline = data.deadline || JobDeadline.none();

    if (!request.id || !request.projectId) {
      return;
    }

    if (this.isBackingOff(request, data.now)) {
      return;
    }

    try {
      if (request.status === SecurityUserErasureRequestStatus.Pending) {
        if (
          timeOf(request.requestedAt) + SUPPRESSION_SETTLE_MS >
          data.now.getTime()
        ) {
          return;
        }

        const isClaimed: boolean =
          await SecurityUserErasureRequestService.compareAndSetColumnsByIdWithoutHooks(
            {
              id: request.id,
              data: {
                status: SecurityUserErasureRequestStatus.InProgress,
              } as unknown as PartialEntity<SecurityUserErasureRequest>,
              expectedData: {
                status: SecurityUserErasureRequestStatus.Pending,
              } as unknown as PartialEntity<SecurityUserErasureRequest>,
            },
          );

        if (!isClaimed) {
          return;
        }

        await this.runErasure(request, deadline, data.now);

        return;
      }

      if (request.status !== SecurityUserErasureRequestStatus.InProgress) {
        return;
      }

      // Its last run failed, and its backoff is over: run it again.
      if (this.didLastRunFail(request)) {
        await this.runErasure(request, deadline, data.now);

        return;
      }

      const progress: SecurityUserErasureProgress =
        readErasureRequestProgress(request);
      const isClean: boolean = await this.isVaultAndEventsClean(request);

      /*
       * Not applied yet: told again once it has had long enough. A request
       * from before #11160 kept no time it was told: its last run's.
       */
      if (
        !isClean &&
        timeOf(progress.toldAt || request.updatedAt) + RESUBMIT_AFTER_MS <=
          data.now.getTime()
      ) {
        await this.runErasure(request, deadline, data.now);

        return;
      }

      await this.continueFindings({
        request,
        names: this.getKeptNames(request),
        progress,
        counts: countsOf(request),
        isClean,
        now: data.now,
        deadline,
      });
    } catch (error) {
      // The run's own time ran out, not the request: a later run carries on.
      if (deadline.hasPassed()) {
        logger.info(
          `SecurityUserErasure: erasure request ${request.id.toString()} stopped when the run ran out of time; a later run carries on.`,
        );

        return;
      }

      await this.recordFailure({ request, error });
    }
  }

  /*
   * Checked done: Postgres gone through once more, for a detection a rule
   * wrote from the events before they lost the name - none can be written
   * after, as no event names the person and no detection that read them
   * before is still running - then the request marked Completed, with what
   * was typed and the names wiped.
   */
  private static async complete(data: {
    request: SecurityUserErasureRequest;
    names: ReadonlyArray<ErasedName>;
    counts: SecurityUserErasureCounts;
    deadline: JobDeadline;
  }): Promise<void> {
    const records: SecurityUserErasureRecordCounts =
      await SecurityUserErasureRecords.unnameRecords({
        projectId: data.request.projectId!,
        names: data.names,
        deadline: data.deadline,
      });

    await SecurityUserErasureRequestService.markCompleted({
      requestId: data.request.id!,
      counts: {
        ...data.counts,
        casesUnnamed: data.counts.casesUnnamed + records.cases,
        proposalsWithdrawn: data.counts.proposalsWithdrawn + records.proposals,
      },
    });

    logger.info(
      `SecurityUserErasure: erasure request ${data.request.id!.toString()} is complete.`,
    );
  }

  /*
   * The names a request goes on looking for once the vault's rows and the
   * events that held them may be gone: each spelling of what was typed,
   * with its own token, and the names a run kept on the request (#11044).
   */
  public static getKeptNames(
    request: SecurityUserErasureRequest,
  ): Array<ErasedName> {
    return distinctNames([
      ...this.getTypedNames({
        projectId: request.projectId!,
        userToErase: request.userToErase,
      }),
      ...readErasureRequestNames(request),
    ]);
  }

  // Each spelling of what the requester typed, with the token a Hash rule makes of exactly it.
  private static getTypedNames(data: {
    projectId: ObjectID;
    userToErase?: string | undefined;
  }): Array<ErasedName> {
    return getErasureSpellings(data.userToErase || "").map(
      (spelling: string): ErasedName => {
        return {
          named: spelling,
          hashed: ScrubHashToken.ofValue({
            projectId: data.projectId,
            value: spelling,
          }),
        };
      },
    );
  }

  /*
   * Who the vault named the person as, and what the rule left in each
   * name's place: each spelling of what the requester typed, the vault's
   * own rows of the tokens, and the users the events it named hold.
   */
  public static async findNames(data: {
    projectId: ObjectID;
    tokens: Array<string>;
    userToErase?: string | undefined;
    // The names an earlier run of the request kept on it (#11044).
    keptNames?: ReadonlyArray<ErasedName> | undefined;
  }): Promise<Array<ErasedName>> {
    const names: Array<ErasedName> = [
      ...this.getTypedNames(data),
      ...(data.keptNames || []),
    ];

    const entries: Array<SecurityUserVaultEntry> =
      await SecurityUserVaultService.findEntriesOfTokens({
        projectId: data.projectId,
        tokens: data.tokens,
      });

    for (const entry of entries) {
      names.push({ named: entry.user, hashed: entry.token });
    }

    const pairs: Array<SecurityUserErasurePair> =
      await SecurityUserErasureEvents.findNamedPairs({
        projectId: data.projectId,
        tokens: data.tokens,
      });

    for (const pair of pairs) {
      names.push({ named: pair.named, hashed: pair.hashed });
    }

    return distinctNames(names);
  }

  /*
   * Telling the erasure, the first time and every time it is told again:
   * Postgres, then ClickHouse's vault rows and events, the counts kept as
   * each part is done - then on with the findings, from where their read
   * got to. The request stays InProgress; a later run checks it is done.
   */
  @CaptureSpan()
  public static async runErasure(
    request: SecurityUserErasureRequest,
    deadline: JobDeadline = JobDeadline.none(),
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<SecurityUserErasureRunResult> {
    const requestId: ObjectID = request.id!;
    const projectId: ObjectID = request.projectId!;
    const tokens: Array<string> = readErasureRequestTokens(request);
    const progress: SecurityUserErasureProgress =
      readErasureRequestProgress(request);

    const found: Array<ErasedName> = await this.findNames({
      projectId,
      tokens,
      userToErase: request.userToErase,
      keptNames: readErasureRequestNames(request),
    });

    /*
     * And each correlation's group value that holds one of them (#11130):
     * once its detection is un-named nothing else says what it was, and the
     * alerts, incidents and risk carrying its fingerprint are found by it.
     */
    const names: Array<ErasedName> = distinctNames([
      ...found,
      ...(await SecurityUserErasureRecords.findCorrelationValues({
        projectId,
        names: found,
      })),
    ]);

    const counts: SecurityUserErasureCounts = countsOf(request);

    /*
     * The names are kept before anything changes: once Postgres has, and
     * the vault's rows and the events in ClickHouse, nothing else says who
     * the findings name or what a correlation's value was.
     */
    await SecurityUserErasureRequestService.markInProgress({
      requestId,
      counts,
      names,
    });

    const records: SecurityUserErasureRecordCounts =
      await SecurityUserErasureRecords.unnameRecords({
        projectId,
        names,
        deadline,
      });

    // Kept at once: Postgres is done, and a retry would find nothing left to count.
    counts.casesUnnamed += records.cases;
    counts.proposalsWithdrawn += records.proposals;

    await SecurityUserErasureRequestService.markInProgress({
      requestId,
      counts,
    });

    /*
     * Counted before each is queued, as ClickHouse answers a mutation with
     * no count. A run again after one that queued them counts what is still
     * there, so the larger of the two is kept, never their sum.
     */
    const events: number = await SecurityUserErasureEvents.countNamedEvents({
      projectId,
      tokens,
    });

    await SecurityUserErasureEvents.unnameEvents({ projectId, tokens });

    const vaultRows: number = await SecurityUserVaultService.countRowsOfTokens({
      projectId,
      tokens,
    });

    await SecurityUserVaultService.eraseTokens({ projectId, tokens });

    progress.toldAt = now.toISOString();
    progress.namedEvents = Math.max(progress.namedEvents, events);
    counts.eventsUnnamed = Math.max(
      counts.eventsUnnamed,
      getEventsUnnamed(progress),
    );
    counts.vaultEntriesDeleted = Math.max(
      counts.vaultEntriesDeleted,
      vaultRows,
    );

    await SecurityUserErasureRequestService.markInProgress({
      requestId,
      counts,
      progress,
    });

    logger.info(
      `SecurityUserErasure: erasure request ${requestId.toString()} took the person out of ${records.cases} case(s) and ${records.proposals} proposal(s), and queued the token back into ${events} event(s) and the delete of ${vaultRows} vault row(s); its Detection Findings are read next.`,
    );

    // Nothing named the person here before it was told: nothing does now.
    await this.continueFindings({
      request,
      names,
      progress,
      counts,
      isClean: events === 0 && vaultRows === 0,
      now,
      deadline,
    });

    return { names, counts };
  }

  /*
   * Whether nothing in the user vault or the events names the person any
   * more: no vault row of its tokens, at any age, and no event the vault
   * named through them. Two counts by the tokens alone.
   */
  public static async isVaultAndEventsClean(
    request: SecurityUserErasureRequest,
  ): Promise<boolean> {
    const projectId: ObjectID = request.projectId!;
    const tokens: Array<string> = readErasureRequestTokens(request);

    if (tokens.length === 0) {
      return true;
    }

    if (
      (await SecurityUserVaultService.countRowsOfTokens({
        projectId,
        tokens,
      })) > 0
    ) {
      return false;
    }

    return (
      (await SecurityUserErasureEvents.countNamedEvents({
        projectId,
        tokens,
      })) === 0
    );
  }

  /*
   * Whether a pass of the findings started now would be the final check:
   * nothing in the vault or the events has named the person for as long as
   * a detection that read them before could still be writing a finding.
   */
  public static canStartFinalPass(data: {
    progress: SecurityUserErasureProgress;
    isClean: boolean;
    now: Date;
  }): boolean {
    return (
      data.isClean &&
      Boolean(data.progress.cleanSince) &&
      timeOf(data.progress.cleanSince) + DETECTION_TURN_SETTLE_MS <=
        data.now.getTime()
    );
  }

  /*
   * The read of the project's findings, on from where it got to (#11160,
   * SecurityUserErasureProgress says how): this run's share of the pass it
   * is in, or the next pass once one can be the final check - and the
   * request completed when a final pass found nothing to change.
   */
  public static async continueFindings(data: {
    request: SecurityUserErasureRequest;
    names: ReadonlyArray<ErasedName>;
    progress: SecurityUserErasureProgress;
    counts: SecurityUserErasureCounts;
    isClean: boolean;
    now: Date;
    deadline: JobDeadline;
  }): Promise<void> {
    const request: SecurityUserErasureRequest = data.request;
    const progress: SecurityUserErasureProgress = data.progress;
    const cleanSince: string | null = data.isClean
      ? progress.cleanSince || data.now.toISOString()
      : null;
    const isCleanSinceNew: boolean = cleanSince !== progress.cleanSince;

    progress.cleanSince = cleanSince;

    const save: () => Promise<void> = async (): Promise<void> => {
      await SecurityUserErasureRequestService.markProgress({
        requestId: request.id!,
        progress,
        eventsUnnamed: Math.max(
          data.counts.eventsUnnamed,
          getEventsUnnamed(progress),
        ),
      });
    };

    // The names the request keeps, with each correlation's value the read finds.
    let kept: Array<ErasedName> = [...data.names];

    const complete: () => Promise<void> = async (): Promise<void> => {
      await save();
      await this.complete({
        request,
        names: kept,
        counts: {
          ...data.counts,
          eventsUnnamed: Math.max(
            data.counts.eventsUnnamed,
            getEventsUnnamed(progress),
          ),
        },
        deadline: data.deadline,
      });
    };

    // Nothing a finding could name the person by: done once ClickHouse is.
    if (data.names.length === 0) {
      if (data.isClean) {
        await complete();
      } else if (isCleanSinceNew) {
        await save();
      }

      return;
    }

    let pass: SecurityUserErasureFindingsPass | null = progress.findings;

    if (pass && pass.endedAt) {
      if (pass.isFinal && pass.changed === 0 && data.isClean) {
        await complete();

        return;
      }

      // The next pass waits until it can be the final check.
      if (!this.canStartFinalPass(data)) {
        if (isCleanSinceNew) {
          await save();
        }

        return;
      }

      pass = this.startPass({ number: pass.number + 1, ...data });
    } else if (!pass) {
      pass = this.startPass({ number: 1, ...data });
    }

    progress.findings = pass;

    const startedWith: { changed: number; unnamed: number } = {
      changed: pass.changed,
      unnamed: pass.unnamed,
    };
    const current: SecurityUserErasureFindingsPass = pass;

    const step: FindingsScanStep =
      await SecurityUserErasureFindings.scanFindings({
        projectId: request.projectId!,
        names: data.names,
        tokens: readErasureRequestTokens(request),
        after: current.after,
        deadline: data.deadline,
        onChangesFound: async (
          correlationValues: Array<ErasedName>,
        ): Promise<void> => {
          const more: Array<ErasedName> = distinctNames([
            ...kept,
            ...correlationValues,
          ]);

          if (more.length > kept.length) {
            kept = more;
            await SecurityUserErasureRequestService.markNames({
              requestId: request.id!,
              names: kept,
            });
          }
        },
        onProgress: async (scanned: FindingsScanProgress): Promise<void> => {
          // What else carries the fingerprint of a correlation's values the batch changed.
          if (scanned.correlationValues.length > 0) {
            await SecurityUserErasureRecords.rewriteFingerprints({
              projectId: request.projectId!,
              groupValues: scanned.correlationValues,
              deadline: data.deadline,
            });
          }

          current.after = scanned.after;
          current.changed = startedWith.changed + scanned.changed;
          current.unnamed = startedWith.unnamed + scanned.unnamed;

          await save();
        },
      });

    logger.info(
      `SecurityUserErasure: erasure request ${request.id!.toString()} read its project's Detection Findings (pass ${current.number}${current.isFinal ? ", the final check" : ""}) and queued a change for ${step.changed} of them${step.isAtEnd ? ", to the last one" : `; it stopped (${step.stoppedBy || "early"}) and a later run goes on from there`}.`,
    );

    if (!step.isAtEnd) {
      return;
    }

    current.endedAt = OneUptimeDate.getCurrentDate().toISOString();
    progress.unnamedFindings = Math.max(
      progress.unnamedFindings,
      current.unnamed,
    );

    if (current.isFinal && current.changed === 0 && data.isClean) {
      await complete();

      return;
    }

    await save();
  }

  // A new pass of the findings, from the first; the final check when it can be.
  private static startPass(data: {
    number: number;
    progress: SecurityUserErasureProgress;
    isClean: boolean;
    now: Date;
  }): SecurityUserErasureFindingsPass {
    return {
      number: data.number,
      startedAt: data.now.toISOString(),
      after: null,
      changed: 0,
      unnamed: 0,
      isFinal: this.canStartFinalPass(data),
      endedAt: null,
    };
  }

  /*
   * A run that failed: tried again later while attempts remain, else
   * Failed, with the project's owners told. Never throws.
   */
  private static async recordFailure(data: {
    request: SecurityUserErasureRequest;
    error: unknown;
  }): Promise<void> {
    const request: SecurityUserErasureRequest = data.request;
    const requestId: ObjectID = request.id!;
    const reason: string = getErrorMessage(data.error);
    const attempts: number = (request.attempts || 0) + 1;

    logger.error(
      `SecurityUserErasure: erasure request ${requestId.toString()} failed (attempt ${attempts} of ${MAX_ERASURE_ATTEMPTS}): ${reason}`,
    );

    try {
      if (attempts < MAX_ERASURE_ATTEMPTS) {
        await SecurityUserErasureRequestService.markAttemptFailed({
          requestId,
          // Claimed already when the run failed: its next run runs it again.
          status: SecurityUserErasureRequestStatus.InProgress,
          attempts,
          failureReason: reason,
        });

        return;
      }

      await SecurityUserErasureRequestService.markFailed({
        requestId,
        attempts,
        failureReason: reason,
      });
    } catch (error) {
      logger.error(
        `SecurityUserErasure: could not record the failure of erasure request ${requestId.toString()}.`,
      );
      logger.error(error);

      return;
    }

    // A legal obligation that could not be met reaches a person, not only a log line.
    try {
      await ProjectService.sendEmailToProjectOwners(
        request.projectId!,
        "A Security Events erasure request could not be completed",
        `An erasure request in Security Events (id ${requestId.toString()}) failed ${MAX_ERASURE_ATTEMPTS} times and has been marked as failed. Last error: ${reason}. ` +
          `The user vault still refuses the person's tokens, so it never names them again, but some of what named them may remain. Review it under Security Events > Settings > Erasure Requests, and file the request again to retry: erasure requests carry a compliance deadline.`,
      );
    } catch (error) {
      logger.error(
        `SecurityUserErasure: could not tell the Project Owners about failed erasure request ${requestId.toString()}: ${getErrorMessage(error)}`,
      );
    }
  }
}
