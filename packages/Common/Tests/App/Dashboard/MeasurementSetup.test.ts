import {
  ALERT_MEASUREMENT_FORM,
  DEFAULT_MEASUREMENT_CHART_SUMMARY,
  DEFAULT_MEASUREMENT_OCCURRENCE,
  DEFAULT_MEASUREMENT_UNIT_VALUE,
  INCIDENT_MEASUREMENT_FORM,
  MEASUREMENT_CHART_RANGE,
  MEASUREMENT_CHART_SUMMARY_OPTIONS,
  MEASUREMENT_END_MOMENT_FIELD_KEY,
  MEASUREMENT_OCCURRENCE_OPTIONS,
  MEASUREMENT_PAGE_COPY,
  MEASUREMENT_PRESET_FIELD_KEY,
  MEASUREMENT_START_MOMENT_FIELD_KEY,
  MEASUREMENT_UNIT_OPTIONS,
  MeasurementEnd,
  MeasurementForm,
  MeasurementOption,
  MeasurementValues,
  SCHEDULED_MAINTENANCE_MEASUREMENT_FORM,
  getDefaultMeasurementStartAnchorType,
  getMeasurementChartQueryParams,
  getMeasurementMomentFormValue,
  getMeasurementSetupText,
  getMeasurementSummary,
  getMeasurementSummaryText,
  getValuesForMeasurementMoment,
  getValuesForMeasurementPreset,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/MeasurementSetup";
import { getMeasurementsHelpMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/MeasurementHelp";
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import AlertMeasurement from "../../../Models/DatabaseModels/AlertMeasurement";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentMeasurement from "../../../Models/DatabaseModels/IncidentMeasurement";
import ScheduledMaintenanceMeasurement from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import MeasurementAggregationType from "../../../Types/Measurement/MeasurementAggregationType";
import MeasurementOccurrence from "../../../Types/Measurement/MeasurementOccurrence";
import MeasurementUnit, {
  getMeasurementUnit,
} from "../../../Types/Measurement/MeasurementUnit";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  CUSTOM_MEASUREMENT_PRESET_ID,
  MeasurementDomain,
  MeasurementMoment,
  MeasurementPreset,
  getMeasurementMoments,
  getMeasurementPresets,
} from "../../../Utils/Measurement/MeasurementMoments";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The plain-language half of the three Measurements pages: what the form
 * holds for a preset or a moment, what it saves, and what the list says.
 * The form itself is drawn for real in MeasurementForms.test.tsx.
 */

interface FormCase {
  label: string;
  form: MeasurementForm;
  newModel: () => BaseModel;
}

const FORMS: Array<FormCase> = [
  {
    label: "Incident",
    form: INCIDENT_MEASUREMENT_FORM,
    newModel: (): BaseModel => {
      return new IncidentMeasurement();
    },
  },
  {
    label: "Alert",
    form: ALERT_MEASUREMENT_FORM,
    newModel: (): BaseModel => {
      return new AlertMeasurement();
    },
  },
  {
    label: "Scheduled maintenance",
    form: SCHEDULED_MAINTENANCE_MEASUREMENT_FORM,
    newModel: (): BaseModel => {
      return new ScheduledMaintenanceMeasurement();
    },
  },
];

// English stays English: the form's callbacks hand in a translate function.
const identity: (text: string) => string = (text: string): string => {
  return text;
};

describe.each(FORMS)("$label measurement form", (entry: FormCase) => {
  const form: MeasurementForm = entry.form;
  const domain: MeasurementDomain = form.domain;
  const model: BaseModel = entry.newModel();
  const presets: Array<MeasurementPreset> = getMeasurementPresets(domain);
  const preset: MeasurementPreset = presets[0]!;

  test("names columns the model really has", () => {
    for (const end of [form.start, form.end]) {
      expect(model.hasColumn(end.anchorType)).toBe(true);
      expect(model.hasColumn(end.stateRole)).toBe(true);
      expect(model.hasColumn(end.state)).toBe(true);
      expect(model.hasColumn(end.occurrence)).toBe(true);
      // The moment itself is the form's own, never saved.
      expect(model.hasColumn(end.moment)).toBe(false);
    }

    expect(model.hasColumn(MEASUREMENT_PRESET_FIELD_KEY)).toBe(false);
    expect(form.start.moment).toBe(MEASUREMENT_START_MOMENT_FIELD_KEY);
    expect(form.end.moment).toBe(MEASUREMENT_END_MOMENT_FIELD_KEY);
  });

  test("starts a new measurement with the defaults Postgres gives an API create that leaves them out", () => {
    const columnDefault: (property: string) => unknown = (
      property: string,
    ): unknown => {
      const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
        .columns.filter((candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === model.constructor &&
            candidate.propertyName === property
          );
        })
        .pop();

      return column?.options.default;
    };

    expect(columnDefault("startStateOccurrence")).toBe(
      DEFAULT_MEASUREMENT_OCCURRENCE,
    );
    expect(columnDefault("endStateOccurrence")).toBe(
      DEFAULT_MEASUREMENT_OCCURRENCE,
    );
    expect(columnDefault("unit")).toBe(DEFAULT_MEASUREMENT_UNIT_VALUE);
    expect(columnDefault("aggregationType")).toBe(
      DEFAULT_MEASUREMENT_CHART_SUMMARY,
    );
    // A new measurement is on; the form has no switch for it on create.
    expect(columnDefault("isEnabled")).toBe(true);
  });

  test("starts a new measurement with the defaults the server would use", () => {
    expect(
      model.getTableColumnMetadata("startStateOccurrence").defaultValue,
    ).toBe(DEFAULT_MEASUREMENT_OCCURRENCE);
    expect(
      model.getTableColumnMetadata("endStateOccurrence").defaultValue,
    ).toBe(DEFAULT_MEASUREMENT_OCCURRENCE);
    expect(model.getTableColumnMetadata("unit").defaultValue).toBe(
      DEFAULT_MEASUREMENT_UNIT_VALUE,
    );
    expect(model.getTableColumnMetadata("aggregationType").defaultValue).toBe(
      DEFAULT_MEASUREMENT_CHART_SUMMARY,
    );
  });

  describe("the moment an end shows", () => {
    test("is the one picked", () => {
      const moment: string = getMeasurementMoments(domain)[1]!.value;

      expect(
        getMeasurementMomentFormValue({
          form,
          end: MeasurementEnd.End,
          values: { [form.end.moment]: moment },
        }),
      ).toBe(moment);
    });

    test("or else the one a saved anchor is", () => {
      const moment: MeasurementMoment = getMeasurementMoments(domain).find(
        (candidate: MeasurementMoment): boolean => {
          return Boolean(candidate.stateRole);
        },
      )!;

      expect(
        getMeasurementMomentFormValue({
          form,
          end: MeasurementEnd.End,
          values: {
            [form.end.anchorType]: moment.anchorType,
            [form.end.stateRole]: moment.stateRole,
          },
        }),
      ).toBe(moment.value);
    });

    test("on a new measurement, starts where most do and ends nowhere yet", () => {
      expect(
        getMeasurementMomentFormValue({
          form,
          end: MeasurementEnd.Start,
          values: {},
        }),
      ).toBe(getDefaultMeasurementStartAnchorType(form));
      expect(
        getMeasurementMomentFormValue({
          form,
          end: MeasurementEnd.End,
          values: {},
        }),
      ).toBeUndefined();
    });

    test("is nothing for a saved anchor that is none of the moments, which is kept as it is", () => {
      expect(
        getMeasurementMomentFormValue({
          form,
          end: MeasurementEnd.Start,
          values: { [form.start.anchorType]: "Not An Anchor" },
        }),
      ).toBeUndefined();
    });
  });

  describe("picking a moment", () => {
    test("saves its anchor, with the role a role moment has", () => {
      const roleMoment: MeasurementMoment = getMeasurementMoments(domain).find(
        (candidate: MeasurementMoment): boolean => {
          return Boolean(candidate.stateRole);
        },
      )!;

      expect(
        getValuesForMeasurementMoment({
          form,
          end: MeasurementEnd.End,
          values: { name: "Kept" },
          moment: roleMoment.value,
        }),
      ).toEqual({
        name: "Kept",
        [form.end.moment]: roleMoment.value,
        [form.end.anchorType]: roleMoment.anchorType,
        [form.end.stateRole]: roleMoment.stateRole,
      });
    });

    test("drops the role a moment without one would leave behind, and keeps a picked state for later", () => {
      const pickedState: { _id: string } = { _id: "state-1" };
      const timestamp: MeasurementMoment = getMeasurementMoments(domain).find(
        (candidate: MeasurementMoment): boolean => {
          return !candidate.stateRole && !candidate.isPickedState;
        },
      )!;

      const values: MeasurementValues = getValuesForMeasurementMoment({
        form,
        end: MeasurementEnd.End,
        values: {
          [form.end.anchorType]: "State Role Entered",
          [form.end.stateRole]: "Resolved",
          [form.end.state]: pickedState,
        },
        moment: timestamp.value,
      });

      expect(values[form.end.anchorType]).toBe(timestamp.anchorType);
      expect(values[form.end.stateRole]).toBeNull();
      expect(values[form.end.state]).toBe(pickedState);
    });

    test("touches only its own end", () => {
      const values: MeasurementValues = getValuesForMeasurementMoment({
        form,
        end: MeasurementEnd.Start,
        values: {
          [form.end.anchorType]: "State Role Entered",
          [form.end.stateRole]: "Resolved",
        },
        moment: getMeasurementMoments(domain)[0]!.value,
      });

      expect(values[form.end.anchorType]).toBe("State Role Entered");
      expect(values[form.end.stateRole]).toBe("Resolved");
    });
  });

  describe("picking a ready-made measurement", () => {
    test("fills in its name, its description and both ends", () => {
      const values: MeasurementValues = getValuesForMeasurementPreset({
        form,
        values: {},
        presetId: preset.id,
        translate: identity,
      });

      expect(values[MEASUREMENT_PRESET_FIELD_KEY]).toBe(preset.id);
      expect(values["name"]).toBe(preset.name);
      expect(values["description"]).toBe(preset.description);
      expect(values[form.start.moment]).toBe(preset.startMoment);
      expect(values[form.end.moment]).toBe(preset.endMoment);
      expect(values[form.start.anchorType]).toBeDefined();
      expect(values[form.end.anchorType]).toBeDefined();
    });

    test("in the reader's language", () => {
      const values: MeasurementValues = getValuesForMeasurementPreset({
        form,
        values: {},
        presetId: preset.id,
        translate: (text: string): string => {
          return `[de] ${text}`;
        },
      });

      expect(values["name"]).toBe(`[de] ${preset.name}`);
      expect(values["description"]).toBe(`[de] ${preset.description}`);
    });

    test("keeps a name and a description the user typed", () => {
      const values: MeasurementValues = getValuesForMeasurementPreset({
        form,
        values: { name: "MTTA", description: "Our own words." },
        presetId: preset.id,
        translate: identity,
      });

      expect(values["name"]).toBe("MTTA");
      expect(values["description"]).toBe("Our own words.");
    });

    test("replaces what another ready-made one filled in, in either language", () => {
      const second: MeasurementPreset = presets[1]!;

      const first: MeasurementValues = getValuesForMeasurementPreset({
        form,
        values: {},
        presetId: preset.id,
        translate: identity,
      });

      expect(
        getValuesForMeasurementPreset({
          form,
          values: first,
          presetId: second.id,
          translate: identity,
        })["name"],
      ).toBe(second.name);

      const translated: (text: string) => string = (text: string): string => {
        return `[fr] ${text}`;
      };

      const firstInFrench: MeasurementValues = getValuesForMeasurementPreset({
        form,
        values: {},
        presetId: preset.id,
        translate: translated,
      });

      expect(
        getValuesForMeasurementPreset({
          form,
          values: firstInFrench,
          presetId: second.id,
          translate: translated,
        })["name"],
      ).toBe(`[fr] ${second.name}`);
    });

    test("Something else changes nothing but the pick: what is filled in is the user's to change", () => {
      const filled: MeasurementValues = getValuesForMeasurementPreset({
        form,
        values: {},
        presetId: preset.id,
        translate: identity,
      });

      expect(
        getValuesForMeasurementPreset({
          form,
          values: filled,
          presetId: CUSTOM_MEASUREMENT_PRESET_ID,
          translate: identity,
        }),
      ).toEqual({
        ...filled,
        [MEASUREMENT_PRESET_FIELD_KEY]: CUSTOM_MEASUREMENT_PRESET_ID,
      });

      expect(
        getValuesForMeasurementPreset({
          form,
          values: { name: "MTTA" },
          presetId: CUSTOM_MEASUREMENT_PRESET_ID,
          translate: identity,
        }),
      ).toEqual({
        name: "MTTA",
        [MEASUREMENT_PRESET_FIELD_KEY]: CUSTOM_MEASUREMENT_PRESET_ID,
      });
    });

    test("an id that is no preset changes nothing but the pick", () => {
      expect(
        getValuesForMeasurementPreset({
          form,
          values: { name: "Kept" },
          presetId: "nope",
          translate: identity,
        }),
      ).toEqual({ name: "Kept", [MEASUREMENT_PRESET_FIELD_KEY]: "nope" });
    });
  });

  test("the list reads a ready-made measurement as its two moments", () => {
    const values: MeasurementValues = getValuesForMeasurementPreset({
      form,
      values: {},
      presetId: preset.id,
      translate: identity,
    });

    const summary: string = getMeasurementSummaryText({
      form,
      measurement: values,
    });

    expect(summary).toContain(" → ");
    expect(summary).not.toContain("Not set");

    expect(getMeasurementSummary({ form, measurement: values }).start).toEqual(
      expect.objectContaining({ isStateName: false, isLastTime: false }),
    );
  });

  test("the list names a picked state, and says when the last time counts", () => {
    const summary: string = getMeasurementSummaryText({
      form,
      measurement: {
        [form.start.anchorType]: "State Entered",
        [form.start.state]: { name: "Investigating" },
        [form.end.anchorType]: "State Role Entered",
        [form.end.stateRole]: getMeasurementMoments(domain).find(
          (candidate: MeasurementMoment): boolean => {
            return Boolean(candidate.stateRole);
          },
        )!.stateRole,
        [form.end.occurrence]: MeasurementOccurrence.Last,
      },
    });

    expect(summary).toMatch(/^Investigating → .+ \(last time\)$/);
  });

  test("the list says an end it cannot name is not set", () => {
    expect(getMeasurementSummaryText({ form, measurement: {} })).toBe(
      "Not set → Not set",
    );
  });

  test("the help explains every ready-made measurement and every moment, without the anchor vocabulary", () => {
    const markdown: string = getMeasurementsHelpMarkdown(domain);

    for (const candidate of presets) {
      if (candidate.id !== CUSTOM_MEASUREMENT_PRESET_ID) {
        expect(markdown).toContain(`**${candidate.name}**`);
      }
    }

    for (const moment of getMeasurementMoments(domain)) {
      expect(markdown).toContain(moment.label);
      expect(markdown).toContain(moment.description);
    }

    expect(markdown).toContain("View Chart");
    // The fold the rarely changed options sit in, by the name the form shows.
    expect(markdown).toContain(`under **${MORE_FIELDS_SECTION_TITLE}**`);
    expect(markdown).not.toContain("Advanced");
    expect(markdown).toContain(".measurement.<key>");
    expect(markdown).not.toMatch(/anchor|Timeline Start|State Role Entered/);
    expect(markdown).not.toContain("mermaid");
  });
});

describe("the options under More fields", () => {
  const values: (options: Array<MeasurementOption>) => Array<string> = (
    options: Array<MeasurementOption>,
  ): Array<string> => {
    return options.map((option: MeasurementOption): string => {
      return option.value;
    });
  };

  test("which time counts: the first or the last, the first by default", () => {
    expect(values(MEASUREMENT_OCCURRENCE_OPTIONS)).toEqual(
      Object.values(MeasurementOccurrence),
    );
    expect(MEASUREMENT_OCCURRENCE_OPTIONS[0]!.value).toBe(
      DEFAULT_MEASUREMENT_OCCURRENCE,
    );
  });

  test("the unit: Automatic (seconds), minutes, hours or days - a dropdown, not free text", () => {
    expect(values(MEASUREMENT_UNIT_OPTIONS)).toEqual(
      Object.values(MeasurementUnit),
    );
    expect(MEASUREMENT_UNIT_OPTIONS[0]).toEqual(
      expect.objectContaining({
        value: MeasurementUnit.Seconds,
        label: "Automatic",
      }),
    );
  });

  test("a unit saved as typed text shows as the option it spells", () => {
    for (const option of MEASUREMENT_UNIT_OPTIONS) {
      for (const alias of option.aliases || []) {
        expect({ alias, unit: getMeasurementUnit(alias) }).toEqual({
          alias,
          unit: option.value,
        });
        expect(alias).not.toBe(option.value);
      }
    }

    const aliases: Array<string> = MEASUREMENT_UNIT_OPTIONS.flatMap(
      (option: MeasurementOption): Array<string> => {
        return option.aliases || [];
      },
    );

    expect(aliases).toEqual(
      expect.arrayContaining(["secs", "s", "Minutes", "min", "hr", "Days"]),
    );
  });

  test("the chart summary: every aggregation a measurement allows, in plain words, never Sum", () => {
    expect(values(MEASUREMENT_CHART_SUMMARY_OPTIONS).sort()).toEqual(
      Object.values(MeasurementAggregationType).sort(),
    );
    expect(MEASUREMENT_CHART_SUMMARY_OPTIONS[0]!.label).toBe("Average");

    for (const option of MEASUREMENT_CHART_SUMMARY_OPTIONS) {
      expect(option.label).not.toMatch(/^(Avg|P\d+|Max|Min)$/);
    }
  });
});

describe("View Chart", () => {
  test("opens the metric explorer on the measurement's metric, summed up its way, titled with its name, over the past month", () => {
    const params: Record<string, string> = getMeasurementChartQueryParams({
      metricName: "oneuptime.incident.measurement.time-to-acknowledge",
      name: "Time to acknowledge",
      aggregationType: MeasurementAggregationType.P90,
    });

    const queries: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(
        params[MetricExplorerUrlParam.MetricQueries]!,
      );

    expect(queries).toHaveLength(1);
    expect(queries[0]!.metricName).toBe(
      "oneuptime.incident.measurement.time-to-acknowledge",
    );
    expect(queries[0]!.aggregationType).toBe(AggregationType.P90);
    expect(queries[0]!.alias?.title).toBe("Time to acknowledge");
    expect(params[MetricExplorerUrlParam.Range]).toBe(TimeRange.PAST_ONE_MONTH);
    expect(MEASUREMENT_CHART_RANGE).toBe(TimeRange.PAST_ONE_MONTH);
  });

  test("averages when the measurement says nothing, and leaves the title to the explorer without a name", () => {
    const params: Record<string, string> = getMeasurementChartQueryParams({
      metricName: "oneuptime.alert.measurement.ttr",
    });

    const query: SerializedMetricQuery =
      MetricExplorerUrl.parseMetricQueriesParam(
        params[MetricExplorerUrlParam.MetricQueries]!,
      )[0]!;

    expect(query.aggregationType).toBe(AggregationType.Avg);
    expect(query.alias).toBeUndefined();
  });
});

describe("getMeasurementSetupText", () => {
  test("holds every word of the three pages' copy, once", () => {
    const text: Array<string> = getMeasurementSetupText();

    for (const copy of Object.values(MEASUREMENT_PAGE_COPY)) {
      for (const value of Object.values(copy)) {
        expect(text).toContain(value);
      }
    }

    for (const option of [
      ...MEASUREMENT_OCCURRENCE_OPTIONS,
      ...MEASUREMENT_UNIT_OPTIONS,
      ...MEASUREMENT_CHART_SUMMARY_OPTIONS,
    ]) {
      expect(text).toContain(option.label);
    }

    expect(new Set(text).size).toBe(text.length);
  });

  test("every page explains a measurement the same way, in its own words", () => {
    for (const domain of Object.values(MeasurementDomain)) {
      expect(MEASUREMENT_PAGE_COPY[domain].cardDescription).toMatch(
        /^A measurement is the time between two moments in an? /,
      );
      expect(MEASUREMENT_PAGE_COPY[domain].presetDescription).toMatch(
        /^A measurement is the time between two moments in an? /,
      );
    }
  });
});
