// UX rule: Docs/ux/README.md#in-every-language
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import IconProp from "../../../Types/Icon/IconProp";
import { NetworkAddressNameSource } from "../../../Types/NetFlow/NetworkAddressName";
import {
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
} from "../../../Types/OpenStack/OpenStackLinks";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { describeCloudChange } from "../../../Utils/AiRemediation/CloudChangeWords";
import { describeLinkedInfrastructure } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import TrafficAddressCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/TrafficAddressCard";
import { OpenStackReachList } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackInstanceLinksCard";
import { OpenStackPlacementLines } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPlacementCard";
import NeedsAttentionCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/NeedsAttentionCard";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A NAME THE SENTENCES SHARE, DRAWN AS A LABEL (#7607, #7628).
 *
 * "Kubernetes cluster", "OpenStack cloud", "DNS zone" and "Cloud resource"
 * are nouns of the Dashboard's sentences too ("No open or recent alerts on
 * {{resources}}"), and es, fr, it, pt and ru word them for the middle of
 * one: "clúster de Kubernetes", "nube OpenStack", "zone DNS", "recurso en la
 * nube". Where the same key starts a label - what an OpenStack instance
 * also is, the line naming its cloud, a chip saying what needs attention,
 * where an address's name comes from - it now starts with a capital, as the
 * labels around it do; the sentences keep the word lower-case.
 * NounKeysDrawnAsLabelsGuard keeps every other place that names one of
 * these keys to the same rule.
 *
 * da, nl, no and sv word "Cloud resource" and "Cloud environment" for the
 * middle of a sentence too, and so does ru, which wrote both with a capital
 * until #7659: "на Облачный ресурс web-alb".
 */

const LANGUAGES: ReadonlyArray<string> = ["es", "fr", "it", "pt", "ru"];

// The languages that word a cloud resource and a cloud environment lower-case.
const CLOUD_NOUN_LANGUAGES: ReadonlyArray<string> = [
  ...LANGUAGES,
  "da",
  "nl",
  "no",
  "sv",
];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of [...CLOUD_NOUN_LANGUAGES, "de", "zh-CN", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function drawIn(language: string, element: React.ReactElement): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>{element}</MemoryRouter>
    </I18nextProvider>,
  );
}

// A word as it starts a label, worked out here apart from the Dashboard's code.
function capitalized(word: string, language: string): string {
  return `${word.charAt(0).toLocaleUpperCase(language)}${word.slice(1)}`;
}

function wordIn(language: string, key: string): string {
  return readDashboardLocale(language)[key] as string;
}

const LOWER_CASE_START: RegExp = /^\p{Ll}/u;

const REACH: OpenStackReachAcrossProducts = {
  hostCount: 1,
  hosts: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      name: "web-1",
      isHypervisor: false,
    },
  ],
  kubernetesNodeCount: 1,
  kubernetesNodes: [
    {
      clusterId: "10000000-0000-4000-8000-000000000002",
      clusterName: "prod",
      nodeName: "node-1",
      instanceId: "i-1",
    },
  ],
  kubernetesClusters: [
    {
      id: "10000000-0000-4000-8000-000000000002",
      name: "prod",
      nodeCount: 3,
    },
  ],
  serviceCount: 1,
  services: [{ id: "10000000-0000-4000-8000-000000000003", name: "api" }],
};

const PLACEMENT: OpenStackPlacement = {
  openStackCloudId: "10000000-0000-4000-8000-000000000004",
  cloudName: "prod-eu",
  kind: "instance",
  externalId: "11111111-2222-4333-8444-555555555555",
  name: "web-1",
  regionName: "RegionOne",
  availabilityZone: "nova",
  hypervisorName: "compute-1",
  hypervisorExternalId: "hv-1",
  openStackProjectId: "p1",
  openStackProjectName: "payments",
  status: "ACTIVE",
};

function attentionItem(kind: string, name: string): ResourceAttentionItem {
  return {
    key: `${kind}:${name}`,
    kind: kind,
    icon: IconProp.Cube,
    name: name,
    severity: ResourceAttentionSeverity.Warning,
    reasons: [{ text: "Stopped" }],
  };
}

describe("the words five languages keep lower-case for a sentence", () => {
  test.each(LANGUAGES)(
    "%s words Kubernetes cluster for the middle of a sentence",
    (language: string) => {
      expect(wordIn(language, "Kubernetes cluster")).toMatch(LOWER_CASE_START);
    },
  );
});

describe("what an OpenStack instance also is, elsewhere in OneUptime", () => {
  test.each(LANGUAGES)(
    "%s starts every row's label with a capital: Kubernetes cluster too",
    (language: string) => {
      drawIn(language, <OpenStackReachList testId="reach" reach={REACH} />);

      const labels: Array<string> = screen
        .getAllByTestId("reach-item")
        .map((row: HTMLElement): string => {
          return (row.querySelector("span > span")?.textContent || "").trim();
        });

      expect(labels).toEqual(
        ["Host", "Kubernetes cluster", "Kubernetes node", "Service"].map(
          (key: string): string => {
            return capitalized(wordIn(language, key), language);
          },
        ),
      );
      expect(labels[1]).not.toBe(wordIn(language, "Kubernetes cluster"));
    },
  );

  test("a word that starts with a capital, or in a script without one, is drawn as written", () => {
    for (const language of ["de", "zh-CN", "fa"]) {
      drawIn(language, <OpenStackReachList testId="reach" reach={REACH} />);

      const cluster: HTMLElement = screen.getAllByTestId("reach-item")[1]!;

      expect(
        within(cluster).getByText(wordIn(language, "Kubernetes cluster")),
      ).toBeVisible();
      cleanup();
    }
  });
});

describe("where an instance runs on OpenStack", () => {
  test.each([
    ["es", "Nube OpenStack"],
    ["ru", "Облако OpenStack"],
    ["fr", "Cloud OpenStack"],
  ])("%s names the cloud's line %s", (language: string, drawn: string) => {
    drawIn(language, <OpenStackPlacementLines placement={PLACEMENT} />);

    const line: HTMLElement = screen.getByTestId("openstack-placement-cloud");

    expect(within(line).getByText(drawn)).toBeVisible();
    expect(line).toHaveTextContent("prod-eu");
  });
});

describe("the chip that says what kind of part needs attention", () => {
  test.each(LANGUAGES)(
    "%s starts a Kubernetes cluster's and a DNS zone's chip with a capital",
    (language: string) => {
      drawIn(
        language,
        <NeedsAttentionCard
          testId="attention"
          items={[
            attentionItem("Kubernetes cluster", "prod"),
            attentionItem("DNS zone", "example.com"),
          ]}
        />,
      );

      expect(
        screen
          .getAllByTestId("attention-kind")
          .map((chip: HTMLElement): string => {
            return chip.textContent || "";
          }),
      ).toEqual(
        ["Kubernetes cluster", "DNS zone"].map((key: string): string => {
          return capitalized(wordIn(language, key), language);
        }),
      );
    },
  );

  test("a kind written as it is named stays as written", () => {
    drawIn(
      "es",
      <NeedsAttentionCard
        testId="attention"
        items={[
          {
            ...attentionItem("pod", "web-1"),
            kindAsWritten: true,
          },
        ]}
      />,
    );

    expect(screen.getByTestId("attention-kind")).toHaveTextContent(/^pod$/);
  });
});

describe("where an address's name comes from, on the address card", () => {
  const CLOUD_RESOURCE_ADDRESS: React.ComponentProps<
    typeof TrafficAddressCard
  >["label"] = {
    address: "10.0.0.5",
    name: "web-alb",
    source: NetworkAddressNameSource.CloudResource,
    resourceId: "10000000-0000-4000-8000-000000000005",
    subnetName: null,
    subnet: null,
  };

  test.each(CLOUD_NOUN_LANGUAGES)(
    "%s starts Cloud resource with a capital, as Host and DNS name are",
    (language: string) => {
      drawIn(
        language,
        <TrafficAddressCard
          label={CLOUD_RESOURCE_ADDRESS}
          canName={false}
          canEditNames={false}
          onNamed={() => {}}
        />,
      );

      expect(wordIn(language, "Cloud resource")).toMatch(LOWER_CASE_START);
      expect(
        screen.getByTestId("traffic-address-card-source").textContent,
      ).toBe(capitalized(wordIn(language, "Cloud resource"), language));
    },
  );
});

describe("a kind only ever drawn first, worded with a capital", () => {
  /*
   * Every language that words the sentences of a cloud change starts them
   * with the kind ("{{kind}} {{name}}: reiniciar"), so "Container App" is
   * worded with a capital in every language (NounKeysDrawnAsLabelsGuard's
   * LABEL_ONLY_KEYS).
   */
  test("es says what a cloud change does to a Container App starting with a capital", () => {
    expect(
      describeCloudChange({
        resourceType: AiResourceType.AzureSubscription,
        command:
          "cloud restart-service /subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod/providers/Microsoft.App/containerApps/api",
        translator: dashboardTranslator("es"),
      })?.sentence,
    ).toBe("Aplicación de contenedor api: reiniciar");
  });
});

describe("the sentences keep the nouns lower-case", () => {
  /*
   * The keys drawn as labels above are worded for the middle of a sentence,
   * and stay so: a linked cloud resource and a Ceph cluster, named in the
   * line an investigation writes about the alerts on them.
   */
  test.each([
    ["es", "en recurso en la nube web-alb y clúster de Ceph ceph-prod"],
    ["fr", "sur ressource cloud web-alb et cluster Ceph ceph-prod"],
    ["it", "su risorsa cloud web-alb e cluster Ceph ceph-prod"],
    ["pt", "em recurso de nuvem web-alb e cluster Ceph ceph-prod"],
    ["ru", "на облачный ресурс web-alb и кластер Ceph ceph-prod"],
    ["da", "på cloud-ressource web-alb og Ceph-klynge ceph-prod"],
    ["nl", "op cloud-resource web-alb en Ceph-cluster ceph-prod"],
    ["no", "på skyressurs web-alb og Ceph-klynge ceph-prod"],
    ["sv", "på molnresurs web-alb och Ceph-kluster ceph-prod"],
  ])("%s: %s", (language: string, named: string) => {
    expect(
      describeLinkedInfrastructure(
        {
          resources: [
            { kind: "CloudResource", name: "web-alb" },
            { kind: "CephCluster", name: "ceph-prod" },
          ],
          alertCount: 0,
          openAlertCount: 0,
          hasMoreAlerts: false,
          lookbackMinutes: 30,
        },
        dashboardTranslator(language),
      ),
    ).toContain(named);
  });

  // An App Platforms environment the investigation read about.
  test.each([
    ["ru", "на облачная среда checkout"],
    ["da", "på cloud-miljø checkout"],
    ["nl", "op cloud-omgeving checkout"],
    ["no", "på skymiljø checkout"],
    ["sv", "på molnmiljö checkout"],
    ["es", "en entorno en la nube checkout"],
  ])("%s: %s", (language: string, named: string) => {
    expect(
      describeLinkedInfrastructure(
        {
          resources: [{ kind: "CloudEnvironment", name: "checkout" }],
          alertCount: 0,
          openAlertCount: 0,
          hasMoreAlerts: false,
          lookbackMinutes: 30,
        },
        dashboardTranslator(language),
      ),
    ).toContain(named);
  });
});

describe("the nouns the sentences share, worded for the middle of one", () => {
  /*
   * Each starts lower-case in every language that writes a common noun so
   * in the middle of a sentence, unless it starts with a name. #7659 found
   * "Cloud resource" and "Cloud environment" with a capital in da, nl, no,
   * ru and sv, "OpenStack cloud" in fr, it and pt, "OpenStack agent" in es,
   * fr, it and pt, "SNMP traps" in es and both documentation links in es
   * and fr - each said in the middle of a sentence ("Consulta la
   * {{documentation}}").
   */
  const SENTENCE_NOUN_KEYS: ReadonlyArray<string> = [
    "Cloud resource",
    "Cloud environment",
    "OpenStack cloud",
    "OpenStack agent",
    "SNMP traps",
    "GitHub Integration documentation",
    "Network Device Monitor documentation",
  ];

  // The names one may start with, written as their makers write them.
  const NAMES: ReadonlyArray<string> = ["OpenStack", "SNMP", "GitHub"];

  test.each(["da", "es", "fr", "it", "nl", "no", "pt", "ru", "sv"])(
    "%s starts each lower-case, or with a name",
    (language: string) => {
      const startingWithACapital: Array<string> = SENTENCE_NOUN_KEYS.filter(
        (key: string): boolean => {
          const value: string = wordIn(language, key);

          return (
            !LOWER_CASE_START.test(value) &&
            !NAMES.some((name: string): boolean => {
              return value.startsWith(name);
            })
          );
        },
      ).map((key: string): string => {
        return `${key}: ${wordIn(language, key)}`;
      });

      expect(startingWithACapital).toEqual([]);
    },
  );
});
