/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import KubernetesClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index";
import DockerHostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Overview";
import PodmanHostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Overview";
import HostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import DockerSwarmClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Index";
import IoTFleetOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  ResourceConnectionGuide,
  ResourceConnectionGuideStep,
  getDockerHostConnectionGuide,
  getDockerSwarmClusterConnectionGuide,
  getHostConnectionGuide,
  getIoTFleetConnectionGuide,
  getKubernetesClusterConnectionGuide,
  getPodmanHostConnectionGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { settle } from "./HostTooltipHarness";

/*
 * The "how do I connect this?" card on the infrastructure overviews -
 * Kubernetes, Docker, Podman, Host, Docker Swarm and IoT - rendered inside
 * the real pages rather than on its own.
 *
 * The reported case: create a Kubernetes cluster by hand, open it, and the
 * hero says "Disconnected" with nothing on the page saying what to do. The
 * card is meant to sit directly under the hero while the resource is not
 * connected, name the exact identifier the agent must report, and link to
 * that resource's Documentation tab. So for each page this checks:
 *
 * - a resource created by hand (nothing ever reported): the setup card,
 *   directly between the hero and the page's first section, with the
 *   resource's own identifier in the command it shows;
 * - a resource that reported and then stopped: the troubleshooting card,
 *   saying when it was last heard from;
 * - a connected resource: no card at all;
 * - and the hero's badge always agreeing with the card.
 *
 * Only the data sources (the resource lookup, lists, counts, the metric
 * aggregates and the Kubernetes summary) and the heavy neighbours (charts,
 * details card, activity cards, refresh control, time picker) are stubbed,
 * the same way the pages' tooltip and slow-load suites stub them. The hero,
 * the card, its Link and CopyTextButton, and every tile are the real code.
 */

const NOW: Date = new Date("2026-09-30T12:00:00.000Z");
const THREE_HOURS_AGO: Date = new Date("2026-09-30T09:00:00.000Z");

/*
 * What the mocked data layer serves. Mutable so each test picks the
 * resource; `mock` prefix because jest.mock factories are hoisted and may
 * only close over mock-prefixed names.
 */
let mockModelId: string = "";
let mockResource: Record<string, unknown> | null = null;
const mockNavigations: Array<unknown> = [];
const mockProjectId: string = "10000000-0000-4000-8000-000000000001";

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType(mockModelId);
      },
      getLastParamAsString: (): string => {
        return "";
      },
      getFirstParam: (): undefined => {
        return undefined;
      },
      navigate: (route: unknown): void => {
        mockNavigations.push(route);
      },
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType(mockProjectId);
      },
    },
  };
});

// The Kubernetes inventory summary and AI agent status: nothing reported yet.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<unknown> => {
        return Promise.resolve({ data: {} });
      },
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        return Promise.resolve(mockResource ? { ...mockResource } : null);
      },
      // Inventories (Swarm resources, IoT devices): empty.
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils",
  () => {
    const actual: {
      default: {
        formatCpuValue: (value: number | null) => string;
        formatMemoryValue: (bytes: number | null) => string;
      };
    } = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils",
    ) as {
      default: {
        formatCpuValue: (value: number | null) => string;
        formatMemoryValue: (bytes: number | null) => string;
      };
    };

    return {
      __esModule: true,
      default: {
        formatCpuValue: actual.default.formatCpuValue,
        formatMemoryValue: actual.default.formatMemoryValue,
        fetchResourceListWithMemory: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
        fetchNodeAllocatableMemory: (): Promise<Map<string, number>> => {
          return Promise.resolve(new Map<string, number>());
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
  () => {
    return {
      __esModule: true,
      ...(jest.requireActual(
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
      ) as Record<string, unknown>),
      fetchClusterWarningEvents: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="stub-activity-cards" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="stub-auto-refresh-control" />;
      },
    };
  },
);

// The Docker Swarm overview's refresh timer; off, so no interval runs.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: (): Record<string, unknown> => {
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: (): void => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="stub-model-detail" />;
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="stub-time-range-picker" />;
      },
    };
  },
);

// Recharts has nothing to measure under jsdom; the charts are not under test.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="stub-line-chart" />;
    },
  };
});

// The pages read their ids from the route (mocked above), not from props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// ---------------------------------------------------------------- the pages

interface OverviewCase {
  Page: FunctionComponent<PageComponentProps>;
  modelId: string;
  documentationPage: PageMap;
  // The resource as someone created it by hand.
  fields: Record<string, unknown>;
  // What the hero's h1 shows.
  heroName: string;
  // The resource in the card's words: "Connect this <noun>".
  noun: string;
  // The name the agent must report, which the page hands the guide.
  identifier: string;
  guide: (identifier: string) => ResourceConnectionGuide;
  // A setup <code> snippet, exactly - the resource's own identifier in it.
  setupCode: string;
  // Where the setup steps name the identifier, as the card shows it.
  identifierMention: string;
  // The first thing the page draws after the hero (and the card).
  nextSection: () => HTMLElement;
}

// An (i) is a <button aria-label="About <title>">; the first one in the page.
function infoButton(title: string): HTMLElement {
  const button: HTMLElement | null = document.querySelector<HTMLElement>(
    `button[aria-label="About ${title}"]`,
  );

  if (!button) {
    throw new Error(`No "About ${title}" (i) on the page.`);
  }

  return button;
}

const OVERVIEWS: Array<[string, OverviewCase]> = [
  [
    "Kubernetes cluster",
    {
      Page: KubernetesClusterOverview,
      modelId: "0193c0de-7777-4aaa-8bbb-000000000007",
      documentationPage: PageMap.KUBERNETES_CLUSTER_VIEW_DOCUMENTATION,
      fields: {
        name: "Production US East",
        clusterIdentifier: "prod-us-east-1",
      },
      heroName: "Production US East",
      noun: "cluster",
      identifier: "prod-us-east-1",
      guide: getKubernetesClusterConnectionGuide,
      setupCode: '--set clusterName="prod-us-east-1"',
      identifierMention: 'clusterName="prod-us-east-1"',
      // The golden metric tiles.
      nextSection: (): HTMLElement => {
        return infoButton("Availability");
      },
    },
  ],
  [
    "Docker host",
    {
      Page: DockerHostOverview,
      modelId: "5a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9",
      documentationPage: PageMap.DOCKER_HOST_VIEW_DOCUMENTATION,
      fields: { name: "Web 01", hostIdentifier: "web-01", osType: "linux" },
      heroName: "Web 01",
      noun: "Docker host",
      identifier: "web-01",
      guide: getDockerHostConnectionGuide,
      setupCode: '-e DOCKER_HOST_NAME="web-01"',
      identifierMention: 'DOCKER_HOST_NAME="web-01"',
      // The summary tiles.
      nextSection: (): HTMLElement => {
        return infoButton("Containers");
      },
    },
  ],
  [
    "Podman host",
    {
      Page: PodmanHostOverview,
      modelId: "6b2c3d4e-5f60-4172-8384-a5b6c7d8e9f0",
      documentationPage: PageMap.PODMAN_HOST_VIEW_DOCUMENTATION,
      fields: { name: "Web 01", hostIdentifier: "web-01", osType: "linux" },
      heroName: "Web 01",
      noun: "Podman host",
      identifier: "web-01",
      guide: getPodmanHostConnectionGuide,
      setupCode: '-e PODMAN_HOST_NAME="web-01"',
      identifierMention: 'PODMAN_HOST_NAME="web-01"',
      nextSection: (): HTMLElement => {
        return infoButton("Containers");
      },
    },
  ],
  [
    "Host",
    {
      Page: HostOverview,
      modelId: "84858d6c-1111-4aaa-8bbb-000000000001",
      documentationPage: PageMap.HOST_VIEW_DOCUMENTATION,
      fields: {
        name: "Web server 01",
        hostIdentifier: "web-01",
        osType: "linux",
      },
      heroName: "Web server 01",
      noun: "host",
      identifier: "web-01",
      guide: getHostConnectionGuide,
      // The collector reads host.name from the machine's hostname.
      setupCode: "hostname",
      identifierMention: 'It has to be "web-01" (any letter case)',
      // The summary tiles: CPU first.
      nextSection: (): HTMLElement => {
        return infoButton("CPU");
      },
    },
  ],
  [
    "Docker Swarm cluster",
    {
      Page: DockerSwarmClusterOverview,
      modelId: "11111111-1111-4111-8111-111111111111",
      documentationPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_DOCUMENTATION,
      fields: { name: "prod-swarm" },
      heroName: "prod-swarm",
      noun: "cluster",
      identifier: "prod-swarm",
      guide: getDockerSwarmClusterConnectionGuide,
      setupCode: "DOCKER_SWARM_CLUSTER_NAME=prod-swarm",
      identifierMention:
        'When it asks for the cluster name, enter "prod-swarm"',
      // The count tiles: Nodes first, opened through an overlay button.
      nextSection: (): HTMLElement => {
        const label: HTMLElement | null = Array.from(
          document.querySelectorAll<HTMLElement>("button span.sr-only"),
        ).find((span: HTMLElement): boolean => {
          return span.textContent === "View Nodes";
        }) as HTMLElement | null;

        if (!label) {
          throw new Error('No "View Nodes" tile on the page.');
        }

        return label.closest("button") as HTMLElement;
      },
    },
  ],
  [
    "IoT fleet",
    {
      Page: IoTFleetOverview,
      modelId: "2c3d4e5f-6071-4283-9495-b6c7d8e9f0a1",
      documentationPage: PageMap.IOT_FLEET_VIEW_DOCUMENTATION,
      fields: { name: "field-sensors" },
      heroName: "field-sensors",
      noun: "fleet",
      identifier: "field-sensors",
      guide: getIoTFleetConnectionGuide,
      setupCode:
        "OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=field-sensors,service.name=iot/field-sensors",
      identifierMention: "iot.fleet.name=field-sensors",
      // The golden metric tiles.
      nextSection: (): HTMLElement => {
        return infoButton("Online Devices");
      },
    },
  ],
];

const KUBERNETES: OverviewCase = OVERVIEWS[0]![1];

// ------------------------------------------------------------------ helpers

function arrange(
  page: OverviewCase,
  connection: { otelCollectorStatus: string; lastSeenAt?: Date },
): void {
  mockModelId = page.modelId;
  mockResource = { _id: page.modelId, ...page.fields, ...connection };
}

async function renderOverview(page: OverviewCase): Promise<void> {
  const Page: FunctionComponent<PageComponentProps> = page.Page;

  render(<Page {...PAGE_PROPS} />);
  await settle();
  await settle();

  // Past every loader: the hero and the section after it are drawn.
  heroHeading(page);
  page.nextSection();
}

// The hero's h1 - the only h1 on the page - naming the resource.
function heroHeading(page: OverviewCase): HTMLElement {
  const headings: Array<HTMLElement> = Array.from(
    document.querySelectorAll<HTMLElement>("h1"),
  );

  expect(
    headings.map((heading: HTMLElement): string => {
      return heading.textContent || "";
    }),
  ).toEqual([page.heroName]);

  return headings[0]!;
}

// The Connected / Disconnected badge that sits right beside the h1.
function heroBadge(page: OverviewCase): string {
  return (heroHeading(page).nextElementSibling?.textContent || "").trim();
}

/*
 * The hero's own block: the h1's ancestor that sits directly in the page,
 * beside the sections drawn after it.
 */
function heroBlock(page: OverviewCase): HTMLElement {
  const next: HTMLElement = page.nextSection();
  let node: HTMLElement = heroHeading(page);

  while (node.parentElement && !node.parentElement.contains(next)) {
    node = node.parentElement;
  }

  return node;
}

function guideCard(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-testid="resource-connection-guide"]',
  );
}

function expectGuideCard(state: string): HTMLElement {
  const card: HTMLElement | null = guideCard();

  expect(card).not.toBeNull();
  expect(card).toHaveAttribute("data-state", state);

  return card!;
}

// Hero, then the card, then the page's first section - nothing in between.
function expectDirectlyUnderHero(page: OverviewCase, card: HTMLElement): void {
  const hero: HTMLElement = heroBlock(page);
  const next: HTMLElement = page.nextSection();

  expect(
    heroHeading(page).compareDocumentPosition(card) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    card.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  expect(hero.nextElementSibling).toBe(card);
  expect(card.nextElementSibling).toContainElement(next);
}

function cardHeading(card: HTMLElement): string {
  return within(card).getByRole("heading", { level: 2 }).textContent || "";
}

function steps(card: HTMLElement): Array<HTMLElement> {
  return within(card).getAllByTestId("resource-connection-guide-step");
}

function stepTitles(card: HTMLElement): Array<string> {
  return steps(card).map((step: HTMLElement): string => {
    return step.querySelector("h3")?.textContent || "";
  });
}

/*
 * The card shows exactly these steps, in order: each one's title, its
 * description (where the troubleshooting steps name the identifier) and its
 * command, if it has one.
 */
function expectSteps(
  card: HTMLElement,
  expected: Array<ResourceConnectionGuideStep>,
): void {
  const shown: Array<HTMLElement> = steps(card);

  expect(stepTitles(card)).toEqual(
    expected.map((step: ResourceConnectionGuideStep): string => {
      return step.title;
    }),
  );

  for (let index: number = 0; index < expected.length; index++) {
    const step: ResourceConnectionGuideStep = expected[index]!;
    const code: string | null =
      shown[index]!.querySelector("code")?.textContent ?? null;

    expect(shown[index]).toHaveTextContent(step.description);
    expect({ step: step.title, code: code }).toEqual({
      step: step.title,
      code: step.code ?? null,
    });
  }
}

function setupGuideLink(card: HTMLElement): HTMLElement {
  return within(card).getByRole("link", { name: "Open the setup guide" });
}

// The resource's Documentation tab, as the page should link it.
function documentationHref(page: OverviewCase): string {
  return RouteUtil.populateRouteParams(
    RouteMap[page.documentationPage] as Route,
    { modelId: new ObjectID(page.modelId) },
  ).toString();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  mockNavigations.length = 0;
  mockModelId = "";
  mockResource = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.localStorage.clear();
});

// ----------------------------------------------------- the reported scenario

describe("Kubernetes: a cluster created by hand, then View cluster (the reported case)", () => {
  beforeEach(() => {
    // Just created from the Clusters list: never reported, no lastSeenAt.
    arrange(KUBERNETES, { otelCollectorStatus: "disconnected" });
  });

  test("the hero still reads Disconnected, and right under it the page says why and how to connect the cluster", async () => {
    await renderOverview(KUBERNETES);

    expect(heroBadge(KUBERNETES)).toBe("Disconnected");
    expect(heroBlock(KUBERNETES)).toHaveTextContent("Last seen never");

    const card: HTMLElement = expectGuideCard("never-connected");

    expectDirectlyUnderHero(KUBERNETES, card);
    expect(cardHeading(card)).toBe("Connect this cluster");
    expect(card).toHaveTextContent(
      "No data has arrived from this cluster yet, which is why it shows as Disconnected.",
    );
    expect(card).toHaveTextContent(
      "Set up the OneUptime Kubernetes Agent — it takes a few minutes.",
    );
    expect(stepTitles(card)).toEqual([
      "Pick an ingestion key",
      "Install the agent with Helm",
      "Wait for the first data",
    ]);
  });

  test("the Helm step names this cluster's identifier - not its display name - ready to copy", async () => {
    await renderOverview(KUBERNETES);

    const helmStep: HTMLElement = steps(expectGuideCard("never-connected"))[1]!;
    const code: HTMLElement = within(helmStep).getByText(
      '--set clusterName="prod-us-east-1"',
    );

    expect(code.tagName).toBe("CODE");
    expect(helmStep).toHaveTextContent(
      "Keep clusterName exactly as below so the data lands on this cluster",
    );
    expect(helmStep).not.toHaveTextContent("Production US East");
    expect(
      within(code.parentElement!).getByRole("button", {
        name: "Copy to clipboard",
      }),
    ).toBeInTheDocument();
  });

  test("Open the setup guide goes to this cluster's Documentation tab", async () => {
    await renderOverview(KUBERNETES);

    const link: HTMLElement = setupGuideLink(
      expectGuideCard("never-connected"),
    );
    const expected: string = `/dashboard/${mockProjectId}/kubernetes/${KUBERNETES.modelId}/documentation`;

    expect(documentationHref(KUBERNETES)).toBe(expected);
    expect(link).toHaveAttribute("href", expected);

    fireEvent.click(link);

    expect(mockNavigations.map(String)).toEqual([expected]);
  });
});

// ------------------------------------------------------- every overview page

describe.each(OVERVIEWS)(
  "%s overview",
  (_label: string, page: OverviewCase) => {
    test("created by hand, never connected: the setup card, directly under the hero", async () => {
      arrange(page, { otelCollectorStatus: "disconnected" });
      await renderOverview(page);

      const card: HTMLElement = expectGuideCard("never-connected");

      expectDirectlyUnderHero(page, card);
      expect(cardHeading(card)).toBe(`Connect this ${page.noun}`);
      expect(card).toHaveTextContent(
        `No data has arrived from this ${page.noun} yet, which is why it shows as Disconnected.`,
      );

      const guide: ResourceConnectionGuide = page.guide(page.identifier);

      expect(steps(card)).toHaveLength(3);
      expectSteps(card, guide.setupSteps);
    });

    test("created by hand: a setup step shows this resource's own identifier, in code", async () => {
      arrange(page, { otelCollectorStatus: "disconnected" });
      await renderOverview(page);

      const card: HTMLElement = expectGuideCard("never-connected");

      expect(within(card).getByText(page.setupCode).tagName).toBe("CODE");
      expect(card).toHaveTextContent(page.identifierMention);
    });

    test("created by hand: Open the setup guide links to this resource's Documentation tab", async () => {
      arrange(page, { otelCollectorStatus: "disconnected" });
      await renderOverview(page);

      const link: HTMLElement = setupGuideLink(
        expectGuideCard("never-connected"),
      );

      expect(documentationHref(page)).toContain(
        `/${page.modelId}/documentation`,
      );
      expect(link).toHaveAttribute("href", documentationHref(page));

      fireEvent.click(link);

      expect(mockNavigations.map(String)).toEqual([documentationHref(page)]);
    });

    test("created by hand: the hero badge reads Disconnected, as the card says", async () => {
      arrange(page, { otelCollectorStatus: "disconnected" });
      await renderOverview(page);

      expect(heroBadge(page)).toBe("Disconnected");
      expect(expectGuideCard("never-connected")).toHaveTextContent(
        "which is why it shows as Disconnected",
      );
    });

    test("reported, then stopped: the troubleshooting card, saying when it was last heard from", async () => {
      arrange(page, {
        otelCollectorStatus: "disconnected",
        lastSeenAt: THREE_HOURS_AGO,
      });
      await renderOverview(page);

      const card: HTMLElement = expectGuideCard("disconnected");

      expectDirectlyUnderHero(page, card);
      expect(cardHeading(card)).toBe(`This ${page.noun} stopped sending data`);
      expect(card).toHaveTextContent(
        `OneUptime last heard from this ${page.noun} 3 hours ago.`,
      );

      const guide: ResourceConnectionGuide = page.guide(page.identifier);

      expect(steps(card)).toHaveLength(3);
      expectSteps(card, guide.troubleshootingSteps);
      // The last check names the identifier the agent must still report.
      expect(steps(card)[2]).toHaveTextContent(`"${page.identifier}"`);
      expect(setupGuideLink(card)).toHaveAttribute(
        "href",
        documentationHref(page),
      );

      // The hero agrees: Disconnected, last seen at the same time.
      expect(heroBadge(page)).toBe("Disconnected");
      expect(heroBlock(page)).toHaveTextContent("Last seen 3 hours ago");
    });

    test.each([["connected"], ["active"]])(
      "status %p: the hero reads Connected and there is no card at all",
      async (status: string) => {
        arrange(page, { otelCollectorStatus: status, lastSeenAt: NOW });
        await renderOverview(page);

        expect(heroBadge(page)).toBe("Connected");
        expect(guideCard()).toBeNull();
        expect(document.body).not.toHaveTextContent("Open the setup guide");

        // The page's first section follows the hero directly.
        expect(heroBlock(page).nextElementSibling).toContainElement(
          page.nextSection(),
        );
      },
    );
  },
);
