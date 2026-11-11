import {
  CheckOn,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import CriteriaFilterValues from "Common/Types/Monitor/CriteriaFilterValues";
import MonitorStepRollingTime from "Common/Types/Monitor/MonitorStepRollingTime";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";

/*
 * THE CASES THE PROVIDER'S MONITOR STEP VALUES ARE CHECKED AGAINST.
 *
 * The server reads a rolling time written another way ("15 minutes",
 * "PT15M") as the one it means and stores that one, and does the same for a
 * filter's metric aggregation and no-data policy ("avg" is "Average"). It
 * refuses a value that means none (OneUptime/oneuptime#6722). The provider
 * has to read them exactly as the server does (StaticFiles/
 * monitorstepsvalues.go): if it reads less, an apply that wrote "15 minutes"
 * fails with "Provider produced inconsistent result after apply"; if it
 * reads more, it plans no change where OneUptime stores a different value,
 * and refuses or lets through at plan time what the server would not.
 *
 * So the generator writes these cases into the provider
 * (internal/provider/testdata/monitor_steps_values.json), every expected
 * value computed here by the server's own code, and the provider's Go test
 * reads each one as the server does or fails:
 *   - the tables: each rolling time and its length, the settings that keep
 *     one and the monitor type that reads them, the aggregations and no-data
 *     policies;
 *   - how a written value reads, and the words the server refuses it in:
 *     every rolling time, the ways a length can be written in each unit the
 *     server reads, and the edge cases its own tests use; every name the
 *     server reads a criteria value by, in other cases and spacing;
 *   - what the server stores: steps written with a value in each of the
 *     settings that keep a rolling time and in a filter's metric options,
 *     read and written back by MonitorSteps as the API does.
 */

export interface RollingTimeCase {
  written: JSONValue;
  // The rolling time the server reads it as (RollingTimeUtil.fromValue).
  read: string | null;
  // The server's refusal, in a Metrics monitor's metric settings.
  error: string | null;
}

export interface CriteriaValueCase {
  // The key in a filter's metricMonitorOptions.
  key: "metricAggregationType" | "onNoDataPolicy";
  written: JSONValue;
  read: string | null;
  // The server's refusal, as the first filter of CRITERIA_NAME.
  error: string | null;
}

export interface StoredCase {
  written: JSONValue;
  // What the server stores, by key: absent when it stores none.
  stored: JSONObject;
}

export interface MonitorStepsValuesCases {
  about: string;
  rollingTimes: Array<{ value: string; minutes: number }>;
  defaultRollingTime: string;
  rollingTimeSettings: Array<{ monitorType: string; apiKey: string }>;
  evaluateOverTimeTypes: Array<string>;
  noDataPolicies: Array<string>;
  // A rolling time that means none, refused in each type's own settings.
  rollingTimeErrorsBySettings: Array<{
    monitorType: string;
    apiKey: string;
    written: JSONValue;
    error: string | null;
  }>;
  rollingTimeCases: Array<RollingTimeCase>;
  criteriaName: string;
  criteriaValueCases: Array<CriteriaValueCase>;
  // Each step's settings' rollingTime, by the settings' API key.
  storedRollingTimes: Array<StoredCase>;
  // A filter's metricMonitorOptions, both keys written with the same value.
  storedMetricMonitorOptions: Array<StoredCase>;
}

/*
 * The unit each unit name is read in, by its first letter, in seconds: how
 * long a window is in that unit, for writing it out.
 */
const SECONDS_BY_UNIT_LETTER: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
};

/*
 * The edge cases the server's own tests read (RollingTimeFromValue.test.ts),
 * and the white space, letters and numbers JavaScript reads its own way.
 */
const ROLLING_TIME_EDGE_CASES: Array<JSONValue> = [
  "15 mins",
  "Last 15 Minutes",
  "past_15_minutes",
  "PAST_15_MINUTES",
  "Past15Minutes",
  "15-minute",
  "pt900s",
  "0.25 hours",
  "60 minutes",
  "past hour",
  "Last Hour",
  "P1DT0H0M0S",
  "P1W7D",
  "past minute",
  "31536000 seconds",
  "20 minutes",
  "45m",
  "4 hours",
  "PT90M",
  "1.5 days",
  "0 minutes",
  "PT0S",
  "PT0M",
  "1 month",
  "1 year",
  "P1M",
  "P1Y",
  "15",
  "900",
  "minutes",
  "hour",
  "past",
  "last",
  "previous",
  "past h",
  "past minutes",
  "P",
  "PT",
  "T",
  "",
  "   ",
  "_",
  "-",
  "_15m_",
  "--15--minutes--",
  ".",
  "x",
  "fifteen minutes",
  "15 minutes ago",
  "15 minutess",
  "15 fortnights",
  "Past 15 Minutes!",
  "15 minutes; DROP TABLE",
  "1h30m",
  "P1DT",
  "PT1H30M",
  "P1DT12H",
  "1..5 hours",
  "1.",
  ".5 hours",
  "0.5 days",
  "0.083333333 hours",
  "0.0833333333 hours",
  "1e3 minutes",
  "-15 minutes",
  "+15 minutes",
  "15  minutes",
  "15 \t minutes",
  "\n15 minutes\n",
  "Past 15 Minutes of fame",
  "Past1Hours",
  "past1hours",
  "PAST1HOURS",
  "past_1_hours",
  "Past 1 Hours",
  "Past1Hour",
  "pasthour",
  "lasthour",
  "previoush",
  "1234567890 minutes",
  "123456789 minutes",
  "15.0000000001 minutes",
  "15.000000001 minutes",
  "0.2500000000 hours",
  "P0000000001D",
  "PT000000015M",
  "pt1h",
  "p1w",
  /*
   * White space JavaScript trims and Go's unicode.IsSpace does not, and the
   * other way round.
   */
  "\uFEFF15 minutes",
  "15 minutes\uFEFF",
  "\u008515 minutes",
  "15\u00A0minutes",
  "15\u2003minutes",
  "\u300015 minutes\u3000",
  // A letter JavaScript lowers to an ASCII one, and one it lowers to two.
  "1 w\u212A",
  "15 M\u0130N",
  "PREV\u0130OUS 15 MINUTES",
  // Digits that are not ASCII.
  "\uFF11\uFF15 minutes",
  "\u0661\u0665 minutes",
  /*
   * Just within, and just past, the longest text read: 64 characters once
   * trimmed, counted before the spaces between words are joined.
   */
  `15${" ".repeat(55)}minutes`,
  `15${" ".repeat(56)}minutes`,
  `15${"_".repeat(56)}minutes`,
  `${" ".repeat(10)}${"1".repeat(1)} minute${" ".repeat(10)}`,
  `past ${"0".repeat(9)}.${"0".repeat(9)} minutes${"s".repeat(30)}`,
  `15 minutes${" ".repeat(54)}x`,
  "a".repeat(64),
  "a".repeat(65),
  `${"😀".repeat(31)}ab`,
  `${"😀".repeat(31)}abc`,
  `${"a".repeat(63)}😀`,
  // What JSON writes besides text.
  15,
  0,
  1.5,
  1e21,
  1e-7,
  0.000001,
  123456789012345680000,
  true,
  false,
  null,
  [],
  ["Past 15 Minutes"],
  {},
  { value: "Past 15 Minutes" },
];

// What a filter's metric options can hold besides a name.
const CRITERIA_VALUE_EDGE_CASES: Array<JSONValue> = [
  "",
  "   ",
  "_",
  "x",
  ">",
  ">=",
  "Munimum Value",
  "Average!",
  "any.value",
  "All-Values",
  "treat-as-zero",
  "TreatAsZero",
  "Treat_As_Zero",
  "zero",
  "Value",
  "Values",
  "Maximum_Value",
  "MAXIMUM VALUE",
  "\uFEFFavg",
  "\u0085avg",
  "Av\u0130erage",
  "a".repeat(128),
  `${"a".repeat(127)} `,
  `avg${" ".repeat(126)}`,
  `avg${" ".repeat(125)}x`,
  // 128 characters, and 129, whose letters are a name.
  `a${" ".repeat(125)}vg`,
  `a${" ".repeat(126)}vg`,
  `${"😀".repeat(40)}`,
  15,
  0,
  true,
  false,
  null,
  [],
  ["Average"],
  {},
];

/*
 * A name written in other cases and spacing: lower, upper, snake and kebab
 * case, with no spaces, padded.
 */
function otherSpellings(name: string): Array<string> {
  const words: Array<string> = name.split(/\s+/);

  return [
    name,
    name.toLowerCase(),
    name.toUpperCase(),
    words.join("_").toLowerCase(),
    words.join("-").toUpperCase(),
    words.join(""),
    words.join("  "),
    `  ${name}\t`,
  ];
}

/*
 * The units the server reads, one kind at a time: its shortest name ("m")
 * and its longest ("minutes"), with how long it is. Every name is tried on
 * its own in unitSpellings.
 */
function unitKinds(): Array<{ short: string; long: string; seconds: number }> {
  const kinds: Map<string, { short: string; long: string; seconds: number }> =
    new Map();

  for (const unit of RollingTimeUtil.getUnitsRead()) {
    const letter: string = unit.charAt(0);
    const seconds: number | undefined = SECONDS_BY_UNIT_LETTER[letter];

    if (seconds === undefined) {
      continue;
    }

    const kind: { short: string; long: string; seconds: number } = kinds.get(
      letter,
    ) || { short: unit, long: unit, seconds: seconds };

    kinds.set(letter, {
      short: unit.length < kind.short.length ? unit : kind.short,
      long: unit.length > kind.long.length ? unit : kind.long,
      seconds: seconds,
    });
  }

  return Array.from(kinds.values());
}

// Each way of writing a window of this many minutes the cases try.
function lengthSpellings(minutes: number): Array<string> {
  const seconds: number = minutes * 60;
  const spellings: Array<string> = [];

  for (const kind of unitKinds()) {
    const count: number = seconds / kind.seconds;

    // Whole counts in every unit; a decimal one only where it is short.
    if (!Number.isInteger(count) && `${count}`.length > 12) {
      continue;
    }

    spellings.push(
      `${count} ${kind.long}`,
      `${count}${kind.short}`,
      `last ${count} ${kind.long}`,
      `Previous_${count}_${kind.long.toUpperCase()}`,
    );
  }

  // ISO 8601, in each part it can be written in.
  spellings.push(`PT${seconds}S`, `PT${minutes}M`);

  if (minutes % 60 === 0) {
    spellings.push(`PT${minutes / 60}H`);
  }

  if (minutes % (24 * 60) === 0) {
    spellings.push(`P${minutes / (24 * 60)}D`);
  }

  if (minutes % (7 * 24 * 60) === 0) {
    spellings.push(`P${minutes / (7 * 24 * 60)}W`);
  }

  return spellings;
}

// Each unit alone, after a word that looks back, and with a count.
function unitSpellings(): Array<string> {
  const spellings: Array<string> = [];

  for (const unit of RollingTimeUtil.getUnitsRead()) {
    spellings.push(
      unit,
      `past ${unit}`,
      `Last ${unit}`,
      `previous ${unit}`,
      `past${unit}`,
      `0 ${unit}`,
      `1 ${unit}`,
      `1${unit}`,
      `2 ${unit}`,
      `${unit} 15`,
    );
  }

  return spellings;
}

// Values in order, each once (JSON.stringify tells them apart: "1" and 1).
function distinct(values: Array<JSONValue>): Array<JSONValue> {
  const seen: Set<string> = new Set();

  return values.filter((value: JSONValue): boolean => {
    const key: string = JSON.stringify(value);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function rollingTimeError(
  monitorType: MonitorType,
  apiKey: string,
  written: JSONValue,
): string | null {
  return MonitorStepRollingTime.getUnreadableError({
    monitorType: monitorType,
    stepData: { [apiKey]: { rollingTime: written } },
  });
}

// The name the criteria of every criteria value case has: JSON quotes it.
export const CRITERIA_NAME: string = 'HTTP "5xx" \\ errors';

function criteriaValueError(
  key: CriteriaValueCase["key"],
  written: JSONValue,
): string | null {
  return (
    CriteriaFilterValues.getUnreadableErrors({
      criteriaName: CRITERIA_NAME,
      filterCondition: "All",
      filters: [{ metricMonitorOptions: { [key]: written } }],
    })[0] || null
  );
}

// Steps as the API takes them: one step, with these settings and options.
function stepsWritten(settings: JSONObject, options: JSONObject): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            ...settings,
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      name: CRITERIA_NAME,
                      filterCondition: "All",
                      filters: [
                        {
                          checkOn: CheckOn.MetricValue,
                          filterType: FilterType.GreaterThan,
                          value: 0,
                          metricMonitorOptions: options,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  };
}

/*
 * Steps as the server stores and answers them: read from the request
 * (MonitorSteps.fromJSON), written to the database (toJSON), read from it
 * and written into the response.
 */
function stepsStored(written: JSONObject): JSONObject {
  const stored: JSONObject = MonitorSteps.fromJSON(written).toJSON();

  return JSON.parse(
    JSON.stringify(MonitorSteps.fromJSON(stored).toJSON()),
  ) as JSONObject;
}

function firstStep(steps: JSONObject): JSONObject {
  const step: JSONObject = (
    (steps["value"] as JSONObject)["monitorStepsInstanceArray"] as JSONArray
  )[0] as JSONObject;

  return step["value"] as JSONObject;
}

function firstFilter(step: JSONObject): JSONObject {
  const criteria: JSONObject = (step["monitorCriteria"] as JSONObject)[
    "value"
  ] as JSONObject;
  const instance: JSONObject = (
    criteria["monitorCriteriaInstanceArray"] as JSONArray
  )[0] as JSONObject;

  return (
    (instance["value"] as JSONObject)["filters"] as JSONArray
  )[0] as JSONObject;
}

// The keys of an object the server stored, absent where it stored none.
function storedKeys(object: JSONValue, keys: Array<string>): JSONObject {
  const stored: JSONObject = {};

  if (!object || typeof object !== "object" || Array.isArray(object)) {
    return stored;
  }

  for (const key of keys) {
    if (key in object) {
      stored[key] = (object as JSONObject)[key] as JSONValue;
    }
  }

  return stored;
}

// What the stored cases write: a sample of each kind of value.
const STORED_SAMPLES: Array<JSONValue> = [
  ...Object.values(RollingTime),
  "15 minutes",
  "PT15M",
  "past hour",
  "1 week",
  "20 minutes",
  "Past1Hours",
  "   ",
  "x",
  "",
  null,
  0,
  15,
  true,
  false,
  [],
  ["Past 15 Minutes"],
  {},
];

const STORED_OPTION_SAMPLES: Array<JSONValue> = [
  ...Object.values(EvaluateOverTimeType),
  ...Object.values(NoDataPolicy),
  "avg",
  "MAXIMUM_VALUE",
  "treat as zero",
  "trigger",
  "x",
  "   ",
  "",
  null,
  0,
  15,
  true,
  false,
  [],
  {},
];

export function buildMonitorStepsValuesCases(): MonitorStepsValuesCases {
  const rollingTimes: Array<RollingTime> = Object.values(RollingTime);
  const settings: Array<{ monitorType: MonitorType; apiKey: string }> =
    MonitorStepRollingTime.getMonitorTypes().map(
      (
        monitorType: MonitorType,
      ): { monitorType: MonitorType; apiKey: string } => {
        return {
          monitorType: monitorType,
          apiKey: MonitorStepRollingTime.getStepKey(monitorType) as string,
        };
      },
    );

  const rollingTimeWritten: Array<JSONValue> = distinct([
    ...rollingTimes.flatMap((rollingTime: RollingTime): Array<string> => {
      return [
        ...otherSpellings(rollingTime),
        ...lengthSpellings(RollingTimeUtil.getWindowInMs(rollingTime) / 60000),
      ];
    }),
    ...unitSpellings(),
    ...ROLLING_TIME_EDGE_CASES,
  ]);

  const criteriaKeys: Array<{
    key: CriteriaValueCase["key"];
    names: Array<string>;
    other: Array<string>;
  }> = [
    {
      key: "metricAggregationType",
      names: CriteriaFilterValues.getNamesRead("evaluateOverTimeType"),
      other: CriteriaFilterValues.getNamesRead("noDataPolicy"),
    },
    {
      key: "onNoDataPolicy",
      names: CriteriaFilterValues.getNamesRead("noDataPolicy"),
      other: CriteriaFilterValues.getNamesRead("evaluateOverTimeType"),
    },
  ];

  const criteriaValueCases: Array<CriteriaValueCase> = criteriaKeys.flatMap(
    (field: {
      key: CriteriaValueCase["key"];
      names: Array<string>;
      other: Array<string>;
    }): Array<CriteriaValueCase> => {
      return distinct([
        ...field.names.flatMap(otherSpellings),
        ...field.other,
        ...CRITERIA_VALUE_EDGE_CASES,
      ]).map((written: JSONValue): CriteriaValueCase => {
        const read: string | null =
          field.key === "metricAggregationType"
            ? CriteriaFilterValues.readEvaluateOverTimeType(written)
            : CriteriaFilterValues.readNoDataPolicy(written);

        return {
          key: field.key,
          written: written,
          read: read,
          error: criteriaValueError(field.key, written),
        };
      });
    },
  );

  return {
    about:
      "Written by the OneUptime Terraform provider generator from the server's own code (Scripts/TerraformProvider/Core/MonitorStepsValuesCases.ts): how the server reads, refuses and stores the values of a monitor's steps that monitorstepsvalues.go reads. Do not edit.",
    rollingTimes: rollingTimes.map(
      (rollingTime: RollingTime): { value: string; minutes: number } => {
        return {
          value: rollingTime,
          minutes: RollingTimeUtil.getWindowInMs(rollingTime) / 60000,
        };
      },
    ),
    defaultRollingTime: RollingTimeUtil.getDefault(),
    rollingTimeSettings: settings,
    evaluateOverTimeTypes: Object.values(EvaluateOverTimeType),
    noDataPolicies: Object.values(NoDataPolicy),
    rollingTimeErrorsBySettings: settings.flatMap(
      (setting: { monitorType: MonitorType; apiKey: string }) => {
        return ["20 minutes", "15 minutes"].map((written: string) => {
          return {
            monitorType: setting.monitorType,
            apiKey: setting.apiKey,
            written: written,
            error: rollingTimeError(
              setting.monitorType,
              setting.apiKey,
              written,
            ),
          };
        });
      },
    ),
    rollingTimeCases: rollingTimeWritten.map(
      (written: JSONValue): RollingTimeCase => {
        return {
          written: written,
          read: RollingTimeUtil.fromValue(written),
          error: rollingTimeError(
            MonitorType.Metrics,
            "metricMonitor",
            written,
          ),
        };
      },
    ),
    criteriaName: CRITERIA_NAME,
    criteriaValueCases: criteriaValueCases,
    storedRollingTimes: STORED_SAMPLES.map((written: JSONValue): StoredCase => {
      const writtenSettings: JSONObject = {};

      for (const setting of settings) {
        writtenSettings[setting.apiKey] = { rollingTime: written };
      }

      const step: JSONObject = firstStep(
        stepsStored(stepsWritten(writtenSettings, {})),
      );
      const stored: JSONObject = {};

      for (const setting of settings) {
        stored[setting.apiKey] = storedKeys(step[setting.apiKey] as JSONValue, [
          "rollingTime",
        ]);
      }

      return { written: written, stored: stored };
    }),
    storedMetricMonitorOptions: STORED_OPTION_SAMPLES.map(
      (written: JSONValue): StoredCase => {
        const filter: JSONObject = firstFilter(
          firstStep(
            stepsStored(
              stepsWritten(
                {},
                { metricAggregationType: written, onNoDataPolicy: written },
              ),
            ),
          ),
        );

        return {
          written: written,
          stored: storedKeys(filter["metricMonitorOptions"] as JSONValue, [
            "metricAggregationType",
            "onNoDataPolicy",
          ]),
        };
      },
    ),
  };
}

// The file's name, in the provider's internal/provider/testdata.
export const MONITOR_STEPS_VALUES_CASES_FILE: string =
  "monitor_steps_values.json";

/*
 * The file the provider's Go test reads, as the generator writes it: one
 * case a line.
 */
export function monitorStepsValuesCasesFile(): string {
  const entries: Array<[string, unknown]> = Object.entries(
    buildMonitorStepsValuesCases(),
  );
  const lines: Array<string> = ["{"];

  entries.forEach(([key, value]: [string, unknown], index: number): void => {
    const comma: string = index < entries.length - 1 ? "," : "";

    if (!Array.isArray(value)) {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
      return;
    }

    lines.push(`  ${JSON.stringify(key)}: [`);
    value.forEach((item: unknown, itemIndex: number): void => {
      lines.push(
        `    ${JSON.stringify(item)}${itemIndex < value.length - 1 ? "," : ""}`,
      );
    });
    lines.push(`  ]${comma}`);
  });

  lines.push("}");

  return `${lines.join("\n")}\n`;
}
