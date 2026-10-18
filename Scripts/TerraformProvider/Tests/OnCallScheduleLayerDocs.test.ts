/*
 * An on-call schedule layer's rotation and restriction times are JSON, and the
 * API's schema says nothing of their shape: its page said only "A JSON value:
 * write it with jsonencode()", and its example left both out. Readers worked
 * the shapes out by trial and error, one key is spelled restictionType, and a
 * weekly window's weekday comes from its timestamps
 * (OneUptime/terraform-provider-oneuptime#11). The page now applies both in
 * its example and describes every shape between the example and the schema.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { DocumentationGenerator } from "../Core/DocumentationGenerator";
import { OpenAPISpec } from "../Core/Types";
import { buildFixtureSpec, crudPaths } from "./Fixtures";

const dateTimeWrapper: any = {
  type: "object",
  "x-oneuptime-type": "DateTime",
  properties: {
    _type: { type: "string", enum: ["DateTime"] },
    value: { type: "string" },
  },
};

// The layer as the API's spec has it: both JSON columns untyped objects.
const layerSchema: any = {
  type: "object",
  description: "On-Call Schedule Layers",
  required: ["onCallDutyPolicyScheduleId", "name", "startsAt", "handOffTime"],
  properties: {
    _id: { type: "string", format: "uuid" },
    onCallDutyPolicyScheduleId: {
      type: "string",
      format: "uuid",
      description: "ID of your On-Call Policy Schedule",
    },
    name: { type: "string", description: "Friendly name for this layer" },
    description: { type: "string", description: "Description for this layer" },
    order: { type: "number", description: "Order / Priority of this layer" },
    startsAt: dateTimeWrapper,
    handOffTime: dateTimeWrapper,
    rotation: {
      type: "object",
      description:
        "How often would you like to hand off the duty to the next user in this layer?",
    },
    restrictionTimes: {
      type: "object",
      description: "Restrict this layer to these times",
    },
  },
};

let outputDir: string;
let layerDoc: string;
let monitorDoc: string;

beforeAll(async () => {
  const spec: OpenAPISpec = buildFixtureSpec();

  Object.assign(
    spec.paths,
    crudPaths({
      path: "/on-call-duty-schedule-layer",
      table: "OnCallDutyPolicyScheduleLayer",
      tag: "On-Call Schedule Layer",
      schema: "OnCallDutyPolicyScheduleLayer",
    }),
  );
  (spec.components!.schemas as Record<string, any>)[
    "OnCallDutyPolicyScheduleLayer"
  ] = layerSchema;

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-layer-docs-"));
  await new DocumentationGenerator(
    {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "14.0.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    },
    spec,
  ).generateDocumentation();

  layerDoc = fs.readFileSync(
    path.join(outputDir, "docs/resources/on_call_schedule_layer.md"),
    "utf-8",
  );
  monitorDoc = fs.readFileSync(
    path.join(outputDir, "docs/resources/monitor.md"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

/*
 * The block validate-docs-examples.sh applies: the first terraform block
 * after "## Example Usage", the way its awk reads it.
 */
function exampleOf(page: string): string {
  const afterHeading: string = page.slice(page.indexOf("## Example Usage"));
  const start: number = afterHeading.indexOf("```terraform\n");
  const body: string = afterHeading.slice(start + "```terraform\n".length);
  return body.slice(0, body.indexOf("\n```"));
}

describe("the on-call schedule layer's example", () => {
  test("is the one validate-docs-examples.sh applies, and it sets both JSON attributes", () => {
    const example: string = exampleOf(layerDoc);

    expect(example).toContain(
      'resource "oneuptime_on_call_schedule_layer" "example"',
    );
    expect(example).toContain("rotation = jsonencode({");
    expect(example).toContain("restriction_times = jsonencode({");
  });

  test("uses the shapes the server reads, spelling and all", () => {
    const example: string = exampleOf(layerDoc);

    expect(example).toContain('_type = "Recurring"');
    expect(example).toContain(
      'intervalCount = { _type = "PositiveNumber", value = 1 }',
    );
    expect(example).toContain('_type = "RestrictionTimes"');
    expect(example).toContain('restictionType = "Weekly"');
    expect(example).toContain('restictionType = "None"');
    expect(example).not.toContain("restrictionType");
  });

  test("gives each weekday a window of its own, dated on that weekday", () => {
    const example: string = exampleOf(layerDoc);

    for (const [day, date] of [
      ["Monday", "2026-01-05"],
      ["Tuesday", "2026-01-06"],
      ["Wednesday", "2026-01-07"],
      ["Thursday", "2026-01-08"],
      ["Friday", "2026-01-09"],
    ]) {
      expect(example).toMatch(new RegExp(`${day}\\s+= "${date}"`));
      // 2026-01-05 is a Monday, and so on: the weekday the date names.
      expect(new Date(`${date}T12:00:00Z`).getUTCDay()).toBe(
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].indexOf(
          day as string,
        ) + 1,
      );
    }

    expect(example).toContain("startDay  = day");
    expect(example).toContain("endDay    = day");
  });

  test("stacks a working-hours layer above an around-the-clock one, and refers to the schedule page's example", () => {
    const example: string = exampleOf(layerDoc);

    expect(example).toMatch(/order\s+= 1/);
    expect(example).toMatch(/order\s+= 2/);
    expect(
      example.match(
        /on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule\.example\.id/g,
      ),
    ).toHaveLength(2);
    // Every page's example lands in one configuration: no second "example".
    expect(
      example.match(/resource "oneuptime_on_call_schedule_layer" "example"/g),
    ).toHaveLength(1);
  });
});

describe("the on-call schedule layer's guide", () => {
  test("sits between the example and the schema, under an anchor", () => {
    const example: number = layerDoc.indexOf("## Example Usage");
    const anchor: number = layerDoc.indexOf(
      '<a id="rotation-and-restriction-times"></a>\n## Rotation and restriction times',
    );
    const schema: number = layerDoc.indexOf("## Schema");

    expect(example).toBeGreaterThan(-1);
    expect(anchor).toBeGreaterThan(example);
    expect(schema).toBeGreaterThan(anchor);
  });

  test("describes the rotation, its intervals and its count", () => {
    expect(layerDoc).toContain("### Rotation");
    expect(layerDoc).toContain("Hour, Day, Week, Month or Year");
    expect(layerDoc).toContain("`hand_off_time`");
  });

  test("describes each restriction type, and says how the key is spelled", () => {
    expect(layerDoc).toContain("### Restriction times");
    for (const type of ["`None`", "`Daily`", "`Weekly`"]) {
      expect(layerDoc).toContain(`- ${type}:`);
    }
    expect(layerDoc).toContain("dayRestrictionTimes = {");
    expect(layerDoc).toContain("weeklyRestrictionTimes = [{");
    expect(layerDoc).toContain("without the second");
  });

  test("says a weekly window is continuous, and how to cover working hours", () => {
    expect(layerDoc).toContain("A window is continuous");
    expect(layerDoc).toContain("give each day a window of its own");
  });

  test("says what a time is: with or without fractional seconds, in the schedule's timezone", () => {
    expect(layerDoc).toContain("with or without fractional seconds");
    expect(layerDoc).toContain("schedule's `timezone`");
    expect(layerDoc).toContain("2026-01-05T09:00:00-05:00");
  });

  test("says what leaving both out gives, and from which version", () => {
    expect(layerDoc).toContain("Both are optional.");
    expect(layerDoc).toContain("OneUptime 14.0.72 and later");
  });
});

describe("the schema", () => {
  test("links both JSON attributes to the guide", () => {
    for (const name of ["restriction_times", "rotation"]) {
      const line: string | undefined = layerDoc
        .split("\n")
        .find((text: string) => {
          return text.startsWith(`- \`${name}\` `);
        });

      expect(line).toContain(
        "See [Rotation and restriction times](#rotation-and-restriction-times).",
      );
    }
  });

  test("leaves every other page as it was: the schema follows the example", () => {
    expect(monitorDoc).not.toContain("Rotation and restriction times");
    expect(monitorDoc).toMatch(/\n```\n\n## Schema\n/);
  });
});
