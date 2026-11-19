/*
 * A NUMBERED LIST'S PAGE SAYS WHAT `order` DOES (OneUptime/oneuptime#9573).
 *
 * A status page's groups and resources, an on-call policy's escalation
 * rules, a schedule's layers and the people in a layer are numbered by
 * `order`. A write of it used to be taken as a move - the rows it passed
 * stepped aside - so numbering a whole list from Terraform, one write per
 * row, all at once, never settled. The API now places the row written and
 * moves no other, which makes such a configuration apply exactly as
 * written. Each of the five pages says so, between its example and its
 * schema, and its `order` attribute links there; no other page does.
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  DocumentationGenerator,
  ORDERED_LIST_PAGES,
} from "../Core/DocumentationGenerator";
import { OpenAPISpec } from "../Core/Types";
import { buildFixtureSpec, crudPaths } from "./Fixtures";

interface ListFixture {
  resource: string;
  path: string;
  table: string;
  tag: string;
  parentColumn: string;
}

const LISTS: Array<ListFixture> = [
  {
    resource: "status_page_group",
    path: "/status-page-group",
    table: "StatusPageGroup",
    tag: "Status Page Group",
    parentColumn: "statusPageId",
  },
  {
    resource: "status_page_resource",
    path: "/status-page-resource",
    table: "StatusPageResource",
    tag: "Status Page Resource",
    parentColumn: "statusPageId",
  },
  {
    resource: "escalation_rule",
    path: "/on-call-duty-policy-escalation-rule",
    table: "OnCallDutyPolicyEscalationRule",
    tag: "Escalation Rule",
    parentColumn: "onCallDutyPolicyId",
  },
  {
    resource: "on_call_schedule_layer",
    path: "/on-call-duty-policy-schedule-layer",
    table: "OnCallDutyPolicyScheduleLayer",
    tag: "On-Call Schedule Layer",
    parentColumn: "onCallDutyPolicyScheduleId",
  },
  {
    resource: "on_call_schedule_layer_user",
    path: "/on-call-duty-policy-schedule-layer-user",
    table: "OnCallDutyPolicyScheduleLayerUser",
    tag: "On-Call Schedule Layer User",
    parentColumn: "onCallDutyPolicyScheduleLayerId",
  },
];

// A row of the list as the API's spec has it: its parent, a name, its order.
function listSchema(fixture: ListFixture): any {
  return {
    type: "object",
    description: `${fixture.tag}s`,
    required: [fixture.parentColumn],
    properties: {
      _id: { type: "string", format: "uuid" },
      [fixture.parentColumn]: {
        type: "string",
        format: "uuid",
        description: "ID of the list's parent",
      },
      name: { type: "string", description: "Its name" },
      order: {
        type: "number",
        description: "Its place in its list, lowest first.",
      },
    },
  };
}

let outputDir: string;
const pages: Record<string, string> = {};
let monitorDoc: string;

beforeAll(async () => {
  const spec: OpenAPISpec = buildFixtureSpec();

  for (const fixture of LISTS) {
    Object.assign(
      spec.paths,
      crudPaths({
        path: fixture.path,
        table: fixture.table,
        tag: fixture.tag,
        schema: fixture.table,
      }),
    );
    (spec.components!.schemas as Record<string, any>)[fixture.table] =
      listSchema(fixture);
  }

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-ordered-docs-"));
  await new DocumentationGenerator(
    {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "16.0.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    },
    spec,
  ).generateDocumentation();

  for (const fixture of LISTS) {
    pages[fixture.resource] = fs.readFileSync(
      path.join(outputDir, `docs/resources/${fixture.resource}.md`),
      "utf-8",
    );
  }

  monitorDoc = fs.readFileSync(
    path.join(outputDir, "docs/resources/monitor.md"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

// The page's Order section: from its heading to the next "## ".
function orderSection(page: string): string {
  const start: number = page.indexOf('<a id="order"></a>\n## Order');

  if (start < 0) {
    return "";
  }

  const rest: string = page.slice(start + 1);
  const next: number = rest.indexOf("\n## ", rest.indexOf("## Order") + 1);

  return next < 0 ? rest : rest.slice(0, next);
}

describe.each(LISTS)("the $resource page", (fixture: ListFixture) => {
  test("has an Order section, between its example and its schema", () => {
    const page: string = pages[fixture.resource]!;
    const order: number = page.indexOf('<a id="order"></a>\n## Order');

    expect(order).toBeGreaterThan(page.indexOf("## Example Usage"));
    expect(order).toBeLessThan(page.indexOf("## Schema"));
  });

  test("says a write of order places the row and moves no other, so a numbered list applies as written", () => {
    const section: string = orderSection(pages[fixture.resource]!);
    const words: (typeof ORDERED_LIST_PAGES)[string] =
      ORDERED_LIST_PAGES[fixture.resource]!;

    expect(section).toContain(
      `Setting it places this ${words.thing} and moves no other`,
    );
    expect(section).toContain("is applied exactly as written");
    expect(section).toContain("the next plan is empty");
    expect(section).toContain(
      `order = index(local.${words.localName}, each.key) + 1`,
    );
  });

  test("says what two rows at one number, a row without one, a deleted row and a move in the Dashboard do", () => {
    const section: string = orderSection(pages[fixture.resource]!);
    const words: (typeof ORDERED_LIST_PAGES)[string] =
      ORDERED_LIST_PAGES[fixture.resource]!;

    expect(section).toContain(
      `two ${words.things} at one number ${words.shared}`,
    );
    expect(section).toContain(
      `A ${words.thing} created without \`order\` ${words.leftOut}.`,
    );
    expect(section).toContain(
      "leaves a gap in the numbers, which changes nothing",
    );
    expect(section).toContain("in the OneUptime Dashboard numbers the");
  });

  test("links its order attribute to the section", () => {
    const orderLine: string | undefined = pages[fixture.resource]!.split(
      "\n",
    ).find((line: string) => {
      return line.startsWith("- `order`");
    });

    expect(orderLine).toBeDefined();
    expect(orderLine).toContain("See [Order](#order).");
  });
});

describe("the pages of a schedule's layers and the people in them", () => {
  test("point at the resource that orders the layers and who takes turns in one write", () => {
    for (const resource of [
      "on_call_schedule_layer",
      "on_call_schedule_layer_user",
    ]) {
      expect(orderSection(pages[resource]!)).toContain(
        "[`oneuptime_on_call_schedule_layers`](./on_call_schedule_layers)",
      );
    }

    expect(orderSection(pages["status_page_group"]!)).not.toContain(
      "on_call_schedule_layers",
    );
  });

  test("the layer page keeps its rotation guide beside the Order section", () => {
    const page: string = pages["on_call_schedule_layer"]!;

    expect(page).toContain(
      '<a id="rotation-and-restriction-times"></a>\n## Rotation and restriction times',
    );
    expect(page.indexOf("## Rotation and restriction times")).toBeLessThan(
      page.indexOf("## Order"),
    );
  });
});

describe("a page of no numbered list", () => {
  test("has no Order section, and no link to one", () => {
    expect(monitorDoc).not.toContain("## Order");
    expect(monitorDoc).not.toContain("(#order)");
  });
});
