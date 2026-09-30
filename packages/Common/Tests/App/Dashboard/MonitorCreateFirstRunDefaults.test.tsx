import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { getJestSpyOn } from "../../Spy";

/*
 * The create monitor form, as a first-time user meets it.
 *
 * - Its "Monitoring Interval" is required, and used to start empty: one more
 *   decision, on the way to a first monitor, that a new user has no basis for.
 *   It now starts on Every 5 Minutes - the interval the page's own prefills
 *   already use - and a prefill that says anything about the interval keeps
 *   it.
 * - Only probe-checked monitor types show that step. Every other type (Manual,
 *   Incoming Request, Logs, ...) must still be created with no interval, as it
 *   was before the default existed: the default is dropped before save unless
 *   a prefill set it.
 * - The Probes field promised "Leave this empty to use every probe that is set
 *   to monitor new monitors by default". An emptied selection is in fact sent
 *   as "attach no probes", and nothing ever checks such a monitor. The help now
 *   says what a probe is and what an empty selection means.
 *
 * The real page is rendered with ModelForm mocked to capture the props it is
 * handed (the approach of MonitorCreateFromMonitorBackedDevice.test.tsx), so
 * the captured initialValues, fields and onBeforeCreate are the page's own.
 */

type CapturedField = {
  title?: string | undefined;
  description?: string | undefined;
  overrideFieldKey?: string | undefined;
  field?: Record<string, unknown> | undefined;
  required?: boolean | undefined;
  stepId?: string | undefined;
  fetchDropdownOptions?:
    | ((item: Record<string, unknown>) => Promise<Array<{ value: unknown }>>)
    | undefined;
};

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
  fields: Array<CapturedField>;
  onBeforeCreate?: ((item: Monitor) => Promise<Monitor>) | undefined;
};

let capturedForm: CapturedFormProps | null = null;

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  /*
   * Everything but the component is real: Create.tsx imports FormType from
   * here, and PayAsYouGo imports the ModelField type.
   */
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForm = props;
      return <div data-testid="model-form" />;
    },
  };
});

// Only rendered through ModelForm's getCustomElement, which the mock never calls.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="monitor-steps" />;
      },
    };
  },
);

const DEFAULT_PROBE_ID: string = "99999999-9999-4999-8999-999999999999";

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<Record<string, unknown>>> => {
        return Promise.resolve([
          {
            _id: "99999999-9999-4999-8999-999999999999",
            name: "Global probe",
            isGlobalProbe: true,
            shouldAutoEnableProbeOnNewMonitors: true,
          },
        ]);
      },
    },
  };
});

/*
 * The template the "?monitorTemplateId=" link loads, swapped per test. Read
 * lazily by the factory below (jest.mock is hoisted above the imports).
 */
let templateRow: MonitorTemplate | null = null;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: { name?: string };
      }): Promise<unknown> => {
        if (request.modelType?.name === "MonitorTemplate") {
          return Promise.resolve(templateRow);
        }

        if (request.modelType?.name === "Project") {
          return Promise.resolve({
            doNotAddGlobalProbesByDefaultOnNewMonitors: false,
          });
        }

        return Promise.resolve(null);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

import MonitorCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import MonitoringInterval from "../../../../App/FeatureSet/Dashboard/src/Utils/MonitorIntervalDropdownOptions";
import {
  DEFAULT_MONITORING_INTERVAL,
  shouldDropDefaultMonitoringInterval,
  withDefaultMonitoringInterval,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitoringIntervalDefault";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import UiAnalytics from "../../../UI/Utils/Analytics";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { MetricExplorerUrlParam } from "../../../Utils/Metrics/MetricExplorerUrl";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: string = "22222222-2222-4222-8222-222222222222";

const NEW_PROBES_HELP: string =
  "Probes are the machines that run this monitor's checks. Your project's default probes start selected. A monitor with no probes is never checked.";

const OLD_PROBES_HELP: string =
  "Which probes should monitor this resource? Leave this empty to use every probe that is set to monitor new monitors by default.";

// Types a probe checks on an interval, and types it does not.
const PROBE_TYPES: Array<MonitorType> = Object.values(MonitorType).filter(
  (type: MonitorType): boolean => {
    return MonitorTypeHelper.doesMonitorTypeHaveInterval(type);
  },
);
const NON_PROBE_TYPES: Array<MonitorType> = Object.values(MonitorType).filter(
  (type: MonitorType): boolean => {
    return !MonitorTypeHelper.doesMonitorTypeHaveInterval(type);
  },
);

function openWithParams(
  params: Record<string, string>,
): Promise<CapturedFormProps> {
  getJestSpyOn(Navigation, "getQueryStringByName").mockImplementation(
    (paramName: string): string | null => {
      return params[paramName] ?? null;
    },
  );

  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <MonitorCreate
        pageRoute={new Route("/dashboard/monitors/create")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  return waitFor(() => {
    expect(capturedForm).not.toBeNull();
    return capturedForm!;
  });
}

function monitorOf(type: MonitorType, interval: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.name = "Checkout";
  monitor.monitorType = type;
  monitor.monitoringInterval = interval;
  return monitor;
}

function probesField(form: CapturedFormProps): CapturedField {
  const field: CapturedField | undefined = form.fields.find(
    (candidate: CapturedField): boolean => {
      return candidate.overrideFieldKey === "probes";
    },
  );
  expect(field).toBeDefined();
  return field!;
}

function intervalField(form: CapturedFormProps): CapturedField {
  const field: CapturedField | undefined = form.fields.find(
    (candidate: CapturedField): boolean => {
      return Boolean(
        candidate.field && "monitoringInterval" in candidate.field,
      );
    },
  );
  expect(field).toBeDefined();
  return field!;
}

beforeEach(() => {
  capturedForm = null;
  templateRow = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the default interval on a plain create page", () => {
  test("the form starts on Every 5 Minutes", async () => {
    const form: CapturedFormProps = await openWithParams({});

    expect(form.initialValues["monitoringInterval"]).toBe("*/5 * * * *");
    expect(form.initialValues["monitoringInterval"]).toBe(
      DEFAULT_MONITORING_INTERVAL,
    );
  });

  test("nothing else is chosen for the user: no monitor type yet", async () => {
    const form: CapturedFormProps = await openWithParams({});

    expect(form.initialValues["monitorType"]).toBeUndefined();
    expect(form.initialValues["name"]).toBeUndefined();
  });

  test("the project's default probes still start selected alongside it", async () => {
    const form: CapturedFormProps = await openWithParams({});

    expect(form.initialValues["probes"]).toEqual([DEFAULT_PROBE_ID]);
  });

  test("the interval stays a required field - the default is only a starting value", async () => {
    const form: CapturedFormProps = await openWithParams({});

    expect(intervalField(form).required).toBe(true);
    expect(intervalField(form).title).toBe("Monitoring Interval");
  });

  test.each([
    MonitorType.Website,
    MonitorType.API,
    MonitorType.SSLCertificate,
    MonitorType.SyntheticMonitor,
    MonitorType.CustomJavaScriptCode,
  ])(
    "the default is one of the options the %s form offers, so it is kept on screen",
    async (type: MonitorType) => {
      const form: CapturedFormProps = await openWithParams({});

      const options: Array<{ value: unknown }> = await intervalField(form)
        .fetchDropdownOptions!({ monitorType: type });

      expect(
        options.map((option: { value: unknown }): unknown => {
          return option.value;
        }),
      ).toContain(DEFAULT_MONITORING_INTERVAL);
    },
  );

  test("a monitorType deep link adds the type and keeps the default interval", async () => {
    const form: CapturedFormProps = await openWithParams({
      monitorType: MonitorType.Website,
    });

    expect(form.initialValues["monitorType"]).toBe(MonitorType.Website);
    expect(form.initialValues["monitoringInterval"]).toBe(
      DEFAULT_MONITORING_INTERVAL,
    );
  });

  test("an unknown monitorType in the link is ignored, and the default still applies", async () => {
    const form: CapturedFormProps = await openWithParams({
      monitorType: "NotARealType",
    });

    expect(form.initialValues["monitorType"]).toBeUndefined();
    expect(form.initialValues["monitoringInterval"]).toBe(
      DEFAULT_MONITORING_INTERVAL,
    );
  });
});

describe("before save on a plain create page", () => {
  test.each(PROBE_TYPES)(
    "a %s monitor keeps the default interval",
    async (type: MonitorType) => {
      const form: CapturedFormProps = await openWithParams({});

      const saved: Monitor = await form.onBeforeCreate!(
        monitorOf(type, DEFAULT_MONITORING_INTERVAL),
      );

      expect(saved.monitoringInterval).toBe(DEFAULT_MONITORING_INTERVAL);
    },
  );

  test("a probe-checked monitor keeps an interval the user picked instead", async () => {
    const form: CapturedFormProps = await openWithParams({});

    const saved: Monitor = await form.onBeforeCreate!(
      monitorOf(MonitorType.Website, "*/15 * * * *"),
    );

    expect(saved.monitoringInterval).toBe("*/15 * * * *");
  });

  test.each(NON_PROBE_TYPES)(
    "a %s monitor is created with no interval, as before",
    async (type: MonitorType) => {
      const form: CapturedFormProps = await openWithParams({});

      const saved: Monitor = await form.onBeforeCreate!(
        monitorOf(type, DEFAULT_MONITORING_INTERVAL),
      );

      expect(saved.monitoringInterval).toBeUndefined();
      expect(
        Object.prototype.hasOwnProperty.call(saved, "monitoringInterval"),
      ).toBe(false);
    },
  );

  test("the named examples: Incoming Request, Manual and Logs lose it; Website, API and Ping keep it", async () => {
    const form: CapturedFormProps = await openWithParams({});

    for (const type of [
      MonitorType.IncomingRequest,
      MonitorType.Manual,
      MonitorType.Logs,
    ]) {
      const saved: Monitor = await form.onBeforeCreate!(
        monitorOf(type, DEFAULT_MONITORING_INTERVAL),
      );
      expect([type, saved.monitoringInterval]).toEqual([type, undefined]);
    }

    for (const type of [
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
    ]) {
      const saved: Monitor = await form.onBeforeCreate!(
        monitorOf(type, DEFAULT_MONITORING_INTERVAL),
      );
      expect([type, saved.monitoringInterval]).toEqual([
        type,
        DEFAULT_MONITORING_INTERVAL,
      ]);
    }
  });

  test("the rest of the monitor is untouched", async () => {
    const form: CapturedFormProps = await openWithParams({});

    const saved: Monitor = await form.onBeforeCreate!(
      monitorOf(MonitorType.IncomingRequest, DEFAULT_MONITORING_INTERVAL),
    );

    expect(saved.name).toBe("Checkout");
    expect(saved.monitorType).toBe(MonitorType.IncomingRequest);
  });
});

describe("a prefill that sets the interval keeps it", () => {
  function template(interval: string | undefined): MonitorTemplate {
    const row: MonitorTemplate = new MonitorTemplate();
    row.id = new ObjectID(TEMPLATE_ID);
    row.monitorName = "From template";
    row.monitorType = MonitorType.Logs;
    if (interval !== undefined) {
      row.monitoringInterval = interval;
    }
    return row;
  }

  test("a template's interval wins over the default", async () => {
    templateRow = template("*/10 * * * *");

    const form: CapturedFormProps = await openWithParams({
      monitorTemplateId: TEMPLATE_ID,
    });

    expect(form.initialValues["monitoringInterval"]).toBe("*/10 * * * *");
    expect(form.initialValues["monitorType"]).toBe(MonitorType.Logs);
  });

  test("a template's interval is saved even for a type with no interval step", async () => {
    templateRow = template("*/10 * * * *");

    const form: CapturedFormProps = await openWithParams({
      monitorTemplateId: TEMPLATE_ID,
    });
    const saved: Monitor = await form.onBeforeCreate!(
      monitorOf(MonitorType.Logs, "*/10 * * * *"),
    );

    expect(saved.monitoringInterval).toBe("*/10 * * * *");
  });

  test("a template that sets no interval gets no default either: the prefill said it", async () => {
    templateRow = template(undefined);

    const form: CapturedFormProps = await openWithParams({
      monitorTemplateId: TEMPLATE_ID,
    });

    expect("monitoringInterval" in form.initialValues).toBe(true);
    expect(form.initialValues["monitoringInterval"]).toBeUndefined();
  });

  test("the metric-view prefill's interval is kept for its Metrics monitor", async () => {
    const form: CapturedFormProps = await openWithParams({
      [MetricExplorerUrlParam.MetricQueries]: JSON.stringify([
        { metricName: "http.server.duration" },
      ]),
    });

    expect(form.initialValues["monitorType"]).toBe(MonitorType.Metrics);
    expect(form.initialValues["monitoringInterval"]).toBe("*/5 * * * *");

    // Metrics has no interval step, but this interval came from the prefill.
    expect(
      MonitorTypeHelper.doesMonitorTypeHaveInterval(MonitorType.Metrics),
    ).toBe(false);
    const saved: Monitor = await form.onBeforeCreate!(
      monitorOf(MonitorType.Metrics, "*/5 * * * *"),
    );
    expect(saved.monitoringInterval).toBe("*/5 * * * *");
  });

  test("without the prefill, the same Metrics monitor is saved with no interval", async () => {
    const form: CapturedFormProps = await openWithParams({});

    const saved: Monitor = await form.onBeforeCreate!(
      monitorOf(MonitorType.Metrics, "*/5 * * * *"),
    );

    expect(saved.monitoringInterval).toBeUndefined();
  });
});

describe("the Probes help", () => {
  test("says what a probe is and what an empty selection means", async () => {
    const form: CapturedFormProps = await openWithParams({});

    expect(probesField(form).title).toBe("Probes");
    expect(probesField(form).description).toBe(NEW_PROBES_HELP);
  });

  test("no longer promises that an empty selection uses the defaults", async () => {
    const form: CapturedFormProps = await openWithParams({});

    expect(probesField(form).description).not.toBe(OLD_PROBES_HELP);
    expect(probesField(form).description).not.toMatch(/leave this empty/i);
  });

  test("warns that a monitor with no probes is never checked", async () => {
    const form: CapturedFormProps = await openWithParams({});

    expect(probesField(form).description).toContain(
      "A monitor with no probes is never checked.",
    );
    expect(probesField(form).description).toContain("start selected");
  });
});

describe("the interval helpers", () => {
  test("the default is five minutes, and on the interval dropdown as Every 5 Minutes", () => {
    expect(DEFAULT_MONITORING_INTERVAL).toBe("*/5 * * * *");

    const option: { value: unknown; label: unknown } | undefined =
      MonitoringInterval.find((candidate: { value: unknown }): boolean => {
        return candidate.value === DEFAULT_MONITORING_INTERVAL;
      }) as { value: unknown; label: unknown } | undefined;

    expect(option?.label).toBe("Every 5 Minutes");
  });

  test("the default is allowed for the types that refuse one- and two-minute checks", () => {
    expect(DEFAULT_MONITORING_INTERVAL).not.toBe("* * * * *");
    expect(DEFAULT_MONITORING_INTERVAL).not.toBe("*/2 * * * *");
  });

  test("an empty prefill gets the default", () => {
    expect(withDefaultMonitoringInterval({})).toEqual({
      monitoringInterval: DEFAULT_MONITORING_INTERVAL,
    });
  });

  test("other starting values are kept beside it", () => {
    expect(
      withDefaultMonitoringInterval({
        name: "Checkout",
        monitorType: MonitorType.Website,
      }),
    ).toEqual({
      name: "Checkout",
      monitorType: MonitorType.Website,
      monitoringInterval: DEFAULT_MONITORING_INTERVAL,
    });
  });

  test("a prefill's own interval is returned untouched, as the same object", () => {
    const prefill: JSONObject = { monitoringInterval: "0 * * * *" };

    expect(withDefaultMonitoringInterval(prefill)).toBe(prefill);
    expect(prefill["monitoringInterval"]).toBe("0 * * * *");
  });

  test("a prefill that names the interval with no value is respected too", () => {
    const prefill: JSONObject = { monitoringInterval: null };

    expect(withDefaultMonitoringInterval(prefill)).toBe(prefill);
    expect(prefill["monitoringInterval"]).toBeNull();
  });

  test("the caller's object is never changed", () => {
    const prefill: JSONObject = { name: "Checkout" };

    withDefaultMonitoringInterval(prefill);

    expect(prefill).toEqual({ name: "Checkout" });
  });

  test.each(Object.values(MonitorType))(
    "%s: the default is dropped exactly when the type has no interval step",
    (type: MonitorType) => {
      expect(
        shouldDropDefaultMonitoringInterval({
          monitorType: type,
          isIntervalPrefilled: false,
        }),
      ).toBe(!MonitorTypeHelper.doesMonitorTypeHaveInterval(type));
    },
  );

  test.each(Object.values(MonitorType))(
    "%s: a prefilled interval is never dropped",
    (type: MonitorType) => {
      expect(
        shouldDropDefaultMonitoringInterval({
          monitorType: type,
          isIntervalPrefilled: true,
        }),
      ).toBe(false);
    },
  );

  test("with no type yet, nothing is dropped", () => {
    expect(
      shouldDropDefaultMonitoringInterval({
        monitorType: undefined,
        isIntervalPrefilled: false,
      }),
    ).toBe(false);
  });

  test("both groups are non-empty, so the per-type tests above test something", () => {
    expect(PROBE_TYPES).toEqual(
      expect.arrayContaining([
        MonitorType.Website,
        MonitorType.API,
        MonitorType.Ping,
      ]),
    );
    expect(NON_PROBE_TYPES).toEqual(
      expect.arrayContaining([
        MonitorType.Manual,
        MonitorType.IncomingRequest,
        MonitorType.Logs,
      ]),
    );
  });
});
