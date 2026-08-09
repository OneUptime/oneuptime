import PostgresErrorTranslator, {
  TranslatedPostgresException,
} from "../../../../Server/Utils/Database/PostgresErrorTranslator";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Exception from "../../../../Types/Exception/Exception";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test: TypeORM's QueryFailedError is not an Exception, so it
 * used to fall through StartServer's generic handler and reach the client as a
 * bare 500 "Server Error" — which is exactly what deleting a project hit when
 * another project's MonitorStatusTimeline rows still referenced its statuses,
 * and what issue #3020 hit when a second ProjectCallSMSConfig was given Twilio
 * credentials another row already held.
 *
 * The translator turns the actionable Postgres failures into a
 * BadDataException (400) and leaves everything else untouched.
 */

type FakeQueryFailedError = {
  message: string;
  code?: string | undefined;
  table?: string | undefined;
  detail?: string | undefined;
  driverError?: unknown;
};

const foreignKeyDeleteError: () => FakeQueryFailedError =
  (): FakeQueryFailedError => {
    return {
      message:
        'update or delete on table "MonitorStatus" violates foreign key constraint "FK_574feb4161c5216c2c7ee0faaf8" on table "MonitorStatusTimeline"',
      code: "23503",
      table: "MonitorStatusTimeline",
      detail:
        'Key (_id)=(cfc2f04f-79cb-4344-8c54-dafe5e3a290c) is still referenced from table "MonitorStatusTimeline".',
    };
  };

/*
 * The literal failure from issue #3020: PUT /api/call-sms-config setting a
 * Twilio account SID that another ProjectCallSMSConfig row already carried.
 */
const twilioAccountSidCollision: () => FakeQueryFailedError =
  (): FakeQueryFailedError => {
    return {
      message:
        'duplicate key value violates unique constraint "UQ_0886139eac04ad49627e446d477"',
      code: "23505",
      table: "ProjectCallSMSConfig",
      detail:
        'Key ("twilioAccountSID")=(AC-redacted-sid-that-must-not-leak) already exists.',
    };
  };

describe("PostgresErrorTranslator", () => {
  describe("foreign key violation on delete", () => {
    it("translates to a BadDataException naming the blocking table", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        foreignKeyDeleteError(),
      );

      expect(translated).toBeInstanceOf(BadDataException);
      expect((translated as Exception).message).toBe(
        "This item cannot be deleted because Monitor Status Timeline records still reference it. Please delete those records first, and then try again.",
      );
    });

    it("reads the pg fields off driverError when the wrapper has no code", () => {
      const translated: unknown = PostgresErrorTranslator.translate({
        message: "wrapped",
        driverError: foreignKeyDeleteError(),
      });

      expect(translated).toBeInstanceOf(BadDataException);
      expect((translated as Exception).message).toContain(
        "Monitor Status Timeline",
      );
    });

    it("does not leak the offending row id into the message", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        foreignKeyDeleteError(),
      );

      expect((translated as Exception).message).not.toContain(
        "cfc2f04f-79cb-4344-8c54-dafe5e3a290c",
      );
    });
  });

  describe("foreign key violation on insert or update", () => {
    it("translates to a BadDataException naming the missing record", () => {
      const translated: unknown = PostgresErrorTranslator.translate({
        message: "insert violates foreign key constraint",
        code: "23503",
        table: "MonitorStatusTimeline",
        detail:
          'Key (monitorStatusId)=(cfc2f04f-79cb-4344-8c54-dafe5e3a290c) is not present in table "MonitorStatus".',
      });

      expect(translated).toBeInstanceOf(BadDataException);
      expect((translated as Exception).message).toBe(
        "This request references Monitor Status that does not exist. Please check the request and try again.",
      );
    });
  });

  describe("unique violation (issue #3020)", () => {
    it("translates to a BadDataException naming the table and the column", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        twilioAccountSidCollision(),
      );

      expect(translated).toBeInstanceOf(BadDataException);
      expect((translated as Exception).message).toBe(
        "A Project Call SMS Config with this Twilio Account SID already exists. Please use a different value and try again.",
      );
    });

    it("is a 400, not the bare 500 the issue reported", () => {
      /*
       * The whole point: the reporter saw `{"error":"Server Error"}` with no
       * indication of which field was at fault.
       */
      const translated: unknown = PostgresErrorTranslator.translate(
        twilioAccountSidCollision(),
      );

      expect((translated as Exception).message).not.toBe("Server Error");
      expect(translated).toBeInstanceOf(BadDataException);
    });

    it("does not leak the colliding value — it may belong to another project", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        twilioAccountSidCollision(),
      );

      expect((translated as Exception).message).not.toContain(
        "AC-redacted-sid-that-must-not-leak",
      );
    });

    it("handles an unquoted column name", () => {
      const translated: unknown = PostgresErrorTranslator.translate({
        message: "duplicate key value violates unique constraint",
        code: "23505",
        table: "Project",
        detail: "Key (slug)=(acme) already exists.",
      });

      expect((translated as Exception).message).toBe(
        "A Project with this Slug already exists. Please use a different value and try again.",
      );
    });

    it("handles a composite key, listing every column", () => {
      const translated: unknown = PostgresErrorTranslator.translate({
        message: "duplicate key value violates unique constraint",
        code: "23505",
        table: "NetworkInterface",
        detail:
          'Key ("networkDeviceId", "interfaceIndex")=(cfc2f04f-79cb-4344-8c54-dafe5e3a290c, 3) already exists.',
      });

      expect((translated as Exception).message).toBe(
        "A Network Interface with the same Network Device Id, Interface Index already exists. Please use different values and try again.",
      );
    });

    it("does not mistake the value list for the column list", () => {
      /*
       * `Key (a)=(b) already exists` has two parenthesised groups. Reading the
       * wrong one would put another row's data in the message.
       */
      const translated: unknown = PostgresErrorTranslator.translate({
        message: "duplicate key value violates unique constraint",
        code: "23505",
        table: "Project",
        detail: "Key (slug)=(secret-customer-name) already exists.",
      });

      expect((translated as Exception).message).not.toContain(
        "secret-customer-name",
      );
    });

    it("reads the pg fields off driverError when the wrapper has no code", () => {
      const translated: unknown = PostgresErrorTranslator.translate({
        message: "wrapped",
        driverError: twilioAccountSidCollision(),
      });

      expect(translated).toBeInstanceOf(BadDataException);
      expect((translated as Exception).message).toContain("Twilio Account SID");
    });

    it("falls back to a generic message when the table is unknown", () => {
      const translated: unknown = PostgresErrorTranslator.translate({
        message: "duplicate key value violates unique constraint",
        code: "23505",
        detail: 'Key ("twilioAccountSID")=(AC123) already exists.',
      });

      expect((translated as Exception).message).toBe(
        "A record with this Twilio Account SID already exists. Please use a different value and try again.",
      );
    });

    it("falls back to a generic message when the columns cannot be parsed", () => {
      const translated: unknown = PostgresErrorTranslator.translate({
        message: "duplicate key value violates unique constraint",
        code: "23505",
        table: "Project",
        detail: "some shape of detail we have not seen already exists.",
      });

      expect(translated).toBeInstanceOf(BadDataException);
      expect((translated as Exception).message).toBe(
        "A Project with these values already exists. Please use different values and try again.",
      );
    });

    it("passes through a 23505 with no detail at all", () => {
      /*
       * Without DETAIL there is nothing actionable to say, so a bare 500 is
       * still more honest than inventing a field name.
       */
      const noDetail: FakeQueryFailedError = {
        message: "duplicate key value violates unique constraint",
        code: "23505",
        table: "Project",
      };

      expect(PostgresErrorTranslator.translate(noDetail)).toBe(noDetail);
    });
  });

  describe("isUniqueViolation", () => {
    it("recognises a raw QueryFailedError", () => {
      expect(
        PostgresErrorTranslator.isUniqueViolation(twilioAccountSidCollision()),
      ).toBe(true);
    });

    it("recognises one wrapped under driverError", () => {
      expect(
        PostgresErrorTranslator.isUniqueViolation({
          message: "wrapped",
          driverError: twilioAccountSidCollision(),
        }),
      ).toBe(true);
    });

    it("still recognises it AFTER translation", () => {
      /*
       * The reason this method exists. DatabaseService.create runs every
       * failure through the translator before rethrowing, so a service's own
       * catch block never sees the raw error. RumSessionPinService recovers
       * from a duplicate pin by returning the existing row; a local
       * `code === "23505"` check there would have started silently returning
       * false the moment 23505 became translatable, turning an idempotent
       * "already pinned" back into an error.
       */
      const translated: unknown = PostgresErrorTranslator.translate(
        twilioAccountSidCollision(),
      );

      expect(translated).toBeInstanceOf(BadDataException);
      expect(PostgresErrorTranslator.isUniqueViolation(translated)).toBe(true);
    });

    it("records the SQLSTATE on the translated exception", () => {
      const translated: TranslatedPostgresException =
        PostgresErrorTranslator.translate(
          twilioAccountSidCollision(),
        ) as TranslatedPostgresException;

      expect(translated.postgresErrorCode).toBe("23505");
    });

    it("does not confuse a foreign key violation for a unique one", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        foreignKeyDeleteError(),
      );

      expect(PostgresErrorTranslator.isUniqueViolation(translated)).toBe(false);
      expect(
        PostgresErrorTranslator.isUniqueViolation(foreignKeyDeleteError()),
      ).toBe(false);
    });

    it("does not confuse Exception.code for a SQLSTATE", () => {
      /*
       * Exception.code is the numeric ExceptionCode, an entirely different
       * namespace from Postgres SQLSTATEs.
       */
      expect(
        PostgresErrorTranslator.isUniqueViolation(new BadDataException("Nope")),
      ).toBe(false);
    });

    it("is false for null and non-objects", () => {
      expect(PostgresErrorTranslator.isUniqueViolation(null)).toBe(false);
      expect(PostgresErrorTranslator.isUniqueViolation(undefined)).toBe(false);
      expect(PostgresErrorTranslator.isUniqueViolation("23505")).toBe(false);
    });
  });

  describe("errors it should not touch", () => {
    it("passes through an unrecognised Postgres error unchanged", () => {
      const notNullViolation: FakeQueryFailedError = {
        message: 'null value in column "name" violates not-null constraint',
        code: "23502",
        table: "Project",
        detail: "Failing row contains (null).",
      };

      expect(PostgresErrorTranslator.translate(notNullViolation)).toBe(
        notNullViolation,
      );
    });

    it("passes through an ordinary Exception unchanged", () => {
      const exception: BadDataException = new BadDataException("Nope");

      expect(PostgresErrorTranslator.translate(exception)).toBe(exception);
    });

    it("passes through null and non-objects unchanged", () => {
      expect(PostgresErrorTranslator.translate(null)).toBeNull();
      expect(PostgresErrorTranslator.translate("boom")).toBe("boom");
    });

    it("passes through a 23503 with an unrecognised detail unchanged", () => {
      const odd: FakeQueryFailedError = {
        message: "foreign key",
        code: "23503",
        table: "MonitorStatusTimeline",
        detail: "something we have not seen before",
      };

      expect(PostgresErrorTranslator.translate(odd)).toBe(odd);
    });
  });
});
