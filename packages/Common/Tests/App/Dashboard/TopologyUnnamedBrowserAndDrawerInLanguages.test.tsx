// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THREE ENGLISH WORDS THE TOPOLOGY SCREENS DREW FROM FILES THEIR GUARD DID
 * NOT READ (#8260).
 *
 * 1. "Unnamed resource" was stored as a resource's name in the explorer's
 *    model, and the explorer draws a name as written: a resource with no
 *    display name read English in its tree, its row and its aria labels.
 *    The service map did the same with "Unnamed service" and "Unnamed
 *    dependency", which its node card, list and buttons drew as written.
 * 2. "Browser" was a browser (RUM) service's runtime label beside product
 *    names drawn as written: "سرویس • Browser" on a Persian page.
 * 3. The entity drawer's screen-reader line glued the English type label
 *    after the name ("api, K8s Pod") when the drawer opened from the
 *    explorer, which hands it no traffic subtitle.
 *
 * Each is the product's word now, looked up where it is drawn, and a name
 * someone gave a resource is still drawn as written.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0 };
      },
      getCommonHeaders: () => {
        return { tenantid: "project-1" };
      },
    },
  };
});

import EntityDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel";
import {
  getInfrastructureNodeName,
  InfrastructureNode,
  UNNAMED_RESOURCE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import { subtitleForEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapGraph";
import {
  BROWSER_DETAIL_LABEL,
  DETAIL_LABELS,
  detailLabelInLanguage,
  entryLabelInLanguage,
  ServiceMapEntry,
  UNNAMED_DEPENDENCY,
  UNNAMED_SERVICE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";
import { metaForEntityType } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import { formatList, Translator } from "../../../Types/Translator";
import { resetPageScrollLockForTesting } from "../../../UI/Utils/PageScrollLock";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const persian: Translator = dashboardTranslator("fa");

const instanceFor: (language: string) => i18n = (language: string): i18n => {
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

  return instance;
};

const nodeOf: (overrides: Partial<InfrastructureNode>) => InfrastructureNode = (
  overrides: Partial<InfrastructureNode>,
): InfrastructureNode => {
  return {
    id: "k8s-pod:api",
    kind: "resource",
    name: "api-7d9f",
    entityType: EntityType.KubernetesPod,
    entity: null,
    parentId: null,
    childIds: [],
    resourceCount: 1,
    countsByType: new Map<string, number>(),
    serviceKeys: [],
    isActive: true,
    lastSeenAt: null,
    ...overrides,
  };
};

const entryOf: (overrides: Partial<ServiceMapEntry>) => ServiceMapEntry = (
  overrides: Partial<ServiceMapEntry>,
): ServiceMapEntry => {
  return {
    entity: {} as ServiceMapEntry["entity"],
    key: "service:web",
    label: "web",
    kind: "service",
    typeLabel: "Service",
    detailLabel: null,
    detailValue: null,
    inbound: { calls: 0, errors: 0, durationMs: 0 },
    outbound: { calls: 0, errors: 0, durationMs: 0 },
    callers: 0,
    dependencies: 0,
    ...overrides,
  } as unknown as ServiceMapEntry;
};

beforeEach(() => {
  postMock.mockReset();
  // The drawer asks for the entity; it stays loading, which is all this reads.
  postMock.mockImplementation(() => {
    return new Promise(() => {});
  });
  resetPageScrollLockForTesting();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("5b2f5b1c-0000-4000-8000-000000000001"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  resetPageScrollLockForTesting();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("the words the cases below lean on", () => {
  test.each(DASHBOARD_LANGUAGES)(
    '%s words the unnamed names and the browser (or keeps "Browser" on purpose)',
    (language: string) => {
      for (const english of [
        UNNAMED_RESOURCE,
        UNNAMED_SERVICE,
        UNNAMED_DEPENDENCY,
        BROWSER_DETAIL_LABEL,
      ]) {
        expect({
          english,
          worded: isWordedInDashboardLocale(english, language),
        }).toEqual({
          english,
          worded: true,
        });
      }
    },
  );
});

describe("an unnamed resource in the explorer", () => {
  test("reads the reader's word, never English", () => {
    const unnamed: InfrastructureNode = nodeOf({
      name: UNNAMED_RESOURCE,
      isUnnamed: true,
    });

    expect(
      getInfrastructureNodeName(unnamed, (text: string): string => {
        return persian.translateText(text) || text;
      }),
    ).toBe(readDashboardLocale("fa")[UNNAMED_RESOURCE]);
  });

  test("a resource's own name reads as written, even when it is an English key", () => {
    const named: InfrastructureNode = nodeOf({ name: "Network" });

    expect(
      getInfrastructureNodeName(named, (text: string): string => {
        return persian.translateText(text) || text;
      }),
    ).toBe("Network");
  });

  test("a category still reads in the reader's words", () => {
    expect(
      getInfrastructureNodeName(
        nodeOf({ kind: "category", name: "Kubernetes" }),
        (text: string): string => {
          return `t(${text})`;
        },
      ),
    ).toBe("t(Kubernetes)");
  });
});

describe("the service map", () => {
  test("an unnamed service or dependency reads the reader's word; a named one as written", () => {
    expect(
      entryLabelInLanguage(
        entryOf({ label: UNNAMED_SERVICE, isUnnamed: true }),
        persian,
      ),
    ).toBe(readDashboardLocale("fa")[UNNAMED_SERVICE]);
    expect(
      entryLabelInLanguage(
        entryOf({ label: UNNAMED_DEPENDENCY, isUnnamed: true }),
        persian,
      ),
    ).toBe(readDashboardLocale("fa")[UNNAMED_DEPENDENCY]);
    expect(
      entryLabelInLanguage(entryOf({ label: "Unnamed service" }), persian),
    ).toBe("Unnamed service");
  });

  test("the browser's runtime reads in the reader's language; every product's name as written", () => {
    expect(DETAIL_LABELS["webjs"]).toBe(BROWSER_DETAIL_LABEL);
    expect(detailLabelInLanguage(BROWSER_DETAIL_LABEL, persian)).toBe(
      readDashboardLocale("fa")[BROWSER_DETAIL_LABEL],
    );

    const german: Translator = dashboardTranslator("de");

    for (const label of Object.values(DETAIL_LABELS)) {
      if (label !== BROWSER_DETAIL_LABEL) {
        // "Go" stays Go, never German "Los".
        expect(detailLabelInLanguage(label, german)).toBe(label);
      }
    }
  });

  test("a browser service's subtitle reads in Persian, with no English left", () => {
    const subtitle: string = withoutIsolateMarks(
      subtitleForEntry(
        entryOf({ detailLabel: BROWSER_DETAIL_LABEL, detailValue: "webjs" }),
        persian,
      ),
    );

    expect(subtitle).toContain(readDashboardLocale("fa")[BROWSER_DETAIL_LABEL]);
    expect(subtitle).not.toContain("Browser");
  });

  test("a product's subtitle keeps the product's name", () => {
    expect(
      withoutIsolateMarks(
        subtitleForEntry(
          entryOf({ detailLabel: "Node.js", detailValue: "nodejs" }),
          persian,
        ),
      ),
    ).toContain("Node.js");
  });
});

describe("the entity drawer's screen-reader line", () => {
  test.each(["en", "de", "ar", "fa"])(
    "%s: a drawer opened from the explorer names the type in the reader's words",
    async (language: string) => {
      render(
        <I18nextProvider i18n={instanceFor(language)}>
          <EntityDetailPanel
            entity={{
              entityKey: "k8s-pod:api",
              entityType: EntityType.KubernetesPod,
              displayName: "api",
            }}
            rangeStart={new Date("2026-11-15T10:00:00.000Z")}
            metricsWindowSeconds={60}
            onClose={() => {}}
          />
        </I18nextProvider>,
      );

      const translator: Translator = dashboardTranslator(language);
      const typeLabel: string = metaForEntityType(
        EntityType.KubernetesPod,
      ).label;

      const line: string =
        (await screen.findByTestId("entity-detail-focus-target")).textContent ||
        "";

      expect(line).toBe(
        formatList(
          ["api", translator.translateText(typeLabel) || typeLabel],
          translator,
        ),
      );

      if (language !== "en") {
        expect(line).not.toContain(typeLabel);
      } else {
        expect(line).toBe(`api, ${typeLabel}`);
      }
    },
  );
});
