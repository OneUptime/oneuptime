import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import ObjectID from "../../../Types/ObjectID";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import { Translator, translatableTerm } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * #7725: THE INFRASTRUCTURE EXPLORER NAMES ITS CATEGORIES IN THE READER'S
 * LANGUAGE.
 *
 * The explorer drew its categories - "Kubernetes", "Hosts & containers",
 * "Network & devices", "Other" - with t(category.name). That call's key is
 * no literal, so `npm run i18n:extract` never found the names, no locale
 * held them, and every language read its tree and its overview's headings
 * in English. A group of replicas read "Host replicas", a key built at run
 * time that no locale holds either, and a row's "+2 more services" was in
 * Latin digits on a Persian page.
 *
 * Rendered here from the real locale files through a real i18next
 * instance. The map, the drawers and the collection transport are stood in
 * for, as in InfrastructureExplorer.test.
 */

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("dde060c6-fe0d-49ce-b44c-4035a13bc1db");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureGraph",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EdgeDetailPanel",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      fetchCollectionPage: (): Promise<unknown> => {
        return new Promise(() => {});
      },
      fetchCollectionSearchCounts: (): Promise<unknown> => {
        return new Promise(() => {});
      },
    };
  },
);

import InfrastructureExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer";
import {
  INFRASTRUCTURE_CATEGORIES,
  InfrastructureCategory,
  categoryForType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";

const NOW: Date = new Date();
const RANGE_START: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

const LATIN_DIGIT: RegExp = /[0-9]/;

/*
 * Each category, in the words its locale gives it: the issue's two
 * languages, and Arabic beside English for a page read from the right.
 */
const CATEGORY_WORDS: Record<string, Record<string, string>> = {
  en: {
    "category:kubernetes": "Kubernetes",
    "category:compute": "Hosts & containers",
    "category:virtualization": "Virtualization & clusters",
    "category:cloud": "Cloud",
    "category:network": "Network & devices",
    "category:other": "Other",
  },
  de: {
    "category:kubernetes": "Kubernetes",
    "category:compute": "Hosts & Container",
    "category:virtualization": "Virtualisierung & Cluster",
    "category:cloud": "Cloud",
    "category:network": "Netzwerk & Geräte",
    "category:other": "Sonstige",
  },
  fa: {
    "category:kubernetes": "Kubernetes",
    "category:compute": "میزبان‌ها و کانتینرها",
    "category:virtualization": "مجازی‌سازی و خوشه‌ها",
    "category:cloud": "ابر",
    "category:network": "شبکه و دستگاه‌ها",
    "category:other": "سایر",
  },
  ar: {
    "category:kubernetes": "Kubernetes",
    "category:compute": "المضيفون والحاويات",
    "category:virtualization": "المحاكاة الافتراضية والعناقيد",
    "category:cloud": "السحابة",
    "category:network": "الشبكة والأجهزة",
    "category:other": "أخرى",
  },
};

const LANGUAGES: ReadonlyArray<string> = Object.keys(CATEGORY_WORDS);

function entity(key: string, type: string, name: string = key): TopologyEntity {
  return {
    entityKey: key,
    entityType: type,
    displayName: name,
    lastSeenAt: NOW,
    source: EntitySource.Discovered,
  };
}

function hostedOn(from: string, to: string): TopologyRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: EntityRelationshipType.HostedOn,
  };
}

/*
 * One resource in each category, a type this version does not know (Other),
 * two replicas of one workload, and a host five services run on.
 */
const SERVICES: ReadonlyArray<string> = ["a", "b", "c", "d", "e"];

const ENTITIES: Array<TopologyEntity> = [
  entity("pod", EntityType.KubernetesPod, "checkout-pod"),
  entity("esxi", EntityType.VMwareHost, "esxi-01"),
  entity("bucket", EntityType.CloudResource, "assets-bucket"),
  entity("switch", EntityType.NetworkDevice, "core-switch"),
  entity("widget", "acme.widget", "acme-widget"),
  entity("r1", EntityType.Host, "oneuptime-app-685856b7d7-48xkt"),
  entity("r2", EntityType.Host, "oneuptime-app-685856b7d7-4vnkt"),
  entity("busy", EntityType.Host, "busy-host"),
  entity("api", EntityType.Service),
  ...SERVICES.map((name: string): TopologyEntity => {
    return entity(name, EntityType.Service);
  }),
];

const RELATIONSHIPS: Array<TopologyRelationship> = [
  hostedOn("api", "r1"),
  hostedOn("api", "r2"),
  ...SERVICES.map((name: string): TopologyRelationship => {
    return hostedOn(name, "busy");
  }),
];

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

// A locale with one key taken out of it, as if no one had worded it.
function instanceWithout(language: string, key: string): i18n {
  const words: Record<string, string> = { ...readDashboardLocale(language) };
  delete words[key];
  const instance: i18n = createInstance();
  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: { translation: words },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });
  return instance;
}

function renderIn(language: string, instance?: i18n): void {
  setDateDisplayLanguage(language);
  render(
    <I18nextProvider i18n={instance || instanceFor(language)}>
      <MemoryRouter>
        <InfrastructureExplorer
          entities={ENTITIES}
          relationships={RELATIONSHIPS}
          metricsWindowSeconds={900}
          rangeStart={RANGE_START}
          onOpenServiceMap={() => {}}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

// The overview's sections, each by the heading it draws.
function overviewHeadings(): Array<string> {
  return Array.from(document.querySelectorAll("section[aria-label] h3")).map(
    (heading: Element): string => {
      return heading.textContent || "";
    },
  );
}

function treeName(categoryId: string): string {
  const button: HTMLElement = screen.getByTestId(
    `infrastructure-tree-${categoryId}`,
  );
  return (
    button.querySelector("span.truncate")?.textContent ||
    button.textContent ||
    ""
  );
}

function row(name: string): HTMLElement {
  const found: HTMLElement | undefined = screen
    .getAllByTestId("infrastructure-row")
    .find((candidate: HTMLElement): boolean => {
      return within(candidate).queryByText(name, { exact: true }) !== null;
    });

  expect({ name, found: found !== undefined }).toEqual({ name, found: true });

  return found as HTMLElement;
}

beforeAll(() => {
  for (const language of LANGUAGES) {
    instanceFor(language);
  }
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage(null);
  window.history.replaceState({}, "", "/");
});

describe("every category is a key every language words", () => {
  test("the model names each category by a key en.json holds", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const category of INFRASTRUCTURE_CATEGORIES) {
      expect({ name: category.name, english: english[category.name] }).toEqual({
        name: category.name,
        english: category.name,
      });
    }
  });

  test.each(DASHBOARD_LANGUAGES)("%s words each one", (language: string) => {
    for (const category of INFRASTRUCTURE_CATEGORIES) {
      expect({
        language,
        name: category.name,
        worded: isWordedInDashboardLocale(category.name, language),
      }).toEqual({ language, name: category.name, worded: true });
    }
  });

  test("a type the catalog does not know falls in Other", () => {
    const other: InfrastructureCategory = categoryForType("acme.widget");

    expect(other.id).toBe("category:other");
    expect(other.name).toBe("Other");
  });
});

describe.each(LANGUAGES)("the explorer in %s", (language: string) => {
  const words: Record<string, string> = CATEGORY_WORDS[language] as Record<
    string,
    string
  >;
  const translator: Translator = dashboardTranslator(language);

  test("its overview heads each category in the language", () => {
    renderIn(language);

    const headings: Array<string> = overviewHeadings();

    for (const [id, name] of Object.entries(words)) {
      expect({ id, drawn: headings.includes(name) }).toEqual({
        id,
        drawn: true,
      });
      expect(screen.getByRole("region", { name: name })).toBeInTheDocument();
    }
  });

  test("its tree names each category in the language", () => {
    renderIn(language);

    for (const [id, name] of Object.entries(words)) {
      expect({ id, name: treeName(id) }).toEqual({ id, name });
    }
  });

  test("a group of replicas says what it is in the language", () => {
    renderIn(language);

    const group: HTMLElement = row("oneuptime-app");

    expect(group).toHaveTextContent(
      translator.translateTemplate("{{type}} replicas", {
        type: translatableTerm("Host"),
      }),
    );
    if (language === "en") {
      expect(group).toHaveTextContent("Host replicas");
    } else {
      expect(group.textContent || "").not.toContain("replicas");
    }
  });

  test("a row with more services than it shows counts the rest in the language's digits", () => {
    renderIn(language);

    const busy: HTMLElement = row("busy-host");

    expect(busy).toHaveTextContent(`+${translator.formatNumber(2)}`);
    if (language === "fa") {
      expect(busy).toHaveTextContent("+۲");
    }
  });
});

describe("read from the right", () => {
  test("Persian's headings, tree and counts are in Persian, its digits too", () => {
    renderIn("fa");

    for (const heading of overviewHeadings()) {
      expect({ heading, latin: LATIN_DIGIT.test(heading) }).toEqual({
        heading,
        latin: false,
      });
    }
    // The tree's counts beside each category.
    for (const id of Object.keys(CATEGORY_WORDS["fa"] || {})) {
      const count: string =
        screen
          .getByTestId(`infrastructure-tree-${id}`)
          .querySelector("span.rounded")?.textContent || "";
      expect({ id, latin: LATIN_DIGIT.test(count) }).toEqual({
        id,
        latin: false,
      });
    }
  });
});

describe("a category no locale words reads in English (negative control)", () => {
  test.each(["de", "fa"])(
    "%s without the key heads its section and its tree in English",
    (language: string) => {
      renderIn(language, instanceWithout(language, "Hosts & containers"));

      expect(overviewHeadings()).toContain("Hosts & containers");
      expect(treeName("category:compute")).toBe("Hosts & containers");
      // The others still read in the language.
      expect(overviewHeadings()).toContain(
        (CATEGORY_WORDS[language] as Record<string, string>)[
          "category:network"
        ],
      );
    },
  );
});
