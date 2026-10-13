/*
 * The fields a record step's two field lists offer, and how a stored value
 * reads as the fields it names (Workflow/FieldPicker/FieldPickerOptions).
 *
 * "Triggers: Listen on and Select fields - Please make them a lot better.
 * They are very confusing now." These hold what the lists say: Fields to
 * pass on offers the record's fields and its related records' fields, in
 * the groups people think in; Fields to watch offers only what an update can
 * change, a related record by the column an update changes; and a stored
 * value is shown exactly as the runtime reads it, never rewritten until the
 * builder changes it.
 */

import {
  ChosenFields,
  FieldGroup,
  FieldGroupId,
  FieldOption,
  FieldPickerMode,
  PanelRow,
  PanelRowKind,
  findFieldOption,
  getFieldGroups,
  getFieldOptions,
  getPanelRows,
  getStoredPaths,
  readChosenFields,
  readStoredValue,
  searchFieldOptions,
  writeChosenFields,
} from "../../../../../UI/Components/Workflow/FieldPicker/FieldPickerOptions";
import { INCIDENT_COLUMNS } from "./FieldPickerFixture";
import { describe, expect, test } from "@jest/globals";

type OptionsFunction = (
  mode: FieldPickerMode,
  storedPaths?: Array<string>,
) => Array<FieldOption>;

const optionsFor: OptionsFunction = (
  mode: FieldPickerMode,
  storedPaths?: Array<string>,
): Array<FieldOption> => {
  return getFieldOptions({
    columns: INCIDENT_COLUMNS,
    mode: mode,
    displayColumnId: "title",
    storedPaths: storedPaths,
  });
};

type GroupsFunction = (
  options: Array<FieldOption>,
) => Record<string, Array<string>>;

// Each group's titles, by group.
const groupTitles: GroupsFunction = (
  options: Array<FieldOption>,
): Record<string, Array<string>> => {
  const groups: Array<FieldGroup> = getFieldGroups({
    options: options,
    displayColumnId: "title",
  });
  const byGroup: Record<string, Array<string>> = {};

  for (const group of groups) {
    byGroup[group.id] = group.options.map((option: FieldOption): string => {
      return option.title;
    });
  }

  return byGroup;
};

type PathsFunction = (options: Array<FieldOption>) => Array<string>;

const paths: PathsFunction = (options: Array<FieldOption>): Array<string> => {
  return options.map((option: FieldOption): string => {
    return option.path;
  });
};

describe("Fields to pass on: what the list offers", () => {
  const options: Array<FieldOption> = optionsFor(FieldPickerMode.PassOn);

  test("grouped the way people think of an incident", () => {
    expect(groupTitles(options)).toEqual({
      [FieldGroupId.Main]: [
        // What names the record leads.
        "Title",
        "Current Incident State",
        "Declared At",
        "Incident Severity",
      ],
      [FieldGroupId.Other]: [
        "Created By Probe ID",
        "Current Incident State ID",
        "Description",
        "Incident Severity ID",
        "Is Private?",
      ],
      [FieldGroupId.Related]: ["Created By Probe", "Labels", "Monitors"],
      [FieldGroupId.System]: [
        // The record's ID leads what OneUptime fills in.
        "ID",
        "Created At",
        "Created by User ID",
        "Incident Number",
        "Incident Number With Prefix",
        "Updated At",
      ],
    });
  });

  test("the project and the always-empty Deleted At are not offered", () => {
    expect(paths(options)).not.toContain("projectId");
    expect(paths(options)).not.toContain("project");
    expect(paths(options)).not.toContain("deletedAt");
    expect(paths(options)).not.toContain("currentIncidentState.deletedAt");
    expect(paths(options)).not.toContain("currentIncidentState.projectId");
  });

  test("but a stored value that names one keeps it listed, so it can be removed", () => {
    const stored: Array<FieldOption> = optionsFor(FieldPickerMode.PassOn, [
      "deletedAt",
      "currentIncidentState.deletedAt",
    ]);

    expect(paths(stored)).toContain("deletedAt");
    expect(paths(stored)).toContain("currentIncidentState.deletedAt");
  });

  test("a related record opens to its fields: name first, OneUptime's last", () => {
    const state: FieldOption | undefined = options.find(
      (option: FieldOption): boolean => {
        return option.path === "currentIncidentState";
      },
    );

    expect(state?.isRelation).toBe(true);
    expect(state?.typeLabel).toBe("Record");
    expect(state?.fieldCount).toBe(5);

    const rows: Array<PanelRow> = getPanelRows({
      options: options,
      groups: getFieldGroups({ options: options, displayColumnId: "title" }),
      query: "",
      expanded: ["currentIncidentState"],
    });

    const opened: Array<string> = rows
      .filter((row: PanelRow): boolean => {
        return row.depth === 1;
      })
      .map((row: PanelRow): string => {
        return row.option?.title || "";
      });

    expect(opened).toEqual([
      "Current Incident State › Name",
      "Current Incident State › Color",
      "Current Incident State › Description",
      "Current Incident State › Created At",
      "Current Incident State › ID",
    ]);
  });

  test("a relation to many records is passed on by its fields too", () => {
    expect(
      options.find((option: FieldOption): boolean => {
        return option.path === "labels";
      })?.typeLabel,
    ).toBe("Records");
    expect(paths(options)).toContain("labels.name");
  });
});

describe("Fields to watch: only what an update can change", () => {
  const options: Array<FieldOption> = optionsFor(FieldPickerMode.Watch);

  test("grouped the same way, a related record by its name", () => {
    expect(groupTitles(options)).toEqual({
      [FieldGroupId.Main]: [
        "Title",
        "Current Incident State",
        "Declared At",
        "Incident Severity",
      ],
      [FieldGroupId.Other]: [
        "Created By Probe",
        "Description",
        "Is Private?",
        "Labels",
        "Monitors",
      ],
      [FieldGroupId.System]: ["Updated At"],
    });
  });

  test("a related record is watched by the column an update changes", () => {
    const state: FieldOption | undefined = options.find(
      (option: FieldOption): boolean => {
        return option.title === "Current Incident State";
      },
    );

    expect(state?.path).toBe("currentIncidentStateId");
    expect(state?.aliases).toEqual(["currentIncidentState"]);
    expect(state?.isRelation).toBeUndefined();
    // ...and not offered a second time by its ID column.
    expect(
      options.filter((option: FieldOption): boolean => {
        return option.path === "currentIncidentStateId";
      }),
    ).toHaveLength(1);
  });

  test("a relation to many records is watched by its own name, as an update names it", () => {
    expect(
      options.find((option: FieldOption): boolean => {
        return option.title === "Labels";
      })?.path,
    ).toBe("labels");
  });

  test("no related record's own fields: no update of this record changes them", () => {
    expect(
      options.some((option: FieldOption): boolean => {
        return Boolean(option.relationPath);
      }),
    ).toBe(false);
  });

  test("never what is set once, when the record is created", () => {
    for (const path of [
      "_id",
      "createdAt",
      "createdByUserId",
      "incidentNumber",
      "incidentNumberWithPrefix",
      "projectId",
      "deletedAt",
    ]) {
      expect([path, paths(options).includes(path)]).toEqual([path, false]);
    }
  });

  test("unless a stored value names one, so it can be removed", () => {
    expect(
      paths(optionsFor(FieldPickerMode.Watch, ["createdAt"])),
    ).toContain("createdAt");
  });
});

describe("searching the list", () => {
  const passOn: Array<FieldOption> = optionsFor(FieldPickerMode.PassOn);

  type SearchFunction = (query: string) => Array<string>;

  const search: SearchFunction = (query: string): Array<string> => {
    return searchFieldOptions(passOn, query).map(
      (option: FieldOption): string => {
        return option.title;
      },
    );
  };

  test("a field that starts with what was typed comes first", () => {
    expect(search("desc")[0]).toBe("Description");
    expect(search("titl")[0]).toBe("Title");
  });

  test("a related record's fields are found through it, name first", () => {
    expect(search("state").slice(0, 3)).toEqual([
      "Current Incident State ID",
      "Current Incident State › Name",
      "Current Incident State › Color",
    ]);
  });

  test("a field found only by its own name comes after everything the record offers", () => {
    const results: Array<string> = search("name");
    const firstRelated: number = results.indexOf(
      "Current Incident State › Name",
    );

    expect(firstRelated).toBeGreaterThanOrEqual(0);
    // The relations the record cannot be without come first among them.
    expect(results.slice(0, 2)).toEqual([
      "Current Incident State › Name",
      "Incident Severity › Name",
    ]);
  });

  test("a key, as it is spelled in JSON, finds its field", () => {
    expect(search("incidentSev")[0]).toBe("Incident Severity ID");
  });

  test("every word, in the name, the key, the description or the kind of value", () => {
    expect(search("declared date")).toContain("Declared At");
  });

  test("nothing a related record is, only its fields", () => {
    for (const option of searchFieldOptions(passOn, "incident")) {
      expect(option.isRelation).toBeUndefined();
    }
  });

  test("nothing found says nothing", () => {
    expect(search("zzzz-no-field")).toEqual([]);
  });

  test("an empty search lists every field", () => {
    expect(searchFieldOptions(passOn, "  ").length).toBe(
      passOn.filter((option: FieldOption): boolean => {
        return !option.isRelation;
      }).length,
    );
  });
});

describe("the rows the list shows", () => {
  const options: Array<FieldOption> = optionsFor(FieldPickerMode.PassOn);
  const groups: Array<FieldGroup> = getFieldGroups({
    options: options,
    displayColumnId: "title",
  });

  test("a heading over each group, and a related record closed until opened", () => {
    const rows: Array<PanelRow> = getPanelRows({
      options: options,
      groups: groups,
      query: "",
      expanded: [],
    });

    expect(
      rows
        .filter((row: PanelRow): boolean => {
          return row.kind === PanelRowKind.Heading;
        })
        .map((row: PanelRow): string => {
          return row.group?.label || "";
        }),
    ).toEqual([
      "Main fields",
      "Other fields",
      "Related records",
      "Filled in by OneUptime",
    ]);
    expect(
      rows.some((row: PanelRow): boolean => {
        return row.depth > 0;
      }),
    ).toBe(false);
  });

  test("no heading over a list of one group", () => {
    const one: Array<FieldGroup> = groups.slice(0, 1);

    expect(
      getPanelRows({ options: options, groups: one, query: "", expanded: [] }).some(
        (row: PanelRow): boolean => {
          return row.kind === PanelRowKind.Heading;
        },
      ),
    ).toBe(false);
  });

  test("a search lists the matches alone, without headings", () => {
    const rows: Array<PanelRow> = getPanelRows({
      options: options,
      groups: groups,
      query: "state",
      expanded: [],
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((row: PanelRow): boolean => {
        return row.kind === PanelRowKind.Option && row.depth === 0;
      }),
    ).toBe(true);
  });
});

describe("reading a stored Fields to pass on", () => {
  const options: Array<FieldOption> = optionsFor(FieldPickerMode.PassOn);

  type ReadFunction = (value: unknown) => ChosenFields;

  const read: ReadFunction = (value: unknown): ChosenFields => {
    return readChosenFields({
      value: value,
      options: options,
      mode: FieldPickerMode.PassOn,
    });
  };

  test("its fields and its related records' fields, in their order", () => {
    expect(
      read({
        title: true,
        currentIncidentState: { name: true, color: true },
        description: true,
      }),
    ).toEqual({
      paths: [
        "title",
        "currentIncidentState.name",
        "currentIncidentState.color",
        "description",
      ],
      unknownPaths: [],
      problems: [],
    });
  });

  test("stored as JSON text, as the field list used to store it, alike", () => {
    expect(read('{"title": true, "labels": {"name": true}}').paths).toEqual([
      "title",
      "labels.name",
    ]);
  });

  test("a field set to false is not chosen", () => {
    expect(read({ title: true, description: false }).paths).toEqual([
      "title",
    ]);
  });

  test("a field the record does not have is shown, flagged, to be removed", () => {
    expect(read({ title: true, nonsense: true })).toEqual({
      paths: ["title", "nonsense"],
      unknownPaths: ["nonsense"],
      problems: [],
    });
  });

  test("empty is nothing chosen", () => {
    for (const value of [undefined, null, "", "  ", {}]) {
      expect(read(value)).toEqual({ paths: [], unknownPaths: [], problems: [] });
    }
  });

  test("what the list cannot show is kept as JSON, and says why", () => {
    expect(read({ currentIncidentState: true }).problems).toEqual([
      "“currentIncidentState” passes on the whole related record. Pick the fields of it the next steps need.",
    ]);
    expect(read({ title: "yes" }).problems).toEqual([
      "“title” has an unexpected value.",
    ]);
    expect(
      read({ currentIncidentState: { name: { deeper: true } } }).problems,
    ).toEqual(["“currentIncidentState.name” goes more than one related record deep."]);
    expect(read("{ not json").problems).toEqual([
      "The current value isn't valid JSON.",
    ]);
    expect(read("[1, 2]").problems).toEqual([
      "The current value isn't valid JSON.",
    ]);
  });
});

describe("reading a stored Fields to watch", () => {
  const options: Array<FieldOption> = optionsFor(FieldPickerMode.Watch);

  type ReadFunction = (value: unknown) => ChosenFields;

  const read: ReadFunction = (value: unknown): ChosenFields => {
    return readChosenFields({
      value: value,
      options: options,
      mode: FieldPickerMode.Watch,
    });
  };

  test("every key counts, whatever it holds, as the trigger reads it", () => {
    expect(read({ title: true, isPrivate: false }).paths).toEqual([
      "title",
      "isPrivate",
    ]);
  });

  test("a related record stored by its own name is the field its ID column stands for", () => {
    // What the old list stored when "Current Incident State › Name" was ticked.
    expect(read({ currentIncidentState: { name: true } })).toEqual({
      paths: ["currentIncidentStateId"],
      unknownPaths: [],
      problems: [],
    });
    expect(
      read({ currentIncidentState: true, currentIncidentStateId: true }).paths,
    ).toEqual(["currentIncidentStateId"]);
  });

  test("a key that is no field is shown, flagged", () => {
    expect(read({ nonsense: true }).unknownPaths).toEqual(["nonsense"]);
  });
});

describe("writing the chosen fields", () => {
  test("passing on, a related record's fields go inside it", () => {
    const value: string = writeChosenFields({
      paths: [
        "title",
        "currentIncidentState.name",
        "description",
        "currentIncidentState.color",
      ],
      mode: FieldPickerMode.PassOn,
    });

    expect(JSON.parse(value)).toEqual({
      title: true,
      currentIncidentState: { name: true, color: true },
      description: true,
    });
  });

  test("watching, each field by the key an update changes", () => {
    expect(
      JSON.parse(
        writeChosenFields({
          paths: ["currentIncidentStateId", "labels"],
          mode: FieldPickerMode.Watch,
        }),
      ),
    ).toEqual({ currentIncidentStateId: true, labels: true });
  });

  test("nothing chosen is empty, which the form reads as not filled in", () => {
    expect(writeChosenFields({ paths: [], mode: FieldPickerMode.PassOn })).toBe(
      "",
    );
  });

  test("what is read is what is written back", () => {
    const options: Array<FieldOption> = optionsFor(FieldPickerMode.PassOn);
    const stored: string =
      '{"title":true,"currentIncidentState":{"name":true},"labels":{"name":true,"color":true}}';
    const chosen: ChosenFields = readChosenFields({
      value: stored,
      options: options,
      mode: FieldPickerMode.PassOn,
    });

    expect(
      writeChosenFields({ paths: chosen.paths, mode: FieldPickerMode.PassOn }),
    ).toBe(stored);
  });
});

describe("the stored value as it is read", () => {
  test("text and, when it is a JSON object, the object", () => {
    expect(readStoredValue('{"title": true}')).toEqual({
      text: '{"title": true}',
      parsed: { title: true },
      isEmpty: false,
    });
    expect(readStoredValue({ title: true }).parsed).toEqual({ title: true });
    expect(readStoredValue("").isEmpty).toBe(true);
    expect(readStoredValue({}).isEmpty).toBe(true);
    expect(readStoredValue("not json").parsed).toBeNull();
  });

  test("every key it names, a related record's fields as record.field", () => {
    expect(
      getStoredPaths({ title: true, currentIncidentState: { name: true } }),
    ).toEqual(["title", "currentIncidentState", "currentIncidentState.name"]);
    expect(getStoredPaths("nonsense")).toEqual([]);
  });

  test("a chosen path's field, never a related record itself", () => {
    const options: Array<FieldOption> = optionsFor(FieldPickerMode.PassOn);

    expect(findFieldOption(options, "currentIncidentState.name")?.title).toBe(
      "Current Incident State › Name",
    );
    expect(findFieldOption(options, "currentIncidentState")).toBeUndefined();
  });
});
