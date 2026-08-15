import Email from "../../../../../Server/Types/Workflow/Components/Email";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import nodemailer from "nodemailer";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("nodemailer", () => {
  return {
    __esModule: true,
    default: {
      createTransport: jest.fn(),
    },
  };
});

interface LogSpy {
  (item: Parameters<RunOptions["log"]>[0]): void;
  mock: { calls: Array<Array<unknown>> };
}

interface OnErrorSpy {
  (exception: Exception): Exception;
  mock: { calls: Array<Array<unknown>> };
}

interface OptionsFixture {
  options: RunOptions;
  log: LogSpy;
  onError: OnErrorSpy;
}

function makeOptions(): OptionsFixture {
  const log: LogSpy = jest.fn() as unknown as LogSpy;
  const onError: OnErrorSpy = jest.fn((exception: Exception): Exception => {
    return exception;
  }) as unknown as OnErrorSpy;

  return {
    log,
    onError,
    options: {
      log: log,
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: onError,
      executeWorkflow: async (): Promise<void> => {},
    },
  };
}

function validArgs(overrides: JSONObject = {}): JSONObject {
  return {
    from: "alerts@example.com",
    to: "on-call@example.com",
    subject: "Workflow alert",
    "email-body": "Something needs attention.",
    "smtp-host": "smtp.example.com",
    "smtp-port": 587,
    secure: false,
    ...overrides,
  };
}

const createTransportMock: ReturnType<typeof jest.fn> =
  nodemailer.createTransport as unknown as ReturnType<typeof jest.fn>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Email workflow component failures", () => {
  test.each([
    ["username only", { "smtp-username": "mailer-user" }],
    ["password only", { "smtp-password": "super-secret-password" }],
  ])(
    "routes %s SMTP credentials to the Error port without logging them",
    async (_label: string, credentials: JSONObject) => {
      const fixture: OptionsFixture = makeOptions();

      const result: RunReturnType = await new Email().run(
        validArgs(credentials),
        fixture.options,
      );

      const diagnostic: string =
        "SMTP username and password must be provided together.";

      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues).toEqual({ error: diagnostic });
      expect(fixture.log).toHaveBeenCalledWith(diagnostic);
      expect(JSON.stringify(fixture.log.mock.calls)).not.toContain(
        "mailer-user",
      );
      expect(JSON.stringify(fixture.log.mock.calls)).not.toContain(
        "super-secret-password",
      );
      expect(fixture.onError).not.toHaveBeenCalled();
      expect(createTransportMock).not.toHaveBeenCalled();
    },
  );

  test("returns a send failure diagnostic through the Error port", async () => {
    const sendMail: ReturnType<typeof jest.fn> = jest
      .fn()
      .mockRejectedValue(new Error("SMTP authentication failed") as never);
    createTransportMock.mockReturnValue({ sendMail });
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new Email().run(
      validArgs({
        "smtp-username": "mailer-user",
        "smtp-password": "super-secret-password",
      }),
      fixture.options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues).toEqual({
      error: "SMTP authentication failed",
    });
    expect(fixture.log).toHaveBeenCalledWith("SMTP authentication failed");
    expect(fixture.onError).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  test("still sends when username and password are both supplied", async () => {
    const sendMail: ReturnType<typeof jest.fn> = jest
      .fn()
      .mockResolvedValue(undefined as never);
    createTransportMock.mockReturnValue({ sendMail });
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new Email().run(
      validArgs({
        "smtp-username": "mailer-user",
        "smtp-password": "super-secret-password",
      }),
      fixture.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues).toEqual({});
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
