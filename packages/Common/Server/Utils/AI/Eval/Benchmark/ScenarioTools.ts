import { JSONObject } from "../../../../../Types/JSON";
import { ToolCallOutcome } from "../../Toolbox/Index";
import Serializer, { SerializedResult } from "../../Toolbox/Serializer";
import { BenchmarkScenario, BenchmarkToolResponse } from "./BenchmarkScenario";

/*
 * Answers a benchmark investigation's tool calls from its scenario's
 * scripted telemetry (BenchmarkScenario.responses), in the toolbox's own
 * format, so the model reads what it would read from a real project. Pure:
 * the same call always gets the same answer, which is also how the scorer
 * tells which of the answer's citations were the fault's own evidence.
 */
export default class ScenarioTools {
  // The response that answers a call, or null when none is scripted for it.
  public static findResponse(
    scenario: BenchmarkScenario,
    toolName: string,
    toolArguments: JSONObject | undefined,
  ): BenchmarkToolResponse | null {
    for (const response of scenario.responses) {
      if (response.toolName !== toolName) {
        continue;
      }

      if (this.matches(response, toolArguments || {})) {
        return response;
      }
    }

    return null;
  }

  public static answer(
    scenario: BenchmarkScenario,
    toolName: string,
    toolArguments: JSONObject | undefined,
  ): ToolCallOutcome {
    const response: BenchmarkToolResponse | null = this.findResponse(
      scenario,
      toolName,
      toolArguments,
    );

    const serialized: SerializedResult = response
      ? this.serialize(response)
      : Serializer.serializeRows([]);

    return {
      success: true,
      textForLlm: serialized.text,
      result: {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: response?.citationLabel || toolName,
        redactionCount: 0,
        isTruncated: serialized.isTruncated,
      },
    };
  }

  public static isKeyEvidence(
    scenario: BenchmarkScenario,
    toolName: string,
    toolArguments: JSONObject | undefined,
  ): boolean {
    return (
      this.findResponse(scenario, toolName, toolArguments)?.isKeyEvidence ===
      true
    );
  }

  private static serialize(response: BenchmarkToolResponse): SerializedResult {
    if (typeof response.text === "string") {
      return Serializer.serializeText(
        response.text,
        response.rows ? response.rows.length : 1,
      );
    }

    return Serializer.serializeRows(response.rows || []);
  }

  private static matches(
    response: BenchmarkToolResponse,
    toolArguments: JSONObject,
  ): boolean {
    const conditions: { [argumentName: string]: string } =
      response.whenArguments || {};

    for (const argumentName of Object.keys(conditions)) {
      const expected: string = (conditions[argumentName] || "").toLowerCase();

      if (!this.valueHolds(toolArguments[argumentName], expected)) {
        return false;
      }
    }

    return true;
  }

  private static valueHolds(value: unknown, expected: string): boolean {
    if (value === undefined || value === null) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.some((item: unknown) => {
        return this.valueHolds(item, expected);
      });
    }

    if (typeof value === "object") {
      return JSON.stringify(value).toLowerCase().includes(expected);
    }

    return String(value).toLowerCase().includes(expected);
  }
}
