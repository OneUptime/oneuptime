import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import frenchLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fr.json";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";

// Render the dashboard's actual NavBar, catalog, translations and search modal.
// Fixtures carrying their own aliases would let the shared search component
// pass while the real products still lacked the words users search for.
const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;
const OTHER_PROJECT_ID: string = "7d2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

const SEARCH_CASES: Array<[string, string, string]> = [
  ["synthetic monitoring", "Monitors", PageMap.MONITORS],
  ["statuspage", "Status Pages", PageMap.STATUS_PAGES],
  ["outage", "Incidents", PageMap.INCIDENTS],
  ["alarms", "Alerts", PageMap.ALERTS],
  [
    "planned downtime",
    "Scheduled Maintenance",
    PageMap.SCHEDULED_MAINTENANCE_EVENTS,
  ],
  ["syslog", "Logs", PageMap.LOGS],
  ["prometheus", "Metrics", PageMap.METRICS],
  ["error tracking", "Exceptions", PageMap.EXCEPTIONS],
  ["genai", "AI / LLM", PageMap.LLM],
  ["copilot", "Chat", PageMap.AI_COPILOT],
  ["ai agents", "Tasks", PageMap.AI_AGENT_TASKS],
  ["source code", "Code Repositories", PageMap.CODE_REPOSITORY],
  ["dependency map", "Topology", PageMap.TOPOLOGY],
  ["cmdb", "Inventory", PageMap.INVENTORY],
  ["container monitoring", "Docker", PageMap.DOCKER_HOSTS],
  ["rootless containers", "Podman", PageMap.PODMAN_HOSTS],
  ["pve", "Proxmox", PageMap.PROXMOX_CLUSTERS],
  ["vsphere", "VMware", PageMap.VMWARE_VCENTERS],
  ["internet of things", "IoT", PageMap.IOT_FLEETS],
  ["rados", "Ceph", PageMap.CEPH_CLUSTERS],
  ["container orchestration", "Docker Swarm", PageMap.DOCKER_SWARM_CLUSTERS],
  ["linux", "Hosts", PageMap.HOSTS],
  ["widgets", "Dashboards", PageMap.DASHBOARDS],
  ["integrations", "Workflows", PageMap.WORKFLOWS],
  ["playbooks", "Runbooks", PageMap.RUNBOOKS],
  ["teammates", "Users", PageMap.USERS],
  ["departments", "Teams", PageMap.TEAMS],
  ["api keys", "Project Settings", PageMap.SETTINGS],
  ["RUM", "Real User Monitoring", PageMap.RUM_APPLICATIONS],
  ["frontend", "Real User Monitoring", PageMap.RUM_APPLICATIONS],
  ["front end", "Real User Monitoring", PageMap.RUM_APPLICATIONS],
  ["web vitals", "Real User Monitoring", PageMap.RUM_APPLICATIONS],
  ["session replay", "Real User Monitoring", PageMap.RUM_APPLICATIONS],
  ["user experience", "Real User Monitoring", PageMap.RUM_APPLICATIONS],
  ["k8s", "Kubernetes", PageMap.KUBERNETES_CLUSTERS],
  ["kubectl", "Kubernetes", PageMap.KUBERNETES_CLUSTERS],
  ["pods", "Kubernetes", PageMap.KUBERNETES_CLUSTERS],
  ["apm", "Services", PageMap.SERVICES],
  ["distributed tracing", "Traces", PageMap.TRACES],
  ["spans", "Traces", PageMap.TRACES],
  ["otel", "Traces", PageMap.TRACES],
  ["opentelemetry", "Traces", PageMap.TRACES],
  ["service level", "SLOs", PageMap.SLOS],
  ["error budget", "SLOs", PageMap.SLOS],
  ["siem", "Security Events", PageMap.SECURITY_EVENTS],
  ["snmp", "Network", PageMap.NETWORK_OVERVIEW],
  ["flamegraph", "Performance Profiles", PageMap.PROFILES],
  ["lambda", "Serverless", PageMap.SERVERLESS_FUNCTIONS],
  ["aws", "Cloud", PageMap.CLOUD_RESOURCES],
  ["azure", "Cloud", PageMap.CLOUD_RESOURCES],
  ["gcp", "Cloud", PageMap.CLOUD_RESOURCES],
  ["oncall", "On-Call Duty", PageMap.ON_CALL_DUTY],
  ["escalation", "On-Call Duty", PageMap.ON_CALL_DUTY],
  ["rca", "Insights", PageMap.AI_INSIGHTS],
];

function navbar(): React.ReactElement {
  return (
    <I18nextProvider i18n={translation}>
      <DashboardNavbar show={true} />
    </I18nextProvider>
  );
}

function openProducts(): void {
  fireEvent.click(screen.getByRole("button", { name: "Products" }));
  expect(screen.getByRole("dialog", { name: "Products menu" })).toBeVisible();
}

function queryFor(value: string): void {
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value },
  });
}

function productLink(pageMapKey: string): HTMLElement {
  const href: string = routeFor(pageMapKey);
  const link: HTMLElement | undefined = within(screen.getByRole("listbox"))
    .queryAllByRole("link")
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("href") === href;
    });

  if (!link) {
    throw new Error(`Search did not expose the product at ${href}.`);
  }

  return link;
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      fr: { translation: frenchLocale },
    },
    interpolation: { escapeValue: false },
  });
});

describe("dashboard product search keywords", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/home`);
    await translation.changeLanguage("en");
    jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.localStorage.clear();
    setViewportWidth(ORIGINAL_WIDTH);
  });

  test.each(SEARCH_CASES)(
    "%j exposes %s at the current project's destination",
    (query: string, title: string, pageMapKey: string) => {
      render(navbar());
      openProducts();

      queryFor(query);

      const link: HTMLElement = productLink(pageMapKey);
      expect(link).toHaveTextContent(title);
      expect(link).toHaveAttribute("href", expect.stringContaining(PROJECT_ID));
      expect(link.getAttribute("href")).not.toContain(":projectId");
    },
  );

  test.each([
    ["  rUm  ", "Real User Monitoring", PageMap.RUM_APPLICATIONS],
    [" K8S ", "Kubernetes", PageMap.KUBERNETES_CLUSTERS],
  ])(
    "%j narrows the real catalog to %s and opens it with Enter",
    (query: string, title: string, pageMapKey: string) => {
      render(navbar());
      openProducts();

      queryFor(query);

      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
        title,
      );
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

      expect(Navigation.navigate).toHaveBeenCalledWith(
        new Route(routeFor(pageMapKey)),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  test("a keyword result can be clicked and appears in recently visited products", () => {
    render(navbar());
    openProducts();
    queryFor("k8s");

    fireEvent.click(productLink(PageMap.KUBERNETES_CLUSTERS));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(Navigation.navigate).toHaveBeenCalledWith(
      new Route(routeFor(PageMap.KUBERNETES_CLUSTERS)),
    );

    openProducts();

    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(
      screen.getByRole("heading", { name: "Recently visited" }),
    ).toBeVisible();
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Kubernetes");
  });

  test("a project switch refreshes keyword results to the newly selected project", () => {
    const { rerender } = render(navbar());
    openProducts();
    queryFor("k8s");
    expect(productLink(PageMap.KUBERNETES_CLUSTERS)).toHaveAttribute(
      "href",
      expect.stringContaining(PROJECT_ID),
    );

    goTo(`/dashboard/${OTHER_PROJECT_ID}/home`);
    rerender(navbar());

    expect(screen.getByRole("combobox")).toHaveValue("k8s");
    const link: HTMLElement = productLink(PageMap.KUBERNETES_CLUSTERS);
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining(OTHER_PROJECT_ID),
    );
    expect(link.getAttribute("href")).not.toContain(PROJECT_ID);

    fireEvent.click(link);
    expect(Navigation.navigate).toHaveBeenCalledWith(
      new Route(routeFor(PageMap.KUBERNETES_CLUSTERS)),
    );
  });

  test("aliases survive a language switch while visible titles are translated", async () => {
    render(navbar());
    openProducts();
    queryFor("frontend");
    expect(productLink(PageMap.RUM_APPLICATIONS)).toHaveTextContent(
      "Real User Monitoring",
    );

    await act(async () => {
      await translation.changeLanguage("fr");
    });

    expect(screen.getByRole("combobox")).toHaveValue("frontend");
    expect(productLink(PageMap.RUM_APPLICATIONS)).toHaveTextContent(
      "Surveillance des utilisateurs réels",
    );
    expect(screen.queryByText("Real User Monitoring")).not.toBeInTheDocument();

    queryFor("utilisateurs réels");
    expect(productLink(PageMap.RUM_APPLICATIONS)).toHaveTextContent(
      "Surveillance des utilisateurs réels",
    );

    queryFor("k8s");
    expect(productLink(PageMap.KUBERNETES_CLUSTERS)).toHaveTextContent(
      "Kubernetes",
    );
  });

  test("unrecognized text shows the dashboard's empty state and clearing restores the catalog", () => {
    render(navbar());
    openProducts();
    const initialCount: number = screen.getAllByRole("option").length;

    queryFor("no-such-product-12345");

    expect(screen.getByText("No products found.")).toBeVisible();
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(initialCount);
    expect(productLink(PageMap.RUM_APPLICATIONS)).toBeVisible();
    expect(productLink(PageMap.KUBERNETES_CLUSTERS)).toBeVisible();
  });
});
