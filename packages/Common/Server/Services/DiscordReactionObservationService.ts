import Model from "../../Models/DatabaseModels/DiscordReactionObservation";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import logger from "../Utils/Logger";
import { Repository, UpdateResult } from "typeorm";

/*
 * Durable dedupe for processed Discord note reactions and pins. Redis claims
 * are fast but volatile; this table is the record that survives a cache
 * flush, a restart, and a note deliberately deleted in OneUptime.
 *
 * Semantics (HOM-43 review 3): claim() takes the claim in ONE conditional
 * write and returns a generation token (observedAt); markDone()/release()
 * only act on the claim whose token the caller holds, so a worker can never
 * terminate a claim that was stolen from it. A crash between claim and
 * markDone leaves an explicit ambiguous state, not a silent success. A read
 * or write failure here PROPAGATES — a failed dedupe layer must never be
 * laundered into "already processed".
 */

/*
 * The generation token is date_trunc('milliseconds', now()): database time,
 * millisecond precision. Milliseconds matter — the token round-trips through
 * a JS Date (millisecond precision) into markDone()/release() equality
 * checks, and a microsecond-precision now() would truncate on that round
 * trip and make nearly every owner's markDone look like a lost claim. All
 * staleness comparisons are now()-to-now() inside the database, so no clock
 * drift allowance is needed.
 */

export type ObservationClaimResult = "Claimed" | "AlreadyObserved";

/*
 * A successful claim returns the row's generation token (its observedAt at
 * claim time). markDone/release accept it back and match it in their WHERE
 * clause, so a worker can only terminate a claim it still owns: a stale
 * worker's late markDone must not flip a row a fresh worker has re-claimed.
 * The token is absent only when the claim was NOT won.
 */
export type ObservationClaim =
  | { result: "Claimed"; observedAt: Date }
  | { result: "AlreadyObserved" };

/*
 * A Pending row older than this is a worker that died between claim and
 * markDone. It is stolen and reprocessed: note saves are idempotent
 * (source-message key), and by steal time NOTICE-fresh messages have aged
 * out, so user replies do not refire. This is at-least-once, not exactly
 * once — by design.
 */
export const OBSERVATION_STALE_AFTER_MS: number = 15 * 60 * 1000;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    /*
     * Observations only need to outlive the claim TTL and the polling
     * window; 30 days is generous and keeps the table small.
     */
    this.hardDeleteItemsOlderThanInDays("createdAt", 30);
  }

  /*
   * Claims the claim key durably, in ONE conditional write. "Claimed" means
   * this caller owns the reaction until markDone/release, and returns the
   * claim's generation token (observedAt) that those methods require.
   * "AlreadyObserved" means a DONE row stands, or a fresh PENDING row is
   * being processed by another worker right now. Throws on database failure
   * so callers can fail open and retry later.
   *
   * The previous read-then-updateBy shape was not atomic (HOM-43 review 3):
   * two workers that both read an old Pending row both "stole" it, and the
   * reclaim did not compare the timestamp it had read, so a stale worker
   * could terminate a claim a fresh worker had just taken. Every state
   * transition below is a single conditional UPDATE whose WHERE clause
   * carries the full predicate, exactly one of which can win.
   */
  public async claim(data: {
    projectId: ObjectID;
    claimKey: string;
    source: "reaction" | "pin";
  }): Promise<ObservationClaim> {
    const repository: Repository<Model> = this.getRepository();

    /*
     * Try to take or steal the claim in one write. The WHERE clause is the
     * whole race decision:
     *   - no row: INSERT ... ON CONFLICT DO NOTHING below instead;
     *   - row is Pending and NOT stale: another worker owns it — 0 rows;
     *   - row is Pending and stale: exactly one of N racing workers matches.
     */
    const steal: UpdateResult = await repository
      .createQueryBuilder()
      .update()
      .set({
        observationState: "Pending",
        observedAt: () => `date_trunc('milliseconds', now())`,
      })
      .where(
        `"projectId" = :projectId AND "claimKey" = :claimKey AND "observationState" = 'Pending' AND ("observedAt" IS NULL OR "observedAt" < date_trunc('milliseconds', now()) - (:staleSeconds * interval '1 second'))`,
        {
          projectId: data.projectId.toString(),
          claimKey: data.claimKey,
          staleSeconds: Math.ceil(OBSERVATION_STALE_AFTER_MS / 1000),
        },
      )
      .returning(["observedAt"])
      .updateEntity(false)
      .execute();

    const stolenToken: unknown = (steal as any).raw?.[0]?.["observedAt"];

    if (steal.affected && steal.affected > 0) {
      if (!stolenToken) {
        // We hold the claim but could not read our own token back: loud, not
        // laundered into AlreadyObserved while owning a Pending row.
        throw new Error(
          "DiscordReactionObservation claim won but returned no observedAt token",
        );
      }

      return {
        result: "Claimed",
        /*
         * pg parses timestamptz RETURNING values into JS Dates natively.
         * String()-round-tripping a Date re-parses "Sat Sep 26 2026 …"
         * and DROPS milliseconds — silently corrupting the token. Only
         * build a Date when the driver did not.
         */
        observedAt:
          stolenToken instanceof Date
            ? stolenToken
            : new Date(String(stolenToken)),
      };
    }

    const existing: Model | null = await repository
      .createQueryBuilder()
      .where(
        `"projectId" = :projectId AND "claimKey" = :claimKey AND "observationState" = 'Pending'`,
        {
          projectId: data.projectId.toString(),
          claimKey: data.claimKey,
        },
      )
      .getOne();

    if (!existing) {
      /*
       * Steal matched nothing and no row exists: fresh claim. ON CONFLICT DO
       * NOTHING — a racing inserter that wins leaves RETURNING empty, which
       * means this caller lost and must not process the reaction. Values
       * are serialized to strings here because InsertQueryBuilder does not
       * apply column transformers.
       */
      try {
        const inserted: UpdateResult = await repository
          .createQueryBuilder()
          .insert()
          .into(Model)
          .values({
            _id: ObjectID.generate().toString() as any,
            projectId: data.projectId.toString() as any,
            claimKey: data.claimKey,
            source: data.source,
            observationState: "Pending",
            observedAt: () => `date_trunc('milliseconds', now())`,
          } as any)
          .orIgnore()
          .returning(["observedAt"])
          .execute();

        const raw: unknown = (inserted as any).raw?.[0];

        if (!raw || !(raw as any)["observedAt"]) {
          // A concurrent inserter owns this claim.
          return { result: "AlreadyObserved" };
        }

        return {
          result: "Claimed",
          // pg already parses the RETURNING value into a Date; keep it.
          observedAt:
            (raw as any)["observedAt"] instanceof Date
              ? (raw as any)["observedAt"]
              : new Date(String((raw as any)["observedAt"])),
        };
      } catch (err) {
        if (PostgresErrorTranslator.isUniqueViolation(err)) {
          return { result: "AlreadyObserved" };
        }
        throw err;
      }
    }

    if (existing.observationState !== "Pending") {
      return { result: "AlreadyObserved" };
    }

    return { result: "AlreadyObserved" };
  }

  /*
   * Terminal record, scoped to the claim the caller owns. Requires the
   * observedAt token returned by claim(): the WHERE clause matches it
   * exactly, so a worker whose claim was stolen (its token no longer
   * matches) does not flip the row the current owner holds, and an
   * omitted/invalid token is refused rather than treated as a wildcard
   * (HOM-43 review 4). Returns false when this caller no longer owns the
   * claim. Idempotent: a row already Done by THIS caller's token still
   * reports success; a row done by a different token does not.
   */
  public async markDone(data: {
    projectId: ObjectID;
    claimKey: string;
    observedAt: Date;
  }): Promise<boolean> {
    if (!(data.observedAt instanceof Date)) {
      // Fail closed: no token, no terminal write. Never a wildcard.
      return false;
    }

    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update()
      .set({ observationState: "Done" })
      .where(
        `"projectId" = :projectId AND "claimKey" = :claimKey AND "observationState" = 'Pending' AND "observedAt" = :observedAt`,
        {
          projectId: data.projectId.toString(),
          claimKey: data.claimKey,
          observedAt: data.observedAt.toISOString(),
        },
      )
      .updateEntity(false)
      .execute();

    if (result.affected) {
      return true;
    }

    /*
     * Token-matched Done fallback: the only idempotent success left is a
     * row this same token already terminated. A row done by a DIFFERENT
     * token (the claim was stolen and completed) must report false — the
     * previous owner must not ride someone else's completion.
     */
    const existing: Model | null = await this.getRepository().findOne({
      where: {
        projectId: data.projectId as any,
        claimKey: data.claimKey,
        observationState: "Done",
        observedAt: data.observedAt,
      } as any,
      select: { _id: true, observationState: true } as any,
    });

    return existing?.observationState === "Done";
  }

  /*
   * Rollback for a claim whose side effects FAILED before running (thrown
   * before any save/reply). The reaction is retried on a later run. Never
   * called after a successful save — that ambiguity is what Pending + steal
   * is for. Scoped to the caller's claim by the observedAt token, like
   * markDone; a missing or mismatched token deletes nothing.
   */
  public async release(data: {
    projectId: ObjectID;
    claimKey: string;
    observedAt: Date;
  }): Promise<void> {
    if (!(data.observedAt instanceof Date)) {
      // Fail closed: no token, no delete. Never a wildcard.
      return;
    }

    try {
      await this.getRepository()
        .createQueryBuilder()
        .delete()
        .where(
          `"projectId" = :projectId AND "claimKey" = :claimKey AND "observationState" = 'Pending' AND "observedAt" = :observedAt`,
          {
            projectId: data.projectId.toString(),
            claimKey: data.claimKey,
            observedAt: data.observedAt.toISOString(),
          },
        )
        .execute();
    } catch (err) {
      /*
       * Best effort: a leftover Pending row is stolen after the stale
       * threshold anyway.
       */
      logger.warn("Could not release Discord reaction observation claim");
      logger.warn(err);
    }
  }
}

export default new Service();
