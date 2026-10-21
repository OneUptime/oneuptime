import CallerVisibleRead from "../../../../Server/Utils/Database/CallerVisibleRead";
import logger from "../../../../Server/Utils/Logger";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Exception from "../../../../Types/Exception/Exception";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A record read as the caller, for a hook that lets a person write a row
 * naming it only if they can see it: a refusal about the record is the
 * answer a missing record gets, and anything else is passed on.
 */
describe("CallerVisibleRead.find", () => {
  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation((() => {
      // quiet
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns what the read found, or nothing", async () => {
    await expect(
      CallerVisibleRead.find(async () => {
        return "record";
      }),
    ).resolves.toBe("record");

    await expect(
      CallerVisibleRead.find(async () => {
        return null;
      }),
    ).resolves.toBeNull();
  });

  test.each([
    ["no read access to the table", new NotAuthorizedException("no")],
    ["a label the caller cannot see", new ForbiddenException("no")],
    ["a record that is not found", new NotFoundException("no")],
    ["a refused query", new BadDataException("no")],
  ])(
    "%s is answered like a record that does not exist",
    async (_case: string, refusal: Exception) => {
      await expect(
        CallerVisibleRead.find(async () => {
          throw refusal;
        }),
      ).resolves.toBeNull();
    },
  );

  test.each([
    ["a lapsed session", new NotAuthenticatedException("signed out")],
    ["an unpaid project", new PaymentRequiredException("upgrade")],
    ["the database being unavailable", new Error("connection reset")],
  ])("%s is passed on as it is", async (_case: string, failure: Error) => {
    await expect(
      CallerVisibleRead.find(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
