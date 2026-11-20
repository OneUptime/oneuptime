const getSymbolTablesMock: jest.Mock = jest.fn();

jest.mock("../../../../Server/Services/TelemetryDsymService", () => {
  return {
    __esModule: true,
    default: {
      getSymbolTables: (...args: Array<unknown>) => {
        return getSymbolTablesMock(...args);
      },
    },
  };
});

import AppleSymbolication from "../../../../Server/Utils/Telemetry/AppleSymbolication";
import ObjectID from "../../../../Types/ObjectID";
import {
  AppleSymbolTable,
  decodeAppleSymbols,
  encodeAppleSymbols,
} from "../../../../Utils/Telemetry/AppleSymbols";
import { toReadableMetricKitStackTrace } from "../../../../Utils/Telemetry/MetricKitCallStack";
import {
  APP_UUID,
  CRASH_KSCRASH_REPORT,
  HANG_TREE,
} from "../../../Utils/Telemetry/AppleCrashFixtures";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * #9922: ingest hands an iOS app's crash and hang stacks here before they
 * are grouped. Each build's table is read once and kept; a build with no
 * dSYM is asked about again within minutes, so a dSYM uploaded after its
 * build's first crash names the crashes that follow.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

const TABLE: AppleSymbolTable = decodeAppleSymbols(
  encodeAppleSymbols({
    symbols: [
      { offset: 20000, name: "main" },
      { offset: 188368, name: "$s5MyApp18CartViewControllerC4loadyyKF" },
      { offset: 229064, name: "$s5MyApp18CartViewControllerC8checkoutyyF" },
      {
        offset: 310000,
        name: "$s5MyApp18CartViewControllerC5fetch2idS2i_tYaKF",
      },
    ],
    textEndOffset: 400000,
  }),
)!;

function withTable(): void {
  getSymbolTablesMock.mockImplementation(
    async (data: { debugIds: Array<string> }) => {
      return new Map<string, AppleSymbolTable>(
        data.debugIds.includes(APP_UUID) ? [[APP_UUID, TABLE]] : [],
      );
    },
  );
}

async function symbolicate(
  stackTrace: string,
  projectId: ObjectID = PROJECT_ID,
): Promise<string | null> {
  return AppleSymbolication.symbolicateStackTrace({ projectId, stackTrace });
}

beforeEach(() => {
  AppleSymbolication.clearCache();
  getSymbolTablesMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a stack trace, symbolicated", () => {
  test("a KSCrash report: the app's frames by their functions, demangled", async () => {
    withTable();

    const text: string | null = await symbolicate(CRASH_KSCRASH_REPORT);

    expect(text).toContain("(CartViewController.checkout() + 732)");
    expect(text).toContain("(CartViewController.load() + 52)");
    expect(text).toContain("(main + 320)");
    expect(getSymbolTablesMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      debugIds: [APP_UUID],
    });
  });

  test("a MetricKit hang drawn as threads", async () => {
    withTable();

    expect(
      await symbolicate(toReadableMetricKitStackTrace(HANG_TREE, "hang")!),
    ).toContain("(CartViewController.fetch(id:) +");
  });

  test("anything that is no Apple crash report is left alone, and nothing is read for it", async () => {
    withTable();

    expect(
      await symbolicate(
        "java.lang.IllegalStateException: boom\n\tat com.example.Cart.checkout(Cart.java:42)",
      ),
    ).toBe(null);
    expect(await symbolicate("")).toBe(null);
    expect(getSymbolTablesMock).not.toHaveBeenCalled();
  });

  test("a report no dSYM resolves is left alone", async () => {
    getSymbolTablesMock.mockResolvedValue(new Map());

    expect(await symbolicate(CRASH_KSCRASH_REPORT)).toBe(null);
  });

  test("a read that fails leaves the stack as it was, and never throws", async () => {
    getSymbolTablesMock.mockRejectedValue(new Error("Postgres is down"));

    expect(await symbolicate(CRASH_KSCRASH_REPORT)).toBe(null);
  });
});

describe("each build's table, read once", () => {
  test("a build's next crash is named from memory", async () => {
    withTable();

    await symbolicate(CRASH_KSCRASH_REPORT);
    await symbolicate(CRASH_KSCRASH_REPORT);

    expect(getSymbolTablesMock).toHaveBeenCalledTimes(1);
  });

  test("by project: another project's dSYM of a UUID is its own", async () => {
    withTable();

    await symbolicate(CRASH_KSCRASH_REPORT);
    await symbolicate(CRASH_KSCRASH_REPORT, ObjectID.generate());

    expect(getSymbolTablesMock).toHaveBeenCalledTimes(2);
  });

  test("a build with no dSYM is asked about again after two minutes, so a dSYM uploaded since names its crashes", async () => {
    let now: number = Date.UTC(2026, 10, 20, 9, 0, 0);
    jest.spyOn(Date, "now").mockImplementation(() => {
      return now;
    });

    getSymbolTablesMock.mockResolvedValue(new Map());

    expect(await symbolicate(CRASH_KSCRASH_REPORT)).toBe(null);

    now += 60 * 1000;
    expect(await symbolicate(CRASH_KSCRASH_REPORT)).toBe(null);
    expect(getSymbolTablesMock).toHaveBeenCalledTimes(1);

    // The dSYM is uploaded.
    withTable();
    now += 61 * 1000;

    expect(await symbolicate(CRASH_KSCRASH_REPORT)).toContain(
      "CartViewController.checkout()",
    );
    expect(getSymbolTablesMock).toHaveBeenCalledTimes(2);
  });

  test("a table is kept for half an hour", async () => {
    let now: number = Date.UTC(2026, 10, 20, 9, 0, 0);
    jest.spyOn(Date, "now").mockImplementation(() => {
      return now;
    });

    withTable();
    await symbolicate(CRASH_KSCRASH_REPORT);

    now += 29 * 60 * 1000;
    await symbolicate(CRASH_KSCRASH_REPORT);
    expect(getSymbolTablesMock).toHaveBeenCalledTimes(1);

    now += 2 * 60 * 1000;
    await symbolicate(CRASH_KSCRASH_REPORT);
    expect(getSymbolTablesMock).toHaveBeenCalledTimes(2);
  });
});
