import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * #6622, ON THE PAGE: AN OPENSHIFT DEPLOYMENTCONFIG'S ROLLOUT STATUS, AS A
 * READER OF EACH LANGUAGE SEES IT.
 *
 * DeploymentConfigRolloutStatusWords reads each language's (i) text against
 * the badge's words. This renders the DeploymentConfig's page itself, in
 * every Dashboard language, and reads its Rollout Status row: the (i)
 * beside it opens that language's text of the states the badge draws, and
 * the count beside the badge reads in the language's words with both of
 * its numbers in the language's digits - "۲/۳ آماده" in Persian, not
 * "2/3 آماده", as the Dashboard's other count pairs read (#6994).
 */

const mockGetItem: MockFunction = getJestMockFunction();
const mockFetchLatestObject: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above them.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return mockGetItem(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: () => {
        return "frontend";
      },
      getQueryStringByName: () => {
        return "shop";
      },
      navigate: () => {},
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
  () => {
    return {
      __esModule: true,
      fetchLatestK8sObject: (...args: Array<unknown>) => {
        return mockFetchLatestObject(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/useNodeAllocatableCpu",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

// The other tabs are not what this is about.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
      useKubernetesEventsTab: () => {
        return { name: "Events", children: <div /> };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesMetricsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesYamlTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesResourceLink",
  () => {
    return {
      __esModule: true,
      default: (props: { resourceName: string }) => {
        return <span>{props.resourceName}</span>;
      },
    };
  },
);

import DeploymentConfigDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DeploymentConfigDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
import { OpenShiftDeploymentConfigObject } from "../../../Types/Kubernetes/OpenShiftObjectParser";
import { translatableTerm, Translator } from "../../../Types/Translator";

const ROLLOUT_STATUS: string =
  KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.deploymentRolloutStatus;

const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

const LATIN_DIGIT: RegExp = /[0-9]/;

// Set to run 3 pods, 2 of them ready: Progressing.
const DESIRED: number = 3;
const READY: number = 2;

const DEPLOYMENT_CONFIG: OpenShiftDeploymentConfigObject = {
  metadata: {
    name: "frontend",
    namespace: "shop",
    uid: "a1b2",
    creationTimestamp: "",
    labels: {},
    annotations: {},
    ownerReferences: [],
  },
  spec: {
    replicas: DESIRED,
    strategy: "Rolling",
    selector: { app: "frontend" },
    triggers: ["ConfigChange"],
    paused: false,
  },
  status: {
    latestVersion: 7,
    replicas: DESIRED,
    readyReplicas: READY,
    availableReplicas: READY,
    unavailableReplicas: DESIRED - READY,
    updatedReplicas: READY,
    conditions: [],
  },
} as unknown as OpenShiftDeploymentConfigObject;

const instances: Map<string, i18n> = new Map();

function instanceFor(language: string): i18n {
  const existing: i18n | undefined = instances.get(language);

  if (existing) {
    return existing;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: { translation: readDashboardLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });
  instances.set(language, instance);

  return instance;
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(10);
    });
  }
}

async function renderIn(language: string): Promise<void> {
  render(
    <I18nextProvider i18n={instanceFor(language)}>
      <DeploymentConfigDetail {...({} as PageComponentProps)} />
    </I18nextProvider>,
  );
  await settle();
}

/*
 * The innermost elements reading `text`, isolate marks aside: the element
 * that draws a sentence, not each of the elements around it.
 */
function elementsReading(text: string): Array<HTMLElement> {
  const wanted: string = withoutIsolateMarks(text).trim();
  const reads: (element: Element) => boolean = (element: Element): boolean => {
    return withoutIsolateMarks(element.textContent || "").trim() === wanted;
  };

  return Array.from(document.body.querySelectorAll<HTMLElement>("*")).filter(
    (element: HTMLElement): boolean => {
      return (
        reads(element) &&
        !Array.from(element.children).some((child: Element): boolean => {
          return reads(child);
        })
      );
    },
  );
}

// The count beside the badge, as the page should draw it in `language`.
function readyCount(language: string): string {
  const translator: Translator = dashboardTranslator(language);

  return translator.translateTemplate("{{ready}}/{{total}} ready", {
    ready: translator.formatNumber(READY),
    total: translator.formatNumber(DESIRED),
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockGetItem.mockReset();
  mockFetchLatestObject.mockReset();
  mockGetItem.mockResolvedValue({ clusterIdentifier: "prod-east" });
  mockFetchLatestObject.mockResolvedValue(DEPLOYMENT_CONFIG);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

test("every Dashboard language is rendered, Arabic and Persian among them", () => {
  expect(LANGUAGES).toEqual(expect.arrayContaining(["en", "de", "ar", "fa"]));
  expect(LANGUAGES.length).toBeGreaterThanOrEqual(18);
});

test("Persian's count reads in Persian digits; one passed as it is would not", () => {
  expect(withoutIsolateMarks(readyCount("fa"))).toContain("۲/۳");
  expect(readyCount("fa")).not.toMatch(LATIN_DIGIT);

  // The negative control: the counts as numbers read "2/3" on a Persian page.
  expect(
    withoutIsolateMarks(
      dashboardTranslator("fa").translateTemplate("{{ready}}/{{total}} ready", {
        ready: READY,
        total: DESIRED,
      }),
    ),
  ).toContain("2/3");
});

describe.each(LANGUAGES)(
  "a DeploymentConfig's Rollout Status in %s",
  (language: string) => {
    test("the count beside the badge reads in the language's words and digits", async () => {
      await renderIn(language);

      expect(mockFetchLatestObject).toHaveBeenCalled();
      expect(elementsReading(readyCount(language))).toHaveLength(1);

      const digits: string = withoutIsolateMarks(
        dashboardTranslator(language).formatNumber(READY),
      );

      if (digits !== String(READY)) {
        // A language with digits of its own reads both counts in them.
        expect(readyCount(language)).not.toMatch(LATIN_DIGIT);
      }
    });

    test("the (i) beside it opens the language's text of the badge's states", async () => {
      await renderIn(language);

      const translator: Translator = dashboardTranslator(language);
      const button: HTMLElement = screen.getByRole("button", {
        name: withoutIsolateMarks(
          translator.translateTemplate("About {{label}}", {
            label: translatableTerm("Rollout Status"),
          }),
        ),
        normalizer: (name: string): string => {
          return withoutIsolateMarks(name).trim();
        },
      });

      fireEvent.mouseEnter(button);
      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");
      const shown: string = withoutIsolateMarks(
        tooltips[tooltips.length - 1]?.textContent || "",
      ).trim();

      expect(shown).toBe(
        withoutIsolateMarks(
          translator.translateText(ROLLOUT_STATUS) || "",
        ).trim(),
      );

      if (language !== "en") {
        expect(shown).not.toBe(ROLLOUT_STATUS);
      }
    });
  },
);
