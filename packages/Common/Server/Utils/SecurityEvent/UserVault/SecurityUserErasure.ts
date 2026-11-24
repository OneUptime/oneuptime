import SecurityUserErasureRequest from "../../../../Models/DatabaseModels/SecurityUserErasureRequest";
import ProjectService from "../../../Services/ProjectService";
import SecurityUserErasureRequestService, {
  SecurityUserErasureCounts,
  getErasureTokens,
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
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { ERASED_TOKENS_CACHE_TTL_MS } from "./SecurityUserErasedTokens";
import SecurityUserErasureEvents, {
  SecurityUserErasurePair,
} from "./SecurityUserErasureEvents";
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
 *        rows of the tokens, and the users the events it named hold - the
 *        names Security Events may have copied onward;
 *     2. Postgres: the person taken out of detections, cases, entity risk
 *        and proposals (SecurityUserErasureRecords). Synchronous, and the
 *        counts kept at once, so a run that fails later loses none;
 *     3. ClickHouse: the events the vault named counted and the token put
 *        back in them (SecurityUserErasureEvents), the vault's rows of the
 *        tokens counted and deleted. Queued mutations, durable from then on.
 *
 *   Completed, once a later run checks that ClickHouse applied them: no
 *     row of the tokens is left in the vault, and no event still names the
 *     person through them. What the requester typed is wiped. A request
 *     still not done RESUBMIT_AFTER_MS after its last run is run again:
 *     every step finds only what still names the person.
 *
 *   Failed, after MAX_ERASURE_ATTEMPTS failed runs, spaced out
 *     (RETRY_BACKOFF_MS more each time): the project's owners are emailed,
 *     because a right-to-erasure obligation must not die on a log line.
 *     What the requester typed is wiped; the tokens are still refused.
 *
 * Every ClickHouse statement names tokens, never the person
 * (SecurityUserVaultService says why).
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
  ): Promise<void> {
    const requests: Array<SecurityUserErasureRequest> =
      await SecurityUserErasureRequestService.getOpenRequests({
        limit: MAX_ERASURE_REQUESTS_PER_RUN,
      });

    for (const request of requests) {
      await this.processRequest({ request, now });
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
  }): Promise<void> {
    const request: SecurityUserErasureRequest = data.request;

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

        await this.runErasure(request);

        return;
      }

      if (request.status !== SecurityUserErasureRequestStatus.InProgress) {
        return;
      }

      // Its last run failed, and its backoff is over: run it again.
      if (this.didLastRunFail(request)) {
        await this.runErasure(request);

        return;
      }

      if (await this.isErased(request)) {
        await SecurityUserErasureRequestService.markCompleted({
          requestId: request.id,
          counts: {
            vaultEntriesDeleted: request.vaultEntriesDeleted || 0,
            eventsUnnamed: request.eventsUnnamed || 0,
            casesUnnamed: request.casesUnnamed || 0,
            proposalsWithdrawn: request.proposalsWithdrawn || 0,
          },
        });

        logger.info(
          `SecurityUserErasure: erasure request ${request.id.toString()} is complete.`,
        );

        return;
      }

      // Not applied yet: told again once it has had long enough.
      if (timeOf(request.updatedAt) + RESUBMIT_AFTER_MS <= data.now.getTime()) {
        await this.runErasure(request);
      }
    } catch (error) {
      await this.recordFailure({ request, error });
    }
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
  }): Promise<Array<ErasedName>> {
    const names: Array<ErasedName> = [];

    for (const spelling of getErasureSpellings(data.userToErase || "")) {
      for (const token of getErasureTokens({
        projectId: data.projectId,
        user: spelling,
      })) {
        names.push({ named: spelling, hashed: token });
      }
    }

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
  ): Promise<SecurityUserErasureRunResult> {
    const requestId: ObjectID = request.id!;
    const projectId: ObjectID = request.projectId!;
    const tokens: Array<string> = readErasureRequestTokens(request);

    const names: Array<ErasedName> = await this.findNames({
      projectId,
      tokens,
      userToErase: request.userToErase,
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

    counts.eventsUnnamed = Math.max(counts.eventsUnnamed, events);
    counts.vaultEntriesDeleted = Math.max(
      counts.vaultEntriesDeleted,
      vaultRows,
    );

    await SecurityUserErasureRequestService.markInProgress({
      requestId,
      counts,
    });

    logger.info(
      `SecurityUserErasure: erasure request ${requestId.toString()} took the person out of ${records.cases} case(s) and ${records.proposals} proposal(s), and queued the token back into ${events} event(s) and the delete of ${vaultRows} vault row(s).`,
    );

    return { names, counts };
  }

  /*
   * Whether nothing the request reaches in ClickHouse names the person any
   * more: no vault row of its tokens, at any age, and no event the vault
   * named through them.
   */
  public static async isErased(
    request: SecurityUserErasureRequest,
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

    return (
      (await SecurityUserErasureEvents.countNamedEvents({
        projectId,
        tokens,
      })) === 0
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
