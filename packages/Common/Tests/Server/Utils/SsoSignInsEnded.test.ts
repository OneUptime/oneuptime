import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SsoSignInsEnded, {
  SIGN_INS_ENDED_BY_DATABASE_SQL,
  SsoProviderSignInStanding,
} from "../../../Server/Utils/SsoSignInsEnded";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * TURNING AN SSO PROVIDER OFF ENDS THE SIGN-INS IT GAVE, WHATEVER KIND OF
 * PROVIDER IT IS (Server/Utils/SsoSignInsEnded).
 *
 * The one rule every kind of provider - a project's, the server's global
 * ones, a status page's - is judged by: a provider vouches for a sign-in it
 * gave only while it is on, and only for one given after it was last turned
 * off. And the step every provider service takes just before an update is
 * written: one that turns a provider off writes when, in the same write.
 */

const TURNED_OFF_AT_MS: number = Date.UTC(2026, 9, 7, 12, 0, 0, 400);

const standing: (
  isOn: boolean,
  signInsEndedAtMs: number | null,
) => SsoProviderSignInStanding = (
  isOn: boolean,
  signInsEndedAtMs: number | null,
): SsoProviderSignInStanding => {
  return { isOn, signInsEndedAtMs };
};

describe("whether a provider vouches for a sign-in it gave", () => {
  test("a provider that is on and was never turned off vouches for every sign-in it gave, dated or not", () => {
    expect(SsoSignInsEnded.doesProviderVouchFor(standing(true, null), 0)).toBe(
      true,
    );
    expect(
      SsoSignInsEnded.doesProviderVouchFor(
        standing(true, null),
        TURNED_OFF_AT_MS,
      ),
    ).toBe(true);
    expect(
      SsoSignInsEnded.doesProviderVouchFor(standing(true, null), null),
    ).toBe(true);
  });

  test("a provider that is off vouches for none, whenever they were given", () => {
    for (const signInsEndedAtMs of [null, TURNED_OFF_AT_MS]) {
      for (const issuedAtMs of [
        null,
        TURNED_OFF_AT_MS - 60_000,
        TURNED_OFF_AT_MS + 60_000,
      ]) {
        expect(
          SsoSignInsEnded.doesProviderVouchFor(
            standing(false, signInsEndedAtMs),
            issuedAtMs,
          ),
        ).toBe(false);
      }
    }
  });

  test("turned off and on again, it vouches only for the sign-ins it gave since", () => {
    const onAgain: SsoProviderSignInStanding = standing(true, TURNED_OFF_AT_MS);

    expect(
      SsoSignInsEnded.doesProviderVouchFor(onAgain, TURNED_OFF_AT_MS - 1),
    ).toBe(false);
    expect(
      SsoSignInsEnded.doesProviderVouchFor(onAgain, TURNED_OFF_AT_MS),
    ).toBe(false);
    expect(
      SsoSignInsEnded.doesProviderVouchFor(onAgain, TURNED_OFF_AT_MS + 1000),
    ).toBe(true);
  });

  test("a sign-in from the second it was turned off does not count: issue times are whole seconds, rounded down", () => {
    const issuedInThatSecondMs: number =
      Math.floor(TURNED_OFF_AT_MS / 1000) * 1000;

    expect(issuedInThatSecondMs).toBeLessThan(TURNED_OFF_AT_MS);
    expect(
      SsoSignInsEnded.doesProviderVouchFor(
        standing(true, TURNED_OFF_AT_MS),
        issuedInThatSecondMs,
      ),
    ).toBe(false);
  });

  test("a sign-in that does not say when it was given counts only for a provider never turned off", () => {
    expect(
      SsoSignInsEnded.doesProviderVouchFor(standing(true, null), null),
    ).toBe(true);
    expect(
      SsoSignInsEnded.doesProviderVouchFor(
        standing(true, TURNED_OFF_AT_MS),
        null,
      ),
    ).toBe(false);
  });
});

describe("reading when a provider's sign-ins ended", () => {
  test("a provider never turned off has no time", () => {
    for (const value of [null, undefined, "", 0]) {
      expect(SsoSignInsEnded.toSignInsEndedAtMs(value)).toBeNull();
    }
  });

  test("a stored time reads as milliseconds, as a Date or as text", () => {
    expect(SsoSignInsEnded.toSignInsEndedAtMs(new Date(TURNED_OFF_AT_MS))).toBe(
      TURNED_OFF_AT_MS,
    );
    expect(
      SsoSignInsEnded.toSignInsEndedAtMs(
        new Date(TURNED_OFF_AT_MS).toISOString(),
      ),
    ).toBe(TURNED_OFF_AT_MS);
  });

  test("a value that is not a time reads as none", () => {
    expect(SsoSignInsEnded.toSignInsEndedAtMs("not a time")).toBeNull();
  });
});

describe("the switch a write sets", () => {
  test("an update that writes Enabled says how; one that leaves it alone says nothing", () => {
    expect(SsoSignInsEnded.getWrittenIsEnabled({ isEnabled: false })).toBe(
      false,
    );
    expect(SsoSignInsEnded.getWrittenIsEnabled({ isEnabled: true })).toBe(true);
    expect(
      SsoSignInsEnded.getWrittenIsEnabled({ name: "Renamed" }),
    ).toBeUndefined();
    expect(SsoSignInsEnded.getWrittenIsEnabled(null)).toBeUndefined();
    expect(SsoSignInsEnded.getWrittenIsEnabled(undefined)).toBeUndefined();
  });

  test("only a boolean counts: DatabaseService has stored the switch as one before any hook runs", () => {
    expect(
      SsoSignInsEnded.getWrittenIsEnabled({ isEnabled: "false" }),
    ).toBeUndefined();
    expect(
      SsoSignInsEnded.getWrittenIsEnabled({ isEnabled: 0 }),
    ).toBeUndefined();
  });

  test("only the write's own field counts, never one it inherits", () => {
    const inherited: Record<string, unknown> = Object.create({
      isEnabled: false,
      restrictToAttachedProjects: true,
    }) as Record<string, unknown>;

    expect(SsoSignInsEnded.getWrittenIsEnabled(inherited)).toBeUndefined();
    expect(
      SsoSignInsEnded.getWrittenBoolean(
        inherited,
        "restrictToAttachedProjects",
      ),
    ).toBeUndefined();
  });

  test("any switch is read the same way", () => {
    expect(
      SsoSignInsEnded.getWrittenBoolean(
        { restrictToAttachedProjects: true },
        "restrictToAttachedProjects",
      ),
    ).toBe(true);
    expect(
      SsoSignInsEnded.getWrittenBoolean(
        { requireSsoForLogin: false },
        "requireSsoForLogin",
      ),
    ).toBe(false);
  });
});

describe("a write that turns a provider off writes when, in the same write", () => {
  type Row = Record<string, unknown>;

  const serviceOver: (rows: Array<Row>) => {
    service: DatabaseService<BaseModel>;
    findAllBy: ReturnType<typeof jest.fn>;
  } = (
    rows: Array<Row>,
  ): {
    service: DatabaseService<BaseModel>;
    findAllBy: ReturnType<typeof jest.fn>;
  } => {
    const findAllBy: ReturnType<typeof jest.fn> = jest.fn(
      async (): Promise<Array<Row>> => {
        return rows;
      },
    );

    return {
      service: { findAllBy } as unknown as DatabaseService<BaseModel>,
      findAllBy,
    };
  };

  const updateOf: (data: Record<string, unknown>) => UpdateBy<BaseModel> = (
    data: Record<string, unknown>,
  ): UpdateBy<BaseModel> => {
    return {
      query: { _id: "provider" },
      data: data,
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    } as unknown as UpdateBy<BaseModel>;
  };

  const writtenEndOf: (updateBy: UpdateBy<BaseModel>) => unknown = (
    updateBy: UpdateBy<BaseModel>,
  ): unknown => {
    return (updateBy.data as unknown as Record<string, unknown>)[
      "signInsEndedAt"
    ];
  };

  test("what the hooks found under their lock decides: a provider it turns off gets the time now", async () => {
    const { service, findAllBy } = serviceOver([]);
    const updateBy: UpdateBy<BaseModel> = updateOf({ isEnabled: false });
    const before: number = Date.now();

    await SsoSignInsEnded.stampWhenTurnedOff({
      service,
      updateBy,
      turnsOneOff: true,
    });

    const written: unknown = writtenEndOf(updateBy);
    expect(written).toBeInstanceOf(Date);
    expect((written as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((written as Date).getTime()).toBeLessThanOrEqual(Date.now());
    // Nothing read: the hooks already know.
    expect(findAllBy).not.toHaveBeenCalled();
  });

  test("one that turns off only providers that are off already keeps the time they have", async () => {
    const { service, findAllBy } = serviceOver([]);
    const updateBy: UpdateBy<BaseModel> = updateOf({ isEnabled: false });

    await SsoSignInsEnded.stampWhenTurnedOff({
      service,
      updateBy,
      turnsOneOff: false,
    });

    expect(writtenEndOf(updateBy)).toBeUndefined();
    expect(findAllBy).not.toHaveBeenCalled();
  });

  test("without the hooks' word, the rows the update names are read: one of them on is turned off", async () => {
    const { service, findAllBy } = serviceOver([
      { _id: "provider", isEnabled: false },
      { _id: "other", isEnabled: true },
    ]);
    const updateBy: UpdateBy<BaseModel> = updateOf({ isEnabled: false });

    await SsoSignInsEnded.stampWhenTurnedOff({ service, updateBy });

    expect(writtenEndOf(updateBy)).toBeInstanceOf(Date);
    expect(findAllBy).toHaveBeenCalledTimes(1);

    const read: Record<string, unknown> = findAllBy.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(read["query"]).toEqual({ _id: "provider" });
    expect(read["limit"]).toBe(1);
    expect(read["skip"]).toBe(0);
    expect(read["select"]).toEqual({ _id: true, isEnabled: true });
    expect(read["props"]).toEqual({ isRoot: true });
  });

  test("and every one of them off already keeps its time", async () => {
    const { service } = serviceOver([{ _id: "provider", isEnabled: false }]);
    const updateBy: UpdateBy<BaseModel> = updateOf({ isEnabled: false });

    await SsoSignInsEnded.stampWhenTurnedOff({ service, updateBy });

    expect(writtenEndOf(updateBy)).toBeUndefined();
  });

  test("turning a provider on, or changing anything else about it, writes no time and reads nothing", async () => {
    for (const data of [
      { isEnabled: true },
      { name: "Renamed" },
      { publicCertificate: "-----BEGIN CERTIFICATE-----" },
      { clientSecret: "a new secret" },
    ]) {
      const { service, findAllBy } = serviceOver([
        { _id: "provider", isEnabled: true },
      ]);
      const updateBy: UpdateBy<BaseModel> = updateOf(data);

      await SsoSignInsEnded.stampWhenTurnedOff({
        service,
        updateBy,
        turnsOneOff: true,
      });

      expect(writtenEndOf(updateBy)).toBeUndefined();
      expect(findAllBy).not.toHaveBeenCalled();
    }
  });
});

/*
 * A status page provider's time is written by the database, in the row's
 * own write (DatabaseService.getRowWriteSql): its sessions are compared
 * with it by the time the database gave them, so no difference between the
 * app's clock and the database's moves the line. Against Postgres in
 * StatusPageSsoSessionsPostgres.test.
 */
describe("a status page provider's turning-off write is stamped by the database", () => {
  test("the write that turns Enabled off names the column; the database works its value out", () => {
    const updateBy: Record<string, unknown> = {
      query: {},
      data: { isEnabled: false },
    };

    SsoSignInsEnded.stampWhenTurnedOffByDatabase({
      updateBy: updateBy as never,
    });

    const data: Record<string, unknown> = updateBy["data"] as Record<
      string,
      unknown
    >;
    expect(Object.keys(data)).toEqual(["isEnabled", "signInsEndedAt"]);
    expect(SsoSignInsEnded.getDatabaseStampSql(data)).toEqual({
      signInsEndedAt: SIGN_INS_ENDED_BY_DATABASE_SQL,
    });
  });

  test("the time is the database's own, for a row that was on; a row off already keeps its time", () => {
    expect(SIGN_INS_ENDED_BY_DATABASE_SQL).toBe(
      'CASE WHEN "isEnabled" = true THEN now() ELSE "signInsEndedAt" END',
    );
  });

  test("turning it on, or changing anything else, names no time and asks the database for none", () => {
    for (const data of [
      { isEnabled: true },
      { name: "Renamed" },
      { publicCertificate: "rotated" },
    ]) {
      const updateBy: Record<string, unknown> = {
        query: {},
        data: { ...data },
      };

      SsoSignInsEnded.stampWhenTurnedOffByDatabase({
        updateBy: updateBy as never,
      });

      expect(updateBy["data"]).toEqual(data);
      expect(SsoSignInsEnded.getDatabaseStampSql(updateBy["data"])).toEqual({});
    }
  });

  test("a write that does not name the column gets no SQL for it", () => {
    expect(SsoSignInsEnded.getDatabaseStampSql({ isEnabled: false })).toEqual(
      {},
    );
  });
});
