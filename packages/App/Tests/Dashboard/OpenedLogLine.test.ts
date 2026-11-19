import { beforeAll, describe, expect, test } from "@jest/globals";
import type * as HookModuleType from "../../FeatureSet/Dashboard/src/Components/Logs/useOpenedLogLine";

/*
 * One log line, opened by its id on the Logs page (#9620): the address
 * names it - `log`, and `logTime`, when it was written - and the line is
 * read in the second around then, or, without a time, around when its
 * time-ordered id says it arrived.
 */

type HookModule = typeof HookModuleType;

let Hook: HookModule;

const LOG_ID: string = "0192f1a0-0000-7000-8000-000000000001";
const AT: Date = new Date("2026-10-27T06:45:12.345Z");

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: "/dashboard/11111111-1111-4111-8111-111111111111/logs",
      search: "",
      hash: "",
    },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Hook = await import(
    "../../FeatureSet/Dashboard/src/Components/Logs/useOpenedLogLine"
  );
});

describe("the line an address opens", () => {
  test("reads the line's id and when it was written", () => {
    expect(
      Hook.readOpenedLogLineAddress(
        `?range=Custom&log=${LOG_ID}&logTime=${encodeURIComponent(AT.toISOString())}`,
      ),
    ).toEqual({ logId: LOG_ID, logTime: AT });
  });

  test("a line without a time, or with one it cannot read, is still opened", () => {
    expect(Hook.readOpenedLogLineAddress(`?log=${LOG_ID}`)).toEqual({
      logId: LOG_ID,
      logTime: null,
    });
    expect(
      Hook.readOpenedLogLineAddress(`?log=${LOG_ID}&logTime=yesterday`),
    ).toEqual({ logId: LOG_ID, logTime: null });
  });

  test("an address that names no line, or something that is not an id, opens none", () => {
    expect(Hook.readOpenedLogLineAddress("?range=PastOneHour")).toBeNull();
    expect(Hook.readOpenedLogLineAddress("?log=")).toBeNull();
    expect(Hook.readOpenedLogLineAddress("?log=';DROP TABLE")).toBeNull();
  });
});

describe("when a line is looked for", () => {
  test("in the second either side of when it was written", () => {
    expect(
      Hook.getOpenedLogLineWindow({
        address: { logId: LOG_ID, logTime: AT },
        now: new Date(),
      }),
    ).toEqual({
      start: new Date(AT.getTime() - Hook.OPENED_LOG_LINE_TIME_SLACK_IN_MS),
      end: new Date(AT.getTime() + Hook.OPENED_LOG_LINE_TIME_SLACK_IN_MS),
    });
  });

  test("without a time, in the day before its time-ordered id says it arrived", () => {
    const arrived: Date = new Date("2026-10-27T06:45:00.000Z");
    const hex: string = arrived.getTime().toString(16).padStart(12, "0");
    const id: string = `${hex.substring(0, 8)}-${hex.substring(8, 12)}-7abc-8def-0123456789ab`;

    expect(Hook.getTimeOfTimeOrderedId(id)).toEqual(arrived);
    expect(
      Hook.getOpenedLogLineWindow({
        address: { logId: id, logTime: null },
        now: new Date("2030-01-01T00:00:00.000Z"),
      }),
    ).toEqual({
      start: new Date(
        arrived.getTime() - Hook.OPENED_LOG_LINE_ARRIVAL_LOOK_BACK_IN_MS,
      ),
      end: new Date(
        arrived.getTime() + Hook.OPENED_LOG_LINE_ARRIVAL_LOOK_AHEAD_IN_MS,
      ),
    });
  });

  test("an id that is not time-ordered says nothing of when, so the day before now is read", () => {
    const now: Date = new Date("2026-10-27T12:00:00.000Z");
    const randomId: string = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

    expect(Hook.getTimeOfTimeOrderedId(randomId)).toBeNull();
    expect(Hook.getTimeOfTimeOrderedId("not an id")).toBeNull();
    expect(
      Hook.getOpenedLogLineWindow({
        address: { logId: randomId, logTime: null },
        now,
      }).start,
    ).toEqual(
      new Date(now.getTime() - Hook.OPENED_LOG_LINE_ARRIVAL_LOOK_BACK_IN_MS),
    );
  });
});
