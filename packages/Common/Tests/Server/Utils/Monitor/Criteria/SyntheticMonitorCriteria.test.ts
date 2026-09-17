import SyntheticMonitoringCriteria from "../../../../../Server/Utils/Monitor/Criteria/SyntheticMonitor";
import CustomCodeMonitoringCriteria from "../../../../../Server/Utils/Monitor/Criteria/CustomCodeMonitorCriteria";
import BrowserType from "../../../../../Types/BrowserType";
import ScreenSizeType from "../../../../../Types/ScreenSizeType";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import SyntheticMonitorResponse from "../../../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The repo mixes @types/jest and @jest/globals typings, so the concrete spy
 * type returned by jest.spyOn is not portable between them. This structural
 * alias is the same workaround used elsewhere in Common/Tests and is all these
 * tests need: a call count.
 */
type SpyLike = {
  mock: { calls: Array<unknown> };
};

/*
 * A synthetic monitor run produces one SyntheticMonitorResponse per
 * browser / screen-size combination it was configured with (Chromium + Firefox,
 * Mobile + Desktop, ...). SyntheticMonitoringCriteria.isMonitorInstanceCriteriaFilterMet
 * has to evaluate EVERY response in that array and return the first one that
 * breaches the filter; a non-matching response must not end the evaluation.
 *
 * These tests pin that contract down for the BrowserType / ScreenSizeType
 * branches (which previously returned the raw, possibly-null, comparison result
 * from inside the loop and therefore only ever looked at the first response),
 * and confirm the custom-code branch keeps its short-circuit behaviour.
 */

function buildResponse(input: {
  browserType: BrowserType;
  screenSizeType: ScreenSizeType;
  executionTimeInMS?: number | undefined;
  scriptError?: string | undefined;
}): SyntheticMonitorResponse {
  return {
    result: "ok",
    scriptError: input.scriptError,
    logMessages: [],
    capturedMetrics: [],
    executionTimeInMS: input.executionTimeInMS ?? 100,
    browserType: input.browserType,
    screenSizeType: input.screenSizeType,
  };
}

function evaluate(
  monitorResponse: Array<SyntheticMonitorResponse>,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return SyntheticMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
    monitorResponse,
    criteriaFilter,
  });
}

describe("SyntheticMonitoringCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("every response in the run is evaluated", () => {
    test("CheckOn.BrowserType matches on the SECOND response", async () => {
      const responses: Array<SyntheticMonitorResponse> = [
        buildResponse({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Desktop,
        }),
        buildResponse({
          browserType: BrowserType.Firefox,
          screenSizeType: ScreenSizeType.Desktop,
        }),
      ];

      const result: string | null = await evaluate(responses, {
        checkOn: CheckOn.BrowserType,
        filterType: FilterType.EqualTo,
        value: BrowserType.Firefox,
      });

      expect(result).toBe(`${CheckOn.BrowserType} is equal to Firefox.`);
    });

    test("CheckOn.ScreenSizeType matches on the LAST response", async () => {
      const responses: Array<SyntheticMonitorResponse> = [
        buildResponse({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Mobile,
        }),
        buildResponse({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Tablet,
        }),
        buildResponse({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Desktop,
        }),
      ];

      const result: string | null = await evaluate(responses, {
        checkOn: CheckOn.ScreenSizeType,
        filterType: FilterType.EqualTo,
        value: ScreenSizeType.Desktop,
      });

      expect(result).toBe(`${CheckOn.ScreenSizeType} is equal to Desktop.`);
    });

    test("the first MATCHING response still wins", async () => {
      const responses: Array<SyntheticMonitorResponse> = [
        buildResponse({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Mobile,
        }),
        buildResponse({
          browserType: BrowserType.Firefox,
          screenSizeType: ScreenSizeType.Desktop,
        }),
      ];

      /*
       * NotEqualTo matches BOTH responses; the message must describe the first
       * one that matched rather than the last one seen.
       */
      const result: string | null = await evaluate(responses, {
        checkOn: CheckOn.ScreenSizeType,
        filterType: FilterType.NotEqualTo,
        value: ScreenSizeType.Desktop,
      });

      expect(result).toBe(`${CheckOn.ScreenSizeType} is not equal to Desktop.`);
    });
  });

  describe("no match", () => {
    test("no response matches the browser type → null", async () => {
      const responses: Array<SyntheticMonitorResponse> = [
        buildResponse({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Desktop,
        }),
        buildResponse({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Mobile,
        }),
      ];

      const result: string | null = await evaluate(responses, {
        checkOn: CheckOn.BrowserType,
        filterType: FilterType.EqualTo,
        value: BrowserType.Firefox,
      });

      expect(result).toBeNull();
    });

    test("no response matches the screen size → null, and all responses were visited", async () => {
      const customCodeSpy: SpyLike = jest.spyOn(
        CustomCodeMonitoringCriteria,
        "isMonitorInstanceCriteriaFilterMet",
      ) as unknown as SpyLike;

      const responses: Array<SyntheticMonitorResponse> = [
        buildResponse({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Mobile,
        }),
        buildResponse({
          browserType: BrowserType.Firefox,
          screenSizeType: ScreenSizeType.Tablet,
        }),
        buildResponse({
          browserType: BrowserType.Firefox,
          screenSizeType: ScreenSizeType.Mobile,
        }),
      ];

      const result: string | null = await evaluate(responses, {
        checkOn: CheckOn.ScreenSizeType,
        filterType: FilterType.EqualTo,
        value: ScreenSizeType.Desktop,
      });

      expect(result).toBeNull();
      // one custom-code evaluation per response proves the loop ran to the end.
      expect(customCodeSpy.mock.calls.length).toBe(responses.length);
    });

    test("empty response array → null", async () => {
      const result: string | null = await evaluate([], {
        checkOn: CheckOn.BrowserType,
        filterType: FilterType.EqualTo,
        value: BrowserType.Chromium,
      });

      expect(result).toBeNull();
    });
  });

  describe("custom code criteria", () => {
    test("a custom-code breach on the first response short-circuits the loop", async () => {
      const customCodeSpy: SpyLike = jest.spyOn(
        CustomCodeMonitoringCriteria,
        "isMonitorInstanceCriteriaFilterMet",
      ) as unknown as SpyLike;

      const responses: Array<SyntheticMonitorResponse> = [
        buildResponse({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Desktop,
          executionTimeInMS: 5000,
        }),
        buildResponse({
          browserType: BrowserType.Firefox,
          screenSizeType: ScreenSizeType.Desktop,
          executionTimeInMS: 6000,
        }),
      ];

      const result: string | null = await evaluate(responses, {
        checkOn: CheckOn.ExecutionTime,
        filterType: FilterType.GreaterThan,
        value: 1000,
      });

      expect(result).toBeTruthy();
      expect(customCodeSpy.mock.calls.length).toBe(1);
    });

    test("a custom-code breach on a LATER response is still reported", async () => {
      const responses: Array<SyntheticMonitorResponse> = [
        buildResponse({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Desktop,
          executionTimeInMS: 100,
        }),
        buildResponse({
          browserType: BrowserType.Firefox,
          screenSizeType: ScreenSizeType.Desktop,
          executionTimeInMS: 9000,
        }),
      ];

      const result: string | null = await evaluate(responses, {
        checkOn: CheckOn.ExecutionTime,
        filterType: FilterType.GreaterThan,
        value: 1000,
      });

      expect(result).toBeTruthy();
    });
  });
});
