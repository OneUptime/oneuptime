import { afterEach, describe, expect, jest, test } from "@jest/globals";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ObjectID from "Common/Types/ObjectID";
import {
  SESSION_LENGTH_SETTING_COLUMNS,
  SessionLengths,
} from "Common/Types/UserSession/SessionLength";
import SessionLengthStore, {
  SESSION_LENGTHS_SELECT,
} from "../../../Server/SessionLength/SessionLengthStore";

/*
 * Where the session lengths are read from: GlobalConfig's five columns, as
 * root, each value read the way core reads it (Common/Types/UserSession/
 * SessionLength.ts) - so the lengths every server holds sessions to are
 * exactly what a master admin saved, and a value no write could have set is
 * the default rather than a surprise.
 */

const NO_LENGTHS: SessionLengths = {
  standard: { lengthInMinutes: null, idleTimeoutInMinutes: null },
  sso: { lengthInMinutes: null, idleTimeoutInMinutes: null },
};

type FindOneById = typeof GlobalConfigService.findOneById;

const holding: (
  row: Record<string, unknown> | null,
) => jest.SpiedFunction<FindOneById> = (
  row: Record<string, unknown> | null,
): jest.SpiedFunction<FindOneById> => {
  return jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      if (!row) {
        return null;
      }

      const config: GlobalConfig = new GlobalConfig();
      Object.assign(config, row);
      return config;
    });
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SessionLengthStore.readLengths", () => {
  test("reads the five columns of the one GlobalConfig row, as root", async () => {
    const read: jest.SpiedFunction<FindOneById> = holding({});

    await SessionLengthStore.readLengths();

    expect(read).toHaveBeenCalledTimes(1);

    const request: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = read.mock.calls[0]![0] as unknown as {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(request.id.toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(request.select).toEqual(SESSION_LENGTHS_SELECT);
    expect(request.props).toEqual({ isRoot: true });
  });

  test("selects exactly the setting's columns", () => {
    expect(Object.keys(SESSION_LENGTHS_SELECT).sort()).toEqual(
      [...SESSION_LENGTH_SETTING_COLUMNS].sort(),
    );
  });

  test("one rule for every sign-in while SSO sign-ins have none of their own", async () => {
    holding({
      sessionLengthInMinutes: 480,
      sessionIdleTimeoutInMinutes: 30,
      useSeparateSsoSessionLengths: false,
      // Set once, then the switch turned off: not applied.
      ssoSessionLengthInMinutes: 60,
      ssoSessionIdleTimeoutInMinutes: 15,
    });

    await expect(SessionLengthStore.readLengths()).resolves.toEqual({
      standard: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
      sso: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
    });
  });

  test("SSO sign-ins' own lengths while the switch is on, empty ones the defaults", async () => {
    holding({
      sessionLengthInMinutes: 480,
      sessionIdleTimeoutInMinutes: 30,
      useSeparateSsoSessionLengths: true,
      ssoSessionLengthInMinutes: 12 * 60,
      ssoSessionIdleTimeoutInMinutes: null,
    });

    await expect(SessionLengthStore.readLengths()).resolves.toEqual({
      standard: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
      sso: { lengthInMinutes: 720, idleTimeoutInMinutes: null },
    });
  });

  test("a value no write could have set is the default", async () => {
    holding({
      sessionLengthInMinutes: 5,
      sessionIdleTimeoutInMinutes: 99999999,
      useSeparateSsoSessionLengths: "yes",
    });

    await expect(SessionLengthStore.readLengths()).resolves.toEqual(NO_LENGTHS);
  });

  test("no row yet, an installation still being set up, is no lengths", async () => {
    holding(null);

    await expect(SessionLengthStore.readLengths()).resolves.toEqual(NO_LENGTHS);
  });

  test("a read that fails throws, so the provider keeps what it holds", async () => {
    jest
      .spyOn(GlobalConfigService, "findOneById")
      .mockRejectedValue(new Error("the database went away") as never);

    await expect(SessionLengthStore.readLengths()).rejects.toThrow(
      "the database went away",
    );
  });
});
