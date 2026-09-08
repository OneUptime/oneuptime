import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Registering a security key and signing in with one each need a challenge,
 * and they used to write the same pair of columns -- so whichever ceremony
 * wrote last silently destroyed the other's. Registration is keyed by the
 * session's user and signing in by an email address, but both land on the same
 * User row, so a second browser tab was enough to lose a registration that was
 * already halfway through.
 *
 * The old pair is dropped rather than kept as the sign-in slot. A column named
 * `webauthnChallenge` that in fact means "the sign-in one" is exactly the
 * ambiguity that let the two flows share it, and leaving it would also leave a
 * value written by a pre-deploy REGISTRATION to be read afterwards as a
 * sign-in challenge.
 *
 * Nothing durable is lost. These columns hold a single-use value with a
 * five-minute TTL, so the worst case is a user who was mid-ceremony as the
 * deploy landed being told to start again -- which is what the message already
 * says, and which retrying fixes.
 */
export class SplitWebAuthnChallengeByPurpose1791800000000
  implements MigrationInterface
{
  public name: string = "SplitWebAuthnChallengeByPurpose1791800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "webauthnChallenge"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "webauthnChallengeExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "webauthnRegistrationChallenge" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "webauthnRegistrationChallengeExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "webauthnAuthenticationChallenge" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "webauthnAuthenticationChallengeExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "webauthnAuthenticationChallengeExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "webauthnAuthenticationChallenge"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "webauthnRegistrationChallengeExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "webauthnRegistrationChallenge"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "webauthnChallengeExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "webauthnChallenge" character varying(100)`,
    );
  }
}
