import AlertState from "Common/Models/DatabaseModels/AlertState";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import Dictionary from "Common/Types/Dictionary";
import MeasurementAggregationType, {
  MeasurementAggregationTypeUtil,
} from "Common/Types/Measurement/MeasurementAggregationType";
import MeasurementOccurrence from "Common/Types/Measurement/MeasurementOccurrence";
import MeasurementUnit, {
  DEFAULT_MEASUREMENT_UNIT,
  MEASUREMENT_UNIT_SPELLINGS,
} from "Common/Types/Measurement/MeasurementUnit";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  CUSTOM_MEASUREMENT_PRESET_ID,
  MEASUREMENT_LAST_TIME_TEMPLATE,
  MeasurementAnchor,
  MeasurementDomain,
  MeasurementEndDescription,
  MeasurementPreset,
  describeMeasurementEnd,
  getDefaultMeasurementStartMoment,
  getMeasurementAnchorForMoment,
  getMeasurementMomentValue,
  getMeasurementPresets,
} from "Common/Utils/Measurement/MeasurementMoments";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";

/*
 * The plain-language half of the Incident, Alert and Scheduled Maintenance
 * Measurements pages.
 *
 * "Please make incident and alert measurements easier to understand. I have
 * no idea what these are. ... There are also some advanced options. Can you
 * please hide them in the advanced section? ... Start State Occurrence can be
 * in advanced and you can have sane defaults. Unit field in the end could be
 * a dropdown." - the maintainer, on a four-step form that asked for a
 * "Start Anchor" of "State Role Entered" and a free-text unit.
 *
 * A measurement still stores what it always stored - two anchors, their
 * occurrences, a unit - and the server reads it exactly as before. What
 * changes is how a person gets there:
 *
 *   - "What do you want to measure?": the common measurements, a click each
 *     (Common/Utils/Measurement/MeasurementMoments has them);
 *   - "Starts when" and "Ends when", each one list of moments in plain words
 *     ("The incident is acknowledged") instead of an anchor type and a role;
 *   - what most measurements never change (which time a repeated state
 *     counts, the chart's unit and summary) under Advanced, with the
 *     defaults the server uses;
 *   - a list that reads "Declared → Acknowledged", and View Chart.
 *
 * React-free on purpose, like Utils/GroupingRule/GroupingRuleSetup: the
 * logic is pinned by node tests that import it from here. Every English
 * string below is also its own key in all seventeen Dashboard locale files.
 */

export enum MeasurementEnd {
  Start = "start",
  End = "end",
}

// The form values of one end of a measurement.
export interface MeasurementEndFields {
  // The anchor type column: startAnchorType.
  anchorType: string;
  // The state role column: startIncidentStateRole.
  stateRole: string;
  // The picked state relation: startIncidentState.
  state: string;
  // The occurrence column: startStateOccurrence.
  occurrence: string;
  // The form-only moment the user picks: startMoment.
  moment: string;
}

export interface MeasurementForm {
  domain: MeasurementDomain;
  // The states a "state you pick" end lists.
  stateModel: DatabaseBaseModelType;
  start: MeasurementEndFields;
  end: MeasurementEndFields;
}

export const MEASUREMENT_START_MOMENT_FIELD_KEY: string = "startMoment";
export const MEASUREMENT_END_MOMENT_FIELD_KEY: string = "endMoment";
export const MEASUREMENT_PRESET_FIELD_KEY: string = "measurementPreset";

type GetEndFieldsFunction = (data: {
  stateColumnPrefix: string;
  end: MeasurementEnd;
}) => MeasurementEndFields;

const getEndFields: GetEndFieldsFunction = (data: {
  stateColumnPrefix: string;
  end: MeasurementEnd;
}): MeasurementEndFields => {
  const end: string = data.end;

  return {
    anchorType: `${end}AnchorType`,
    stateRole: `${end}${data.stateColumnPrefix}StateRole`,
    state: `${end}${data.stateColumnPrefix}State`,
    occurrence: `${end}StateOccurrence`,
    moment:
      data.end === MeasurementEnd.Start
        ? MEASUREMENT_START_MOMENT_FIELD_KEY
        : MEASUREMENT_END_MOMENT_FIELD_KEY,
  };
};

export const INCIDENT_MEASUREMENT_FORM: MeasurementForm = {
  domain: MeasurementDomain.Incident,
  stateModel: IncidentState,
  start: getEndFields({
    stateColumnPrefix: "Incident",
    end: MeasurementEnd.Start,
  }),
  end: getEndFields({ stateColumnPrefix: "Incident", end: MeasurementEnd.End }),
};

export const ALERT_MEASUREMENT_FORM: MeasurementForm = {
  domain: MeasurementDomain.Alert,
  stateModel: AlertState,
  start: getEndFields({
    stateColumnPrefix: "Alert",
    end: MeasurementEnd.Start,
  }),
  end: getEndFields({ stateColumnPrefix: "Alert", end: MeasurementEnd.End }),
};

export const SCHEDULED_MAINTENANCE_MEASUREMENT_FORM: MeasurementForm = {
  domain: MeasurementDomain.ScheduledMaintenance,
  stateModel: ScheduledMaintenanceState,
  start: getEndFields({
    stateColumnPrefix: "ScheduledMaintenance",
    end: MeasurementEnd.Start,
  }),
  end: getEndFields({
    stateColumnPrefix: "ScheduledMaintenance",
    end: MeasurementEnd.End,
  }),
};

export const getMeasurementEndFields: (
  form: MeasurementForm,
  end: MeasurementEnd,
) => MeasurementEndFields = (
  form: MeasurementForm,
  end: MeasurementEnd,
): MeasurementEndFields => {
  return end === MeasurementEnd.Start ? form.start : form.end;
};

// A measurement, or a form's values for one. Read loosely: either may be partial.
export type MeasurementValues = Record<string, unknown>;

// The reader's language: the English text is the key.
export type MeasurementTranslateFunction = (text: string) => string;

type ReadStringFunction = (value: unknown) => string | undefined;

const readString: ReadStringFunction = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim() ? value : undefined;
};

export type GetMeasurementMomentFormValueFunction = (data: {
  form: MeasurementForm;
  end: MeasurementEnd;
  values: MeasurementValues;
}) => string | undefined;

/**
 * The moment one end of the form shows: the one picked, or else the one the
 * stored anchor is. A new measurement starts where most do - when the
 * incident is declared - and has no end until one is picked. An anchor that
 * is none of the domain's moments shows nothing, and is kept as it is until
 * a moment is picked.
 */
export const getMeasurementMomentFormValue: GetMeasurementMomentFormValueFunction =
  (data: {
    form: MeasurementForm;
    end: MeasurementEnd;
    values: MeasurementValues;
  }): string | undefined => {
    const fields: MeasurementEndFields = getMeasurementEndFields(
      data.form,
      data.end,
    );

    const picked: string | undefined = readString(data.values[fields.moment]);

    if (picked) {
      return picked;
    }

    const anchorType: string | undefined = readString(
      data.values[fields.anchorType],
    );

    if (anchorType) {
      return (
        getMeasurementMomentValue({
          domain: data.form.domain,
          anchorType: anchorType,
          stateRole: readString(data.values[fields.stateRole]),
        }) || undefined
      );
    }

    return data.end === MeasurementEnd.Start
      ? getDefaultMeasurementStartMoment(data.form.domain).value
      : undefined;
  };

/**
 * The anchor type a new measurement's start is saved with when nobody
 * picks another: the default start moment's.
 */
export const getDefaultMeasurementStartAnchorType: (
  form: MeasurementForm,
) => string = (form: MeasurementForm): string => {
  return getDefaultMeasurementStartMoment(form.domain).anchorType;
};

export type GetValuesForMeasurementMomentFunction = (data: {
  form: MeasurementForm;
  end: MeasurementEnd;
  values: MeasurementValues;
  moment: string | null | undefined;
}) => MeasurementValues;

/**
 * The form's values once a moment is picked for one end: the moment, and the
 * anchor it is saved as. A role is cleared when the new moment has none, so
 * no stale role is left on the measurement. A picked state is kept: it only
 * counts for "a state you pick", and is there again if that is picked back.
 */
export const getValuesForMeasurementMoment: GetValuesForMeasurementMomentFunction =
  (data: {
    form: MeasurementForm;
    end: MeasurementEnd;
    values: MeasurementValues;
    moment: string | null | undefined;
  }): MeasurementValues => {
    const fields: MeasurementEndFields = getMeasurementEndFields(
      data.form,
      data.end,
    );

    const values: MeasurementValues = {
      ...data.values,
      [fields.moment]: data.moment || undefined,
    };

    const anchor: MeasurementAnchor | null = getMeasurementAnchorForMoment({
      domain: data.form.domain,
      value: data.moment,
    });

    if (!anchor) {
      return values;
    }

    values[fields.anchorType] = anchor.anchorType;
    values[fields.stateRole] = anchor.stateRole;

    return values;
  };

export type GetValuesForMeasurementPresetFunction = (data: {
  form: MeasurementForm;
  values: MeasurementValues;
  presetId: string | null | undefined;
  translate: MeasurementTranslateFunction;
}) => MeasurementValues;

/**
 * The form's values once a ready-made measurement is picked: its name and
 * description - unless the user has typed their own - and both ends.
 * "Something else" changes nothing: whatever is filled in is the user's to
 * change, on this step and the next.
 */
export const getValuesForMeasurementPreset: GetValuesForMeasurementPresetFunction =
  (data: {
    form: MeasurementForm;
    values: MeasurementValues;
    presetId: string | null | undefined;
    translate: MeasurementTranslateFunction;
  }): MeasurementValues => {
    const presets: Array<MeasurementPreset> = getMeasurementPresets(
      data.form.domain,
    );

    const preset: MeasurementPreset | undefined = presets.find(
      (candidate: MeasurementPreset): boolean => {
        return candidate.id === data.presetId;
      },
    );

    let values: MeasurementValues = {
      ...data.values,
      [MEASUREMENT_PRESET_FIELD_KEY]: data.presetId || undefined,
    };

    if (!preset || preset.id === CUSTOM_MEASUREMENT_PRESET_ID) {
      return values;
    }

    // What a preset may have filled in, in either language.
    const presetText: Set<string> = new Set<string>();

    for (const candidate of presets) {
      if (candidate.id === CUSTOM_MEASUREMENT_PRESET_ID) {
        continue;
      }

      for (const text of [candidate.name, candidate.description]) {
        presetText.add(text);
        presetText.add(data.translate(text));
      }
    }

    const isFromPreset: (value: unknown) => boolean = (
      value: unknown,
    ): boolean => {
      return typeof value === "string" && presetText.has(value.trim());
    };

    const isTheUsersOwn: (value: unknown) => boolean = (
      value: unknown,
    ): boolean => {
      return Boolean(readString(value)) && !isFromPreset(value);
    };

    if (!isTheUsersOwn(values["name"])) {
      values["name"] = data.translate(preset.name);
    }

    if (!isTheUsersOwn(values["description"])) {
      values["description"] = data.translate(preset.description);
    }

    values = getValuesForMeasurementMoment({
      form: data.form,
      end: MeasurementEnd.Start,
      values: values,
      moment: preset.startMoment,
    });

    return getValuesForMeasurementMoment({
      form: data.form,
      end: MeasurementEnd.End,
      values: values,
      moment: preset.endMoment,
    });
  };

export interface MeasurementSummary {
  start: MeasurementEndDescription | null;
  end: MeasurementEndDescription | null;
}

/**
 * A measurement in the list: where it starts and where it ends, in a word or
 * two each - "Declared → Acknowledged".
 */
export const getMeasurementSummary: (data: {
  form: MeasurementForm;
  measurement: MeasurementValues;
}) => MeasurementSummary = (data: {
  form: MeasurementForm;
  measurement: MeasurementValues;
}): MeasurementSummary => {
  const describe: (end: MeasurementEnd) => MeasurementEndDescription | null = (
    end: MeasurementEnd,
  ): MeasurementEndDescription | null => {
    const fields: MeasurementEndFields = getMeasurementEndFields(
      data.form,
      end,
    );
    const state: unknown = data.measurement[fields.state];

    return describeMeasurementEnd({
      domain: data.form.domain,
      anchorType: readString(data.measurement[fields.anchorType]),
      stateRole: readString(data.measurement[fields.stateRole]),
      stateName:
        state && typeof state === "object"
          ? readString((state as Record<string, unknown>)["name"])
          : undefined,
      occurrence: readString(data.measurement[fields.occurrence]),
    });
  };

  return {
    start: describe(MeasurementEnd.Start),
    end: describe(MeasurementEnd.End),
  };
};

/**
 * The same, as text - for the list's CSV export, which is in English like
 * the rest of it: "Declared → Resolved (last time)".
 */
export const getMeasurementSummaryText: (data: {
  form: MeasurementForm;
  measurement: MeasurementValues;
}) => string = (data: {
  form: MeasurementForm;
  measurement: MeasurementValues;
}): string => {
  const summary: MeasurementSummary = getMeasurementSummary(data);

  const describe: (end: MeasurementEndDescription | null) => string = (
    end: MeasurementEndDescription | null,
  ): string => {
    if (!end) {
      return MEASUREMENT_FORM_COPY.noMoment;
    }

    return end.isLastTime
      ? MEASUREMENT_LAST_TIME_TEMPLATE.replace("{{moment}}", end.label)
      : end.label;
  };

  return `${describe(summary.start)} → ${describe(summary.end)}`;
};

/*
 * A dropdown option, as plain data: the .tsx side hands these to Dropdown,
 * which translates the label and the description itself.
 */
export interface MeasurementOption {
  value: string;
  label: string;
  description?: string | undefined;
  // Stored spellings that mean this option (DropdownOption.aliases).
  aliases?: Array<string> | undefined;
}

export const MEASUREMENT_OCCURRENCE_OPTIONS: Array<MeasurementOption> = [
  { value: MeasurementOccurrence.First, label: "Use the first time" },
  { value: MeasurementOccurrence.Last, label: "Use the last time" },
];

type UnitAliasesFunction = (unit: MeasurementUnit) => Array<string>;

// Every stored spelling of a unit but its own value, as typed or capitalised.
const unitAliases: UnitAliasesFunction = (
  unit: MeasurementUnit,
): Array<string> => {
  const aliases: Set<string> = new Set<string>();

  for (const spelling of MEASUREMENT_UNIT_SPELLINGS[unit]) {
    for (const variant of [
      spelling,
      spelling.toUpperCase(),
      spelling.charAt(0).toUpperCase() + spelling.slice(1),
    ]) {
      if (variant !== unit) {
        aliases.add(variant);
      }
    }
  }

  return Array.from(aliases);
};

export const MEASUREMENT_UNIT_OPTIONS: Array<MeasurementOption> = [
  {
    value: MeasurementUnit.Seconds,
    label: "Automatic",
    description: "Seconds, minutes, hours or days, whichever reads best.",
    aliases: unitAliases(MeasurementUnit.Seconds),
  },
  {
    value: MeasurementUnit.Minutes,
    label: "Minutes",
    aliases: unitAliases(MeasurementUnit.Minutes),
  },
  {
    value: MeasurementUnit.Hours,
    label: "Hours",
    aliases: unitAliases(MeasurementUnit.Hours),
  },
  {
    value: MeasurementUnit.Days,
    label: "Days",
    aliases: unitAliases(MeasurementUnit.Days),
  },
];

export const DEFAULT_MEASUREMENT_UNIT_VALUE: string = DEFAULT_MEASUREMENT_UNIT;

export const MEASUREMENT_CHART_SUMMARY_OPTIONS: Array<MeasurementOption> = [
  { value: MeasurementAggregationType.Avg, label: "Average" },
  { value: MeasurementAggregationType.P50, label: "Median" },
  { value: MeasurementAggregationType.P90, label: "90th percentile" },
  { value: MeasurementAggregationType.P95, label: "95th percentile" },
  { value: MeasurementAggregationType.P99, label: "99th percentile" },
  { value: MeasurementAggregationType.Max, label: "Longest" },
  { value: MeasurementAggregationType.Min, label: "Shortest" },
];

// The column defaults, which the server applies too.
export const DEFAULT_MEASUREMENT_OCCURRENCE: string =
  MeasurementOccurrence.First;
export const DEFAULT_MEASUREMENT_CHART_SUMMARY: string =
  MeasurementAggregationType.Avg;

// The window View Chart opens on: measurements come one per incident.
export const MEASUREMENT_CHART_RANGE: TimeRange = TimeRange.PAST_ONE_MONTH;

/**
 * The metric explorer's query for one measurement's chart: its metric,
 * summed up the way the measurement says, titled with its name, over the
 * past month.
 */
export const getMeasurementChartQueryParams: (data: {
  metricName: string;
  name?: string | null | undefined;
  aggregationType?: string | null | undefined;
}) => Dictionary<string> = (data: {
  metricName: string;
  name?: string | null | undefined;
  aggregationType?: string | null | undefined;
}): Dictionary<string> => {
  const query: SerializedMetricQuery = {
    metricName: data.metricName,
    attributes: {},
    aggregationType: MeasurementAggregationTypeUtil.toAggregationType(
      (data.aggregationType || undefined) as
        | MeasurementAggregationType
        | undefined,
    ),
  };

  const title: string | undefined = readString(data.name);

  if (title) {
    query.alias = { title: title };
  }

  const params: Dictionary<string> = {
    [MetricExplorerUrlParam.MetricQueries]: JSON.stringify([query]),
  };

  const range: string | undefined = MetricExplorerUrl.getValidRangeToken(
    MEASUREMENT_CHART_RANGE,
  );

  if (range) {
    params[MetricExplorerUrlParam.Range] = range;
  }

  return params;
};

/*
 * The words of the forms and the lists, shared by the three pages. Copy
 * that names the incident, the alert or the maintenance event is written
 * out per page below, whole sentences, never assembled from parts.
 */
export const MEASUREMENT_FORM_COPY: {
  measurementStep: string;
  momentsStep: string;
  presetTitle: string;
  nameTitle: string;
  nameDescription: string;
  keyTitle: string;
  descriptionTitle: string;
  enabledTitle: string;
  startTitle: string;
  endTitle: string;
  momentPlaceholder: string;
  startStateTitle: string;
  endStateTitle: string;
  statePlaceholder: string;
  startOccurrenceTitle: string;
  endOccurrenceTitle: string;
  unitTitle: string;
  unitDescription: string;
  chartSummaryTitle: string;
  advancedDescription: string;
  nameColumn: string;
  measuresColumn: string;
  statusColumn: string;
  enabledFilter: string;
  enabledPill: string;
  disabledPill: string;
  viewChart: string;
  noMoment: string;
} = {
  measurementStep: "Measurement",
  momentsStep: "Start and End",
  presetTitle: "What do you want to measure?",
  nameTitle: "Name",
  nameDescription: "What this measurement is called on charts.",
  keyTitle: "Key",
  descriptionTitle: "Description",
  enabledTitle: "Enabled",
  startTitle: "Starts when",
  endTitle: "Ends when",
  momentPlaceholder: "Pick a moment",
  startStateTitle: "Start state",
  endStateTitle: "End state",
  statePlaceholder: "Pick a state",
  startOccurrenceTitle: "If the start happens more than once",
  endOccurrenceTitle: "If the end happens more than once",
  unitTitle: "Show durations in",
  unitDescription: "The unit this measurement's charts use.",
  chartSummaryTitle: "Chart summary",
  advancedDescription: "Most measurements never need these.",
  nameColumn: "Name",
  measuresColumn: "Measures",
  statusColumn: "Status",
  enabledFilter: "Enabled",
  enabledPill: "Enabled",
  disabledPill: "Disabled",
  viewChart: "View Chart",
  // An end the list cannot name: an anchor of another kind of measurement.
  noMoment: "Not set",
};

export interface MeasurementPageCopy {
  cardTitle: string;
  cardDescription: string;
  helpTitle: string;
  helpDescription: string;
  presetDescription: string;
  namePlaceholder: string;
  keyDescription: string;
  descriptionPlaceholder: string;
  enabledDescription: string;
  startDescription: string;
  endDescription: string;
  startStateDescription: string;
  endStateDescription: string;
  startOccurrenceDescription: string;
  endOccurrenceDescription: string;
  chartSummaryDescription: string;
}

export const MEASUREMENT_PAGE_COPY: Record<
  MeasurementDomain,
  MeasurementPageCopy
> = {
  [MeasurementDomain.Incident]: {
    cardTitle: "Incident Measurements",
    cardDescription:
      "A measurement is the time between two moments in an incident, like time to acknowledge or time to resolve. OneUptime works it out for every incident and charts it, so you can see whether your team is getting faster.",
    helpTitle: "How Incident Measurements Work",
    helpDescription:
      "What a measurement is, where its numbers show up, and why an incident can have none",
    presetDescription:
      "A measurement is the time between two moments in an incident. Pick a common one, or choose Something else to set up your own.",
    namePlaceholder: "Time to acknowledge",
    keyDescription:
      "Part of the metric name, oneuptime.incident.measurement.<key>, so it can't be changed once the measurement is created.",
    descriptionPlaceholder:
      "From when an incident is declared until someone acknowledges it.",
    enabledDescription:
      "Turn this off to stop measuring incidents. Numbers already recorded are kept.",
    startDescription:
      "The clock starts at this moment and stops at the one below. Every incident is measured this way, past ones included.",
    endDescription:
      "An incident that never reaches this moment gets no number, rather than a zero.",
    startStateDescription:
      "The clock starts when the incident enters this state.",
    endStateDescription: "The clock stops when the incident enters this state.",
    startOccurrenceDescription:
      "An incident that is reopened can reach the same state again. The first time is the usual choice.",
    endOccurrenceDescription:
      "For example, an incident that is resolved, reopened and resolved again.",
    chartSummaryDescription:
      "How View Chart sums up many incidents. Average is the usual choice.",
  },
  [MeasurementDomain.Alert]: {
    cardTitle: "Alert Measurements",
    cardDescription:
      "A measurement is the time between two moments in an alert, like time to acknowledge or time to resolve. OneUptime works it out for every alert and charts it, so you can see whether your team is getting faster.",
    helpTitle: "How Alert Measurements Work",
    helpDescription:
      "What a measurement is, where its numbers show up, and why an alert can have none",
    presetDescription:
      "A measurement is the time between two moments in an alert. Pick a common one, or choose Something else to set up your own.",
    namePlaceholder: "Time to acknowledge",
    keyDescription:
      "Part of the metric name, oneuptime.alert.measurement.<key>, so it can't be changed once the measurement is created.",
    descriptionPlaceholder:
      "From when an alert is created until someone acknowledges it.",
    enabledDescription:
      "Turn this off to stop measuring alerts. Numbers already recorded are kept.",
    startDescription:
      "The clock starts at this moment and stops at the one below. Every alert is measured this way, past ones included.",
    endDescription:
      "An alert that never reaches this moment gets no number, rather than a zero.",
    startStateDescription: "The clock starts when the alert enters this state.",
    endStateDescription: "The clock stops when the alert enters this state.",
    startOccurrenceDescription:
      "An alert that is reopened can reach the same state again. The first time is the usual choice.",
    endOccurrenceDescription:
      "For example, an alert that is resolved, reopened and resolved again.",
    chartSummaryDescription:
      "How View Chart sums up many alerts. Average is the usual choice.",
  },
  [MeasurementDomain.ScheduledMaintenance]: {
    cardTitle: "Scheduled Maintenance Measurements",
    cardDescription:
      "A measurement is the time between two moments in a maintenance event, like how late it starts or how long it runs over. OneUptime works it out for every event and charts it, so you can see whether maintenance goes to plan.",
    helpTitle: "How Scheduled Maintenance Measurements Work",
    helpDescription:
      "What a measurement is, where its numbers show up, and why an event can have none",
    presetDescription:
      "A measurement is the time between two moments in a maintenance event. Pick a common one, or choose Something else to set up your own.",
    namePlaceholder: "Start delay",
    keyDescription:
      "Part of the metric name, oneuptime.scheduled-maintenance.measurement.<key>, so it can't be changed once the measurement is created.",
    descriptionPlaceholder:
      "How late maintenance starts: from its scheduled start until it starts.",
    enabledDescription:
      "Turn this off to stop measuring maintenance events. Numbers already recorded are kept.",
    startDescription:
      "The clock starts at this moment and stops at the one below. Every maintenance event is measured this way, past ones included.",
    endDescription:
      "An event that never reaches this moment gets no number, rather than a zero.",
    startStateDescription: "The clock starts when the event enters this state.",
    endStateDescription: "The clock stops when the event enters this state.",
    startOccurrenceDescription:
      "An event can reach the same state again, for example when it is rescheduled. The first time is the usual choice.",
    endOccurrenceDescription:
      "For example, an event that ends, starts again and ends again.",
    chartSummaryDescription:
      "How View Chart sums up many maintenance events. Average is the usual choice.",
  },
};

/*
 * The key a page's empty Key box suggests: a key, never translated. It is
 * the key the page's Name placeholder makes.
 */
export const MEASUREMENT_KEY_PLACEHOLDER: Record<MeasurementDomain, string> = {
  [MeasurementDomain.Incident]: "time-to-acknowledge",
  [MeasurementDomain.Alert]: "time-to-acknowledge",
  [MeasurementDomain.ScheduledMaintenance]: "start-delay",
};

/*
 * Every English string the measurement pages draw from this module, for the
 * locale files.
 */
export const getMeasurementSetupText: () => Array<string> =
  (): Array<string> => {
    const text: Set<string> = new Set<string>();

    for (const value of Object.values(MEASUREMENT_FORM_COPY)) {
      text.add(value);
    }

    for (const copy of Object.values(MEASUREMENT_PAGE_COPY)) {
      for (const value of Object.values(copy)) {
        text.add(value);
      }
    }

    for (const options of [
      MEASUREMENT_OCCURRENCE_OPTIONS,
      MEASUREMENT_UNIT_OPTIONS,
      MEASUREMENT_CHART_SUMMARY_OPTIONS,
    ]) {
      for (const option of options) {
        text.add(option.label);

        if (option.description) {
          text.add(option.description);
        }
      }
    }

    return Array.from(text);
  };
