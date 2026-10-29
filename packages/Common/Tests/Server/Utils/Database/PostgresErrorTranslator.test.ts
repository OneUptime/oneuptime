import PostgresErrorTranslator, {
  TranslatedPostgresException,
} from "../../../../Server/Utils/Database/PostgresErrorTranslator";
import { EXAMPLE_UUID } from "../../../../Server/Types/Database/UUIDColumnFilter";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Exception from "../../../../Types/Exception/Exception";
import { describe, expect, it } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

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

  /*
   * A value records pick from (a severity, a state, a label) that rows still
   * have: "delete those records first" would mean deleting incidents to
   * delete a severity. Its own service's delete is answered with the way on
   * - archive it - and only that one: the same refusal reached by deleting
   * something else (a project, whose statuses go with it) keeps its words.
   */
  describe("a value records still have, deleted by its own service", () => {
    const severityDeleteError: () => FakeQueryFailedError =
      (): FakeQueryFailedError => {
        return {
          message:
            'update or delete on table "IncidentSeverity" violates foreign key constraint "FK_1c523ebcb77b541cb035757081f" on table "Incident"',
          code: "23503",
          table: "Incident",
          detail:
            'Key (_id)=(cfc2f04f-79cb-4344-8c54-dafe5e3a290c) is still referenced from table "Incident".',
        };
      };

    const GENERAL_WORDS: string =
      "This item cannot be deleted because Incident records still reference it. Please delete those records first, and then try again.";

    it("says to archive it instead, naming what has it", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        severityDeleteError(),
        { tableName: "IncidentSeverity" },
      );

      expect(translated).toBeInstanceOf(BadDataException);
      expect((translated as Exception).message).toBe(
        "This incident severity can't be deleted while Incident records still have it. Archive it instead: nobody can pick it again, and everything that has it keeps it.",
      );
      expect((translated as Exception).message).not.toContain(
        "cfc2f04f-79cb-4344-8c54-dafe5e3a290c",
      );
    });

    it("names each kind of value as its own definition does", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        foreignKeyDeleteError(),
        { tableName: "MonitorStatus" },
      );

      expect((translated as Exception).message).toBe(
        "This monitor status can't be deleted while Monitor Status Timeline records still have it. Archive it instead: nobody can pick it again, and everything that has it keeps it.",
      );
    });

    it("reads the deleted table off driverError too", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        { message: "wrapped", driverError: severityDeleteError() },
        { tableName: "IncidentSeverity" },
      );

      expect((translated as Exception).message).toContain("Archive it instead");
    });

    it("a project's delete that reached its statuses keeps the general words", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        foreignKeyDeleteError(),
        { tableName: "Project" },
      );

      expect((translated as Exception).message).toBe(
        "This item cannot be deleted because Monitor Status Timeline records still reference it. Please delete those records first, and then try again.",
      );
    });

    it("a table that holds no value keeps the general words", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        {
          ...severityDeleteError(),
          message:
            'update or delete on table "Monitor" violates foreign key constraint "FK_x" on table "Incident"',
        },
        { tableName: "Monitor" },
      );

      expect((translated as Exception).message).toBe(GENERAL_WORDS);
    });

    it("without its own table - a caller outside a service - keeps the general words", () => {
      for (const context of [undefined, {}, { tableName: null }]) {
        const translated: unknown = PostgresErrorTranslator.translate(
          severityDeleteError(),
          context,
        );

        expect((translated as Exception).message).toBe(GENERAL_WORDS);
      }
    });

    it("a message that does not say which table was deleted from keeps the general words", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        {
          ...severityDeleteError(),
          message: "violates foreign key constraint",
        },
        { tableName: "IncidentSeverity" },
      );

      expect((translated as Exception).message).toBe(GENERAL_WORDS);
    });

    it("reads a long message in time that grows with it", () => {
      // Its worst case: a table name that never closes.
      const message: string =
        'update or delete on table "' + "a".repeat(400000);

      const translated: FastestRun<unknown> = fastestRun({
        run: (): unknown => {
          return PostgresErrorTranslator.translate(
            { ...severityDeleteError(), message: message },
            { tableName: "IncidentSeverity" },
          );
        },
        limitInMs: 2000,
      });

      expect(translated.inMs).toBeLessThan(2000);
      expect((translated.result as Exception).message).toBe(GENERAL_WORDS);
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

  /*
   * A service that recovers from ONE unique index tells it from every other
   * by its name: the episode member services make a create again when it
   * lost a race to their first-membership index, and never when it broke
   * any other (EpisodeSingleMembership).
   */
  describe("isUniqueViolationOf", () => {
    const INDEX: string = "IDX_IncidentEpisodeMember_first_membership";

    const firstMembershipCollision: () => FakeQueryFailedError & {
      constraint?: string | undefined;
    } = (): FakeQueryFailedError & { constraint?: string | undefined } => {
      return {
        message:
          'duplicate key value violates unique constraint "IDX_IncidentEpisodeMember_first_membership"',
        code: "23505",
        table: "IncidentEpisodeMember",
        detail:
          'Key ("incidentId")=(cfc2f04f-79cb-4344-8c54-dafe5e3a290c) already exists.',
        constraint: INDEX,
      };
    };

    it("recognises the index by name, raw and wrapped", () => {
      expect(
        PostgresErrorTranslator.isUniqueViolationOf(
          firstMembershipCollision(),
          INDEX,
        ),
      ).toBe(true);
      expect(
        PostgresErrorTranslator.isUniqueViolationOf(
          { message: "wrapped", driverError: firstMembershipCollision() },
          INDEX,
        ),
      ).toBe(true);
    });

    it("still recognises it after translation: the name is kept on the exception", () => {
      const translated: TranslatedPostgresException =
        PostgresErrorTranslator.translate(
          firstMembershipCollision(),
        ) as TranslatedPostgresException;

      expect(translated).toBeInstanceOf(BadDataException);
      expect(translated.postgresConstraintName).toBe(INDEX);
      expect(
        PostgresErrorTranslator.isUniqueViolationOf(translated, INDEX),
      ).toBe(true);
    });

    it("is false for another unique index, translated or not", () => {
      const other: FakeQueryFailedError & { constraint?: string } = {
        ...firstMembershipCollision(),
        constraint: "IDX_some_other_index",
      };

      expect(PostgresErrorTranslator.isUniqueViolationOf(other, INDEX)).toBe(
        false,
      );
      expect(
        PostgresErrorTranslator.isUniqueViolationOf(
          PostgresErrorTranslator.translate(other),
          INDEX,
        ),
      ).toBe(false);
    });

    it("is false when Postgres named no constraint", () => {
      expect(
        PostgresErrorTranslator.isUniqueViolationOf(
          twilioAccountSidCollision(),
          INDEX,
        ),
      ).toBe(false);
      expect(
        PostgresErrorTranslator.isUniqueViolationOf(
          PostgresErrorTranslator.translate(twilioAccountSidCollision()),
          INDEX,
        ),
      ).toBe(false);
    });

    it("is false for anything that is not a unique violation, whatever it names", () => {
      expect(
        PostgresErrorTranslator.isUniqueViolationOf(
          { ...foreignKeyDeleteError(), constraint: INDEX },
          INDEX,
        ),
      ).toBe(false);
      expect(
        PostgresErrorTranslator.isUniqueViolationOf(
          new BadDataException("Nope"),
          INDEX,
        ),
      ).toBe(false);
      expect(PostgresErrorTranslator.isUniqueViolationOf(null, INDEX)).toBe(
        false,
      );
    });

    it("an exception made by the application, not the database, names no index", () => {
      const made: TranslatedPostgresException =
        PostgresErrorTranslator.createUniqueViolationException(
          "Already there.",
        ) as TranslatedPostgresException;

      expect(made.postgresConstraintName).toBeUndefined();
      expect(PostgresErrorTranslator.isUniqueViolationOf(made, INDEX)).toBe(
        false,
      );
    });
  });

  describe("createUniqueViolationException (issue #3394)", () => {
    /*
     * @UniqueColumnsTogether refuses a duplicate owner row before the insert.
     * The callers that add owners in bulk must treat that refusal exactly like
     * the unique index rejecting a racing insert, through one predicate.
     */
    it("is a BadDataException carrying the given message", () => {
      const exception: BadDataException =
        PostgresErrorTranslator.createUniqueViolationException(
          "This team is already an owner of this incident.",
        );

      expect(exception).toBeInstanceOf(BadDataException);
      expect(exception.message).toBe(
        "This team is already an owner of this incident.",
      );
    });

    it("is recognised by isUniqueViolation", () => {
      expect(
        PostgresErrorTranslator.isUniqueViolation(
          PostgresErrorTranslator.createUniqueViolationException("Duplicate."),
        ),
      ).toBe(true);
    });

    it("is tagged with the unique-violation SQLSTATE, like a translated one", () => {
      const exception: TranslatedPostgresException =
        PostgresErrorTranslator.createUniqueViolationException(
          "Duplicate.",
        ) as TranslatedPostgresException;
      const translated: TranslatedPostgresException =
        PostgresErrorTranslator.translate(
          twilioAccountSidCollision(),
        ) as TranslatedPostgresException;

      expect(exception.postgresErrorCode).toBe("23505");
      expect(exception.postgresErrorCode).toBe(translated.postgresErrorCode);
    });

    it("keeps the same HTTP-facing code as any other BadDataException", () => {
      expect(
        PostgresErrorTranslator.createUniqueViolationException("Duplicate.")
          .code,
      ).toBe(new BadDataException("Duplicate.").code);
    });

    it("passes through translate() unchanged", () => {
      const exception: BadDataException =
        PostgresErrorTranslator.createUniqueViolationException("Duplicate.");

      expect(PostgresErrorTranslator.translate(exception)).toBe(exception);
    });

    it("returns a new exception on every call", () => {
      expect(
        PostgresErrorTranslator.createUniqueViolationException("Duplicate."),
      ).not.toBe(
        PostgresErrorTranslator.createUniqueViolationException("Duplicate."),
      );
    });
  });

  /*
   * A value Postgres cannot read as a uuid. A filter and a write are refused
   * before they reach Postgres, naming the column (UUIDColumnFilter); this
   * is what answers the rest - a custom route, a statement written by hand -
   * with a 400 instead of the bare 500 the API used to send.
   */
  describe("a value Postgres cannot read as a uuid (22P02)", () => {
    const invalidUuid: (value: string) => FakeQueryFailedError = (
      value: string,
    ): FakeQueryFailedError => {
      return {
        message: `invalid input syntax for type uuid: "${value}"`,
        code: "22P02",
      };
    };

    it("translates to a BadDataException saying what an ID is", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        invalidUuid("[object Object]"),
      );

      expect(translated).toBeInstanceOf(BadDataException);
      expect((translated as Exception).message).toBe(
        `An ID in this request is not valid. An ID is a UUID, such as "${EXAMPLE_UUID}". Please check the IDs in the request and try again.`,
      );
    });

    it("records the SQLSTATE on the translated exception", () => {
      expect(
        (
          PostgresErrorTranslator.translate(
            invalidUuid("abc"),
          ) as TranslatedPostgresException
        ).postgresErrorCode,
      ).toBe("22P02");
    });

    // Whatever was bound, which need not be the caller's own text.
    it("does not repeat the value Postgres was given", () => {
      const translated: unknown = PostgresErrorTranslator.translate(
        invalidUuid("secret-value-from-somewhere"),
      );

      expect((translated as Exception).message).not.toContain(
        "secret-value-from-somewhere",
      );
    });

    it("reads the pg fields off driverError when the wrapper has no code", () => {
      const translated: unknown = PostgresErrorTranslator.translate({
        message: "wrapped",
        driverError: invalidUuid("abc"),
      });

      expect(translated).toBeInstanceOf(BadDataException);
    });

    it("is not a unique violation", () => {
      expect(
        PostgresErrorTranslator.isUniqueViolation(
          PostgresErrorTranslator.translate(invalidUuid("abc")),
        ),
      ).toBe(false);
    });

    // Every other 22P02 is some other column's problem, and left as it was.
    it.each([
      ["an integer", 'invalid input syntax for type integer: "abc"'],
      ["a json", "invalid input syntax for type json"],
      ["an enum", 'invalid input value for enum "Status": "abc"'],
      ["no message at all", ""],
    ])(
      "passes through a 22P02 for %s unchanged",
      (_name: string, message: string) => {
        const other: FakeQueryFailedError = { message, code: "22P02" };

        expect(PostgresErrorTranslator.translate(other)).toBe(other);
      },
    );
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

/*
 * isMissingRowOf (issue #5214): ingest wrote a deleted Docker host's
 * containers against its cached id, and Postgres refused them with
 *
 *   insert or update on table "DockerResource" violates foreign key
 *   constraint "FK_84fba362f2ac3a2550e08d16fb2"
 *   Key (dockerHostId)=(66f44447-...) is not present in table "DockerHost".
 *
 * Ingest asks this to tell that refusal - the resource is gone, resolve it
 * again - from every other failure, whether the error comes straight from
 * the driver (a bulk upsert's manager.query) or through DatabaseService
 * (translated into a BadDataException).
 */
describe("PostgresErrorTranslator.isMissingRowOf", () => {
  const dockerResourceRefused: () => FakeQueryFailedError =
    (): FakeQueryFailedError => {
      return {
        message:
          'insert or update on table "DockerResource" violates foreign key constraint "FK_84fba362f2ac3a2550e08d16fb2"',
        code: "23503",
        table: "DockerResource",
        detail:
          'Key (dockerHostId)=(66f44447-ee93-4a12-99ec-79edd9a2421c) is not present in table "DockerHost".',
      };
    };

  it("is true for the issue's refusal, raw from the driver, for the table it names", () => {
    expect(
      PostgresErrorTranslator.isMissingRowOf(
        dockerResourceRefused(),
        "DockerHost",
      ),
    ).toBe(true);
  });

  it("is true for it under a QueryFailedError's driverError too", () => {
    const wrapped: FakeQueryFailedError = {
      message: "query failed",
      driverError: dockerResourceRefused(),
    };

    expect(PostgresErrorTranslator.isMissingRowOf(wrapped, "DockerHost")).toBe(
      true,
    );
  });

  it("is true for it once DatabaseService translated it", () => {
    const translated: unknown = PostgresErrorTranslator.translate(
      dockerResourceRefused(),
    );

    expect(translated).toBeInstanceOf(BadDataException);
    expect(
      (translated as TranslatedPostgresException).postgresMissingRowTable,
    ).toBe("DockerHost");
    expect(
      PostgresErrorTranslator.isMissingRowOf(translated, "DockerHost"),
    ).toBe(true);
  });

  it("is false for another table's missing row - the project, say", () => {
    const projectGone: FakeQueryFailedError = {
      ...dockerResourceRefused(),
      detail:
        'Key (projectId)=(66f44447-ee93-4a12-99ec-79edd9a2421c) is not present in table "Project".',
    };

    expect(
      PostgresErrorTranslator.isMissingRowOf(projectGone, "DockerHost"),
    ).toBe(false);
    expect(
      PostgresErrorTranslator.isMissingRowOf(
        PostgresErrorTranslator.translate(projectGone),
        "DockerHost",
      ),
    ).toBe(false);
  });

  it("is false for a table whose name only begins with the one asked about", () => {
    const feedGone: FakeQueryFailedError = {
      ...dockerResourceRefused(),
      detail:
        'Key (hostId)=(66f44447-ee93-4a12-99ec-79edd9a2421c) is not present in table "DockerHostFeed".',
    };

    expect(PostgresErrorTranslator.isMissingRowOf(feedGone, "DockerHost")).toBe(
      false,
    );
  });

  it("is false for a delete refused because rows still refer to the row", () => {
    expect(
      PostgresErrorTranslator.isMissingRowOf(
        foreignKeyDeleteError(),
        "MonitorStatusTimeline",
      ),
    ).toBe(false);
  });

  it("is false for a unique violation, another error, an Exception and nothing", () => {
    expect(
      PostgresErrorTranslator.isMissingRowOf(
        twilioAccountSidCollision(),
        "ProjectCallSMSConfig",
      ),
    ).toBe(false);
    expect(
      PostgresErrorTranslator.isMissingRowOf(
        new Error('is not present in table "DockerHost"'),
        "DockerHost",
      ),
    ).toBe(false);
    expect(
      PostgresErrorTranslator.isMissingRowOf(
        new BadDataException("Nope"),
        "DockerHost",
      ),
    ).toBe(false);
    expect(PostgresErrorTranslator.isMissingRowOf(null, "DockerHost")).toBe(
      false,
    );
    expect(
      PostgresErrorTranslator.isMissingRowOf("is not present", "DockerHost"),
    ).toBe(false);
  });
});
