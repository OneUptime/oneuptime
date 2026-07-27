import PostgresErrorTranslator from "../../../../Server/Utils/Database/PostgresErrorTranslator";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Exception from "../../../../Types/Exception/Exception";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test: TypeORM's QueryFailedError is not an Exception, so it
 * used to fall through StartServer's generic handler and reach the client as a
 * bare 500 "Server Error" — which is exactly what deleting a project hit when
 * another project's MonitorStatusTimeline rows still referenced its statuses.
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

  describe("errors it should not touch", () => {
    it("passes through a non-foreign-key Postgres error unchanged", () => {
      const uniqueViolation: FakeQueryFailedError = {
        message: "duplicate key value violates unique constraint",
        code: "23505",
        table: "Project",
        detail: "Key (slug)=(acme) already exists.",
      };

      expect(PostgresErrorTranslator.translate(uniqueViolation)).toBe(
        uniqueViolation,
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
