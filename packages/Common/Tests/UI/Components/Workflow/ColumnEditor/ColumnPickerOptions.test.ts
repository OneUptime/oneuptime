/*
 * The order the "Add a field" list shows a model's fields in, and what its
 * search finds.
 *
 * The columns below are Create One Incident's writable fields as the
 * /model-schema endpoint describes them (titles, keys, required and default
 * flags), so the groups asserted here are the ones a builder actually sees.
 */

import TableColumnType from "../../../../../Types/Database/TableColumnType";
import {
  ColumnPickerGroup,
  ColumnPickerGroupId,
  groupPickerColumns,
  isColumnDescriptionInformative,
  isColumnKeyInformative,
  searchPickerColumns,
  summarizeDescription,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnPickerOptions";
import { ColumnUse } from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnUse";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import { describe, expect, test } from "@jest/globals";

type MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string; title: string },
) => ModelSchemaColumn;

const makeColumn: MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string; title: string },
): ModelSchemaColumn => {
  return {
    type: TableColumnType.ShortText,
    isRelation: false,
    ...overrides,
  };
};

const INCIDENT_FIELDS: Array<ModelSchemaColumn> = [
  makeColumn({
    id: "title",
    title: "Title",
    type: TableColumnType.LongText,
    required: true,
    description: "Title of this incident.",
  }),
  makeColumn({
    id: "description",
    title: "Description",
    type: TableColumnType.Markdown,
    description: "Short description of this incident.",
  }),
  makeColumn({
    id: "declaredAt",
    title: "Declared At",
    type: TableColumnType.Date,
    required: true,
    hasDefault: true,
    description: "When this incident was declared.",
  }),
  makeColumn({
    id: "currentIncidentStateId",
    title: "Current Incident State ID",
    type: TableColumnType.ObjectID,
    required: true,
    hasDefault: true,
    description: "Current state of this incident.",
  }),
  makeColumn({
    id: "incidentSeverityId",
    title: "Incident Severity ID",
    type: TableColumnType.ObjectID,
    required: true,
    description: "How bad this incident is.",
  }),
  makeColumn({
    id: "changeMonitorStatusToId",
    title: "Change Monitor Status To ID",
    type: TableColumnType.ObjectID,
    description:
      "Relation to Monitor Status Object ID. All monitors connected to this incident will be changed to this status when the incident is created.",
  }),
  makeColumn({
    id: "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    title: "Should subscribers be notified?",
    type: TableColumnType.Boolean,
    description:
      "Should status page subscribers be notified when this incident is created?",
  }),
  makeColumn({
    id: "isPrivate",
    title: "Is Private?",
    type: TableColumnType.Boolean,
    description: "Private incidents are only visible to their owners.",
  }),
  makeColumn({
    id: "rootCause",
    title: "Root Cause",
    type: TableColumnType.Markdown,
    description: "What caused this incident, once it is known.",
  }),
];

type IdsFunction = (columns: Array<ModelSchemaColumn>) => Array<string>;

const ids: IdsFunction = (columns: Array<ModelSchemaColumn>): Array<string> => {
  return columns.map((column: ModelSchemaColumn) => {
    return column.id;
  });
};

type GroupByIdFunction = (
  groups: Array<ColumnPickerGroup>,
  id: ColumnPickerGroupId,
) => ColumnPickerGroup | undefined;

const groupById: GroupByIdFunction = (
  groups: Array<ColumnPickerGroup>,
  id: ColumnPickerGroupId,
): ColumnPickerGroup | undefined => {
  return groups.find((group: ColumnPickerGroup) => {
    return group.id === id;
  });
};

describe("groupPickerColumns on a create", () => {
  const groups: Array<ColumnPickerGroup> = groupPickerColumns({
    columns: INCIDENT_FIELDS,
    use: ColumnUse.Create,
    requiredColumnIds: ["title", "incidentSeverityId"],
  });

  test("lists what the create cannot do without first", () => {
    expect(
      groups.map((group: ColumnPickerGroup) => {
        return group.id;
      }),
    ).toEqual([
      ColumnPickerGroupId.Required,
      ColumnPickerGroupId.Main,
      ColumnPickerGroupId.Other,
    ]);
    expect(groups[0]!.label).toBe("Required");
    expect(groups[0]!.hint).toBe("The record can't be created without them");
    expect(ids(groups[0]!.columns)).toEqual(["incidentSeverityId", "title"]);
  });

  /*
   * The record's other defining fields: required by the model, but filled in
   * with a default when left out. The hint is what stops a builder reading
   * "required" into a field the step does not need.
   */
  test("then the model's main fields, saying they fill themselves in", () => {
    const main: ColumnPickerGroup | undefined = groupById(
      groups,
      ColumnPickerGroupId.Main,
    );

    expect(main?.label).toBe("Main fields");
    expect(main?.hint).toBe("Filled in for you if you leave them out");
    expect(ids(main?.columns || [])).toEqual([
      "currentIncidentStateId",
      "declaredAt",
    ]);
  });

  test("then everything else, alphabetically", () => {
    const other: ColumnPickerGroup | undefined = groupById(
      groups,
      ColumnPickerGroupId.Other,
    );

    expect(other?.label).toBe("Other fields");
    expect(ids(other?.columns || [])).toEqual([
      "changeMonitorStatusToId",
      "description",
      "isPrivate",
      "rootCause",
      "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    ]);
  });

  test("every field lands in exactly one group", () => {
    const listed: Array<string> = groups.flatMap((group: ColumnPickerGroup) => {
      return ids(group.columns);
    });

    expect([...listed].sort()).toEqual(ids(INCIDENT_FIELDS).sort());
  });

  test("an empty group is left out rather than shown with nothing under it", () => {
    const withoutRequired: Array<ColumnPickerGroup> = groupPickerColumns({
      columns: INCIDENT_FIELDS,
      use: ColumnUse.Create,
      // Both required fields are already on the form, so not offered.
      requiredColumnIds: [],
    });

    expect(
      withoutRequired.map((group: ColumnPickerGroup) => {
        return group.id;
      }),
    ).not.toContain(ColumnPickerGroupId.Required);
  });

  test("does not reorder the caller's array", () => {
    const before: Array<string> = ids(INCIDENT_FIELDS);

    groupPickerColumns({
      columns: INCIDENT_FIELDS,
      use: ColumnUse.Create,
      requiredColumnIds: ["title"],
    });

    expect(ids(INCIDENT_FIELDS)).toEqual(before);
  });
});

describe("groupPickerColumns on an update", () => {
  const groups: Array<ColumnPickerGroup> = groupPickerColumns({
    columns: INCIDENT_FIELDS,
    use: ColumnUse.Update,
    requiredColumnIds: [],
  });

  test("has no Required group - an update writes only what it names", () => {
    expect(groupById(groups, ColumnPickerGroupId.Required)).toBeUndefined();
  });

  /*
   * Changing an incident's state or severity is what most updates do, and
   * those are the fields the model requires of every incident.
   */
  test("leads with the fields the model requires of every record", () => {
    const main: ColumnPickerGroup | undefined = groupById(
      groups,
      ColumnPickerGroupId.Main,
    );

    expect(groups[0]!.id).toBe(ColumnPickerGroupId.Main);
    expect(main?.hint).toBeUndefined();
    expect(ids(main?.columns || [])).toEqual([
      "currentIncidentStateId",
      "declaredAt",
      "incidentSeverityId",
      "title",
    ]);
  });
});

describe("groupPickerColumns on a query", () => {
  const groups: Array<ColumnPickerGroup> = groupPickerColumns({
    columns: [
      ...INCIDENT_FIELDS,
      makeColumn({
        id: "createdAt",
        title: "Created At",
        type: TableColumnType.Date,
        isSystemColumn: true,
      }),
      makeColumn({
        id: "_id",
        title: "ID",
        type: TableColumnType.ObjectID,
        isSystemColumn: true,
      }),
      makeColumn({
        id: "createdByUserId",
        title: "Created by User ID",
        type: TableColumnType.ObjectID,
      }),
      // Required of the database, not of the person writing the query.
      makeColumn({
        id: "isOwnerNotifiedOfResourceCreation",
        title: "Are Owners Notified Of Resource Creation?",
        type: TableColumnType.Boolean,
        required: true,
        isSystemColumn: true,
      }),
    ],
    use: ColumnUse.Filter,
    requiredColumnIds: [],
  });

  test("puts the record ID first - finding one record is the commonest query", () => {
    const main: ColumnPickerGroup | undefined = groupById(
      groups,
      ColumnPickerGroupId.Main,
    );

    expect(ids(main?.columns || [])[0]).toBe("_id");
    expect(ids(main?.columns || [])).toContain("title");
  });

  test("keeps a required column OneUptime fills in out of the main fields", () => {
    const main: ColumnPickerGroup | undefined = groupById(
      groups,
      ColumnPickerGroupId.Main,
    );

    expect(ids(main?.columns || [])).not.toContain(
      "isOwnerNotifiedOfResourceCreation",
    );
  });

  /*
   * They are good filters, so they stay - but last, under a heading saying
   * whose they are, rather than mixed in among the incident's own fields.
   */
  test("lists what OneUptime fills in last, in a group of its own", () => {
    const system: ColumnPickerGroup | undefined = groupById(
      groups,
      ColumnPickerGroupId.System,
    );
    const other: ColumnPickerGroup | undefined = groupById(
      groups,
      ColumnPickerGroupId.Other,
    );

    expect(groups[groups.length - 1]!.id).toBe(ColumnPickerGroupId.System);
    expect(system?.label).toBe("Filled in by OneUptime");
    expect(ids(system?.columns || [])).toEqual([
      "isOwnerNotifiedOfResourceCreation",
      "createdAt",
      "createdByUserId",
    ]);
    expect(ids(other?.columns || [])).not.toContain("createdAt");
    expect(ids(other?.columns || [])).toContain("description");
  });
});

describe("groupPickerColumns on a model with nothing required", () => {
  test("is one plain group", () => {
    const groups: Array<ColumnPickerGroup> = groupPickerColumns({
      columns: [
        makeColumn({ id: "note", title: "Note" }),
        makeColumn({ id: "postedAt", title: "Posted At" }),
      ],
      use: ColumnUse.Update,
      requiredColumnIds: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe(ColumnPickerGroupId.Other);
  });

  test("and no groups at all when there is nothing to offer", () => {
    expect(
      groupPickerColumns({
        columns: [],
        use: ColumnUse.Create,
        requiredColumnIds: [],
      }),
    ).toEqual([]);
  });
});

describe("searchPickerColumns", () => {
  type SearchFunction = (query: string) => Array<string>;

  const search: SearchFunction = (query: string): Array<string> => {
    return ids(searchPickerColumns(INCIDENT_FIELDS, query));
  };

  test("an empty search lists everything, in the order given", () => {
    expect(search("")).toEqual(ids(INCIDENT_FIELDS));
    expect(search("   ")).toEqual(ids(INCIDENT_FIELDS));
  });

  /*
   * "desc" + Enter has to pick Description, not the first field whose
   * description mentions a description.
   */
  test("a title that starts with what was typed comes first", () => {
    expect(search("desc")[0]).toBe("description");
    expect(search("root")[0]).toBe("rootCause");
  });

  test("an exact title beats a longer one starting the same way", () => {
    const columns: Array<ModelSchemaColumn> = [
      makeColumn({ id: "titleTemplate", title: "Title Template" }),
      makeColumn({ id: "title", title: "Title" }),
    ];

    expect(ids(searchPickerColumns(columns, "title"))).toEqual([
      "title",
      "titleTemplate",
    ]);
  });

  test("matches a word inside the title", () => {
    expect(search("severity")).toEqual(["incidentSeverityId"]);
    expect(search("state")[0]).toBe("currentIncidentStateId");
  });

  test("is not fussy about case or spacing", () => {
    expect(search("  DECLARED   at ")).toEqual(["declaredAt"]);
  });

  test("finds a field by its key, typed with or without spaces", () => {
    expect(search("isprivate")).toEqual(["isPrivate"]);
    expect(search("changeMonitorStatus")).toEqual(["changeMonitorStatusToId"]);
  });

  test("finds a field by what its description says", () => {
    expect(search("subscribers notified")).toEqual([
      "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    ]);
  });

  test("finds fields by the kind of value they hold", () => {
    expect(search("true or false").sort()).toEqual(
      [
        "isPrivate",
        "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
      ].sort(),
    );
    expect(search("date and time")).toEqual(["declaredAt"]);
  });

  test("needs every word to match somewhere", () => {
    expect(search("severity banana")).toEqual([]);
  });

  test("finds nothing for something no field mentions", () => {
    expect(search("kubernetes")).toEqual([]);
  });

  test("ranks a title match above a match only in the description", () => {
    // "incident" is in every description, and in two titles.
    const results: Array<string> = search("incident");

    expect(results.slice(0, 2).sort()).toEqual(
      ["currentIncidentStateId", "incidentSeverityId"].sort(),
    );
    expect(results).toContain("description");
  });
});

describe("isColumnKeyInformative", () => {
  test("a key that is only the title without spaces says nothing new", () => {
    expect(
      isColumnKeyInformative(
        makeColumn({ id: "createdAt", title: "Created At" }),
      ),
    ).toBe(false);
    expect(
      isColumnKeyInformative(
        makeColumn({
          id: "currentIncidentStateId",
          title: "Current Incident State ID",
        }),
      ),
    ).toBe(false);
    expect(
      isColumnKeyInformative(
        makeColumn({ id: "isPrivate", title: "Is Private?" }),
      ),
    ).toBe(false);
    expect(isColumnKeyInformative(makeColumn({ id: "_id", title: "ID" }))).toBe(
      false,
    );
  });

  test("a key the title does not spell out is worth showing", () => {
    expect(
      isColumnKeyInformative(
        makeColumn({
          id: "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
          title: "Should subscribers be notified?",
        }),
      ),
    ).toBe(true);
    expect(
      isColumnKeyInformative(
        makeColumn({ id: "databaseServers", title: "Databases" }),
      ),
    ).toBe(true);
  });
});

describe("isColumnDescriptionInformative", () => {
  /*
   * Incident describes incidentSeverityId as "Incident Severity ID" - the
   * second line of the option would only say the first one again.
   */
  test("a description that is the title again says nothing new", () => {
    expect(
      isColumnDescriptionInformative(
        makeColumn({
          id: "incidentSeverityId",
          title: "Incident Severity ID",
          description: "Incident Severity ID",
        }),
      ),
    ).toBe(false);
    expect(
      isColumnDescriptionInformative(
        makeColumn({ id: "name", title: "Name", description: "name." }),
      ),
    ).toBe(false);
  });

  test("a missing description says nothing", () => {
    expect(
      isColumnDescriptionInformative(makeColumn({ id: "name", title: "Name" })),
    ).toBe(false);
    expect(
      isColumnDescriptionInformative(
        makeColumn({ id: "name", title: "Name", description: "  " }),
      ),
    ).toBe(false);
  });

  test("a real sentence about the field is worth showing", () => {
    expect(
      isColumnDescriptionInformative(
        makeColumn({
          id: "declaredAt",
          title: "Declared At",
          description: "When this incident was declared.",
        }),
      ),
    ).toBe(true);
  });
});

describe("summarizeDescription", () => {
  test("leaves a short description alone", () => {
    expect(summarizeDescription("Title of this incident.")).toBe(
      "Title of this incident.",
    );
  });

  test("cuts a long one at a word and says it was cut", () => {
    const summary: string = summarizeDescription(
      "Relation to Monitor Status Object ID. All monitors connected to this incident will be changed to this status when the incident is created.",
      60,
    );

    expect(summary.length).toBeLessThanOrEqual(60);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).toBe("Relation to Monitor Status Object ID. All monitors…");
  });

  test("never leaves dangling punctuation before the ellipsis", () => {
    const summary: string = summarizeDescription(
      "One two three four five six seven, eight nine ten eleven twelve",
      36,
    );

    expect(summary).toBe("One two three four five six seven…");
  });

  test("folds line breaks and runs of spaces", () => {
    expect(summarizeDescription("Line one.\n\n   Line   two.")).toBe(
      "Line one. Line two.",
    );
  });

  test("hands back an empty string for no description", () => {
    expect(summarizeDescription(undefined)).toBe("");
    expect(summarizeDescription("")).toBe("");
  });

  test("still cuts a single word that is longer than the limit", () => {
    const summary: string = summarizeDescription("a".repeat(100), 20);

    expect(summary).toBe(`${"a".repeat(19)}…`);
  });
});
