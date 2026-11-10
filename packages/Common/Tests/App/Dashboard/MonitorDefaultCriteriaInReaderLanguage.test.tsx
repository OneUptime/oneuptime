import "@testing-library/jest-dom";
import MonitorCriteriaAlignmentUtil, {
  CriteriaSeedOptions,
  MonitorCriteriaAlignmentResult,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorCriteriaAlignment";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  createTranslator,
  TemplateValues,
  Translator,
} from "../../../Types/Translator";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * A new monitor's out-of-the-box criteria - each criteria's name and
 * description, and the title and description of every incident and alert
 * it opens - are written in the language of the person creating it (#6542):
 * a customer with the Dashboard in Chinese got them in English. Once saved
 * they are the project's own words, edited like anything typed.
 *
 * The criteria form seeds them with the reader's translator, and keeps them
 * in step with the monitor type in that language: criteria nobody has
 * worked on - in the reader's language, or English ones seeded before -
 * are seeded afresh for a new type, in the reader's language. An existing
 * monitor's criteria, English or not, are handed back as they are.
 *
 * MonitorStep is mocked out: what is under test is this form's seeding and
 * alignment, not the fields its child renders.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: () => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: () => {
        return Promise.resolve([]);
      },
    },
  };
});

import MonitorStepsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ONLINE_STATUS_ID: string = "22222222-2222-4222-8222-222222222222";
const OFFLINE_STATUS_ID: string = "33333333-3333-4333-8333-333333333333";
const INCIDENT_SEVERITY_ID: string = "44444444-4444-4444-8444-444444444444";
const ALERT_SEVERITY_ID: string = "55555555-5555-4555-8555-555555555555";

const MONITOR_NAME: string = "Acme";

const MONITOR_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
) as Array<MonitorType>;

// What the form seeds with, once it has the project's statuses and severities.
const SEED_OPTIONS: CriteriaSeedOptions = {
  onlineMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
  offlineMonitorStatusId: new ObjectID(OFFLINE_STATUS_ID),
  defaultIncidentSeverityId: new ObjectID(INCIDENT_SEVERITY_ID),
  defaultAlertSeverityId: new ObjectID(ALERT_SEVERITY_ID),
  monitorName: MONITOR_NAME,
};

/*
 * A reader's language that words every sentence the defaults are written
 * with, each one marked: an English word left among them would show.
 */
const READER_WORDS: Record<string, string> = ((): Record<string, string> => {
  const words: Record<string, string> = {};
  const english: Translator = createTranslator(undefined, "en");
  const recording: Translator = {
    ...english,
    translateTemplate: (template: string, values?: TemplateValues): string => {
      words[template] = `【${template}】`;
      return english.translateTemplate(template, values);
    },
  };

  for (const monitorType of MONITOR_TYPES) {
    MonitorCriteria.getDefaultMonitorCriteria({
      ...SEED_OPTIONS,
      monitorType,
      translator: recording,
    });
  }

  return words;
})();

const READER: Translator = createTranslator(
  (text: string): string | undefined => {
    return READER_WORDS[text];
  },
  "zh-CN",
);

const defaultCriteria: (
  monitorType: MonitorType,
  translator?: Translator | undefined,
) => MonitorCriteria = (
  monitorType: MonitorType,
  translator?: Translator | undefined,
): MonitorCriteria => {
  return MonitorCriteria.getDefaultMonitorCriteria({
    ...SEED_OPTIONS,
    monitorType,
    translator,
  });
};

const defaultSteps: (
  monitorType: MonitorType,
  translator?: Translator | undefined,
) => MonitorSteps = (
  monitorType: MonitorType,
  translator?: Translator | undefined,
): MonitorSteps => {
  return MonitorSteps.getDefaultMonitorSteps({
    ...SEED_OPTIONS,
    defaultMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
    monitorType,
    translator,
  });
};

// Every name, description and title, in order.
const wordsOf: (monitorCriteria: MonitorCriteria) => Array<string> = (
  monitorCriteria: MonitorCriteria,
): Array<string> => {
  return (monitorCriteria.data?.monitorCriteriaInstanceArray || []).flatMap(
    (instance: MonitorCriteriaInstance): Array<string> => {
      return [
        instance.data?.name || "",
        instance.data?.description || "",
        ...(instance.data?.incidents || []).flatMap(
          (incident: CriteriaIncident) => {
            return [incident.title, incident.description];
          },
        ),
        ...(instance.data?.alerts || []).flatMap((alert: CriteriaAlert) => {
          return [alert.title, alert.description];
        }),
      ];
    },
  );
};

const wordsOfSteps: (monitorSteps: MonitorSteps) => Array<string> = (
  monitorSteps: MonitorSteps,
): Array<string> => {
  return (monitorSteps.data?.monitorStepsInstanceArray || []).flatMap(
    (monitorStep: MonitorStep) => {
      return monitorStep.data ? wordsOf(monitorStep.data.monitorCriteria) : [];
    },
  );
};

const isReaders: (words: Array<string>) => boolean = (
  words: Array<string>,
): boolean => {
  return (
    words.length > 0 &&
    words.every((word: string) => {
      return word.startsWith("【") && word.endsWith("】");
    })
  );
};

describe("the out-of-the-box criteria, kept in step with the monitor type in the reader's language", () => {
  const readerSeedOptions: CriteriaSeedOptions = {
    ...SEED_OPTIONS,
    translator: READER,
  };

  test("the defaults the reader's form wrote read as untouched", () => {
    expect(
      isReaders(wordsOf(defaultCriteria(MonitorType.Website, READER))),
    ).toBe(true);
    expect(
      MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
        monitorCriteria: defaultCriteria(MonitorType.Website, READER),
        monitorType: MonitorType.Website,
        seedOptions: readerSeedOptions,
      }),
    ).toBe(true);
  });

  test("so do English ones, seeded before or outside the Dashboard", () => {
    expect(
      MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
        monitorCriteria: defaultCriteria(MonitorType.Website),
        monitorType: MonitorType.Website,
        seedOptions: readerSeedOptions,
      }),
    ).toBe(true);
  });

  test("but not another type's defaults, nor defaults a person has worked on", () => {
    expect(
      MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
        monitorCriteria: defaultCriteria(MonitorType.Website, READER),
        monitorType: MonitorType.ExternalStatusPage,
        seedOptions: readerSeedOptions,
      }),
    ).toBe(false);

    const renamed: MonitorCriteria = defaultCriteria(
      MonitorType.Website,
      READER,
    );
    renamed.data!.monitorCriteriaInstanceArray[0]!.data!.name =
      "Checkout is down";

    expect(
      MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
        monitorCriteria: renamed,
        monitorType: MonitorType.Website,
        seedOptions: readerSeedOptions,
      }),
    ).toBe(false);
  });

  test.each([
    { seededIn: "the reader's language", translator: READER },
    { seededIn: "English", translator: undefined },
  ])(
    "a Website's defaults in $seededIn, now an External Status Page's, are seeded afresh in the reader's language",
    (data: { seededIn: string; translator: Translator | undefined }) => {
      const result: MonitorCriteriaAlignmentResult =
        MonitorCriteriaAlignmentUtil.alignMonitorCriteriaWithMonitorType({
          monitorCriteria: defaultCriteria(
            MonitorType.Website,
            data.translator,
          ),
          monitorType: MonitorType.ExternalStatusPage,
          seedOptions: readerSeedOptions,
        });

      expect(result.didChange).toBe(true);
      expect(wordsOf(result.monitorCriteria)).toEqual(
        wordsOf(defaultCriteria(MonitorType.ExternalStatusPage, READER)),
      );
      expect(isReaders(wordsOf(result.monitorCriteria))).toBe(true);
    },
  );

  test("criteria that suit the type are handed back as they are, in whatever language", () => {
    for (const criteria of [
      defaultCriteria(MonitorType.Website, READER),
      defaultCriteria(MonitorType.Website),
    ]) {
      const result: MonitorCriteriaAlignmentResult =
        MonitorCriteriaAlignmentUtil.alignMonitorCriteriaWithMonitorType({
          monitorCriteria: criteria,
          monitorType: MonitorType.Website,
          seedOptions: readerSeedOptions,
        });

      expect(result.didChange).toBe(false);
      expect(result.monitorCriteria).toBe(criteria);
    }
  });

  test("with no reader, the criteria seeded afresh are English, as before", () => {
    const result: MonitorCriteriaAlignmentResult =
      MonitorCriteriaAlignmentUtil.alignMonitorCriteriaWithMonitorType({
        monitorCriteria: defaultCriteria(MonitorType.Website),
        monitorType: MonitorType.ExternalStatusPage,
        seedOptions: SEED_OPTIONS,
      });

    expect(result.didChange).toBe(true);
    expect(wordsOf(result.monitorCriteria)).toEqual(
      wordsOf(defaultCriteria(MonitorType.ExternalStatusPage)),
    );
  });
});

function listOf<T>(data: Array<T>): unknown {
  return {
    data: data,
    count: data.length,
    skip: 0,
    limit: 50,
  };
}

function monitorStatus(data: {
  id: string;
  name: string;
  isOperationalState: boolean;
  isOfflineState: boolean;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = data.id;
  status.name = data.name;
  status.isOperationalState = data.isOperationalState;
  status.isOfflineState = data.isOfflineState;
  return status;
}

/*
 * The criteria form fetches statuses, severities, on-call policies, labels,
 * teams and incident roles on mount. Only the first three shape what it
 * seeds; the rest just have to answer.
 */
function mockModelApi(): void {
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((request: { modelType: unknown }): never => {
      const modelType: unknown = request.modelType;

      if (modelType === MonitorStatus) {
        return listOf([
          monitorStatus({
            id: ONLINE_STATUS_ID,
            name: "Operational",
            isOperationalState: true,
            isOfflineState: false,
          }),
          monitorStatus({
            id: OFFLINE_STATUS_ID,
            name: "Offline",
            isOperationalState: false,
            isOfflineState: true,
          }),
        ]) as never;
      }

      if (modelType === IncidentSeverity) {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = INCIDENT_SEVERITY_ID;
        severity.name = "Critical";
        return listOf([severity]) as never;
      }

      if (modelType === AlertSeverity) {
        const severity: AlertSeverity = new AlertSeverity();
        severity._id = ALERT_SEVERITY_ID;
        severity.name = "Critical";
        return listOf([severity]) as never;
      }

      return listOf([]) as never;
    });
}

// The Dashboard in the reader's language: its own words, the defaults' too.
async function readerI18n(): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "zh-CN",
    fallbackLng: "zh-CN",
    resources: { "zh-CN": { translation: READER_WORDS } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
}

interface MountedForm {
  // Everything the form has pushed up through onChange, in order.
  changes: Array<MonitorSteps>;
  latest: () => MonitorSteps;
}

async function mountWith(data: {
  initialValue?: MonitorSteps | undefined;
  monitorType: MonitorType;
}): Promise<MountedForm> {
  const changes: Array<MonitorSteps> = [];

  render(
    <I18nextProvider i18n={await readerI18n()}>
      <MonitorStepsElement
        monitorType={data.monitorType}
        monitorName={MONITOR_NAME}
        {...(data.initialValue ? { initialValue: data.initialValue } : {})}
        onChange={(value: MonitorSteps) => {
          changes.push(value);
        }}
      />
    </I18nextProvider>,
  );

  // Drawn once the statuses and severities it seeds with have arrived.
  await waitFor(() => {
    expect(screen.getByText("Default Monitor Status")).toBeInTheDocument();
  });

  return {
    changes: changes,
    latest: () => {
      return changes[changes.length - 1]!;
    },
  };
}

describe("the criteria form, with the Dashboard in the reader's language", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    mockModelApi();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("a new Website monitor's criteria, and the incident and alert they open, are in the reader's language", async () => {
    const form: MountedForm = await mountWith({
      monitorType: MonitorType.Website,
    });

    await waitFor(() => {
      expect(wordsOfSteps(form.latest())).toEqual(
        wordsOf(defaultCriteria(MonitorType.Website, READER)),
      );
    });

    expect(isReaders(wordsOfSteps(form.latest()))).toBe(true);
  });

  test("criteria it wrote for a Website, now shown for an External Status Page, are written afresh in the reader's language", async () => {
    const form: MountedForm = await mountWith({
      initialValue: defaultSteps(MonitorType.Website, READER),
      monitorType: MonitorType.ExternalStatusPage,
    });

    await waitFor(() => {
      expect(wordsOfSteps(form.latest())).toEqual(
        wordsOf(defaultCriteria(MonitorType.ExternalStatusPage, READER)),
      );
    });
  });

  test("criteria it wrote that suit the type are handed back unchanged", async () => {
    const seeded: MonitorSteps = defaultSteps(MonitorType.Website, READER);

    const form: MountedForm = await mountWith({
      initialValue: seeded,
      monitorType: MonitorType.Website,
    });

    expect(form.latest().toJSON()).toEqual(seeded.toJSON());
    expect(form.changes).toHaveLength(1);
  });

  test("an existing monitor's English criteria stay as they are", async () => {
    const english: MonitorSteps = defaultSteps(MonitorType.Website);

    const form: MountedForm = await mountWith({
      initialValue: english,
      monitorType: MonitorType.Website,
    });

    expect(form.latest().toJSON()).toEqual(english.toJSON());
    expect(form.changes).toHaveLength(1);
    expect(wordsOfSteps(form.latest())).toContain(
      `Check if ${MONITOR_NAME} is offline`,
    );
  });
});
