import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import CephMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CephMonitor/CephMetricPicker";
import DockerMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerMonitor/DockerMetricPicker";
import DockerSwarmMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerSwarmMonitor/DockerSwarmMetricPicker";
import HostMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/HostMonitor/HostMetricPicker";
import IoTMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IoTMonitor/IoTMetricPicker";
import KubernetesMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMetricPicker";
import OpenStackMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/OpenStackMonitor/OpenStackMetricPicker";
import PodmanMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/PodmanMonitor/PodmanMetricPicker";
import ProxmoxMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProxmoxMonitor/ProxmoxMetricPicker";
import StorageArrayMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/StorageArrayMonitor/StorageArrayMetricPicker";
import VMwareMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VMwareMonitor/VMwareMetricPicker";
import XcpNgMetricPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/XcpNgMonitor/XcpNgMetricPicker";
import {
  getAllCephMetricCategories,
  getAllCephMetrics,
  getCephMetricCategoryLabel,
} from "../../../Types/Monitor/CephMetricCatalog";
import {
  getAllDockerMetricCategories,
  getAllDockerMetrics,
  getDockerMetricCategoryLabel,
} from "../../../Types/Monitor/DockerMetricCatalog";
import {
  getAllDockerSwarmMetricCategories,
  getAllDockerSwarmMetrics,
  getDockerSwarmMetricCategoryLabel,
} from "../../../Types/Monitor/DockerSwarmMetricCatalog";
import {
  getAllHostMetricCategories,
  getAllHostMetrics,
  getHostMetricCategoryLabel,
} from "../../../Types/Monitor/HostMetricCatalog";
import {
  getAllIoTMetricCategories,
  getAllIoTMetrics,
  getIoTMetricCategoryLabel,
} from "../../../Types/Monitor/IotMetricCatalog";
import {
  getAllKubernetesMetricCategories,
  getAllKubernetesMetrics,
  getKubernetesMetricCategoryLabel,
} from "../../../Types/Monitor/KubernetesMetricCatalog";
import {
  getAllOpenStackMetricCategories,
  getAllOpenStackMetrics,
  getOpenStackMetricCategoryLabel,
} from "../../../Types/Monitor/OpenStackMetricCatalog";
import {
  getAllPodmanMetricCategories,
  getAllPodmanMetrics,
  getPodmanMetricCategoryLabel,
} from "../../../Types/Monitor/PodmanMetricCatalog";
import {
  getAllProxmoxMetricCategories,
  getAllProxmoxMetrics,
  getProxmoxMetricCategoryLabel,
} from "../../../Types/Monitor/ProxmoxMetricCatalog";
import {
  getAllXcpNgMetricCategories,
  getAllXcpNgMetrics,
  getXcpNgMetricCategoryLabel,
} from "../../../Types/Monitor/XcpNgMetricCatalog";
import {
  getAllStorageArrayMetricCategories,
  getAllStorageArrayMetrics,
  getStorageArrayMetricCategoryLabel,
  StorageArrayMetricCategory,
} from "../../../Types/Monitor/StorageArrayMetricCatalog";
import {
  getAllVMwareMetricCategories,
  getAllVMwareMetrics,
  getVMwareMetricCategoryLabel,
} from "../../../Types/Monitor/VMwareMetricCatalog";
import {
  NARROW_NO_BREAK_SPACE,
  NO_BREAK_SPACE,
} from "../../../Types/NoBreakSpaces";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  whenCodeCanBeSetApart,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import { productNamePostProcessor } from "../../../UI/Utils/ProductNameTranslation";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A MONITOR'S METRIC PICKER NAMES EACH METRIC AND EACH GROUP IN THE READER'S
 * LANGUAGE (#8353).
 *
 * The VMware, Kubernetes, Docker, Docker Swarm, Podman, host and IoT pickers
 * looked each metric's name up, but no name of those catalogs was a key, so
 * a German reader picked "Datacenter Cluster Count" over a German
 * description. And every picker handed its groups to the dropdown as the
 * catalog's category, which the dropdown draws as given: "Datacenter",
 * "ControlPlane", "BlockIO". The names are keys now, the groups' headings a
 * label record of keys per catalog, and each picker looks each up once. The
 * storage array, Proxmox, Ceph and OpenStack pickers, whose names were keys
 * already, headed their groups in English the same way until #8653.
 *
 * Drawn in English, German, Arabic and Persian from the Dashboard's own
 * locale files, and again with every name and heading worded as a probe that
 * is itself a key reading TWICE: a word looked up twice would say it.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const TWICE: string = "TWICE";

const PROBE_MARKS: Readonly<Record<string, string>> = {
  en: "EN› ",
  de: "DE› ",
  ar: "ع› ",
  fa: "ف› ",
};

interface PickerMetric {
  id: string;
  friendlyName: string;
  unit?: string | undefined;
  category: string;
}

interface PickerCase {
  name: string;
  metrics: Array<PickerMetric>;
  // Each group's heading, in the picker's order.
  headings: Array<string>;
  draw: (metricId: string) => ReactElement;
}

const doNothing: () => void = (): void => {};

const PICKERS: Array<PickerCase> = [
  {
    name: "VMware",
    metrics: getAllVMwareMetrics(),
    headings: getAllVMwareMetricCategories().map(getVMwareMetricCategoryLabel),
    draw: (id: string): ReactElement => {
      return (
        <VMwareMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "Kubernetes",
    metrics: getAllKubernetesMetrics(),
    headings: getAllKubernetesMetricCategories().map(
      getKubernetesMetricCategoryLabel,
    ),
    draw: (id: string): ReactElement => {
      return (
        <KubernetesMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "Docker",
    metrics: getAllDockerMetrics(),
    headings: getAllDockerMetricCategories().map(getDockerMetricCategoryLabel),
    draw: (id: string): ReactElement => {
      return (
        <DockerMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "Docker Swarm",
    metrics: getAllDockerSwarmMetrics(),
    headings: getAllDockerSwarmMetricCategories().map(
      getDockerSwarmMetricCategoryLabel,
    ),
    draw: (id: string): ReactElement => {
      return (
        <DockerSwarmMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "Podman",
    metrics: getAllPodmanMetrics(),
    headings: getAllPodmanMetricCategories().map(getPodmanMetricCategoryLabel),
    draw: (id: string): ReactElement => {
      return (
        <PodmanMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "host",
    metrics: getAllHostMetrics(),
    headings: getAllHostMetricCategories().map(getHostMetricCategoryLabel),
    draw: (id: string): ReactElement => {
      return (
        <HostMetricPicker selectedMetricId={id} onMetricSelected={doNothing} />
      );
    },
  },
  {
    name: "IoT",
    metrics: getAllIoTMetrics(),
    headings: getAllIoTMetricCategories().map(getIoTMetricCategoryLabel),
    draw: (id: string): ReactElement => {
      return (
        <IoTMetricPicker selectedMetricId={id} onMetricSelected={doNothing} />
      );
    },
  },
  // The four whose groups were headed in English after #8353 (#8653).
  {
    name: "storage array",
    metrics: getAllStorageArrayMetrics(),
    // With no platform chosen it offers the whole catalog: every group that has a metric.
    headings: getAllStorageArrayMetricCategories()
      .filter((category: StorageArrayMetricCategory): boolean => {
        return getAllStorageArrayMetrics().some(
          (metric: PickerMetric): boolean => {
            return metric.category === category;
          },
        );
      })
      .map(getStorageArrayMetricCategoryLabel),
    draw: (id: string): ReactElement => {
      return (
        <StorageArrayMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "Proxmox",
    metrics: getAllProxmoxMetrics(),
    headings: getAllProxmoxMetricCategories().map(
      getProxmoxMetricCategoryLabel,
    ),
    draw: (id: string): ReactElement => {
      return (
        <ProxmoxMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
  {
    name: "XCP-ng",
    metrics: getAllXcpNgMetrics(),
    headings: getAllXcpNgMetricCategories().map(getXcpNgMetricCategoryLabel),
    draw: (id: string): ReactElement => {
      return (
        <XcpNgMetricPicker selectedMetricId={id} onMetricSelected={doNothing} />
      );
    },
  },
  {
    name: "Ceph",
    metrics: getAllCephMetrics(),
    headings: getAllCephMetricCategories().map(getCephMetricCategoryLabel),
    draw: (id: string): ReactElement => {
      return (
        <CephMetricPicker selectedMetricId={id} onMetricSelected={doNothing} />
      );
    },
  },
  {
    name: "OpenStack",
    metrics: getAllOpenStackMetrics(),
    headings: getAllOpenStackMetricCategories().map(
      getOpenStackMetricCategoryLabel,
    ),
    draw: (id: string): ReactElement => {
      return (
        <OpenStackMetricPicker
          selectedMetricId={id}
          onMetricSelected={doNothing}
        />
      );
    },
  },
];

const PROBED_TEXTS: Array<string> = Array.from(
  new Set<string>(
    PICKERS.flatMap((picker: PickerCase): Array<string> => {
      return [
        ...picker.headings,
        ...picker.metrics.map((metric: PickerMetric): string => {
          return metric.friendlyName;
        }),
      ];
    }),
  ),
);

const probeOf: (language: string, text: string) => string = (
  language: string,
  text: string,
): string => {
  return `${PROBE_MARKS[language]}${text}`;
};

const probedWords: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  const words: Record<string, string> = { ...readDashboardLocale(language) };

  for (const text of PROBED_TEXTS) {
    words[text] = probeOf(language, text);
    words[probeOf(language, text)] = TWICE;
  }

  return words;
};

const dashboardI18n: i18n = createInstance();
const probedI18n: i18n = createInstance();

beforeAll(async () => {
  await whenCodeCanBeSetApart("ar");

  for (const [instance, wordsOf] of [
    [dashboardI18n, readDashboardLocale],
    [probedI18n, probedWords],
  ] as Array<[i18n, (language: string) => Record<string, string>]>) {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};

    for (const language of LANGUAGES) {
      resources[language] = { translation: wordsOf(language) };
    }

    await instance
      .use(productNamePostProcessor)
      .use(codeReadsAsWrittenPostProcessor)
      .init({
        lng: "en",
        fallbackLng: "en",
        postProcess: getTranslationPostProcess(),
        resources: resources,
        interpolation: { escapeValue: false },
      });
  }
});

afterEach(() => {
  cleanup();
});

const shownIn: (element: Element) => string = (element: Element): string => {
  return withoutIsolates(element.textContent || "")
    .split(NO_BREAK_SPACE)
    .join(" ")
    .split(NARROW_NO_BREAK_SPACE)
    .join(" ")
    .trim();
};

const withUnit: (name: string, metric: PickerMetric) => string = (
  name: string,
  metric: PickerMetric,
): string => {
  return metric.unit ? `${name} (${metric.unit})` : name;
};

interface OpenPicker {
  picked: string;
  headings: Array<string>;
  options: Array<string>;
}

// The picker with its first metric chosen, its list open.
const openPicker: (
  instance: i18n,
  language: string,
  picker: PickerCase,
) => Promise<OpenPicker> = async (
  instance: i18n,
  language: string,
  picker: PickerCase,
): Promise<OpenPicker> => {
  void instance.changeLanguage(language);

  const container: HTMLElement = render(
    <I18nextProvider i18n={instance}>
      {picker.draw((picker.metrics[0] as PickerMetric).id)}
    </I18nextProvider>,
  ).container;
  const picked: Element | null = container.querySelector(
    ".ou-select__single-value",
  );
  const input: HTMLElement | null = container.querySelector(
    'input[role="combobox"]',
  );

  expect(picked).not.toBeNull();
  expect(input).not.toBeNull();

  await act(async () => {
    fireEvent.keyDown(input as HTMLElement, { key: "ArrowDown" });
  });

  return {
    picked: shownIn(picked as Element),
    headings: Array.from(
      document.querySelectorAll(".ou-select__group-heading"),
    ).map(shownIn),
    options: screen.getAllByRole("option").map(shownIn),
  };
};

const wordOf: (words: Record<string, string>, text: string) => string = (
  words: Record<string, string>,
  text: string,
): string => {
  return words[text] || text;
};

describe.each(PICKERS)("the $name metric picker", (picker: PickerCase) => {
  test.each(LANGUAGES)(
    "in %s names each metric and each group in the reader's words",
    async (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const drawn: OpenPicker = await openPicker(
        dashboardI18n,
        language,
        picker,
      );
      const first: PickerMetric = picker.metrics[0] as PickerMetric;

      expect(drawn.picked).toBe(
        withUnit(wordOf(words, first.friendlyName), first),
      );
      expect(drawn.headings).toEqual(
        picker.headings.map((heading: string): string => {
          return wordOf(words, heading);
        }),
      );
      expect([...drawn.options].sort()).toEqual(
        picker.metrics
          .map((metric: PickerMetric): string => {
            return withUnit(wordOf(words, metric.friendlyName), metric);
          })
          .sort(),
      );
    },
  );

  test.each(LANGUAGES)(
    "in %s looks each name and each heading up once",
    async (language: string) => {
      const drawn: OpenPicker = await openPicker(probedI18n, language, picker);
      const first: PickerMetric = picker.metrics[0] as PickerMetric;

      expect(drawn.picked).toBe(
        withUnit(probeOf(language, first.friendlyName), first),
      );
      expect(drawn.headings).toEqual(
        picker.headings.map((heading: string): string => {
          return probeOf(language, heading);
        }),
      );
      expect(drawn.options.join(" ")).not.toContain(TWICE);
    },
  );
});
