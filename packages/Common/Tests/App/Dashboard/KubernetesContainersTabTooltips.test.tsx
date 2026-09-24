import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import KubernetesContainersTab from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesContainersTab";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
import {
  KubernetesContainerSpec,
  KubernetesContainerStatus,
} from "../../../Types/Kubernetes/KubernetesObjectParser";

/*
 * A pod's Containers tab: one card per container with State / Ready /
 * Restarts tiles and its resource Requests and Limits. Each of those now
 * carries an (i) that says what the value means - "Limits" in particular is
 * where a customer learns that crossing the memory limit gets the container
 * killed. Rendered for real; tippy is portalled to document.body and its box
 * never finishes animating under jsdom, so presence is asserted.
 */

const D: typeof KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS =
  KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS;

function container(
  overrides: Partial<KubernetesContainerSpec> = {},
): KubernetesContainerSpec {
  return {
    name: "app",
    image: "nginx:1.27",
    command: [],
    args: [],
    env: [{ name: "MODE", value: "production" }],
    ports: [],
    resources: {
      requests: { cpu: "250m", memory: "256Mi" },
      limits: { cpu: "1", memory: "512Mi" },
    },
    volumeMounts: [],
    ...overrides,
  };
}

function status(
  overrides: Partial<KubernetesContainerStatus> = {},
): KubernetesContainerStatus {
  return {
    name: "app",
    ready: true,
    restartCount: 3,
    state: "running",
    reason: "",
    image: "nginx:1.27",
    ...overrides,
  };
}

async function tooltipFor(label: string): Promise<string> {
  const button: HTMLElement = screen.getByRole("button", {
    name: `About ${label}`,
  });

  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");
  const text: string = tooltips[tooltips.length - 1]?.textContent || "";

  fireEvent.mouseLeave(button);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });

  return text;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("KubernetesContainersTab: every number on a container card is explained", () => {
  test("State, Ready, Restarts, Requests and Limits each have an (i)", () => {
    render(
      <KubernetesContainersTab
        containers={[container()]}
        initContainers={[]}
        containerStatuses={[status()]}
        initContainerStatuses={[]}
      />,
    );

    for (const label of ["State", "Ready", "Restarts", "Requests", "Limits"]) {
      expect(
        screen.getByRole("button", { name: `About ${label}` }),
      ).toBeInTheDocument();
    }
  });

  test.each([
    ["State", D.containerState],
    ["Ready", D.containerReady],
    ["Restarts", D.containerRestarts],
    ["Requests", D.containerRequests],
    ["Limits", D.containerLimits],
  ])(
    "hovering the %s (i) shows what it means",
    async (label: string, text: string) => {
      render(
        <KubernetesContainersTab
          containers={[container()]}
          initContainers={[]}
          containerStatuses={[status()]}
          initContainerStatuses={[]}
        />,
      );

      expect(await tooltipFor(label)).toBe(text);
    },
  );

  test("nothing is explained before someone reaches for it", () => {
    render(
      <KubernetesContainersTab
        containers={[container()]}
        initContainers={[]}
        containerStatuses={[status()]}
        initContainerStatuses={[]}
      />,
    );

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByText(D.containerLimits)).not.toBeInTheDocument();
  });

  test("the values the tiles explain are still shown beside them", () => {
    render(
      <KubernetesContainersTab
        containers={[container()]}
        initContainers={[]}
        containerStatuses={[status({ restartCount: 7 })]}
        initContainerStatuses={[]}
      />,
    );

    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("250m (0.25 CPU cores)")).toBeInTheDocument();
    expect(screen.getByText("512Mi (512 MB)")).toBeInTheDocument();
  });

  test("a container with no status yet shows no State / Ready / Restarts (i)", () => {
    render(
      <KubernetesContainersTab
        containers={[container()]}
        initContainers={[]}
        containerStatuses={[]}
        initContainerStatuses={[]}
      />,
    );

    for (const label of ["State", "Ready", "Restarts"]) {
      expect(
        screen.queryByRole("button", { name: `About ${label}` }),
      ).not.toBeInTheDocument();
    }

    // Its resources are still explained.
    expect(
      screen.getByRole("button", { name: "About Requests" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "About Limits" }),
    ).toBeInTheDocument();
  });

  test("only the resource sections a container declares get an (i)", () => {
    render(
      <KubernetesContainersTab
        containers={[
          container({
            resources: { requests: { cpu: "100m" }, limits: {} },
          }),
        ]}
        initContainers={[]}
        containerStatuses={[status()]}
        initContainerStatuses={[]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "About Requests" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "About Limits" }),
    ).not.toBeInTheDocument();
  });

  test("a container with no requests or limits shows neither (i)", () => {
    render(
      <KubernetesContainersTab
        containers={[container({ resources: { requests: {}, limits: {} } })]}
        initContainers={[]}
        containerStatuses={[status()]}
        initContainerStatuses={[]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "About Requests" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "About Limits" }),
    ).not.toBeInTheDocument();
  });

  test("init containers are explained the same way, card by card", () => {
    render(
      <KubernetesContainersTab
        containers={[container()]}
        initContainers={[container({ name: "migrate" })]}
        containerStatuses={[status()]}
        initContainerStatuses={[
          status({ name: "migrate", state: "terminated", ready: false }),
        ]}
      />,
    );

    // One set per card: the regular container and the init container.
    for (const label of ["State", "Ready", "Restarts", "Requests", "Limits"]) {
      expect(
        screen.getAllByRole("button", { name: `About ${label}` }),
      ).toHaveLength(2);
    }
  });

  test("no (i) sits inside another button or a link", () => {
    render(
      <KubernetesContainersTab
        containers={[container()]}
        initContainers={[]}
        containerStatuses={[status()]}
        initContainerStatuses={[]}
      />,
    );

    const infoButtons: Array<HTMLElement> = screen.getAllByRole("button", {
      name: /^About /,
    });

    expect(infoButtons).toHaveLength(5);

    for (const button of infoButtons) {
      expect(button.parentElement?.closest("button, a")).toBeNull();
    }
  });

  test("clicking an (i) does not toggle the card's expandable sections", () => {
    render(
      <KubernetesContainersTab
        containers={[container()]}
        initContainers={[]}
        containerStatuses={[status()]}
        initContainerStatuses={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "About Limits" }));

    // The env vars stay collapsed: the toggle still reads "▶".
    const envToggle: HTMLElement = screen.getByRole("button", {
      name: /Environment Variables/,
    });

    expect(within(envToggle).getByText("▶")).toBeInTheDocument();
    expect(screen.queryByText("production")).not.toBeInTheDocument();
  });

  test("the Requests and Limits (i)s sit beside their headings", () => {
    render(
      <KubernetesContainersTab
        containers={[container()]}
        initContainers={[]}
        containerStatuses={[status()]}
        initContainerStatuses={[]}
      />,
    );

    for (const label of ["Requests", "Limits"]) {
      const heading: HTMLElement = screen.getByText(label, {
        selector: "span",
      });
      const button: HTMLElement = screen.getByRole("button", {
        name: `About ${label}`,
      });

      expect(heading.parentElement).toContainElement(button);
    }
  });
});
