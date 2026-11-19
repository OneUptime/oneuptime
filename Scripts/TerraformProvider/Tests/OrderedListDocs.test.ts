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
 * Since #9650 every drag-ordered list (@ListOrderColumn: severities, states,
 * monitor statuses, custom fields, pipelines, filters, rules, links) keeps
 * the same rules, and its page says so too (#9652), in a section written
 * from the facts the spec carries on its tag (x-oneuptime-list-order): its
 * number's attribute (`order`, `sort_order`, `priority`), which end is the
 * top, what holds the list, where a row created without a number goes, and
 * which built-in rows stay in order. No other page has such a section.
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  DocumentationGenerator,
  ORDERED_LIST_PAGES,
  getListOrderAttribute,
} from "../Core/DocumentationGenerator";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { OpenAPISpec, TerraformResource } from "../Core/Types";
import { buildFixtureSpec, crudPaths } from "./Fixtures";
import { ListOrderFacts } from "Common/Utils/DeveloperDocs/ListOrderFacts";

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

/*
 * DRAG-ORDERED LISTS (issue #9652): every model marked @ListOrderColumn,
 * whose tag the spec marks with its facts (x-oneuptime-list-order,
 * Common/Utils/DeveloperDocs/ListOrderFacts, whose own test reads them off
 * the real models). These fixtures carry the facts the real ones have: a
 * project's list, a state list that keeps its built-in rows in order and
 * puts a new state just above the resolved one, a pipeline's processors
 * numbered by sort_order, rules that count down, a list of one kind, and a
 * list whose built-in rows keep their order but whose new rows go last.
 */
interface DragFixture {
  resource: string;
  path: string;
  table: string;
  tag: string;
  // The number's column, as the API names it, and as the provider does.
  column: string;
  attribute: string;
  // The column naming the list's parent, when it is not the project.
  parentColumn?: string | undefined;
  facts: ListOrderFacts;
}

const DRAG_LISTS: Array<DragFixture> = [
  {
    resource: "incident_severity",
    path: "/incident-severity",
    table: "IncidentSeverity",
    tag: "Incident Severity",
    column: "order",
    attribute: "order",
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
    column: "order",
    attribute: "order",
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
    resource: "log_pipeline_processor",
    path: "/log-pipeline-processor",
    table: "LogPipelineProcessor",
    tag: "Log Pipeline Processor",
    column: "sortOrder",
    attribute: "sort_order",
    parentColumn: "logPipelineId",
    facts: {
      column: "sortOrder",
      descending: false,
      singular: "log pipeline processor",
      plural: "log pipeline processors",
      parent: "log pipeline",
    },
  },
  {
    resource: "network_site_assignment_rule",
    path: "/network-site-assignment-rule",
    table: "NetworkSiteAssignmentRule",
    tag: "Network Site Assignment Rule",
    column: "priority",
    attribute: "priority",
    facts: {
      column: "priority",
      descending: true,
      singular: "network site assignment rule",
      plural: "network site assignment rules",
      parent: "project",
    },
  },
  {
    resource: "public_note_approval_step",
    path: "/public-note-approval-step",
    table: "PublicNoteApprovalStep",
    tag: "Public Note Approval Step",
    column: "order",
    attribute: "order",
    facts: {
      column: "order",
      descending: false,
      singular: "public note approval step",
      plural: "public note approval steps",
      parent: "project",
      sameAs: "event type",
    },
  },
  {
    resource: "security_case_priority",
    path: "/security-case-priority",
    table: "SecurityCasePriority",
    tag: "Security Case Priority",
    column: "order",
    attribute: "order",
    facts: {
      column: "order",
      descending: false,
      singular: "security case priority",
      plural: "security case priorities",
      parent: "project",
      keepsInOrder: [
        "critical priority",
        "high priority",
        "medium priority",
        "low priority",
        "informational priority",
      ],
    },
  },
];

// A row of a drag-ordered list as the spec has it: a name, its number.
function dragListSchema(fixture: DragFixture): any {
  return {
    type: "object",
    description: `${fixture.tag}s`,
    required: fixture.parentColumn ? [fixture.parentColumn] : [],
    properties: {
      _id: { type: "string", format: "uuid" },
      ...(fixture.parentColumn
        ? {
            [fixture.parentColumn]: {
              type: "string",
              format: "uuid",
              description: "ID of the list's parent",
            },
          }
        : {}),
      name: { type: "string", description: "Its name" },
      [fixture.column]: {
        type: "number",
        description: "Its place in its list.",
      },
    },
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
let fixtureSpec: OpenAPISpec;

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
      dragListSchema(fixture);
    spec.tags!.push({
      name: fixture.tag,
      description: `${fixture.tag}s of a project.`,
      "x-oneuptime-table": fixture.table,
      "x-oneuptime-list-order": fixture.facts,
    });
  }

  fixtureSpec = spec;

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

describe("a page of no numbered list", () => {
  test("has no Order section, and no link to one", () => {
    expect(monitorDoc).not.toContain("## Order");
    expect(monitorDoc).not.toContain("(#order)");
  });
});

// A drag-ordered list's page: what each fixture's facts make of it.
describe.each(DRAG_LISTS)(
  "the $resource page, of a drag-ordered list",
  (fixture: DragFixture) => {
    const page: () => string = (): string => {
      return pages[fixture.resource]!;
    };

    test("reads its list's facts off its tag", () => {
      const parser: OpenAPIParser = new OpenAPIParser();
      parser.setSpec(fixtureSpec);
      const resource: TerraformResource | undefined = parser
        .getResources()
        .find((candidate: TerraformResource): boolean => {
          return candidate.name === fixture.resource;
        });

      expect(resource?.listOrder).toEqual(fixture.facts);
      expect(getListOrderAttribute(fixture.facts)).toBe(fixture.attribute);
    });

    test("has an Order section, between its example and its schema", () => {
      const order: number = page().indexOf('<a id="order"></a>\n## Order');

      expect(order).toBeGreaterThan(page().indexOf("## Example Usage"));
      expect(order).toBeLessThan(page().indexOf("## Schema"));
    });

    test("says a write of its number places the row and moves no other, so a numbered list applies as written", () => {
      const section: string = orderSection(page());
      const { singular, plural } = fixture.facts;

      expect(section).toContain(
        `\`${fixture.attribute}\` is this ${singular}'s place among the ${plural} of its ${fixture.facts.parent}`,
      );
      expect(section).toContain(
        `Setting it places this ${singular} and moves no other`,
      );
      expect(section).toContain("is applied exactly as written");
      expect(section).toContain("the next plan is empty");
    });

    test("numbers its list in a for_each from the top, whichever way the list counts", () => {
      const section: string = orderSection(page());
      const local: string = fixture.facts.plural.replace(/ /g, "_");

      expect(section).toContain(
        fixture.facts.descending
          ? `${fixture.attribute} = length(local.${local}) - index(local.${local}, each.key)`
          : `${fixture.attribute} = index(local.${local}, each.key) + 1`,
      );
      expect(section).toContain(
        fixture.facts.descending ? "the highest number first" : "lowest first",
      );
      expect(section).toContain(
        fixture.facts.descending ? "n..1 again" : "1..n again",
      );
    });

    test("says two rows at one number are shown the older first, as the list shows them", () => {
      expect(orderSection(page())).toContain(
        `two ${fixture.facts.plural} at one number are shown the older first`,
      );
      expect(orderSection(page())).not.toContain("order of their IDs");
    });

    test("says where a row created without a number goes", () => {
      const section: string = orderSection(page());
      const insertsAbove: string | undefined = fixture.facts.insertsAbove;

      if (insertsAbove) {
        // It takes the anchor's place, and the rows from there step down.
        expect(section).toContain(
          `created without \`${fixture.attribute}\` goes just above the ${insertsAbove}: it takes the ${insertsAbove}'s number, and the ${insertsAbove} and the ${fixture.facts.plural} right below it step down one.`,
        );
        expect(section).not.toContain("goes after the last one");
        return;
      }

      expect(section).toContain(
        fixture.facts.descending
          ? `created without \`${fixture.attribute}\` goes below the last one of its ${fixture.facts.parent}, one number lower.`
          : `created without \`${fixture.attribute}\` goes after the last one of its ${fixture.facts.parent}`,
      );
      expect(section).not.toContain("goes just above");
    });

    test("says which built-in rows keep their order, when the list has any", () => {
      const section: string = orderSection(page());
      const kept: Array<string> | undefined = fixture.facts.keepsInOrder;

      if (!kept) {
        expect(section).not.toContain("stay in that order");
        return;
      }

      expect(section).toContain(
        `The ${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]} stay in that order, from the top: a write that would put two of them at one number, or out of order, is refused.`,
      );
      expect(section).toContain("apply again and it finishes");
    });

    test("says what holds a list of one kind", () => {
      const section: string = orderSection(page());

      if (fixture.facts.sameAs) {
        expect(section).toContain(
          `the ${fixture.facts.plural} of its project with the same ${fixture.facts.sameAs}`,
        );
        expect(section).toContain(
          `numbers the ${fixture.facts.plural} of the project with that ${fixture.facts.sameAs}`,
        );
        return;
      }

      expect(section).toContain(
        `numbers the ${fixture.facts.parent}'s ${fixture.facts.plural}`,
      );
    });

    test("says a deleted row leaves a gap that changes nothing", () => {
      expect(orderSection(page())).toContain(
        "leaves a gap in the numbers, which changes nothing",
      );
    });

    test("links its number's attribute to the section, and no other", () => {
      const lines: Array<string> = page().split("\n");
      const numberLine: string | undefined = lines.find((line: string) => {
        return line.startsWith(`- \`${fixture.attribute}\``);
      });

      expect(numberLine).toBeDefined();
      expect(numberLine).toContain("See [Order](#order).");
      expect(
        lines.filter((line: string): boolean => {
          return line.includes("See [Order](#order).");
        }),
      ).toHaveLength(1);
    });
  },
);

describe("a resource whose tag carries no list facts", () => {
  test("gets no Order section, though it has a number", () => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(fixtureSpec);

    expect(
      parser
        .getResources()
        .filter((resource: TerraformResource): boolean => {
          return Boolean(resource.listOrder);
        })
        .map((resource: TerraformResource): string => {
          return resource.name;
        })
        .sort(),
    ).toEqual(
      DRAG_LISTS.map((fixture: DragFixture): string => {
        return fixture.resource;
      }).sort(),
    );

    // The five numbered lists have a section of their own words instead.
    for (const fixture of LISTS) {
      expect(pages[fixture.resource]).not.toContain(
        "are shown the older first",
      );
    }
  });
});
