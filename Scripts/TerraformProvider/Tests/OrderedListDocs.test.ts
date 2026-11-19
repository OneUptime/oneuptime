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
 * schema, and its `order` attribute links there.
 *
 * The drag-ordered lists (@ListOrderColumn: severities, states, monitor
 * statuses, custom fields, pipelines, filters, rules...) work the same way
 * since OneUptime/oneuptime#9609, and the spec marks their tags with what
 * their number means (x-oneuptime-list-order): their pages get an Order
 * section written from it, which their number's attribute - `order`,
 * `sort_order` or `priority` - links to. No other page has one.
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  DocumentationGenerator,
  ORDERED_LIST_PAGES,
  getListOrderAttribute,
} from "../Core/DocumentationGenerator";
import { OpenAPISpec } from "../Core/Types";
import { ListOrderFacts } from "Common/Utils/DeveloperDocs/ListOrderFacts";
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

// A drag-ordered list, as the spec's tag marks it (x-oneuptime-list-order).
interface DragFixture {
  resource: string;
  path: string;
  table: string;
  tag: string;
  facts: ListOrderFacts;
  // The columns naming its list besides the project, as the API writes them.
  listColumns: Array<string>;
}

const DRAG_LISTS: Array<DragFixture> = [
  {
    resource: "incident_severity",
    path: "/incident-severity",
    table: "IncidentSeverity",
    tag: "Incident Severity",
    listColumns: [],
    facts: {
      column: "order",
      descending: false,
      singular: "incident severity",
      plural: "incident severities",
      parent: "project",
    },
  },
  {
    resource: "incident_state",
    path: "/incident-state",
    table: "IncidentState",
    tag: "Incident State",
    listColumns: [],
    facts: {
      column: "order",
      descending: false,
      singular: "incident state",
      plural: "incident states",
      parent: "project",
      insertsAbove: "resolved state",
      keepsInOrder: ["created state", "acknowledged state", "resolved state"],
    },
  },
  {
    resource: "network_site_assignment_rule",
    path: "/network-site-assignment-rule",
    table: "NetworkSiteAssignmentRule",
    tag: "Network Site Assignment Rule",
    listColumns: [],
    facts: {
      column: "priority",
      descending: true,
      singular: "network site assignment rule",
      plural: "network site assignment rules",
      parent: "project",
    },
  },
  {
    resource: "log_pipeline_processor",
    path: "/log-pipeline-processor",
    table: "LogPipelineProcessor",
    tag: "Log Pipeline Processor",
    listColumns: ["logPipelineId"],
    facts: {
      column: "sortOrder",
      descending: false,
      singular: "log pipeline processor",
      plural: "log pipeline processors",
      parent: "log pipeline",
    },
  },
  {
    resource: "public_note_approval_step",
    path: "/public-note-approval-step",
    table: "PublicNoteApprovalStep",
    tag: "Public Note Approval Step",
    listColumns: ["eventType"],
    facts: {
      column: "order",
      descending: false,
      singular: "public note approval step",
      plural: "public note approval steps",
      parent: "project",
      sameAs: "event type",
    },
  },
];

// A row of a drag-ordered list as the API's spec has it.
function dragSchema(fixture: DragFixture): any {
  const properties: Record<string, any> = {
    _id: { type: "string", format: "uuid" },
    name: { type: "string", description: "Its name" },
    [fixture.facts.column]: {
      type: "number",
      description: "Where it sits in its list.",
    },
  };

  for (const column of fixture.listColumns) {
    properties[column] = {
      type: "string",
      description: "What holds its list",
    };
  }

  return {
    type: "object",
    description: `${fixture.tag}s`,
    properties: properties,
  };
}

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

  for (const fixture of DRAG_LISTS) {
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
      dragSchema(fixture);
    spec.tags!.push({
      name: fixture.tag,
      description: `${fixture.tag}s`,
      "x-oneuptime-table": fixture.table,
      "x-oneuptime-list-order": fixture.facts,
    });
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

  for (const fixture of [...LISTS, ...DRAG_LISTS]) {
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

describe.each(DRAG_LISTS)(
  "the $resource page (a drag-ordered list)",
  (fixture: DragFixture) => {
    const attribute: string = getListOrderAttribute(fixture.facts);

    test("has an Order section, between its example and its schema", () => {
      const page: string = pages[fixture.resource]!;
      const order: number = page.indexOf('<a id="order"></a>\n## Order');

      expect(order).toBeGreaterThan(page.indexOf("## Example Usage"));
      expect(order).toBeLessThan(page.indexOf("## Schema"));
    });

    test("says a write of its number places the row and moves no other, so a numbered list applies as written", () => {
      const section: string = orderSection(pages[fixture.resource]!);

      expect(section).toContain(
        `\`${attribute}\` is this ${fixture.facts.singular}'s place among the ${fixture.facts.plural} of its ${fixture.facts.parent}`,
      );
      expect(section).toContain(
        `Setting it places this ${fixture.facts.singular} and moves no other`,
      );
      expect(section).toContain("is applied exactly as written");
      expect(section).toContain("the next plan is empty");
    });

    test("says what two rows at one number, a row without one, a deleted row and a move in the Dashboard do", () => {
      const section: string = orderSection(pages[fixture.resource]!);

      expect(section).toContain(
        `two ${fixture.facts.plural} at one number are taken in the order of their IDs`,
      );
      expect(section).toContain(`created without \`${attribute}\``);
      expect(section).toContain(
        "leaves a gap in the numbers, which changes nothing",
      );
      expect(section).toContain("in the OneUptime Dashboard numbers");
      expect(section).toContain(`changes to \`${attribute}\`.`);
    });

    test("links its number's attribute to the section", () => {
      const line: string | undefined = pages[fixture.resource]!.split(
        "\n",
      ).find((candidate: string) => {
        return candidate.startsWith(`- \`${attribute}\``);
      });

      expect(line).toBeDefined();
      expect(line).toContain("See [Order](#order).");
    });
  },
);

describe("a drag-ordered list's Order section, in its own words", () => {
  test("names the attribute the provider gives the column: order, sort_order or priority", () => {
    expect(
      DRAG_LISTS.map((fixture: DragFixture) => {
        return getListOrderAttribute(fixture.facts);
      }),
    ).toEqual(["order", "order", "priority", "sort_order", "order"]);
  });

  test("a list counted from the top numbers 1..n, and a new row goes after the last", () => {
    const section: string = orderSection(pages["incident_severity"]!);

    expect(section).toContain(
      "`order` is this incident severity's place among the incident severities of its project, lowest first.",
    );
    expect(section).toContain(
      "order = index(local.incident_severities, each.key) + 1",
    );
    expect(section).toContain(
      "An incident severity created without `order` goes after the last one of its project.",
    );
    expect(section).toContain(
      "numbers the project's incident severities 1..n again",
    );
  });

  test("a list whose top is its highest number says so, numbers down, and puts a new rule at the bottom", () => {
    const section: string = orderSection(
      pages["network_site_assignment_rule"]!,
    );

    expect(section).toContain("of its project, the highest number first.");
    expect(section).toContain(
      "priority = length(local.network_site_assignment_rules) - index(local.network_site_assignment_rules, each.key)",
    );
    expect(section).toContain(
      "A network site assignment rule created without `priority` goes below the last one of its project, one number lower.",
    );
    expect(section).toContain(
      "numbers the project's network site assignment rules n..1 again",
    );
  });

  test("a state says where a new one goes, and which built-in states keep their order", () => {
    const section: string = orderSection(pages["incident_state"]!);

    expect(section).toContain(
      "An incident state created without `order` goes just above the resolved state, and the project's incident states are numbered 1..n again: give it `order` if the configuration numbers the others.",
    );
    expect(section).toContain(
      "- The created state, acknowledged state and resolved state keep that order: a write that would put them out of order is refused, so number them in that order.",
    );
    expect(orderSection(pages["incident_severity"]!)).not.toContain(
      "keep that order",
    );
  });

  test("a list held by a parent, or split by a column, names it", () => {
    expect(orderSection(pages["log_pipeline_processor"]!)).toContain(
      "`sort_order` is this log pipeline processor's place among the log pipeline processors of its log pipeline, lowest first.",
    );
    expect(orderSection(pages["log_pipeline_processor"]!)).toContain(
      "numbers the log pipeline's log pipeline processors 1..n again",
    );

    const steps: string = orderSection(pages["public_note_approval_step"]!);

    expect(steps).toContain(
      "among the public note approval steps of its project with the same event type, lowest first.",
    );
    expect(steps).toContain(
      "numbers the public note approval steps of the project with that event type 1..n again",
    );
  });

  test("a numbered list's own words win over the spec's", () => {
    expect(orderSection(pages["status_page_group"]!)).toContain(
      `Setting it places this ${ORDERED_LIST_PAGES["status_page_group"]!.thing} and moves no other`,
    );
  });
});

describe("a page of no numbered list", () => {
  test("has no Order section, and no link to one", () => {
    expect(monitorDoc).not.toContain("## Order");
    expect(monitorDoc).not.toContain("(#order)");
  });
});
