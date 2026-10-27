import {
  INSTANCE_CHECK_IN_URL,
  checkIn,
} from "../../FeatureSet/Workers/Jobs/InstanceCheckIn/CheckIn";
import RunCron from "../../FeatureSet/Workers/Utils/Cron";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import { EVERY_DAY } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Once a day every self-hosted install tells oneuptime.com its URL and the
 * version it runs - nothing about anyone - so OneUptime knows which installs
 * still run a release with a security issue. One setting turns it off, and
 * with no route out it fails quietly.
 */

type Flags = {
  billingEnabled: boolean;
  checkInDisabled: boolean;
};

/*
 * The flags live inside the factory: services read IsBillingEnabled while
 * the modules load, before this file's own variables exist.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const flags: Flags = { billingEnabled: false, checkInDisabled: false };

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    AppVersion: "10.0.6",
    mockFlags: flags,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return flags.billingEnabled;
    },
  });

  Object.defineProperty(mocked, "DisableInstanceCheckIn", {
    get: (): boolean => {
      return flags.checkInDisabled;
    },
  });

  return mocked;
});

// RunCron registers a repeatable BullMQ job at import time.
jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Logger");

// What the job module registered when it was imported, before any test ran.
const registrations: Array<Array<unknown>> = [
  ...(RunCron as unknown as jest.Mock).mock.calls,
];

const flags: Flags = (
  jest.requireMock("Common/Server/EnvironmentConfig") as { mockFlags: Flags }
).mockFlags;

let post: ReturnType<typeof jest.spyOn>;
let getHost: ReturnType<typeof jest.spyOn>;

function readSource(file: string): string {
  return fs.readFileSync(path.join(__dirname, "../../", file), "utf8");
}

beforeEach(() => {
  flags.billingEnabled = false;
  flags.checkInDisabled = false;

  getHost = jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.acme.io"));

  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);

  post = jest.spyOn(API, "post").mockResolvedValue({
    isSuccess: (): boolean => {
      return true;
    },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the daily check-in", () => {
  test("runs once a day, and not on startup", () => {
    expect(registrations).toEqual([
      [
        "InstanceCheckIn:CheckIn",
        { schedule: EVERY_DAY, runOnStartup: false, timeoutInMS: 60 * 1000 },
        checkIn,
      ],
    ]);
  });

  test("sends oneuptime.com the install's URL and version, and nothing else", async () => {
    await checkIn();

    expect(post).toHaveBeenCalledTimes(1);

    const { url, data, options } = post.mock.calls[0]![0] as {
      url: URL;
      data: JSONObject;
      options: JSONObject;
    };

    expect(INSTANCE_CHECK_IN_URL).toBe(
      "https://oneuptime.com/api/open-source-deployment/check-in",
    );
    expect(url.toString()).toBe(INSTANCE_CHECK_IN_URL);
    expect(data).toEqual({
      instanceUrl: "https://oneuptime.acme.io/",
      oneuptimeVersion: "10.0.6",
    });
    expect(options).toEqual({ timeout: 15000 });
  });

  test("sends the same instance URL a sign-up with release emails ticked sends", () => {
    // So a check-in updates the record that sign-up made.
    const sameUrl: string =
      "const instanceUrl: string = new URL(httpProtocol, host).toString();";

    expect(readSource("FeatureSet/Identity/API/Authentication.ts")).toContain(
      sameUrl,
    );
    expect(
      readSource("FeatureSet/Workers/Jobs/InstanceCheckIn/CheckIn.ts"),
    ).toContain(sameUrl);
  });

  test("makes no call when DISABLE_INSTANCE_CHECK_IN is set", async () => {
    flags.checkInDisabled = true;

    await checkIn();

    expect(post).not.toHaveBeenCalled();
    expect(getHost).not.toHaveBeenCalled();
  });

  test("makes no call from the hosted service", async () => {
    flags.billingEnabled = true;

    await checkIn();

    expect(post).not.toHaveBeenCalled();
  });

  test("fails quietly with no route to oneuptime.com", async () => {
    post.mockRejectedValue(new Error("getaddrinfo ENOTFOUND") as never);

    await expect(checkIn()).resolves.toBeUndefined();
  });

  test("fails quietly when oneuptime.com answers with an error", async () => {
    post.mockResolvedValue({
      isSuccess: (): boolean => {
        return false;
      },
    } as never);

    await expect(checkIn()).resolves.toBeUndefined();
  });
});
