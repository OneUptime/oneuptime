import { describe, expect, test } from "@jest/globals";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentRole from "../../../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import Label from "../../../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Service from "../../../../../Models/DatabaseModels/Service";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageHistoryChartBarColorRule from "../../../../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import {
  Amber600,
  Green,
  Indigo500,
  Red,
  Teal600,
  Yellow,
} from "../../../../../Types/BrandColors";
import Color from "../../../../../Types/Color";
import TableColumn from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import FormFieldSchemaType from "../../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  ColorInUse,
  CreateFormField,
  getColorsInUse,
  getCreateFormColorDefault,
  getCreateFormColumnDefault,
} from "../../../../../UI/Components/Forms/Utils/CreateFormDefaults";
import {
  DISTINCT_COLORS,
  areSimilarColors,
} from "../../../../../Utils/DistinctColor";

/*
 * The colour a Create form starts with (getCreateFormColorDefault).
 *
 * Nine create forms - Settings > Labels, the six state, severity and monitor
 * status pages, Incident Roles and a status page's bar colour rules - opened
 * on an empty colour picker that blocked Create: each colour column is
 * required and has no default. Now a colour field the record cannot be saved
 * without starts with a colour from the palette, one the records beside the
 * form do not use yet. Read off the real models.
 */

const INDIGO: string = Indigo500.toString();

function colorField<TEntity>(
  key: string,
  extra: Partial<CreateFormField<TEntity>> = {},
): CreateFormField<TEntity> {
  return {
    field: { [key]: true } as CreateFormField<TEntity>["field"],
    title: key,
    fieldType: FormFieldSchemaType.Color,
    required: true,
    ...extra,
  };
}

/*
 * A model whose colour columns cover what the real ones do not: one with a
 * default of its own, one with a default that is not a colour, and a text
 * column holding a hex.
 */
class Swatch extends BaseModel {
  @TableColumn({
    title: "Default Color",
    required: true,
    type: TableColumnType.Color,
    defaultValue: "#14B8A6",
  })
  public defaultColor?: Color = undefined;

  @TableColumn({
    title: "Broken Default",
    required: true,
    type: TableColumnType.Color,
    defaultValue: "not a colour",
  })
  public brokenDefault?: Color = undefined;

  @TableColumn({
    title: "Hex Text",
    required: true,
    type: TableColumnType.ShortText,
  })
  public hexText?: string = undefined;
}

describe("a colour field the record cannot be saved without", () => {
  test.each([
    ["Settings > Labels", new Label(), "color"],
    ["Incident states", new IncidentState(), "color"],
    ["Incident severities", new IncidentSeverity(), "color"],
    ["Alert states", new AlertState(), "color"],
    ["Alert severities", new AlertSeverity(), "color"],
    ["Monitor statuses", new MonitorStatus(), "color"],
    ["Scheduled maintenance states", new ScheduledMaintenanceState(), "color"],
    ["Incident roles", new IncidentRole(), "color"],
    [
      "Status page bar colour rules",
      new StatusPageHistoryChartBarColorRule(),
      "barColor",
    ],
  ] as Array<[string, BaseModel, string]>)(
    "%s: starts with the palette's first colour when nothing is listed",
    (_page: string, model: BaseModel, key: string) => {
      // Required and without a default: why the picker started empty.
      expect(model.getTableColumnMetadata(key).required).toBe(true);
      expect(model.getTableColumnMetadata(key).defaultValue).toBeUndefined();

      expect(getCreateFormColorDefault(model, colorField(key))).toBe(INDIGO);
      // So does a field that leaves required to the column.
      expect(
        getCreateFormColorDefault(model, colorField(key, { required: false })),
      ).toBe(INDIGO);
    },
  );

  test("starts with a colour none of the listed records looks like", () => {
    const state: IncidentState = new IncidentState();

    // A new project's states: Identified, Acknowledged, Resolved.
    expect(
      getCreateFormColorDefault(state, colorField("color"), [
        Red,
        Yellow,
        Green,
      ]),
    ).toBe(INDIGO);

    // Indigo and amber taken: teal.
    expect(
      getCreateFormColorDefault(state, colorField("color"), [
        new Color(INDIGO),
        Amber600.toString(),
      ]),
    ).toBe(Teal600.toString());

    // Nearly the same counts as taken.
    expect(
      getCreateFormColorDefault(state, colorField("color"), ["#4f46e5"]),
    ).toBe(Amber600.toString());
  });

  test("is text the picker shows and the form sends", () => {
    const picked: string | undefined = getCreateFormColorDefault(
      new Label(),
      colorField("color"),
    );

    expect(picked).toMatch(/^#[0-9a-f]{6}$/);
    expect(
      DISTINCT_COLORS.map((color: Color): string => {
        return color.toString();
      }),
    ).toContain(picked);
  });
});

describe("a colour field left as it always started", () => {
  test("says for itself what it starts as", () => {
    const label: Label = new Label();

    expect(
      getCreateFormColorDefault(
        label,
        colorField("color", { defaultValue: "#ef4444" }),
      ),
    ).toBeUndefined();
    expect(
      getCreateFormColorDefault(
        label,
        colorField("color", {
          getDefaultValue: (): string => {
            return "#ef4444";
          },
        }),
      ),
    ).toBeUndefined();
  });

  test("writes no column of its own", () => {
    const label: Label = new Label();

    expect(
      getCreateFormColorDefault(label, {
        overrideField: { color: true },
        overrideFieldKey: "accent",
        title: "Accent",
        fieldType: FormFieldSchemaType.Color,
        required: true,
      }),
    ).toBeUndefined();
    expect(
      getCreateFormColorDefault(
        label,
        colorField("color", { overrideFieldKey: "accent" }),
      ),
    ).toBeUndefined();
    expect(
      getCreateFormColorDefault(label, colorField("color", { formOnly: true })),
    ).toBeUndefined();
    expect(
      getCreateFormColorDefault(label, {
        title: "Nothing",
        fieldType: FormFieldSchemaType.Color,
        required: true,
      }),
    ).toBeUndefined();
    expect(
      getCreateFormColorDefault(label, colorField("notAColumnOfThisModel")),
    ).toBeUndefined();
  });

  test("is not a colour picker, or does not write a colour column", () => {
    const label: Label = new Label();

    expect(
      getCreateFormColorDefault(
        label,
        colorField("color", { fieldType: FormFieldSchemaType.Text }),
      ),
    ).toBeUndefined();
    // A picker over a text column: nothing to stand for a colour there.
    expect(
      getCreateFormColorDefault(new Swatch(), colorField("hexText")),
    ).toBeUndefined();
  });

  test("is a colour the record can go without: empty means none, or the server's own pick", () => {
    // A service's colour is optional; the server picks one when none is sent.
    const service: Service = new Service();

    expect(service.getTableColumnMetadata("serviceColor").required).not.toBe(
      true,
    );
    expect(
      getCreateFormColorDefault(
        service,
        colorField("serviceColor", { required: false }),
      ),
    ).toBeUndefined();
    expect(
      getCreateFormColorDefault(
        new StatusPage(),
        colorField("defaultBarColor", { required: false }),
      ),
    ).toBeUndefined();

    // Unless the form itself will not save without one.
    expect(getCreateFormColorDefault(service, colorField("serviceColor"))).toBe(
      INDIGO,
    );
    expect(
      getCreateFormColorDefault(
        service,
        colorField("serviceColor", {
          required: (): boolean => {
            return true;
          },
        }),
      ),
    ).toBe(INDIGO);
  });

  test("has a column default of its own, which the form starts from instead", () => {
    const swatch: Swatch = new Swatch();

    expect(
      getCreateFormColorDefault(swatch, colorField("defaultColor")),
    ).toBeUndefined();
    // As the picker writes it.
    expect(getCreateFormColumnDefault(swatch, colorField("defaultColor"))).toBe(
      "#14b8a6",
    );

    // A default that is not a colour is none: the form picks one.
    expect(
      getCreateFormColumnDefault(swatch, colorField("brokenDefault")),
    ).toBeUndefined();
    expect(getCreateFormColorDefault(swatch, colorField("brokenDefault"))).toBe(
      INDIGO,
    );
  });
});

describe("the colours the listed records use", () => {
  test("are read from the column the field writes", () => {
    const first: Label = new Label();
    first.color = new Color("#6366f1");
    const second: Label = new Label();
    second.color = new Color("#d97706");

    expect(
      getColorsInUse(colorField<Label>("color"), [first, second]).map(
        (color: ColorInUse): string => {
          return String(color);
        },
      ),
    ).toEqual(["#6366f1", "#d97706"]);
  });

  test("take text as well as a Color, and skip what holds none", () => {
    const withoutColor: Label = new Label();
    const asJson: Record<string, unknown> = { color: "#0d9488" };

    expect(
      getColorsInUse(colorField<Label>("color"), [
        withoutColor,
        asJson,
        null,
        "a string",
        { color: 42 },
      ]),
    ).toEqual([undefined, "#0d9488", undefined, undefined, undefined]);
  });

  test("are none without records, or without a column to read", () => {
    expect(getColorsInUse(colorField<Label>("color"), undefined)).toEqual([]);
    expect(getColorsInUse(colorField<Label>("color"), [])).toEqual([]);
    expect(
      getColorsInUse<Label>(
        { title: "Nothing", fieldType: FormFieldSchemaType.Color },
        [{ color: "#0d9488" }],
      ),
    ).toEqual([]);
  });

  test("feed the pick: a table of labels gets a colour no row has", () => {
    const rows: Array<Record<string, unknown>> = DISTINCT_COLORS.slice(
      0,
      3,
    ).map((color: Color) => {
      return { color: new Color(color.toString()) };
    });

    const picked: string | undefined = getCreateFormColorDefault(
      new Label(),
      colorField("color"),
      getColorsInUse(colorField<Label>("color"), rows),
    );

    expect(picked).toBe(DISTINCT_COLORS[3]!.toString());

    for (const row of rows) {
      expect(areSimilarColors(picked, row["color"] as Color)).toBe(false);
    }
  });
});
