/*
 * A FILTER THE API WOULD NOT READ AS ONE IS REFUSED, AND NOTHING ELSE IS.
 *
 * A list or count tool takes any field, so nothing in its schema stops a filter
 * written another way: {"$regex": ...} as MongoDB writes it, or an operator
 * OneUptime does not have. The API passes such a filter on, and the database
 * compares a text column with the object's JSON, so the agent is told there is
 * nothing to find (Tools/FilterCheck). These hold the check to refusing exactly
 * those: Tests/DescribeResource holds it to letting through every operator
 * oneuptime_describe_resource teaches, on every field of every resource.
 */

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import { getFilterProblem } from "../Tools/FilterCheck";
import { generateAllTools } from "../Tools/ToolGenerator";
import { McpToolInfo } from "../Types/McpTypes";

const A_UUID: string = "550e8400-e29b-41d4-a716-446655440000";
const A_TIME: string = "2026-07-01T00:00:00.000Z";

const tools: Array<McpToolInfo> = generateAllTools();

function tool(name: string): McpToolInfo {
  const found: McpToolInfo | undefined = tools.find(
    (candidate: McpToolInfo): boolean => {
      return candidate.name === name;
    },
  );

  if (!found) {
    throw new Error(`No tool named ${name}.`);
  }

  return found;
}

describe("the filter check", () => {
  const incidents: McpToolInfo = tool("list_incidents");
  const logs: McpToolInfo = tool("list_logs");

  test.each([
    ["no filter", undefined],
    ["an empty filter", {}],
    ["a value, for an exact match", { title: "Checkout is down" }],
    ["a null", { rootCause: null }],
    ["an operator", { title: { _type: "Search", value: "checkout" } }],
    [
      "a range, which has no value of its own",
      {
        createdAt: { _type: "InBetween", startValue: A_TIME, endValue: A_TIME },
      },
    ],
    ["an operator that takes nothing", { rootCause: { _type: "IsNull" } }],
    ["a list of values", { _id: { _type: "Includes", value: [A_UUID] } }],
    ["a typed value", { declaredAt: { _type: "DateTime", value: A_TIME } }],
    [
      "a relation, filtered by its own fields",
      { currentIncidentState: { isResolvedState: false } },
    ],
    [
      "a field the record does not have, which the API refuses by name",
      { nope: { $regex: "checkout" } },
    ],
  ])("lets through %s", (_label: string, query: unknown) => {
    expect(getFilterProblem(incidents, query)).toBeNull();
  });

  test("lets through a telemetry map, filtered by its keys", () => {
    expect(
      getFilterProblem(logs, {
        attributes: {
          "http.method": "GET",
          "http.url": { _type: "Search", value: "checkout" },
        },
      }),
    ).toBeNull();
  });

  test.each([
    [
      "MongoDB's $regex",
      { title: { $regex: "checkout" } },
      'title {"$regex":"checkout"}',
    ],
    [
      "MongoDB's $gt on a date",
      { createdAt: { $gt: "2026-01-01" } },
      'createdAt {"$gt":"2026-01-01"}',
    ],
    [
      "an operator OneUptime does not have",
      { title: { _type: "Contains", value: "checkout" } },
      'title {"_type":"Contains","value":"checkout"}',
    ],
    [
      "an ID written as an object",
      { projectId: { _id: A_UUID } },
      `projectId {"_id":"${A_UUID}"}`,
    ],
  ])(
    "refuses %s, naming the field and its value",
    (_label: string, query: unknown, named: string) => {
      const problem: string | null = getFilterProblem(incidents, query);

      expect(problem).toContain(
        `Not a value or an operator OneUptime reads: ${named}.`,
      );
      // And says how a filter is written.
      expect(problem).toContain('{"_type":"Search","value":"checkout"}');
    },
  );

  test("refuses the same on telemetry", () => {
    expect(
      getFilterProblem(logs, {
        severityText: { $in: ["Error", "Fatal"] },
        time: { _type: "GreaterThan", value: A_TIME },
      }),
    ).toContain('severityText {"$in":["Error","Fatal"]}');
  });

  test("names every field it refuses, and none it does not", () => {
    const problem: string | null = getFilterProblem(incidents, {
      title: { $regex: "checkout" },
      createdAt: { $gt: "2026-01-01" },
      description: { _type: "Search", value: "checkout" },
    });

    expect(problem).toContain('title {"$regex":"checkout"}');
    expect(problem).toContain('createdAt {"$gt":"2026-01-01"}');
    expect(problem).not.toContain("description");
  });

  test.each([
    ["a string of JSON", '{"title":"Checkout is down"}'],
    ["an array", [{ title: "Checkout is down" }]],
    ["a number", 5],
  ])(
    "refuses a query that is %s, not an object",
    (_label: string, query: unknown) => {
      expect(getFilterProblem(incidents, query)).toContain(
        'query is an object of field names, such as {"title": "Checkout is down"}',
      );
    },
  );

  test("quotes no more than the start of a long value", () => {
    const problem: string | null = getFilterProblem(incidents, {
      title: { $regex: "x".repeat(10_000) },
    });

    expect(problem).toContain("...");
    expect((problem as string).length).toBeLessThan(500);
  });

  test("checks the count tools as the list tools", () => {
    expect(
      getFilterProblem(tool("count_incidents"), {
        title: { $regex: "checkout" },
      }),
    ).toContain('title {"$regex":"checkout"}');
  });
});
