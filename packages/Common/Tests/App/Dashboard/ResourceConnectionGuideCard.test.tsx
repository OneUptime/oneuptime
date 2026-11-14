/** @timezone UTC */

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
import { SpyInstance } from "jest-mock";
import ResourceConnectionGuideCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuideCard";
import {
  ResourceConnectionGuide,
  getHostConnectionGuide,
  getKubernetesClusterConnectionGuide,
  getProxmoxClusterConnectionGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import Clipboard from "../../../UI/Utils/Clipboard";

/*
 * The "how do I connect this?" card on a resource overview, rendered for
 * real: nothing while connected, the setup steps for a resource nothing has
 * ever reported for, and the troubleshooting steps - with when it was last
 * heard from - for one that stopped.
 */

const NOW: Date = new Date("2026-09-30T12:00:00.000Z");
const DOCS: Route = new Route(
  "/dashboard/project-1/kubernetes/cluster-1/documentation",
);

// The card's sentences about the resource are the guide's own (issue #6308).
const GUIDE: ResourceConnectionGuide = {
  agentName: "OneUptime Widget Agent",
  setupCopy: {
    title: "Connect this widget",
    description:
      "No data has arrived from this widget yet, which is why it shows as Disconnected. Set up the {{agentName}} — it takes a few minutes.",
  },
  stoppedCopy: {
    title: "This widget stopped sending data",
    description:
      "OneUptime last heard from this widget {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
  },
  setupSteps: [
    { title: "First setup step", description: "Do the first thing." },
    {
      title: "Second setup step",
      description: "Run this:",
      code: "widget-agent install --name=w1",
    },
    { title: "Third setup step", description: "Wait." },
  ],
  troubleshootingSteps: [
    {
      title: "First check",
      description: "Look at it.",
      code: "widget-agent status",
    },
    { title: "Second check", description: "Read the logs." },
    { title: "Third check", description: "Reinstall." },
  ],
};

function card(): HTMLElement | null {
  return screen.queryByTestId("resource-connection-guide");
}

function stepTitles(): Array<string> {
  return screen
    .getAllByTestId("resource-connection-guide-step")
    .map((step: HTMLElement): string => {
      return within(step).getByRole("heading").textContent || "";
    });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/*
 * A diagnostic command's address is longer than the card's column: it
 * breaks after a slash of its path - "https://oneuptime.com/" "install/"
 * "proxmox-agent/" - never mid-word ("instal" / "l/..."), and the command
 * on screen is still the command, character for character.
 */
describe("ResourceConnectionGuideCard's long addresses", () => {
  const DIAGNOSE: string =
    "curl -fsSL https://oneuptime.com/install/proxmox-agent/troubleshoot.sh -o troubleshoot.sh && bash troubleshoot.sh";

  test("break after a slash of their path, the command unchanged", () => {
    render(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt={NOW}
        guide={{
          ...GUIDE,
          troubleshootingSteps: [
            {
              title: "Run the diagnostic script",
              description: "It checks the whole chain.",
              code: DIAGNOSE,
            },
          ],
        }}
        documentationRoute={DOCS}
      />,
    );

    const code: HTMLElement = screen.getByText(DIAGNOSE);
    expect(code.tagName).toBe("CODE");
    expect(code.textContent).toBe(DIAGNOSE);
    expect(code.querySelectorAll("wbr")).toHaveLength(3);
    expect(
      Array.from(code.childNodes)
        .filter((node: ChildNode): boolean => {
          return node.nodeType === Node.TEXT_NODE;
        })
        .map((node: ChildNode): string => {
          return node.textContent || "";
        }),
    ).toEqual([
      "curl -fsSL https://oneuptime.com/",
      "install/",
      "proxmox-agent/",
      "troubleshoot.sh -o troubleshoot.sh && bash troubleshoot.sh",
    ]);
  });
});

describe("ResourceConnectionGuideCard while connected", () => {
  test.each([
    ["connected", NOW],
    ["connected", undefined],
    ["active", NOW],
    ["Connected", NOW],
  ])(
    "status %p draws nothing at all",
    (status: string, lastSeenAt: Date | undefined) => {
      const { container } = render(
        <ResourceConnectionGuideCard
          status={status}
          lastSeenAt={lastSeenAt}
          guide={GUIDE}
          documentationRoute={DOCS}
        />,
      );

      expect(card()).toBeNull();
      expect(container).toBeEmptyDOMElement();
    },
  );
});

describe("ResourceConnectionGuideCard for a resource nothing has reported for", () => {
  function renderNeverConnected(
    status: string | undefined = "disconnected",
  ): void {
    render(
      <ResourceConnectionGuideCard
        status={status}
        lastSeenAt={undefined}
        guide={GUIDE}
        documentationRoute={DOCS}
      />,
    );
  }

  test("says to connect it, and why it reads Disconnected", () => {
    renderNeverConnected();

    expect(card()).toHaveAttribute("data-state", "never-connected");
    expect(
      screen.getByRole("heading", { name: "Connect this widget" }),
    ).toBeInTheDocument();
    expect(card()).toHaveTextContent(
      "No data has arrived from this widget yet, which is why it shows as Disconnected.",
    );
    expect(card()).toHaveTextContent("Set up the OneUptime Widget Agent");
  });

  test("shows the setup steps, numbered, in order", () => {
    renderNeverConnected();

    expect(stepTitles()).toEqual([
      "First setup step",
      "Second setup step",
      "Third setup step",
    ]);

    const steps: Array<HTMLElement> = screen.getAllByTestId(
      "resource-connection-guide-step",
    );

    expect(
      steps.map((step: HTMLElement) => {
        return step.tagName;
      }),
    ).toEqual(["LI", "LI", "LI"]);
    expect(steps[0]!.parentElement?.tagName).toBe("OL");
    expect(steps[0]).toHaveTextContent("1First setup step");
    expect(steps[2]).toHaveTextContent("3Third setup step");
  });

  test("never shows the troubleshooting steps", () => {
    renderNeverConnected();

    expect(screen.queryByText("First check")).not.toBeInTheDocument();
    expect(screen.queryByText("widget-agent status")).not.toBeInTheDocument();
  });

  test("a step's command is shown in code with a copy button; a step without one has neither", () => {
    renderNeverConnected();

    const [first, second] = screen.getAllByTestId(
      "resource-connection-guide-step",
    );

    expect(
      within(second!).getByText("widget-agent install --name=w1").tagName,
    ).toBe("CODE");
    expect(
      within(second!).getByRole("button", { name: "Copy to clipboard" }),
    ).toBeInTheDocument();
    expect(first!.querySelector("code")).toBeNull();
    expect(within(first!).queryByRole("button")).toBeNull();
  });

  test("the copy button copies the command", async () => {
    const copy: SpyInstance<typeof Clipboard.copyToClipboard> = jest
      .spyOn(Clipboard, "copyToClipboard")
      .mockResolvedValue(true);

    renderNeverConnected();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy to clipboard" }),
      );
    });

    expect(copy).toHaveBeenCalledWith("widget-agent install --name=w1");
  });

  test("links to the resource's full setup guide", () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    renderNeverConnected();

    const link: HTMLElement = screen.getByRole("link", {
      name: "Open the setup guide",
    });

    expect(link).toHaveAttribute("href", DOCS.toString());

    fireEvent.click(link);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(DOCS.toString());
  });

  test("the card is a section named by its heading", () => {
    renderNeverConnected();

    expect(screen.getByRole("region", { name: "Connect this widget" })).toBe(
      card(),
    );
  });

  test("a missing status (not just 'disconnected') counts as never connected", () => {
    renderNeverConnected(undefined);

    expect(card()).toHaveAttribute("data-state", "never-connected");
  });

  test("an unparseable lastSeenAt is treated as never seen, not as 'Invalid date'", () => {
    render(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt="not-a-date"
        guide={GUIDE}
        documentationRoute={DOCS}
      />,
    );

    expect(card()).toHaveAttribute("data-state", "never-connected");
    expect(card()).not.toHaveTextContent(/invalid/i);
  });
});

describe("ResourceConnectionGuideCard for a resource that stopped reporting", () => {
  function renderStopped(lastSeenAt: Date | string): void {
    render(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt={lastSeenAt}
        guide={GUIDE}
        documentationRoute={DOCS}
      />,
    );
  }

  test("says it stopped, and when it was last heard from", () => {
    renderStopped(new Date("2026-09-30T09:00:00.000Z"));

    expect(card()).toHaveAttribute("data-state", "disconnected");
    expect(
      screen.getByRole("heading", { name: "This widget stopped sending data" }),
    ).toBeInTheDocument();
    expect(card()).toHaveTextContent(
      "OneUptime last heard from this widget 3 hours ago.",
    );
    expect(card()).toHaveTextContent(
      "The OneUptime Widget Agent is no longer reporting",
    );
  });

  test("an ISO-string lastSeenAt reads the same", () => {
    renderStopped("2026-09-28T12:00:00.000Z");

    expect(card()).toHaveTextContent(
      "OneUptime last heard from this widget 2 days ago.",
    );
  });

  test("shows the troubleshooting steps instead of the setup steps", () => {
    renderStopped(new Date("2026-09-30T11:00:00.000Z"));

    expect(stepTitles()).toEqual([
      "First check",
      "Second check",
      "Third check",
    ]);
    expect(screen.queryByText("First setup step")).not.toBeInTheDocument();
    expect(screen.getByText("widget-agent status").tagName).toBe("CODE");
  });

  test("still links to the full setup guide", () => {
    renderStopped(new Date("2026-09-30T11:00:00.000Z"));

    expect(
      screen.getByRole("link", { name: "Open the setup guide" }),
    ).toHaveAttribute("href", DOCS.toString());
  });

  test("is told apart from the setup card by its tone as well as its words", () => {
    renderStopped(new Date("2026-09-30T11:00:00.000Z"));
    const stoppedClasses: string = card()!.className;
    cleanup();

    render(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt={null}
        guide={GUIDE}
        documentationRoute={DOCS}
      />,
    );
    const setupClasses: string = card()!.className;

    expect(stoppedClasses).toContain("border-amber-200");
    expect(setupClasses).toContain("border-indigo-200");
  });
});

/*
 * Issue #6191: a resource that sends data only while people use it (a RUM
 * application) is idle, not broken, when nothing has arrived for a while.
 * Its guide's idleCopy makes the card say so - in grey, with when data last
 * arrived - and fold its checks away behind one line; before its first data
 * it asks for the setup without calling the resource "Disconnected".
 */
describe("ResourceConnectionGuideCard for a resource that is idle when unused", () => {
  const IDLE_GUIDE: ResourceConnectionGuide = {
    ...GUIDE,
    idleCopy: {
      title: "Nobody used this widget lately",
      description:
        "OneUptime last heard from this widget {{lastHeard}}. That is normal.",
      checksLabel: "What to check if it is in use",
      waitingDescription: "No data from this widget yet. Set it up.",
    },
  };

  function renderIdle(
    guide: ResourceConnectionGuide = IDLE_GUIDE,
  ): HTMLElement {
    render(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt={new Date("2026-09-30T09:00:00.000Z")}
        guide={guide}
        documentationRoute={DOCS}
      />,
    );
    return card() as HTMLElement;
  }

  function toggle(): HTMLElement {
    return screen.getByTestId("resource-connection-guide-steps-toggle");
  }

  function stepsList(): HTMLElement {
    return document.getElementById(
      toggle().getAttribute("aria-controls") as string,
    ) as HTMLElement;
  }

  test("says it is idle, in grey, with when data last arrived", () => {
    const element: HTMLElement = renderIdle();

    expect(element).toHaveAttribute("data-state", "disconnected");
    expect(element).toHaveAttribute("data-variant", "idle");
    expect(
      screen.getByRole("heading", { name: "Nobody used this widget lately" }),
    ).toBeInTheDocument();
    expect(element).toHaveTextContent(
      "OneUptime last heard from this widget 3 hours ago. That is normal.",
    );
    expect(element.className).toContain("border-gray-200");
    expect(element.className).not.toMatch(/amber|red/);
    // Not the agent's card.
    expect(element).not.toHaveTextContent(/stopped sending data/);
    expect(element).not.toHaveTextContent(/no longer reporting/);
  });

  test("an ISO-string lastSeenAt reads the same", () => {
    render(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt="2026-09-28T12:00:00.000Z"
        guide={IDLE_GUIDE}
        documentationRoute={DOCS}
      />,
    );

    expect(card()).toHaveTextContent(
      "OneUptime last heard from this widget 2 days ago.",
    );
  });

  test("folds its checks behind one button, which shows and hides them", () => {
    renderIdle();

    expect(toggle().tagName).toBe("BUTTON");
    expect(toggle()).toHaveAttribute("type", "button");
    expect(
      screen.getByRole("button", { name: "What to check if it is in use" }),
    ).toBe(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(stepsList().tagName).toBe("OL");
    expect(stepsList()).toHaveAttribute("hidden");
    expect(stepsList()).toHaveClass("hidden");
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);

    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(stepsList()).not.toHaveAttribute("hidden");
    expect(stepsList()).toHaveClass("grid");
    expect(stepTitles()).toEqual([
      "First check",
      "Second check",
      "Third check",
    ]);
    // The checks, never the setup steps.
    expect(screen.queryByText("First setup step")).not.toBeInTheDocument();
    expect(screen.getByText("widget-agent status").tagName).toBe("CODE");

    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(stepsList()).toHaveAttribute("hidden");
  });

  test("the header is ruled off from the checks only while they show", () => {
    const element: HTMLElement = renderIdle();
    const header: HTMLElement = element.firstElementChild as HTMLElement;

    expect(header.className).not.toContain("border-b");

    fireEvent.click(toggle());

    expect(header.className).toContain("border-b");
  });

  test("its link to the setup guide is the quieter, outlined button", () => {
    renderIdle();

    const link: HTMLElement = screen.getByRole("link", {
      name: "Open the setup guide",
    });

    expect(link).toHaveAttribute("href", DOCS.toString());
    expect(link).toHaveClass("bg-white");
    expect(link).not.toHaveClass("bg-indigo-600");
  });

  test("an idle guide with no checks draws no fold and no list", () => {
    const element: HTMLElement = renderIdle({
      ...IDLE_GUIDE,
      troubleshootingSteps: [],
    });

    expect(
      screen.queryByTestId("resource-connection-guide-steps-toggle"),
    ).toBeNull();
    expect(element.querySelector("ol")).toBeNull();
  });

  test("before its first data it asks for the setup in its own words, never 'Disconnected'", () => {
    render(
      <ResourceConnectionGuideCard
        status={undefined}
        lastSeenAt={undefined}
        guide={IDLE_GUIDE}
        documentationRoute={DOCS}
      />,
    );

    expect(card()).toHaveAttribute("data-state", "never-connected");
    expect(card()).toHaveAttribute("data-variant", "setup");
    expect(
      screen.getByRole("heading", { name: "Connect this widget" }),
    ).toBeInTheDocument();
    expect(card()).toHaveTextContent(
      "No data from this widget yet. Set it up.",
    );
    expect(card()).not.toHaveTextContent(/disconnected/i);
    // What to do now is not folded away.
    expect(
      screen.queryByTestId("resource-connection-guide-steps-toggle"),
    ).toBeNull();
    expect(stepTitles()).toEqual([
      "First setup step",
      "Second setup step",
      "Third setup step",
    ]);
    expect(
      screen.getByRole("link", { name: "Open the setup guide" }),
    ).toHaveClass("bg-indigo-600");
  });

  test("draws nothing at all once data arrives", () => {
    const { container } = render(
      <ResourceConnectionGuideCard
        status="connected"
        lastSeenAt={NOW}
        guide={IDLE_GUIDE}
        documentationRoute={DOCS}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("two idle cards on one page each fold their own checks", () => {
    render(
      <div>
        <ResourceConnectionGuideCard
          status="disconnected"
          lastSeenAt={NOW}
          guide={IDLE_GUIDE}
          documentationRoute={DOCS}
        />
        <ResourceConnectionGuideCard
          status="disconnected"
          lastSeenAt={NOW}
          guide={IDLE_GUIDE}
          documentationRoute={DOCS}
        />
      </div>,
    );

    const toggles: Array<HTMLElement> = screen.getAllByTestId(
      "resource-connection-guide-steps-toggle",
    );
    const controlled: Array<string> = toggles.map((button: HTMLElement) => {
      return button.getAttribute("aria-controls") || "";
    });

    expect(new Set(controlled).size).toBe(2);

    fireEvent.click(toggles[0]!);

    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(controlled[1]!)).toHaveAttribute("hidden");
  });
});

/*
 * And a resource whose agent should always report keeps the card it had: an
 * amber "stopped sending data", its checks in full view, the setup guide as
 * the main button.
 */
describe("ResourceConnectionGuideCard for an always-on agent that stopped", () => {
  test("keeps its checks in view and its primary link, with no fold", () => {
    render(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt={NOW}
        guide={GUIDE}
        documentationRoute={DOCS}
      />,
    );

    expect(card()).toHaveAttribute("data-variant", "stopped");
    expect(
      screen.queryByTestId("resource-connection-guide-steps-toggle"),
    ).toBeNull();
    expect(card()!.querySelector("ol")).not.toHaveAttribute("hidden");
    expect(stepTitles()).toEqual([
      "First check",
      "Second check",
      "Third check",
    ]);
    expect(
      screen.getByRole("link", { name: "Open the setup guide" }),
    ).toHaveClass("bg-indigo-600");
  });
});

describe("ResourceConnectionGuideCard on a page with more than one", () => {
  test("each card is named by its own heading", () => {
    render(
      <div>
        <ResourceConnectionGuideCard
          status="disconnected"
          lastSeenAt={null}
          guide={GUIDE}
          documentationRoute={DOCS}
        />
        <ResourceConnectionGuideCard
          status="disconnected"
          lastSeenAt={NOW}
          guide={GUIDE}
          documentationRoute={DOCS}
        />
      </div>,
    );

    const cards: Array<HTMLElement> = screen.getAllByTestId(
      "resource-connection-guide",
    );
    const labelIds: Array<string> = cards.map((section: HTMLElement) => {
      return section.getAttribute("aria-labelledby") || "";
    });

    expect(new Set(labelIds).size).toBe(2);
    expect(screen.getByRole("region", { name: "Connect this widget" })).toBe(
      cards[0],
    );
    expect(
      screen.getByRole("region", { name: "This widget stopped sending data" }),
    ).toBe(cards[1]);
  });
});

describe("ResourceConnectionGuideCard updates with the resource", () => {
  test("disappears once the resource connects, and comes back if it drops", () => {
    const { rerender } = render(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt={null}
        guide={GUIDE}
        documentationRoute={DOCS}
      />,
    );

    expect(card()).toHaveAttribute("data-state", "never-connected");

    rerender(
      <ResourceConnectionGuideCard
        status="connected"
        lastSeenAt={NOW}
        guide={GUIDE}
        documentationRoute={DOCS}
      />,
    );

    expect(card()).toBeNull();

    rerender(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt={NOW}
        guide={GUIDE}
        documentationRoute={DOCS}
      />,
    );

    expect(card()).toHaveAttribute("data-state", "disconnected");
  });
});

describe("ResourceConnectionGuideCard with the Kubernetes guide", () => {
  test("a new cluster is told to install the agent with its own cluster name", () => {
    render(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt={undefined}
        guide={getKubernetesClusterConnectionGuide("prod-us-east-1")}
        documentationRoute={DOCS}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Connect this cluster" }),
    ).toBeInTheDocument();
    expect(card()).toHaveTextContent("OneUptime Kubernetes Agent");
    expect(
      screen.getByText('--set clusterName="prod-us-east-1"'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("kubectl get pods -n oneuptime-agent"),
    ).toBeInTheDocument();
  });

  test("a cluster that stopped reporting is told how to check on the agent", () => {
    render(
      <ResourceConnectionGuideCard
        status="disconnected"
        lastSeenAt={new Date("2026-09-30T11:30:00.000Z")}
        guide={getKubernetesClusterConnectionGuide("prod-us-east-1")}
        documentationRoute={DOCS}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "This cluster stopped sending data",
      }),
    ).toBeInTheDocument();
    expect(card()).toHaveTextContent("30 minutes ago");
    expect(
      screen.getByText(
        "kubectl logs -n oneuptime-agent deploy/kubernetes-agent --tail=50",
      ),
    ).toBeInTheDocument();
  });
});

describe("ResourceConnectionGuideCard for a host OneUptime installed the collector on", () => {
  function renderManagedHost(registeredMinutesAgo: number): void {
    render(
      <ResourceConnectionGuideCard
        status={undefined}
        lastSeenAt={undefined}
        guide={getHostConnectionGuide("web-09", {
          isManaged: true,
          osType: "linux",
          registeredAt: new Date(
            NOW.getTime() - registeredMinutesAgo * 60 * 1000,
          ),
        })}
        documentationRoute={DOCS}
      />,
    );
  }

  test("just installed: it says the host is starting, and lists no checks", () => {
    renderManagedHost(1);

    expect(
      screen.getByRole("heading", { name: "This host is starting" }),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByTestId("resource-connection-guide-step"),
    ).toHaveLength(0);
    expect(card()!.querySelector("ol")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open the Collector page" }),
    ).toBeInTheDocument();
  });

  test("its first data late: it says so, with the checks", () => {
    renderManagedHost(30);

    expect(
      screen.getByRole("heading", { name: "No data from this host yet" }),
    ).toBeInTheDocument();
    expect(stepTitles()).toEqual([
      "Check the collector's config",
      "Check the collector's service",
      "Read the collector's log",
    ]);
    expect(
      screen.getByText("sudo systemctl status oneuptime-collector"),
    ).toBeInTheDocument();
  });

  test("a command wraps at a space, not in the middle of a word", () => {
    renderManagedHost(30);

    const code: HTMLElement = screen.getByText(
      "sudo journalctl -u oneuptime-collector -n 50",
    );
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("break-all");
    expect(code.className).toContain("[overflow-wrap:anywhere]");
  });
});

/*
 * Issue #7439: a Proxmox cluster whose agent runs but cannot read the
 * Proxmox VE API. The agent's own clock (agentLastSeenAt) is recent while
 * the cluster is not read, so the card says the API needs looking at - not
 * "stopped sending data", which sent people to a container that was fine -
 * with the checks of the API: the diagnostic script, the token, the nodes.
 */
describe("ResourceConnectionGuideCard for a Proxmox cluster whose agent cannot read the API", () => {
  const PROXMOX_GUIDE: ResourceConnectionGuide =
    getProxmoxClusterConnectionGuide("pve-prod", "https://oneuptime.example");

  function renderProxmox(props: {
    status?: string;
    lastSeenAt: Date | string | null;
    agentLastSeenAt: Date | string | null;
    guide?: ResourceConnectionGuide;
  }): void {
    render(
      <ResourceConnectionGuideCard
        status={props.status ?? "disconnected"}
        lastSeenAt={props.lastSeenAt}
        agentLastSeenAt={props.agentLastSeenAt}
        guide={props.guide ?? PROXMOX_GUIDE}
        documentationRoute={DOCS}
      />,
    );
  }

  test("read before and not now, the agent heard: it says the agent can't read the API, and since when", () => {
    renderProxmox({
      lastSeenAt: new Date("2026-09-30T11:35:00.000Z"),
      agentLastSeenAt: new Date("2026-09-30T11:58:00.000Z"),
    });

    expect(card()).toHaveAttribute("data-state", "reading-stopped");
    expect(card()).toHaveAttribute("data-variant", "unreadable");
    expect(
      screen.getByRole("heading", {
        name: "The agent can't read the Proxmox VE API",
      }),
    ).toBeInTheDocument();
    expect(card()).toHaveTextContent(
      "The OneUptime Proxmox Agent is running, but it last read the cluster from the Proxmox VE API 25 minutes ago.",
    );
    expect(card()).toHaveTextContent(
      "The nodes, guests and storage here are as it read them then.",
    );
    expect(card()).not.toHaveTextContent("stopped sending data");
  });

  test("it lists the checks of the API, with the diagnostic script and the failover container's logs", () => {
    renderProxmox({
      lastSeenAt: new Date("2026-09-30T11:35:00.000Z"),
      agentLastSeenAt: new Date("2026-09-30T11:58:00.000Z"),
    });

    expect(stepTitles()).toEqual([
      "Run the diagnostic script",
      "Check the API token",
      "Check that a node answers",
    ]);
    expect(card()).toHaveTextContent(
      "curl -fsSL https://oneuptime.example/install/proxmox-agent/troubleshoot.sh -o troubleshoot.sh && bash troubleshoot.sh",
    );
    expect(
      screen.getByText("docker logs oneuptime-pve-api-failover --tail 20")
        .tagName,
    ).toBe("CODE");
    // Not the checks of an agent that stopped.
    expect(
      screen.queryByText("Check the agent is running"),
    ).not.toBeInTheDocument();
  });

  test("it is amber, like a cluster that stopped, and still links to the setup guide", () => {
    renderProxmox({
      lastSeenAt: new Date("2026-09-30T11:35:00.000Z"),
      agentLastSeenAt: new Date("2026-09-30T11:58:00.000Z"),
    });

    expect(card()!.className).toContain("border-amber-200");
    expect(
      screen.getByRole("link", { name: "Open the setup guide" }),
    ).toHaveAttribute("href", DOCS.toString());
  });

  test("never read, the agent heard: it says no read has come yet, in the calmer indigo, with the same checks", () => {
    renderProxmox({
      lastSeenAt: null,
      agentLastSeenAt: new Date("2026-09-30T11:59:30.000Z"),
    });

    expect(card()).toHaveAttribute("data-state", "not-read-yet");
    expect(card()).toHaveAttribute("data-variant", "waiting-for-read");
    expect(
      screen.getByRole("heading", {
        name: "The agent has not read the cluster yet",
      }),
    ).toBeInTheDocument();
    expect(card()).toHaveTextContent(
      "The OneUptime Proxmox Agent is running and reads the cluster from the Proxmox VE API every 30 seconds, but no read has arrived yet.",
    );
    expect(card()!.className).toContain("border-indigo-200");
    expect(stepTitles()).toEqual([
      "Run the diagnostic script",
      "Check the API token",
      "Check that a node answers",
    ]);
    // Not the install steps: the agent is installed.
    expect(screen.queryByText("Install the agent")).not.toBeInTheDocument();
  });

  test("an agent last heard over 15 minutes ago has stopped: the card says so, with the agent's checks", () => {
    renderProxmox({
      lastSeenAt: new Date("2026-09-30T11:00:00.000Z"),
      agentLastSeenAt: new Date("2026-09-30T11:40:00.000Z"),
    });

    expect(card()).toHaveAttribute("data-state", "disconnected");
    expect(card()).toHaveAttribute("data-variant", "stopped");
    expect(
      screen.getByRole("heading", {
        name: "This cluster stopped sending data",
      }),
    ).toBeInTheDocument();
    expect(stepTitles()[0]).toBe("Check the agent is running");
  });

  test("an agent that never reported reads as never connected: install it", () => {
    renderProxmox({ lastSeenAt: null, agentLastSeenAt: null });

    expect(card()).toHaveAttribute("data-state", "never-connected");
    expect(card()).toHaveAttribute("data-variant", "setup");
  });

  test("a cluster that is read draws nothing, however its agent's clock reads", () => {
    renderProxmox({
      status: "connected",
      lastSeenAt: new Date("2026-09-30T11:59:00.000Z"),
      agentLastSeenAt: new Date("2026-09-30T11:57:00.000Z"),
    });

    expect(card()).toBeNull();
  });

  test("a guide with nothing to say about an unreadable resource reads it as before", () => {
    renderProxmox({
      lastSeenAt: new Date("2026-09-30T11:35:00.000Z"),
      agentLastSeenAt: new Date("2026-09-30T11:58:00.000Z"),
      guide: GUIDE,
    });
    expect(card()).toHaveAttribute("data-state", "disconnected");
    expect(card()).toHaveAttribute("data-variant", "stopped");
    cleanup();

    renderProxmox({
      lastSeenAt: null,
      agentLastSeenAt: new Date("2026-09-30T11:58:00.000Z"),
      guide: GUIDE,
    });
    expect(card()).toHaveAttribute("data-state", "never-connected");
    expect(card()).toHaveAttribute("data-variant", "setup");
  });
});
