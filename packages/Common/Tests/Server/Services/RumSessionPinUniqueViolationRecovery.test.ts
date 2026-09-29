import DatabaseService from "../../../Server/Services/DatabaseService";
import RumSessionPinService from "../../../Server/Services/RumSessionPinService";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import RumSessionPin from "../../../Models/DatabaseModels/RumSessionPin";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Collateral guard for the issue #3020 fix.
 *
 * That fix taught PostgresErrorTranslator to turn a Postgres unique_violation
 * (23505) into a BadDataException, so a duplicate reaches the client as a 400
 * naming the field instead of a bare 500 "Server Error".
 *
 * RumSessionPinService is the one caller that RECOVERS from a unique violation
 * rather than reporting it: pinning an already-pinned recording returns the
 * existing pin instead of erroring, and the catch block closes the race between
 * two concurrent pins. It used to detect the violation with a local
 * `code === "23505"` check — which stopped matching the moment translation
 * happened, because DatabaseService.create runs every failure through the
 * translator BEFORE rethrowing. The error arriving in that catch is a
 * BadDataException whose `code` is the numeric ExceptionCode, not a SQLSTATE.
 *
 * These tests pin the recovery to the translated shape, so translating more
 * SQLSTATEs later cannot silently turn "already pinned" back into an error.
 *
 * DatabaseService.prototype.create is spied so super.create() is observable
 * without a database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);
const RUM_APPLICATION_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000002",
);
const SESSION_ID: string = "session-abc";

/* The error DatabaseService.create actually throws after translation. */
function translatedUniqueViolation(): unknown {
  return PostgresErrorTranslator.translate({
    message:
      'duplicate key value violates unique constraint "IDX_rum_session_pin_session"',
    code: "23505",
    table: "RumSessionPin",
    detail:
      'Key ("projectId", "rumApplicationId", "sessionId")=(00000000-0000-4000-8000-000000000001, 00000000-0000-4000-8000-000000000002, session-abc) already exists.',
  });
}

function createBy(): CreateBy<RumSessionPin> {
  const data: RumSessionPin = new RumSessionPin();
  data.projectId = PROJECT_ID;
  data.rumApplicationId = RUM_APPLICATION_ID;
  data.sessionId = SESSION_ID;

  return { data, props: { isRoot: true } } as CreateBy<RumSessionPin>;
}

function existingPin(): RumSessionPin {
  const pin: RumSessionPin = new RumSessionPin();
  pin._id = "00000000-0000-4000-8000-000000000003";
  pin.projectId = PROJECT_ID;
  pin.rumApplicationId = RUM_APPLICATION_ID;
  pin.sessionId = SESSION_ID;

  return pin;
}

describe("RumSessionPinService recovery from a translated unique violation", () => {
  let createSpy: jest.SpyInstance;
  let getPinSpy: jest.SpyInstance;

  beforeEach(() => {
    createSpy = jest.spyOn(DatabaseService.prototype, "create");
    getPinSpy = jest.spyOn(RumSessionPinService, "getPinForSession");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the error thrown by create() really is translated, not raw", () => {
    /*
     * Guards the premise. If this stopped being a BadDataException the rest of
     * these tests would be exercising a shape that no longer occurs.
     */
    expect(translatedUniqueViolation()).toBeInstanceOf(BadDataException);
  });

  test("a raced duplicate pin returns the existing pin instead of throwing", async () => {
    const pin: RumSessionPin = existingPin();

    /* Pre-check finds nothing; the racing request wins; the retry finds it. */
    getPinSpy
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(pin as never);
    createSpy.mockRejectedValueOnce(translatedUniqueViolation() as never);

    await expect(RumSessionPinService.create(createBy())).resolves.toBe(pin);
  });

  test("the recovery is what returns it — create() was really attempted", async () => {
    const pin: RumSessionPin = existingPin();

    getPinSpy
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(pin as never);
    createSpy.mockRejectedValueOnce(translatedUniqueViolation() as never);

    await RumSessionPinService.create(createBy());

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(getPinSpy).toHaveBeenCalledTimes(2);
  });

  test("a unique violation with nothing to recover still surfaces", async () => {
    /*
     * If the row genuinely is not there, swallowing the error would report a
     * pin that does not exist.
     */
    const error: unknown = translatedUniqueViolation();

    getPinSpy.mockResolvedValue(null as never);
    createSpy.mockRejectedValueOnce(error as never);

    await expect(RumSessionPinService.create(createBy())).rejects.toBe(error);
  });

  test("an unrelated failure is rethrown untouched, not treated as a duplicate", async () => {
    const error: BadDataException = new BadDataException("something else");

    getPinSpy.mockResolvedValue(null as never);
    createSpy.mockRejectedValueOnce(error as never);

    await expect(RumSessionPinService.create(createBy())).rejects.toBe(error);
    expect(getPinSpy).toHaveBeenCalledTimes(1);
  });

  test("a translated FOREIGN KEY violation is not mistaken for a duplicate", async () => {
    /*
     * Both SQLSTATEs now translate to a BadDataException, so the recovery can
     * no longer key off the exception type — only off the recorded SQLSTATE.
     */
    const error: unknown = PostgresErrorTranslator.translate({
      message: "insert violates foreign key constraint",
      code: "23503",
      table: "RumSessionPin",
      detail:
        'Key (rumApplicationId)=(00000000-0000-4000-8000-000000000002) is not present in table "RumApplication".',
    });

    expect(error).toBeInstanceOf(BadDataException);

    getPinSpy.mockResolvedValue(null as never);
    createSpy.mockRejectedValueOnce(error as never);

    await expect(RumSessionPinService.create(createBy())).rejects.toBe(error);
    expect(getPinSpy).toHaveBeenCalledTimes(1);
  });
});
