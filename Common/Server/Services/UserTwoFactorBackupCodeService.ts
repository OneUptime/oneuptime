import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/UserTwoFactorBackupCode";
import TwoFactorBackupCode, {
  BackupCodeSetSize,
} from "../Utils/TwoFactorBackupCode";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import BadDataException from "../../Types/Exception/BadDataException";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

/**
 * How many of a user's backup codes are left, for the profile page and the
 * admin's account view.
 *
 * `total` and `unused` are both reported rather than just the remaining count
 * because they answer different questions: "have you set backup codes up at
 * all" and "how many can you still use". A user with ten codes and a user who
 * has spent all ten both have a `total` of ten, and only the second needs to
 * be told to regenerate.
 */
export interface TwoFactorBackupCodeStatus {
  total: number;
  unused: number;

  /*
   * When the current set was minted, or null if there are none. Read off the
   * newest row rather than stored separately -- regeneration replaces the
   * whole set in one call, so every row in a set shares a creation time to
   * within a few milliseconds.
   */
  generatedAt: Date | null;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The model denies create to everyone, so the only way a row is written is
   * `regenerateForUser` below, as root. This hook is the second lock on the
   * same door: it refuses any create that did not come through there.
   *
   * Worth having both because the two guards fail differently. The table
   * permission is enforced by the CRUD API layer and is bypassed wholesale by
   * `isRoot`, which every internal caller uses -- so a future service that
   * reaches for `UserTwoFactorBackupCodeService.create()` with a plaintext
   * code, or with no owner, would sail past it. What lands in `codeHash` is
   * the credential; there is no recovering from writing the wrong thing there.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.userId) {
      throw new BadDataException("User id is required");
    }

    if (!createBy.data.codeHash) {
      throw new BadDataException("Backup code hash is required");
    }

    /*
     * A code that arrives already spent is a caller confusing itself about
     * which end of the lifecycle it is at. Codes are minted usable and are
     * spent only by `consumeCode`.
     *
     * Deleted rather than set to undefined: `exactOptionalPropertyTypes` is on,
     * so the property being ABSENT and the property holding `undefined` are
     * different things to the compiler, and only the first is allowed here.
     */
    delete createBy.data.usedAt;

    return {
      createBy: createBy,
      carryForward: {},
    };
  }

  /**
   * Mint a fresh set of backup codes for one user, replacing whatever they
   * had, and return the PLAINTEXT codes.
   *
   * This is the only moment the plaintext exists anywhere. The caller shows it
   * to the user once and then it is gone -- only the keyed digests are stored,
   * so nothing (not this service, not a master admin, not a database dump) can
   * produce the codes again. That is the property the feature is worth having
   * for, and it is why the API route wraps this in a response the UI is
   * expected to make the user acknowledge.
   *
   * REPLACING rather than adding is deliberate. "Generate more codes" would
   * leave the codes from a list the user printed, lost and then regenerated
   * over still working, which defeats the point of regenerating after a
   * suspected compromise.
   *
   * ALL OR NOTHING, and this is the part that needs care. The old set is
   * deleted first, then the new rows are written one at a time -- so a failure
   * partway through the loop would otherwise leave the account holding a few
   * rows that WERE written and that the caller, having thrown, never showed to
   * anybody. `getStatusForUser` would then report "4 backup codes" to a user
   * who has never seen one of them: codes that are unusable in practice and
   * that hide the fact that they have no recovery route left. That is the
   * worst state this feature can produce, because it looks exactly like the
   * good one.
   *
   * So a failure is compensated: everything written for this user is removed,
   * and the account ends with NO codes and an error on screen. "You have no
   * backup codes" is a state the profile page already tells the user to fix;
   * "you have four codes you have never seen" is not.
   *
   * The compensating delete is itself best-effort -- if it also fails there is
   * nothing further to try -- but it turns a silent, permanent trap into two
   * consecutive infrastructure failures.
   */
  @CaptureSpan()
  public async regenerateForUser(data: {
    userId: ObjectID;
    count?: number | undefined;
  }): Promise<Array<string>> {
    const count: number = data.count || BackupCodeSetSize;

    await this.deleteAllForUser({ userId: data.userId });

    const codes: Array<string> = TwoFactorBackupCode.generateCodeSet(count);

    try {
      for (const code of codes) {
        const backupCode: Model = new Model();
        backupCode.userId = data.userId;
        backupCode.codeHash = TwoFactorBackupCode.hashCode({
          code: code,
          userId: data.userId,
        });

        await this.create({
          data: backupCode,
          props: {
            isRoot: true,
          },
        });
      }
    } catch (err) {
      try {
        await this.deleteAllForUser({ userId: data.userId });
      } catch (cleanupError) {
        /*
         * Swallowed so the ORIGINAL failure is what the caller sees. The
         * cleanup error is the less useful of the two -- it explains why the
         * rollback did not happen, not why the write did not.
         */
        logger.error(cleanupError);
      }

      throw err;
    }

    return codes;
  }

  /**
   * Spend one of this user's backup codes, if the submitted code is one of
   * them and has not been used already.
   *
   * ONE STATEMENT, ON PURPOSE
   *
   * The obvious shape -- find the row, check `usedAt`, then update it -- has a
   * window between the read and the write, and "single use" is the entire
   * guarantee a backup code offers. Two sign-in attempts carrying the same
   * code that arrive together would both read a null `usedAt` and both be let
   * in, which is precisely the property an attacker who has watched somebody
   * type a code off a printed list would exploit.
   *
   * `usedAt IS NULL` in the WHERE clause moves the decision inside Postgres,
   * where the row lock settles it: the first statement to reach the row
   * updates it, the second matches nothing. `RETURNING "_id"` is what turns
   * that into an answer for the caller -- an UPDATE that matched no rows and
   * an UPDATE that matched one are otherwise indistinguishable from here.
   *
   * Written as raw parameterized SQL rather than through the ORM because no
   * write path on DatabaseService both takes a non-primary-key predicate and
   * reports what it matched. Column and table names are literals in this file,
   * never caller input, and all three values are bound parameters.
   *
   * `deletedAt IS NULL` is included because soft-deleted rows are still
   * physically present; without it, a code from a set that regeneration
   * replaced would still sign somebody in.
   *
   * @returns true when a code was spent, false when the code was wrong,
   *          already used, or belongs to somebody else.
   */
  @CaptureSpan()
  public async consumeCode(data: {
    userId: ObjectID;
    code: string;
  }): Promise<boolean> {
    const normalizedCode: string = TwoFactorBackupCode.normalizeCode(data.code);

    /*
     * Refused before the query rather than hashed and looked up. An empty
     * submission cannot be anybody's code, and letting it through would mean
     * one round trip per empty request on a route an attacker can call.
     */
    if (!normalizedCode) {
      return false;
    }

    const codeHash: string = TwoFactorBackupCode.hashCode({
      code: normalizedCode,
      userId: data.userId,
    });

    const rows: Array<{ _id: string }> = await this.getRepository()
      .manager.query(
        `UPDATE "UserTwoFactorBackupCode"
            SET "usedAt" = $1, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "userId" = $2
            AND "codeHash" = $3
            AND "usedAt" IS NULL
            AND "deletedAt" IS NULL
      RETURNING "_id"`,
        [OneUptimeDate.getCurrentDate(), data.userId.toString(), codeHash],
      )
      /*
       * For an UPDATE the postgres driver hands back `[rows, rowCount]` rather
       * than a bare row array, so the rows have to be unwrapped. Written
       * defensively: a driver that returns the bare array instead must read as
       * "no code was spent", never as a silent success.
       */
      .then((result: unknown): Array<{ _id: string }> => {
        if (!Array.isArray(result)) {
          return [];
        }

        const first: unknown = result[0];

        return Array.isArray(first) ? (first as Array<{ _id: string }>) : [];
      });

    return rows.length > 0;
  }

  /**
   * How many codes this user has, and how many are still spendable.
   *
   * Counted rather than fetched: the rows carry a credential digest and there
   * is no caller that needs them, so nothing is loaded that a stray log line
   * could then print.
   */
  @CaptureSpan()
  public async getStatusForUser(data: {
    userId: ObjectID;
  }): Promise<TwoFactorBackupCodeStatus> {
    const total: PositiveNumber = await this.countBy({
      query: {
        userId: data.userId,
      },
      props: {
        isRoot: true,
      },
    });

    if (total.toNumber() === 0) {
      return {
        total: 0,
        unused: 0,
        generatedAt: null,
      };
    }

    const unused: number = await this.countUnusedForUser({
      userId: data.userId,
    });

    const newest: Model | null = await this.findOneBy({
      query: {
        userId: data.userId,
      },
      select: {
        createdAt: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });

    return {
      total: total.toNumber(),
      unused: unused,
      generatedAt: newest?.createdAt || null,
    };
  }

  /**
   * How many unused codes this user has left.
   *
   * Split out from `getStatusForUser` because the login path needs exactly
   * this number and nothing else: it decides whether the two factor challenge
   * screen offers "use a backup code" at all, and it is answered on every
   * two-factor sign-in.
   *
   * `usedAt: QueryHelper.isNull()` rather than `usedAt: null`. A bare null
   * predicate is dropped by TypeORM rather than compiled to `IS NULL`, so the
   * count would silently include spent codes and the login page would offer a
   * recovery route to a user with nothing left to recover with.
   */
  @CaptureSpan()
  public async countUnusedForUser(data: { userId: ObjectID }): Promise<number> {
    const unused: PositiveNumber = await this.countBy({
      query: {
        userId: data.userId,
        usedAt: QueryHelper.isNull(),
      },
      props: {
        isRoot: true,
      },
    });

    return unused.toNumber();
  }

  /**
   * Drop every backup code this user has.
   *
   * Called by regeneration, and by UserService.resetTwoFactorAuth -- an
   * operator resetting two factor auth for somebody who lost a device must
   * take the recovery codes with it. Leaving them behind would mean the reset
   * did not actually revoke the account's second-factor material, which is the
   * one thing the operator pressed the button to do.
   */
  @CaptureSpan()
  public async deleteAllForUser(data: { userId: ObjectID }): Promise<void> {
    await this.deleteBy({
      query: {
        userId: data.userId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
