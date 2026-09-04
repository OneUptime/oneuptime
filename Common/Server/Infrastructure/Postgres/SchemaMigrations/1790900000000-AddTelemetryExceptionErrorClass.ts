import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The fault class becomes a first-class, always-populated column on the
 * exception group, instead of a nullable AI verdict.
 *
 * Both columns are NOT NULL DEFAULT on purpose, and that is the whole point of
 * this migration rather than an incidental choice. The Issues list scopes with
 * `IncludesNone(NON_ACTIONABLE_ERROR_CLASSES)`, which compiles to SQL
 * `"errorClass" NOT IN ('user-error', 'expected-denial')`. In SQL,
 * `NULL NOT IN (...)` evaluates to NULL — falsy, not true — so with a nullable
 * column every unclassified row would fail that predicate and vanish from the
 * "show me the real failures" view. That is the exact inverse of the intended
 * fail-safe. With NOT NULL DEFAULT 'unknown', a row nobody classified carries
 * a value that is not in the suppressed set, so it is an Issue by
 * construction, and the ADD COLUMN backfills every existing row in one pass.
 *
 * aiClassification is left in place: it is the same vocabulary under its older
 * name (see Types/Telemetry/ErrorClass) and is still what the triage runner
 * writes, so dropping it here would break that writer. It is copied across
 * below and can be retired once every writer has moved to errorClass.
 */
export class AddTelemetryExceptionErrorClass1790900000000
  implements MigrationInterface
{
  public name: string = "AddTelemetryExceptionErrorClass1790900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "errorClass" character varying(100) NOT NULL DEFAULT 'unknown'`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "errorClassSource" character varying(100) NOT NULL DEFAULT 'default'`,
    );

    /*
     * Carry the existing AI verdicts over. Same five string values, so this is
     * a rename rather than a translation.
     *
     * Deliberately not filtered to the known enum members: a value this does
     * not recognise still fails the `NOT IN ('user-error', 'expected-denial')`
     * scope and therefore stays visible, which is the safe direction. Silently
     * dropping it to 'unknown' would lose information for no gain.
     */
    await queryRunner.query(`
      UPDATE "TelemetryException"
      SET "errorClass" = "aiClassification", "errorClassSource" = 'ai'
      WHERE "aiClassification" IS NOT NULL
    `);

    /*
     * Reconstruct what the emitting code would have declared, for groups the
     * AI never looked at, so the Issues list is quiet on day one instead of
     * only for exceptions raised after this deploy.
     *
     * Every class listed here overrides getErrorClass to UserError or
     * ExpectedDenial. Both collapse to 'user-error' here: the two are
     * interchangeable for the only thing this backfill drives (they are the
     * two members of NON_ACTIONABLE_ERROR_CLASSES), and guessing the finer
     * split from a type name alone would be inventing precision the data does
     * not have. Live traffic re-stamps the precise class on the next
     * occurrence.
     *
     * Spelling matters here and is easy to get wrong: exceptionType comes from
     * the constructor name, so it is 'SSOAuthorizationException' (the file is
     * SsoAuthorizationException.ts) and 'UnableToReachServer' (no trailing
     * Exception). MasterPasswordRequiredException carries no override of its
     * own — it inherits ExpectedDenial from NotAuthenticatedException — so it
     * has to be listed explicitly.
     *
     * The bare numeric values are the same exceptions seen through an older
     * emit path (and through third-party SDKs), which reported the numeric
     * status as exception.type rather than the class name. 408 and 415 are
     * deliberately ABSENT: they are TimeoutException and UnableToReachServer,
     * which are Infrastructure — real failures that must keep showing up as
     * Issues. 500 and 503 are absent for the same reason.
     *
     * Guarded on "aiClassification" IS NULL so it cannot overwrite an AI
     * verdict. Type name is a class-level GENERALISATION ("BadDataException
     * usually means the caller sent something wrong"), whereas the AI looked
     * at this specific group; and the only disagreement that matters is one
     * where the AI said code-fault and this would flip it to user-error, i.e.
     * hide a real failure. Deferring keeps the failure mode as
     * over-reporting.
     */
    await queryRunner.query(`
      UPDATE "TelemetryException"
      SET "errorClass" = 'user-error', "errorClassSource" = 'declared'
      WHERE "aiClassification" IS NULL
        AND (
          "exceptionType" IN (
            'BadDataException',
            'BadRequestException',
            'NotFoundException',
            'PayloadTooLargeException',
            'TenantNotFoundException',
            'ForbiddenException',
            'NotAuthenticatedException',
            'NotAuthorizedException',
            'PaymentRequiredException',
            'SSOAuthorizationException',
            'MasterPasswordRequiredException',
            'TooManyRequestsException'
          )
          OR "exceptionType" IN (
            '400', '401', '402', '403', '404', '405', '406', '413', '422', '429'
          )
        )
    `);
  }

  /*
   * Nothing to un-backfill: both columns go away, and aiClassification — the
   * only source the backfill read — was never modified.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "errorClassSource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "errorClass"`,
    );
  }
}
