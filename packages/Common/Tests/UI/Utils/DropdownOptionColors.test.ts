import {
  DropdownOption,
  DropdownOptionGroup,
} from "../../../UI/Components/Dropdown/Dropdown";
import DropdownUtil from "../../../UI/Utils/Dropdown";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Color from "../../../Types/Color";
import { describe, expect, test } from "@jest/globals";

/*
 * "This doesn't have a colour, just like the incident severity on top. Can
 * you please add colours to incident state as well?"
 *
 * A dropdown draws an option's colour as a dot before its name. These are
 * the helpers every picker of a state, a severity or a monitor status goes
 * through to get that colour onto its options - and to keep it when a field
 * fetches its list a second time.
 */

type ModelWithColor = { new (): BaseModel; name: string };

// Every model a state, severity or status dropdown lists.
const STATE_SEVERITY_AND_STATUS_MODELS: Array<ModelWithColor> = [
  IncidentState,
  IncidentSeverity,
  AlertState,
  AlertSeverity,
  ScheduledMaintenanceState,
  MonitorStatus,
];

// [name, model] pairs, so each test is titled with the model's name.
const NAMED_MODELS: Array<[string, ModelWithColor]> =
  STATE_SEVERITY_AND_STATUS_MODELS.map(
    (modelType: ModelWithColor): [string, ModelWithColor] => {
      return [modelType.name, modelType];
    },
  );

const RED: string = "#ef4444";
const GREEN: string = "#10b981";
const AMBER: string = "#f59e0b";

function row<T extends BaseModel>(
  model: T,
  id: string,
  name: string,
  color?: Color | string | undefined,
): T {
  const values: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  values["_id"] = id;
  values["name"] = name;

  if (color !== undefined) {
    values["color"] = color;
  }

  return model;
}

function colorsOf(
  options: Array<DropdownOption | DropdownOptionGroup>,
): Array<string | undefined> {
  return options.map(
    (option: DropdownOption | DropdownOptionGroup): string | undefined => {
      return (option as DropdownOption).color?.toString();
    },
  );
}

describe("every state, severity and monitor status has a colour column", () => {
  test.each(NAMED_MODELS)(
    "%s: its first colour column is `color`",
    (_name: string, modelType: ModelWithColor) => {
      /*
       * ModelForm, EntityDropdown, the table filters and
       * getDropdownOptionsFromEntityArray all find a dropdown's colour
       * through this. A model that lost its @ColorField would quietly drop
       * the dot from every picker of it.
       */
      expect(new modelType().getFirstColorColumn()).toBe("color");
    },
  );

  test("a model without a colour has no colour column", () => {
    expect(new Monitor().getFirstColorColumn()).toBeNull();
  });
});

describe("DropdownUtil.toOptionColor", () => {
  test("keeps a Color as it is", () => {
    const color: Color = new Color(RED);

    expect(DropdownUtil.toOptionColor(color)).toBe(color);
  });

  test("turns a colour string into a Color, trimmed", () => {
    const color: Color | undefined = DropdownUtil.toOptionColor(` ${GREEN} `);

    expect(color).toBeInstanceOf(Color);
    expect(color?.toString()).toBe(GREEN);
  });

  test.each([
    ["an empty string", ""],
    ["a blank string", "   "],
    ["an empty Color", new Color("")],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a plain object", { value: RED }],
  ])("gives nothing for %s", (_name: string, value: unknown) => {
    expect(DropdownUtil.toOptionColor(value)).toBeUndefined();
  });
});

describe("DropdownUtil.getDropdownOptionsFromEntityArray with real models", () => {
  test.each(NAMED_MODELS)(
    "%s rows become options with their colours",
    (_name: string, modelType: ModelWithColor) => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEntityArray({
          array: [
            row(new modelType(), "id-1", "First", new Color(RED)),
            row(new modelType(), "id-2", "Second", new Color(GREEN)),
          ],
          labelField: "name",
          valueField: "_id",
        });

      expect(
        options.map((option: DropdownOption) => {
          return [option.label, option.value, option.color?.toString()];
        }),
      ).toEqual([
        ["First", "id-1", RED],
        ["Second", "id-2", GREEN],
      ]);
    },
  );

  test("labels and incident roles keep their colours too", () => {
    const labels: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEntityArray({
        array: [row(new Label(), "label-1", "Payments", new Color(AMBER))],
        labelField: "name",
        valueField: "_id",
      });

    const roles: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEntityArray({
        array: [row(new IncidentRole(), "role-1", "Commander", new Color(RED))],
        labelField: "name",
        valueField: "_id",
      });

    expect(labels[0]!.color?.toString()).toBe(AMBER);
    expect(roles[0]!.color?.toString()).toBe(RED);
  });

  test("a colour held as a string becomes a Color", () => {
    const options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEntityArray({
        array: [row(new IncidentState(), "id-1", "Resolved", GREEN)],
        labelField: "name",
        valueField: "_id",
      });

    expect(options[0]!.color).toBeInstanceOf(Color);
    expect(options[0]!.color?.toString()).toBe(GREEN);
  });

  test("a row fetched without its colour has no colour, and no color key", () => {
    const options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEntityArray({
        array: [row(new IncidentState(), "id-1", "Identified")],
        labelField: "name",
        valueField: "_id",
      });

    expect(options).toEqual([{ label: "Identified", value: "id-1" }]);
    expect(Object.keys(options[0]!)).not.toContain("color");
  });

  test("a model without a colour column gives plain options", () => {
    const options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEntityArray({
        array: [row(new Monitor(), "monitor-1", "API")],
        labelField: "name",
        valueField: "_id",
      });

    expect(options).toEqual([{ label: "API", value: "monitor-1" }]);
  });

  test("a row without a name gets an empty label rather than null", () => {
    const state: IncidentState = new IncidentState();
    state._id = "id-1";

    const options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEntityArray({
        array: [state],
        labelField: "name",
        valueField: "_id",
      });

    expect(options[0]!.label).toBe("");
  });

  test("keeps the rows' order", () => {
    const options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEntityArray({
        array: [
          row(new IncidentState(), "c", "Identified", RED),
          row(new IncidentState(), "a", "Acknowledged", AMBER),
          row(new IncidentState(), "b", "Resolved", GREEN),
        ],
        labelField: "name",
        valueField: "_id",
      });

    expect(
      options.map((option: DropdownOption) => {
        return option.label;
      }),
    ).toEqual(["Identified", "Acknowledged", "Resolved"]);
  });
});

describe("DropdownUtil.keepKnownOptionColors", () => {
  // What the form fetched for the dropdown's model: names, ids, colours.
  const known: Array<DropdownOption> = [
    { label: "Resolved", value: "resolved", color: new Color(GREEN) },
    { label: "Identified", value: "identified", color: new Color(RED) },
    { label: "Acknowledged", value: "acknowledged", color: new Color(AMBER) },
  ];

  test("gives a re-fetched list without colours the colours the form knew", () => {
    // The field's own fetch: sorted by order, names and ids only.
    const refetched: Array<DropdownOption> = [
      { label: "Identified", value: "identified" },
      { label: "Acknowledged", value: "acknowledged" },
      { label: "Resolved", value: "resolved" },
    ];

    const options: Array<DropdownOption | DropdownOptionGroup> =
      DropdownUtil.keepKnownOptionColors(refetched, known);

    expect(colorsOf(options)).toEqual([RED, AMBER, GREEN]);
  });

  test("keeps the re-fetched list's own order, labels and membership", () => {
    const refetched: Array<DropdownOption> = [
      { label: "Acknowledged (2)", value: "acknowledged" },
      { label: "Identified (1)", value: "identified" },
    ];

    const options: Array<DropdownOption> = DropdownUtil.keepKnownOptionColors(
      refetched,
      known,
    ) as Array<DropdownOption>;

    expect(
      options.map((option: DropdownOption) => {
        return [option.label, option.value];
      }),
    ).toEqual([
      ["Acknowledged (2)", "acknowledged"],
      ["Identified (1)", "identified"],
    ]);
  });

  test("never replaces a colour an option already has", () => {
    const own: Color = new Color("#000000");

    const options: Array<DropdownOption | DropdownOptionGroup> =
      DropdownUtil.keepKnownOptionColors(
        [{ label: "Resolved", value: "resolved", color: own }],
        known,
      );

    expect((options[0] as DropdownOption).color).toBe(own);
  });

  test("leaves an option the form never knew as it came", () => {
    const stranger: DropdownOption = { label: "Postmortem", value: "pm" };

    const options: Array<DropdownOption | DropdownOptionGroup> =
      DropdownUtil.keepKnownOptionColors([stranger], known);

    expect(options[0]).toBe(stranger);
    expect(Object.keys(options[0]!)).not.toContain("color");
  });

  test("does not change the options it is given", () => {
    const refetched: Array<DropdownOption> = [
      { label: "Identified", value: "identified" },
    ];

    DropdownUtil.keepKnownOptionColors(refetched, known);

    expect(refetched[0]!.color).toBeUndefined();
  });

  test("hands the list back untouched when nothing known has a colour", () => {
    const refetched: Array<DropdownOption> = [
      { label: "Identified", value: "identified" },
    ];

    expect(DropdownUtil.keepKnownOptionColors(refetched, undefined)).toBe(
      refetched,
    );
    expect(DropdownUtil.keepKnownOptionColors(refetched, [])).toBe(refetched);
    expect(
      DropdownUtil.keepKnownOptionColors(refetched, [
        { label: "Identified", value: "identified" },
      ]),
    ).toBe(refetched);
  });

  test("reads colours from groups, and fills them in groups", () => {
    const knownGroups: Array<DropdownOptionGroup> = [
      {
        label: "Open",
        options: [
          { label: "Identified", value: "identified", color: new Color(RED) },
        ],
      },
      {
        label: "Closed",
        options: [
          { label: "Resolved", value: "resolved", color: new Color(GREEN) },
        ],
      },
    ];

    const options: Array<DropdownOption | DropdownOptionGroup> =
      DropdownUtil.keepKnownOptionColors(
        [
          {
            label: "Everything",
            options: [
              { label: "Resolved", value: "resolved" },
              { label: "Identified", value: "identified" },
            ],
          },
          { label: "Identified", value: "identified" },
        ],
        knownGroups,
      );

    const group: DropdownOptionGroup = options[0] as DropdownOptionGroup;

    expect(group.label).toBe("Everything");
    expect(colorsOf(group.options)).toEqual([GREEN, RED]);
    expect((options[1] as DropdownOption).color?.toString()).toBe(RED);
  });

  test("matches a value whatever type it was written as", () => {
    const options: Array<DropdownOption | DropdownOptionGroup> =
      DropdownUtil.keepKnownOptionColors(
        [{ label: "Sev 1", value: 1 }],
        [{ label: "Sev 1", value: "1", color: new Color(RED) }],
      );

    expect((options[0] as DropdownOption).color?.toString()).toBe(RED);
  });

  test("a known colour written as a string becomes a Color", () => {
    const options: Array<DropdownOption | DropdownOptionGroup> =
      DropdownUtil.keepKnownOptionColors(
        [{ label: "Resolved", value: "resolved" }],
        [
          {
            label: "Resolved",
            value: "resolved",
            color: GREEN as unknown as Color,
          },
        ],
      );

    expect((options[0] as DropdownOption).color).toBeInstanceOf(Color);
    expect((options[0] as DropdownOption).color?.toString()).toBe(GREEN);
  });
});
