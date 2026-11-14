import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import Route from "../../../Types/API/Route";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { getMonitorTemplateSyncFieldSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTemplateSyncFields";
import MonitorTemplatesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplatesView";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A TEMPLATE'S SYNC CONFIRMATIONS, ONE LANGUAGE EACH (#7607).
 *
 * Sync Criteria and a linked monitor's Sync from Template ask first, and
 * each says which fields keep the monitor's own values: the summary the
 * Template sync settings card shows. The page built that summary once, in
 * the reader's language, and put it in both sentences as a string - so a
 * language that words the summary but not yet a confirmation read an
 * English dialog with the summary in its own words in the middle. The
 * summary is a composed value now, built in the language of the sentence
 * it is put in.
 */

interface CapturedDetail {
  name: string;
  cardProps?: {
    buttons?: Array<{ onClick?: (() => void) | undefined }> | undefined;
  };
}

type ActionButtonClick = (
  monitor: Monitor,
  onCompleteAction: () => void,
  onError: (error: Error) => void,
) => void;

interface CapturedMonitorTable {
  actionButtons?: Array<{ title: string; onClick: ActionButtonClick }>;
}

let capturedDetails: Array<CapturedDetail> = [];
let capturedTables: Array<CapturedMonitorTable> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: CapturedDetail) => {
      capturedDetails.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/CustomFields/CustomFieldsDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedMonitorTable) => {
        capturedTables.push(props);
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  const ObjectIDType: typeof ObjectID = (
    jest.requireActual("../../../Types/ObjectID") as {
      default: typeof ObjectID;
    }
  ).default;

  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
      getCurrentProject: () => {
        return {
          id: new ObjectIDType("10000000-0000-4000-8000-000000000001"),
        };
      },
      getCurrentPlan: () => {
        return null;
      },
    },
  };
});

const TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000001";

const CRITERIA_SENTENCE: string =
  "Copies the template's criteria and step settings to {{count}} linked monitors. {{protectedFields}} Everything else is kept. This cannot be undone.";
const SINGLE_SYNC_SENTENCE: string =
  'Copies the template\'s criteria, step settings, interval, probe agreement and labels to "{{monitorName}}". {{protectedFields}} This cannot be undone.';

// German, and German that has not worded the two confirmations yet.
const GERMAN: Record<string, string> = readDashboardLocale("de");
const GERMAN_BUT_THE_CONFIRMATIONS: Record<string, string> = Object.fromEntries(
  Object.entries(GERMAN).filter(([key]: [string, string]): boolean => {
    return !key.startsWith(CRITERIA_SENTENCE) && key !== SINGLE_SYNC_SENTENCE;
  }),
);

const instances: Record<string, i18n> = {};

function stepProtecting(paths: Array<string>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.doNotSyncFields = paths;
  return step;
}

const TEMPLATE_STEPS: MonitorSteps = new MonitorSteps();
TEMPLATE_STEPS.setMonitorStepsInstanceArray([
  stepProtecting(["monitorDestination", "requestHeaders"]),
]);

function summaryIn(words: Record<string, string>, language: string): string {
  const translator: Translator = createTranslator(
    (text: string): string | undefined => {
      return words[text];
    },
    language,
  );

  return getMonitorTemplateSyncFieldSummary(
    { monitorType: MonitorType.API, monitorSteps: TEMPLATE_STEPS },
    translator,
  );
}

// A template filled by hand: `values` go in as they are.
function filled(template: string, values: Record<string, string>): string {
  let result: string = template;

  for (const key of Object.keys(values)) {
    result = result.split(`{{${key}}}`).join(values[key] as string);
  }

  return result;
}

beforeAll(async () => {
  for (const [name, words] of Object.entries({
    de: GERMAN,
    "de-without-confirmations": GERMAN_BUT_THE_CONFIRMATIONS,
  })) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        de: { translation: words },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    instances[name] = instance;
  }
});

beforeEach(() => {
  capturedDetails = [];
  capturedTables = [];

  const template: MonitorTemplate = new MonitorTemplate();
  template.monitorType = MonitorType.API;
  template.monitorSteps = TEMPLATE_STEPS;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(TEMPLATE_ID));
  jest.spyOn(ModelAPI, "count").mockResolvedValue(2);
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(template as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openPage(instance: string): Promise<void> {
  await act(async () => {
    render(
      <I18nextProvider i18n={instances[instance]!}>
        <MonitorTemplatesView
          pageRoute={
            new Route(`/dashboard/monitors/settings/templates/${TEMPLATE_ID}`)
          }
          currentProject={null}
          hasPaymentMethod={true}
        />
      </I18nextProvider>,
    );
  });

  // The criteria card comes once the template's type is read.
  await waitFor(() => {
    expect(
      capturedDetails.some((detail: CapturedDetail): boolean => {
        return detail.name === "Monitoring Criteria";
      }),
    ).toBe(true);
  });
}

async function openCriteriaSync(): Promise<void> {
  const criteria: CapturedDetail | undefined = capturedDetails
    .filter((detail: CapturedDetail): boolean => {
      return detail.name === "Monitoring Criteria";
    })
    .pop();

  await act(async () => {
    criteria!.cardProps!.buttons![0]!.onClick!();
  });
}

async function openSingleSync(): Promise<void> {
  const table: CapturedMonitorTable | undefined =
    capturedTables[capturedTables.length - 1];
  const syncFromTemplate:
    | { title: string; onClick: ActionButtonClick }
    | undefined = table?.actionButtons?.find(
    (button: { title: string }): boolean => {
      return button.title === "Sync from Template";
    },
  );
  const monitor: Monitor = new Monitor();
  monitor.name = "Checkout API";

  await act(async () => {
    syncFromTemplate!.onClick(
      monitor,
      () => {},
      () => {},
    );
  });
}

describe("the template's sync confirmations", () => {
  test("German words both: Sync Criteria says it all in German, the summary too", async () => {
    await openPage("de");
    await openCriteriaSync();

    expect(
      await screen.findByText(
        filled(GERMAN[CRITERIA_SENTENCE] as string, {
          count: "2",
          protectedFields: summaryIn(GERMAN, "de"),
        }),
      ),
    ).toBeVisible();
    expect(summaryIn(GERMAN, "de")).toContain("Monitor-Ziel");
  });

  test("German words both: Sync from Template says it all in German, the summary too", async () => {
    await openPage("de");
    await openSingleSync();

    expect(
      await screen.findByText(
        filled(GERMAN[SINGLE_SYNC_SENTENCE] as string, {
          monitorName: "Checkout API",
          protectedFields: summaryIn(GERMAN, "de"),
        }),
      ),
    ).toBeVisible();
  });

  test("German that words the summary but not the confirmations: Sync Criteria is English through and through", async () => {
    const english: Record<string, string> = readDashboardLocale("en");

    await openPage("de-without-confirmations");
    await openCriteriaSync();

    const dialog: HTMLElement = await screen.findByText(
      filled(CRITERIA_SENTENCE, {
        count: "2",
        protectedFields: summaryIn(english, "en"),
      }),
    );

    expect(dialog).toBeVisible();
    // The summary alone is still German: the dialog does not borrow it.
    expect(summaryIn(GERMAN_BUT_THE_CONFIRMATIONS, "de")).toContain(
      "Monitor-Ziel",
    );
    expect(dialog.textContent).not.toContain("Monitor-Ziel");
  });

  test("German that words the summary but not the confirmations: Sync from Template is English through and through", async () => {
    const english: Record<string, string> = readDashboardLocale("en");

    await openPage("de-without-confirmations");
    await openSingleSync();

    const dialog: HTMLElement = await screen.findByText(
      filled(SINGLE_SYNC_SENTENCE, {
        monitorName: "Checkout API",
        protectedFields: summaryIn(english, "en"),
      }),
    );

    expect(dialog).toBeVisible();
    expect(dialog.textContent).not.toContain("Monitor-Ziel");
  });
});
