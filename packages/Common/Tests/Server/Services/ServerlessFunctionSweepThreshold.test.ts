import ServerlessFunctionService from "../../../Server/Services/ServerlessFunctionService";
import ReceivingCoverage from "../../../Server/Utils/Telemetry/ReceivingCoverage";
import {
  SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES,
  SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_DESCRIPTION,
} from "../../../Types/Serverless/ServerlessFunctionStatus";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";

/*
 * Issue #6269: a serverless function turns "disconnected" - which the
 * Dashboard says as "No recent invocations" - after the minutes the
 * status's own words name ("Nothing has arrived in the last 15 minutes").
 * The sweep and the words read one constant,
 * SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES, so they can
 * never say different numbers. This holds the sweep to it: it asks for its
 * cutoff with exactly that number, and moves when the number does.
 */

const SENTINEL_CUTOFF: Date = new Date("2026-11-08T11:45:00.000Z");

const STATUS_MODULE: string = "../../../Types/Serverless/ServerlessFunctionStatus";
const SERVICE_MODULE: string =
  "../../../Server/Services/ServerlessFunctionService";
const COVERAGE_MODULE: string = "../../../Server/Utils/Telemetry/ReceivingCoverage";

// The value a QueryHelper.lessThan(...) was built with.
function lessThanValue(operator: unknown): unknown {
  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};
  return Object.values(parameters)[0];
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the serverless sweep's silence is the status's number", () => {
  test("it asks ReceivingCoverage for a cutoff of the status module's minutes, and turns quiet only what is older", async () => {
    const cutoffSpy: SpyInstance<typeof ReceivingCoverage.getSilenceCutoff> =
      jest
        .spyOn(ReceivingCoverage, "getSilenceCutoff")
        .mockResolvedValue(SENTINEL_CUTOFF);
    const findBy: SpyInstance<(...args: Array<unknown>) => Promise<unknown>> =
      jest
        .spyOn(
          ServerlessFunctionService as unknown as {
            findBy: (...args: Array<unknown>) => Promise<unknown>;
          },
          "findBy",
        )
        .mockResolvedValue([]);

    await ServerlessFunctionService.markDisconnectedFunctions();

    expect(cutoffSpy).toHaveBeenCalledTimes(1);
    expect(cutoffSpy).toHaveBeenCalledWith({
      silenceInMinutes: SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES,
    });
    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    // Only what is still "connected" turns, and only once older than the cutoff.
    expect(query["otelCollectorStatus"]).toBe("connected");
    expect(lessThanValue(query["lastSeenAt"])).toEqual(SENTINEL_CUTOFF);
  });

  test("the number is the one the words say", () => {
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES).toBe(15);
    expect(SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_DESCRIPTION).toContain(
      `in the last ${SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES} minutes`,
    );
  });

  /*
   * Load the service again with a status module whose number is 42: the
   * sweep must ask for 42 minutes. A sweep that wrote its own 15 would
   * still pass the test above, and fail this one.
   */
  test("it moves with the constant: no number of its own", async () => {
    let run: (() => Promise<void>) | undefined;
    let isolatedCutoff:
      | SpyInstance<typeof ReceivingCoverage.getSilenceCutoff>
      | undefined;

    jest.isolateModules(() => {
      jest.doMock(STATUS_MODULE, () => {
        return {
          ...(jest.requireActual(STATUS_MODULE) as Record<string, unknown>),
          SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES: 42,
        };
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const coverage: typeof ReceivingCoverage = require(COVERAGE_MODULE)
        .default as typeof ReceivingCoverage;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const service: typeof ServerlessFunctionService = require(SERVICE_MODULE)
        .default as typeof ServerlessFunctionService;

      isolatedCutoff = jest
        .spyOn(coverage, "getSilenceCutoff")
        .mockResolvedValue(SENTINEL_CUTOFF);
      jest
        .spyOn(
          service as unknown as {
            findBy: (...args: Array<unknown>) => Promise<unknown>;
          },
          "findBy",
        )
        .mockResolvedValue([]);
      run = (): Promise<void> => {
        return service.markDisconnectedFunctions();
      };
    });

    await run!();

    expect(isolatedCutoff).toHaveBeenCalledWith({ silenceInMinutes: 42 });
    jest.dontMock(STATUS_MODULE);
  });

  test("the sweep's source names the constant, and no minutes of its own", () => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../../Server/Services/ServerlessFunctionService.ts"),
      "utf8",
    );
    const sweep: string = source.slice(
      source.indexOf("public async markDisconnectedFunctions()"),
    );

    expect(source).toContain(
      'import { SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES } from "../../Types/Serverless/ServerlessFunctionStatus";',
    );
    expect(sweep).toContain(
      "silenceInMinutes: SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES,",
    );
    expect(sweep).not.toMatch(/silenceInMinutes:\s*\d/);
  });
});
