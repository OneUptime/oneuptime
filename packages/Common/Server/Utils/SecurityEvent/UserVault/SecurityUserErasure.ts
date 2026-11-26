import SecurityUserErasureRequest from "../../../../Models/DatabaseModels/SecurityUserErasureRequest";
import ProjectService from "../../../Services/ProjectService";
import SecurityUserErasureRequestService, {
  SecurityUserErasureCounts,
  readErasureRequestNames,
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
import JobDeadline from "../../JobDeadline";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ScrubHashToken from "../../Telemetry/ScrubHashToken";
import { ERASED_TOKENS_CACHE_TTL_MS } from "./SecurityUserErasedTokens";
import SecurityUserErasureEvents, {
  SecurityUserErasurePair,
} from "./SecurityUserErasureEvents";
import SecurityUserErasureFindings, {
  FindingsScanResult,
} from "./SecurityUserErasureFindings";
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
 *   InProgress. Claimed (one worker does it), then:
 *     1. who the vault named: what the requester typed, the vault's own
 *        rows of the tokens, the users the events it named hold - the
 *        names Security Events may have copied onward - and the names an
 *        earlier run kept on the request;
 *     2. Postgres: the person taken out of detections, cases, entity risk
 *        and proposals (SecurityUserErasureRecords). Synchronous, and the
 *        counts kept at once, so a run that fails later loses none. The
 *        names are kept on the request with them, encrypted
 *        (namesToErase): the vault's rows and the events that hold them go
 *        with this run, and later runs and the check need them (#11044);
 *     3. ClickHouse: the Detection Findings a rule wrote about the person
 *        read and the names taken out of them (SecurityUserErasureFindings:
 *        they carry no token to be found by); the events the vault named
 *        counted and the token put back in them (SecurityUserErasureEvents);
 *        the vault's rows of the tokens counted and deleted. Queued
 *        mutations, durable from then on.
 *
 *   Completed, once a later run checks that ClickHouse applied them: no
 *     row of the tokens is left in the vault, no event still names the
 *     person through them, and none of the project's own Detection Findings
 *     names them. Postgres is gone through once more first, for a detection
 *     a rule wrote from the events before they lost the name. What the
 *     requester typed, and the names, are wiped. A request still not done
 *     RESUBMIT_AFTER_MS after its last run is run again: every step finds
 *     only what still names the person.
 *
 *   Failed, after MAX_ERASURE_ATTEMPTS failed runs, spaced out
 *     (RETRY_BACKOFF_MS more each time): the project's owners are emailed,
 *     because a right-to-erasure obligation must not die on a log line.
 *     What the requester typed is wiped; the tokens are still refused.
 *
 * Every ClickHouse statement names tokens, never the person
 * (SecurityUserVaultService says why): the findings are matched to the
 * names here, in the worker, and changed by their ids.
 *
 * A run that runs out of the cron job's time (its deadline) stops where it
 * is, with nothing counted against the request: one not started yet waits
 * for the next run, and one started is run again as any request still not
 * done is (RESUBMIT_AFTER_MS). Every step finds only what still names the
 * person, so nothing is done twice.
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

// What one run of a request found and changed.
export interface SecurityUserErasureRunResult {
  names: Array<ErasedName>;
  counts: SecurityUserErasureCounts;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function timeOf(value: Date | string | undefined): number {
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

        await this.runErasure(request, deadline);

        return;
      }

      if (request.status !== SecurityUserErasureRequestStatus.InProgress) {
        return;
      }

      // Its last run failed, and its backoff is over: run it again.
      if (this.didLastRunFail(request)) {
        await this.runErasure(request, deadline);

        return;
      }

      if (await this.isErased(request, deadline)) {
        await this.complete(request);

        return;
      }

      // Not applied yet: told again once it has had long enough.
      if (timeOf(request.updatedAt) + RESUBMIT_AFTER_MS <= data.now.getTime()) {
        await this.runErasure(request, deadline);
      }
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
   * after, as no event names the person once the check passes - then the
   * request marked Completed, with what was typed and the names wiped.
   */
  private static async complete(
    request: SecurityUserErasureRequest,
  ): Promise<void> {
    const records: SecurityUserErasureRecordCounts =
      await SecurityUserErasureRecords.unnameRecords({
        projectId: request.projectId!,
        names: this.getKeptNames(request),
      });

    await SecurityUserErasureRequestService.markCompleted({
      requestId: request.id!,
      counts: {
        vaultEntriesDeleted: request.vaultEntriesDeleted || 0,
        eventsUnnamed: request.eventsUnnamed || 0,
        casesUnnamed: (request.casesUnnamed || 0) + records.cases,
        proposalsWithdrawn:
          (request.proposalsWithdrawn || 0) + records.proposals,
      },
    });

    logger.info(
      `SecurityUserErasure: erasure request ${request.id!.toString()} is complete.`,
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
   * One run of the erasure itself: Postgres, then ClickHouse, the counts
   * kept as each part is done. The request stays InProgress; a later run
   * checks it is done.
   */
  @CaptureSpan()
  public static async runErasure(
    request: SecurityUserErasureRequest,
    deadline: JobDeadline = JobDeadline.none(),
  ): Promise<SecurityUserErasureRunResult> {
    const requestId: ObjectID = request.id!;
    const projectId: ObjectID = request.projectId!;
    const tokens: Array<string> = readErasureRequestTokens(request);

    const names: Array<ErasedName> = await this.findNames({
      projectId,
      tokens,
      userToErase: request.userToErase,
      keptNames: readErasureRequestNames(request),
    });

    const records: SecurityUserErasureRecordCounts =
      await SecurityUserErasureRecords.unnameRecords({ projectId, names });

    // Kept at once: Postgres is done, and a retry would find nothing left to count.
    const counts: SecurityUserErasureCounts = {
      vaultEntriesDeleted: request.vaultEntriesDeleted || 0,
      eventsUnnamed: request.eventsUnnamed || 0,
      casesUnnamed: (request.casesUnnamed || 0) + records.cases,
      proposalsWithdrawn: (request.proposalsWithdrawn || 0) + records.proposals,
    };

    /*
     * The names are kept with the counts before anything in ClickHouse
     * changes: once the vault's rows and the events have, nothing else
     * says who the findings name.
     */
    await SecurityUserErasureRequestService.markInProgress({
      requestId,
      counts,
      names,
    });

    /*
     * The findings first, by the names: a rule's Detection Findings about
     * the person carry no token. Counted with the events, below.
     */
    const findings: FindingsScanResult =
      await SecurityUserErasureFindings.findNamingFindings({
        projectId,
        names,
        deadline,
      });
    const findingsChanged: number =
      await SecurityUserErasureFindings.unnameFindings({
        projectId,
        rewrites: findings.rewrites,
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

    counts.eventsUnnamed = Math.max(
      counts.eventsUnnamed,
      events + findingsChanged,
    );
    counts.vaultEntriesDeleted = Math.max(
      counts.vaultEntriesDeleted,
      vaultRows,
    );

    await SecurityUserErasureRequestService.markInProgress({
      requestId,
      counts,
    });

    logger.info(
      `SecurityUserErasure: erasure request ${requestId.toString()} took the person out of ${records.cases} case(s) and ${records.proposals} proposal(s), and queued the token back into ${events} event(s) and ${findingsChanged} Detection Finding(s)${findings.isCapped ? " (a later run takes the rest)" : ""}, and the delete of ${vaultRows} vault row(s).`,
    );

    return { names, counts };
  }

  /*
   * Whether nothing the request reaches in ClickHouse names the person any
   * more: no vault row of its tokens, at any age, no event the vault named
   * through them, and none of the project's own Detection Findings naming
   * one of the request's names (#11044). The cheap checks first: a request
   * still waiting on ClickHouse reads no findings.
   */
  public static async isErased(
    request: SecurityUserErasureRequest,
    deadline: JobDeadline = JobDeadline.none(),
  ): Promise<boolean> {
    const projectId: ObjectID = request.projectId!;
    const tokens: Array<string> = readErasureRequestTokens(request);

    if (tokens.length === 0) {
      return true;
    }

    const vaultRows: number = await SecurityUserVaultService.countRowsOfTokens({
      projectId,
      tokens,
    });

    if (vaultRows > 0) {
      return false;
    }

    if (
      (await SecurityUserErasureEvents.countNamedEvents({
        projectId,
        tokens,
      })) > 0
    ) {
      return false;
    }

    const names: Array<ErasedName> = this.getKeptNames(request);

    return (
      names.length === 0 ||
      !(await SecurityUserErasureFindings.isAnyFindingNaming({
        projectId,
        names,
        deadline,
      }))
    );
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
