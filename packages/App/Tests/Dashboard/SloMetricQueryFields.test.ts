import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import { Mock } from "jest-mock";
import path from "path";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  SloMetricKind,
  SloMetricQueryPart,
} from "Common/Utils/Slo/SloMetricSli";
import {
  getSloMetricFields,
  getSloMetricPartProblem,
  guessSloMetricKind,
  isMetricForm,
  readSloMetricConfigInForm,
  SLO_METRIC_FIELD_KEYS,
  SLO_METRIC_FIELD_TITLES,
  withSloMetricPart,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloMetricQueryFields";
import {
  getSloFormFields,
  pickSloFormFields,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";

/*
 * A Metric SLO's metric in the create form and in Settings (#8445): one
 * JSON column, asked part by part - which metric, how its good events are
 * told apart, the good condition or value, and an optional filter - each a
 * form-only field that edits its part, the column registered unseen so the
 * form loads and saves it.
 */

type SloField = ModelField<ServiceLevelObjective>;
type SloValues = FormValues<ServiceLevelObjective>;

function valuesOf(fields: Record<string, unknown>): SloValues {
  return fields as unknown as SloValues;
}

const METRIC_SLO: SloValues = valuesOf({
  sliType: SliType.Metric,
  metricQueryConfig: {
    metricName: "http_requests_total",
    kind: SloMetricKind.Counter,
    goodFilter: "@http.response.status_code:<500",
  },
});

function partFieldOf(
  fields: Array<SloField>,
  part: SloMetricQueryPart,
): SloField {
  const field: SloField | undefined = fields.find(
    (candidate: SloField): boolean => {
      return candidate.overrideFieldKey === SLO_METRIC_FIELD_KEYS[part];
    },
  );

  if (!field) {
    throw new Error(`No field for the metric's ${part}.`);
  }

  return field;
}

describe("the Metric SLO form's helpers", () => {
  test("a Metric SLO's form asks for its metric; no other does", () => {
    expect(isMetricForm(METRIC_SLO)).toBe(true);

    for (const sliType of [
      SliType.MonitorUptime,
      SliType.RequestSuccess,
      SliType.RequestLatency,
      undefined,
    ]) {
      expect(isMetricForm(valuesOf({ sliType: sliType }))).toBe(false);
    }
  });

  test.each<[string, SloMetricKind | undefined]>([
    ["http.server.request.duration", SloMetricKind.Histogram],
    ["http_server_duration_milliseconds", SloMetricKind.Histogram],
    ["http_request_duration_seconds_bucket", SloMetricKind.Histogram],
    ["rpc.server.latency", SloMetricKind.Histogram],
    ["http_requests_total", SloMetricKind.Counter],
    ["grpc_server_handled_total", SloMetricKind.Counter],
    ["jobs.processed.count", SloMetricKind.Counter],
    ["queue.depth", undefined],
    ["  ", undefined],
  ])(
    "guesses %s is a %s by its name",
    (name: string, kind: SloMetricKind | undefined) => {
      expect(guessSloMetricKind(name)).toBe(kind);
    },
  );

  test("reads the metric the form holds, and nothing from a value that is not one", () => {
    expect(readSloMetricConfigInForm(METRIC_SLO)).toEqual({
      metricName: "http_requests_total",
      kind: SloMetricKind.Counter,
      goodFilter: "@http.response.status_code:<500",
    });

    for (const stored of [undefined, null, "http_requests_total", [1]]) {
      expect(
        readSloMetricConfigInForm(valuesOf({ metricQueryConfig: stored })),
      ).toEqual({});
    }
  });

  test("changes one part and keeps the rest", () => {
    const changed: SloValues = withSloMetricPart(
      METRIC_SLO,
      SloMetricQueryPart.Filter,
      "@http.route:/checkout*",
    );

    expect(readSloMetricConfigInForm(changed)).toEqual({
      metricName: "http_requests_total",
      kind: SloMetricKind.Counter,
      goodFilter: "@http.response.status_code:<500",
      filter: "@http.route:/checkout*",
    });
    // The values it was given are left as they were.
    expect(readSloMetricConfigInForm(METRIC_SLO)).not.toHaveProperty("filter");
  });

  test("an emptied part is gone, not stored empty", () => {
    expect(
      readSloMetricConfigInForm(
        withSloMetricPart(METRIC_SLO, SloMetricQueryPart.GoodFilter, ""),
      ),
    ).not.toHaveProperty("goodFilter");
  });

  test("a metric picked before its kind gets the kind its name says, never over one chosen", () => {
    expect(
      readSloMetricConfigInForm(
        withSloMetricPart(
          valuesOf({ sliType: SliType.Metric }),
          SloMetricQueryPart.MetricName,
          "http.server.request.duration",
        ),
      ).kind,
    ).toBe(SloMetricKind.Histogram);

    expect(
      readSloMetricConfigInForm(
        withSloMetricPart(
          METRIC_SLO,
          SloMetricQueryPart.MetricName,
          "http.server.request.duration",
        ),
      ).kind,
    ).toBe(SloMetricKind.Counter);
  });

  test("says what is wrong with a part on that part's field only", () => {
    const noCondition: SloValues = valuesOf({
      sliType: SliType.Metric,
      metricQueryConfig: { metricName: "http_requests_total", kind: "Counter" },
    });

    expect(
      getSloMetricPartProblem(noCondition, SloMetricQueryPart.GoodFilter),
    ).toBe(
      "Say which of the counter's events are good, such as @http.response.status_code:<500.",
    );

    for (const part of [
      SloMetricQueryPart.MetricName,
      SloMetricQueryPart.Kind,
      SloMetricQueryPart.Filter,
    ]) {
      expect(getSloMetricPartProblem(noCondition, part)).toBeNull();
    }
  });

  test("an SLO of another type is never told about a metric", () => {
    expect(
      getSloMetricPartProblem(
        valuesOf({ sliType: SliType.RequestSuccess }),
        SloMetricQueryPart.MetricName,
      ),
    ).toBeNull();
  });

  test("a Metric SLO with nothing chosen is asked for the metric first", () => {
    expect(
      getSloMetricPartProblem(
        valuesOf({ sliType: SliType.Metric }),
        SloMetricQueryPart.MetricName,
      ),
    ).toBe(
      "Choose the metric this SLO counts, such as http.server.request.duration.",
    );
  });
});

describe("the Metric SLO form's fields", () => {
  const fields: Array<SloField> = getSloMetricFields({ stepId: "metric" });

  test("the column comes first, registered unseen so the form loads and saves it", () => {
    const column: SloField = fields[0]!;

    expect(column.field).toEqual({ metricQueryConfig: true });
    expect(column.showIf!(METRIC_SLO)).toBe(false);
    expect(column.hideColumnDescription).toBe(true);
    expect(column.required).toBe(false);
  });

  test("then each part, as a form-only field of its own key that edits the column", () => {
    expect(
      fields.slice(1).map((field: SloField): string => {
        return field.overrideFieldKey as string;
      }),
    ).toEqual([
      "sloMetricName",
      "sloMetricKind",
      "sloMetricGoodFilter",
      "sloMetricGoodAtOrUnder",
      "sloMetricFilter",
    ]);

    for (const field of fields.slice(1)) {
      expect(field.overrideField).toEqual({ metricQueryConfig: true });
      expect(field.formOnly).toBe(true);
      expect(field.fieldType).toBe(FormFieldSchemaType.CustomComponent);
      expect(field.stepId).toBe("metric");
      // Each part says what it needs as its problem, never as an empty "required".
      expect(field.required).toBe(false);
    }
  });

  test("each part is titled as the form asks it", () => {
    for (const part of Object.values(SloMetricQueryPart)) {
      expect(partFieldOf(fields, part).title).toBe(
        SLO_METRIC_FIELD_TITLES[part],
      );
    }

    expect(SLO_METRIC_FIELD_TITLES).toEqual({
      metricName: "Metric",
      kind: "Good Events",
      goodFilter: "Good When",
      goodAtOrUnder: "Good At Or Under",
      filter: "Metric Filter",
    });
  });

  test("only the filter is marked optional", () => {
    for (const part of Object.values(SloMetricQueryPart)) {
      expect({
        part: part,
        hidesOptional: partFieldOf(fields, part).hideOptionalLabel,
      }).toEqual({
        part: part,
        hidesOptional: part !== SloMetricQueryPart.Filter,
      });
    }
  });

  test("a counter asks for its condition, a histogram for its value, and neither for the other's", () => {
    const histogram: SloValues = valuesOf({
      sliType: SliType.Metric,
      metricQueryConfig: { metricName: "m", kind: SloMetricKind.Histogram },
    });

    const shows: (part: SloMetricQueryPart, values: SloValues) => boolean = (
      part: SloMetricQueryPart,
      values: SloValues,
    ): boolean => {
      return partFieldOf(fields, part).showIf!(values);
    };

    expect(shows(SloMetricQueryPart.GoodFilter, METRIC_SLO)).toBe(true);
    expect(shows(SloMetricQueryPart.GoodAtOrUnder, METRIC_SLO)).toBe(false);
    expect(shows(SloMetricQueryPart.GoodFilter, histogram)).toBe(false);
    expect(shows(SloMetricQueryPart.GoodAtOrUnder, histogram)).toBe(true);

    // No kind chosen yet: neither, until one is.
    const noKind: SloValues = valuesOf({
      sliType: SliType.Metric,
      metricQueryConfig: { metricName: "m" },
    });

    expect(shows(SloMetricQueryPart.GoodFilter, noKind)).toBe(false);
    expect(shows(SloMetricQueryPart.GoodAtOrUnder, noKind)).toBe(false);

    // Another SLO type's form shows none of them.
    for (const part of Object.values(SloMetricQueryPart)) {
      expect(shows(part, valuesOf({ sliType: SliType.RequestSuccess }))).toBe(
        false,
      );
    }
  });

  test("a part's change is written into the column, the rest kept", () => {
    const setNewFormValues: Mock<(values: SloValues) => void> =
      jest.fn<(values: SloValues) => void>();

    partFieldOf(fields, SloMetricQueryPart.Filter).onChange!(
      "@http.route:/checkout*",
      METRIC_SLO,
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(
      readSloMetricConfigInForm(
        setNewFormValues.mock.calls[0]![0] as SloValues,
      ),
    ).toMatchObject({
      metricName: "http_requests_total",
      filter: "@http.route:/checkout*",
    });
  });

  test("each part validates its own part", () => {
    const noValue: SloValues = valuesOf({
      sliType: SliType.Metric,
      metricQueryConfig: { metricName: "m", kind: SloMetricKind.Histogram },
    });

    expect(
      partFieldOf(fields, SloMetricQueryPart.GoodAtOrUnder).customValidation!(
        noValue,
      ),
    ).toContain("Enter the value a good observation stays at or under");
    expect(
      partFieldOf(fields, SloMetricQueryPart.MetricName).customValidation!(
        noValue,
      ),
    ).toBeNull();
  });
});

describe("the Metric SLO's fields in the create form and in Settings", () => {
  test("the create form asks for them on their own step", () => {
    const metricFields: Array<SloField> = getSloFormFields().filter(
      (field: SloField): boolean => {
        return field.stepId === "metric";
      },
    );

    expect(metricFields).toHaveLength(6);
  });

  test("Settings edits the column with every part, on no step", () => {
    const picked: Array<SloField> = pickSloFormFields(["metricQueryConfig"]);

    expect(picked).toHaveLength(6);
    expect(
      picked.map((field: SloField): string => {
        return field.overrideFieldKey || Object.keys(field.field || {})[0]!;
      }),
    ).toEqual([
      "metricQueryConfig",
      "sloMetricName",
      "sloMetricKind",
      "sloMetricGoodFilter",
      "sloMetricGoodAtOrUnder",
      "sloMetricFilter",
    ]);

    for (const field of picked) {
      expect(field.stepId).toBeUndefined();
    }
  });
});

/*
 * The fields draw nothing themselves, so they can be read here: App has no
 * react (FeatureSetImportsStayReactFree). Each part's control comes from
 * SloMetricQueryFieldElements.tsx, which hands them over as it loads.
 */
describe("the Metric SLO fields' controls", () => {
  const DASHBOARD_SOURCE: string = path.join(
    __dirname,
    "../../FeatureSet/Dashboard/src",
  );

  function sourceFiles(directory: string): Array<string> {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((entry: fs.Dirent): Array<string> => {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          return sourceFiles(full);
        }

        return entry.name.endsWith(".tsx") ? [full] : [];
      });
  }

  test("are handed over by SloMetricQueryFieldElements as it loads", () => {
    const elements: string = fs.readFileSync(
      path.join(DASHBOARD_SOURCE, "Pages/Slo/SloMetricQueryFieldElements.tsx"),
      "utf8",
    );

    expect(elements).toContain("setSloMetricPartElement(drawSloMetricPart);");
  });

  test("a part shown where they were not loaded says what to load", () => {
    const field: SloField = partFieldOf(
      getSloMetricFields(),
      SloMetricQueryPart.MetricName,
    );

    expect(() => {
      field.getCustomElement!(METRIC_SLO, {} as CustomElementProps);
    }).toThrow(
      "load Pages/Slo/SloMetricQueryFieldElements where the SLO form is shown",
    );
  });

  // A page that shows the SLO form, and the import that loads the controls.
  const SHOWS_THE_FORM: RegExp = /\b(getSloFormFields|pickSloFormFields)\(/;
  const LOADS_THE_CONTROLS: RegExp =
    /^import "[./]+(Slo\/)?SloMetricQueryFieldElements";$/m;

  test("every page that shows the SLO form loads them", () => {
    const pages: Array<string> = sourceFiles(DASHBOARD_SOURCE)
      .filter((file: string): boolean => {
        return SHOWS_THE_FORM.test(fs.readFileSync(file, "utf8"));
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SOURCE, file);
      });

    expect(pages).toEqual(
      expect.arrayContaining([
        "Pages/Slo/Slos.tsx",
        "Pages/Slo/View/Settings.tsx",
        "Pages/Service/View/Slos.tsx",
      ]),
    );

    for (const page of pages) {
      expect({
        page,
        loadsTheControls: LOADS_THE_CONTROLS.test(
          fs.readFileSync(path.join(DASHBOARD_SOURCE, page), "utf8"),
        ),
      }).toEqual({ page, loadsTheControls: true });
    }
  });
});
