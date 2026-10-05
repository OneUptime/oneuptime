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
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { findNestedControls } from "../../Helpers/NestedControls";

/*
 * The agent version every resource shows, and the sign beside it when a
 * newer agent is available (Components/AgentVersion).
 *
 * "If the agent version is outdated, can you please show the sign beside the
 * agent version and also, when I click on it, show how to upgrade the agent?
 * Please do this for all the resources like Hosts / docker / etc etc."
 *
 * Only the server's version (APP_VERSION in env.js) is stubbed; the version
 * rules, the upgrade guides and the dialog are the real ones.
 */

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    AppVersion: "14.0.14",
  };
});

import * as UIConfig from "../../../UI/Config";

/*
 * The component reads AppVersion off the (mocked) module when it renders, so
 * a test sets the server's version by writing it there. A getter in the mock
 * would not do: jest copies the factory's properties as plain values.
 */
function setServerVersion(version: string): void {
  (UIConfig as unknown as { AppVersion: string }).AppVersion = version;
}

import AgentVersion from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import { getKubernetesAgentChartUpgradeCommand } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import { getDockerAgentUpgradeCommand } from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import { getPodmanAgentUpgradeCommand } from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import {
  DOCKER_SWARM_AGENT_COMPOSE_UPGRADE_COMMAND,
  getDockerSwarmAgentInstallScriptCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import {
  DATABASE_AGENT_RECREATE_COMMAND,
  getDatabaseAgentDownloadCommand,
  getDatabaseAgentUpgradeCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import { getRunnerUpgradeCommand } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerImage";
import {
  getProxmoxAgentDownloadCommand,
  getProxmoxAgentRecreateCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  getCephAgentDownloadCommand,
  getCephAgentRecreateCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import {
  VMWARE_AGENT_RECREATE_COMMAND,
  getVMwareAgentDownloadCommand,
  getVMwareAgentUpgradeCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import { getHostCollectorUpgradeCommand } from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import Route from "../../../Types/API/Route";

const SETUP_GUIDE: Route = new Route("/dashboard/p1/docker/h1/documentation");

const OUTDATED_NAME: string =
  "Agent 14.0.10 is outdated. A newer agent is available: 14.0.14. Show how to upgrade.";

beforeEach(() => {
  setServerVersion("14.0.14");
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// The code a dialog shows, one block per command, as the reader copies it.
function codeBlocksIn(element: HTMLElement): Array<string> {
  return Array.from(element.querySelectorAll("pre code")).map(
    (code: Element): string => {
      return (code.textContent || "").trim();
    },
  );
}

async function openDialog(name: string | RegExp): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

describe("an up-to-date or unknown version looks exactly as before", () => {
  test("the server's own version is a bare text node: no button, no sign", () => {
    const { container }: RenderResult = render(
      <AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.14" />,
    );

    expect(container.innerHTML).toBe("14.0.14");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("a newer agent than the server is not outdated", () => {
    const { container }: RenderResult = render(
      <AgentVersion kind={AgentKind.DockerAgent} version="14.0.20" />,
    );
    expect(container.innerHTML).toBe("14.0.20");
  });

  test("a server that does not know its own version shows every version plainly", () => {
    setServerVersion("");
    const { container }: RenderResult = render(
      <AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />,
    );
    expect(container.innerHTML).toBe("14.0.10");
  });

  test("a server on a release candidate shows every version plainly", () => {
    setServerVersion("14.1.0-rc.1");
    const { container }: RenderResult = render(
      <AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />,
    );
    expect(container.innerHTML).toBe("14.0.10");
  });

  test("an unparsable version is shown as it is, never called outdated", () => {
    const { container }: RenderResult = render(
      <AgentVersion kind={AgentKind.DockerAgent} version="dev-build" />,
    );
    expect(container.innerHTML).toBe("dev-build");
  });

  test("the Runner's 1.0.0 placeholder is not called outdated", () => {
    const { container }: RenderResult = render(
      <AgentVersion kind={AgentKind.Runner} version="1.0.0" />,
    );
    expect(container.innerHTML).toBe("1.0.0");
  });

  test.each([
    [AgentKind.IoTExporter],
    [AgentKind.ServerlessSdk],
    [AgentKind.RumSdk],
  ])(
    "%s: an agent OneUptime does not release never shows a sign, however old",
    (kind: AgentKind) => {
      const { container }: RenderResult = render(
        <AgentVersion kind={kind} version="0.1.0" />,
      );
      expect(container.innerHTML).toBe("0.1.0");
    },
  );

  test("surrounding whitespace is trimmed", () => {
    const { container }: RenderResult = render(
      <AgentVersion kind={AgentKind.KubernetesAgent} version=" 14.0.14 " />,
    );
    expect(container.innerHTML).toBe("14.0.14");
  });
});

describe("no version", () => {
  test("draws the details card's placeholder", () => {
    render(
      <AgentVersion
        kind={AgentKind.KubernetesAgent}
        version={undefined}
        placeholder="Not reported"
      />,
    );
    expect(screen.getByTestId("placeholder-text")).toHaveTextContent(
      "Not reported",
    );
  });

  test.each([[undefined], [null], [""], ["   "]])(
    "draws nothing without a placeholder (%p)",
    (version: string | null | undefined) => {
      const { container }: RenderResult = render(
        <AgentVersion kind={AgentKind.KubernetesAgent} version={version} />,
      );
      expect(container.innerHTML).toBe("");
    },
  );
});

describe("an outdated version gets a sign that opens how to upgrade", () => {
  test("the version and the sign are one button that says what it does", () => {
    render(<AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />);

    const trigger: HTMLElement = screen.getByRole("button", {
      name: OUTDATED_NAME,
    });
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("data-agent-kind", "kubernetes-agent");
    expect(trigger).toHaveTextContent("14.0.10");
    // The sign: the warning icon beside the version.
    expect(trigger.querySelector("svg")).not.toBeNull();
    // The version keeps the font of what it sits in (a monospace row).
    expect(trigger.className).toContain("[font-family:inherit]");
  });

  test("hovering says a newer agent is available, and which", async () => {
    jest.useFakeTimers();
    render(<AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />);

    expect(
      screen.queryByText("A newer agent is available: 14.0.14"),
    ).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: OUTDATED_NAME }));
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(
      screen.getByText("A newer agent is available: 14.0.14"),
    ).toBeInTheDocument();
  });

  test("keyboard focus says it too", async () => {
    jest.useFakeTimers();
    render(<AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />);

    act(() => {
      screen.getByRole("button", { name: OUTDATED_NAME }).focus();
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(
      screen.getByText("A newer agent is available: 14.0.14"),
    ).toBeInTheDocument();
  });

  test("nothing is a control inside another control", () => {
    render(<AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />);
    expect(findNestedControls(document.body)).toEqual([]);
  });

  test("the dialog opens only when asked for", () => {
    render(<AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the upgrade dialog", () => {
  test("Kubernetes: names the agent and both versions, and shows the chart upgrade to copy", async () => {
    render(<AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />);

    const dialog: HTMLElement = await openDialog(OUTDATED_NAME);

    expect(
      within(dialog).getByRole("heading", {
        name: "Upgrade the OneUptime Kubernetes Agent",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "This agent runs version 14.0.10. Version 14.0.14 is available.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Upgrade the Helm release")).toBeVisible();
    expect(codeBlocksIn(dialog)).toEqual([
      getKubernetesAgentChartUpgradeCommand(),
    ]);
    // One way to install it, so no tabs.
    expect(within(dialog).queryByRole("tab")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Copy to clipboard" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "The new version shows here a few minutes after the upgrade.",
      ),
    ).toBeInTheDocument();
  });

  test("Close closes it and gives the focus back to the version", async () => {
    render(<AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />);

    const trigger: HTMLElement = screen.getByRole("button", {
      name: OUTDATED_NAME,
    });
    trigger.focus();
    const dialog: HTMLElement = await openDialog(OUTDATED_NAME);

    // Nothing to fill in, so the footer's one button is Close.
    const close: HTMLElement = within(dialog).getByTestId(
      "modal-footer-close-button",
    );
    expect(close).toHaveTextContent("Close");
    expect(
      within(dialog).queryByTestId("modal-footer-submit-button"),
    ).not.toBeInTheDocument();
    fireEvent.click(close);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test("Escape closes it", async () => {
    render(<AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />);
    await openDialog(OUTDATED_NAME);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("it can be opened again after closing", async () => {
    render(<AgentVersion kind={AgentKind.KubernetesAgent} version="14.0.10" />);
    let dialog: HTMLElement = await openDialog(OUTDATED_NAME);
    fireEvent.click(within(dialog).getByTestId("close-button"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    dialog = await openDialog(OUTDATED_NAME);
    expect(dialog).toBeInTheDocument();
  });

  test("its content has no control inside another control", async () => {
    render(
      <AgentVersion
        kind={AgentKind.DockerAgent}
        version="14.0.10"
        setupGuideRoute={SETUP_GUIDE}
      />,
    );
    await openDialog(OUTDATED_NAME);
    expect(findNestedControls(document.body)).toEqual([]);
  });

  test("Docker: a tab per install method, the CLI first with the guide for the run command", async () => {
    render(
      <AgentVersion
        kind={AgentKind.DockerAgent}
        version="14.0.10"
        setupGuideRoute={SETUP_GUIDE}
      />,
    );
    const dialog: HTMLElement = await openDialog(OUTDATED_NAME);

    expect(
      within(dialog).getByRole("heading", {
        name: "Upgrade the OneUptime Docker Agent",
      }),
    ).toBeInTheDocument();

    const tabs: Array<HTMLElement> = within(dialog).getAllByRole("tab");
    expect(
      tabs.map((tab: HTMLElement): string => {
        return tab.textContent || "";
      }),
    ).toEqual(["Docker CLI", "Docker Compose"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    expect(codeBlocksIn(dialog)).toEqual([
      getDockerAgentUpgradeCommand("docker-cli"),
    ]);
    expect(within(dialog).getByText("Start the agent again")).toBeVisible();
    const guideLink: HTMLElement = within(dialog).getByRole("link", {
      name: "Open the setup guide",
    });
    expect(guideLink).toHaveAttribute("href", SETUP_GUIDE.toString());

    fireEvent.click(tabs[1]!);

    expect(codeBlocksIn(dialog)).toEqual([
      getDockerAgentUpgradeCommand("docker-compose"),
    ]);
    expect(
      within(dialog).queryByRole("link", { name: "Open the setup guide" }),
    ).not.toBeInTheDocument();
  });

  test("Docker without a setup guide route still says where the run command is, with no dead link", async () => {
    render(<AgentVersion kind={AgentKind.DockerAgent} version="14.0.10" />);
    const dialog: HTMLElement = await openDialog(OUTDATED_NAME);

    expect(
      within(dialog).getByText(
        "Run the command from the setup guide again. It is filled in with this host's name and the ingestion key you pick there.",
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
  });

  test("Podman: the Podman commands, in Podman's tabs", async () => {
    render(
      <AgentVersion
        kind={AgentKind.PodmanAgent}
        version="14.0.10"
        setupGuideRoute={SETUP_GUIDE}
      />,
    );
    const dialog: HTMLElement = await openDialog(OUTDATED_NAME);

    expect(
      within(dialog).getByRole("heading", {
        name: "Upgrade the OneUptime Podman Agent",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
    ).toEqual(["Podman CLI", "Podman Compose"]);
    expect(codeBlocksIn(dialog)).toEqual([
      getPodmanAgentUpgradeCommand("podman-cli"),
    ]);

    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Podman Compose" }),
    );
    expect(codeBlocksIn(dialog)).toEqual([
      getPodmanAgentUpgradeCommand("podman-compose"),
    ]);
  });

  test("Docker Swarm: behind the collector this release pins, whatever the server knows of itself", async () => {
    setServerVersion("");
    render(
      <AgentVersion kind={AgentKind.DockerSwarmAgent} version="0.154.0" />,
    );
    const dialog: HTMLElement = await openDialog(
      "Agent 0.154.0 is outdated. A newer agent is available: 0.161.0. Show how to upgrade.",
    );

    expect(
      within(dialog).getByRole("heading", {
        name: "Upgrade the OneUptime Docker Swarm Agent",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "This agent runs version 0.154.0. Version 0.161.0 is available.",
      ),
    ).toBeInTheDocument();
    expect(codeBlocksIn(dialog)).toEqual([
      getDockerSwarmAgentInstallScriptCommand(),
    ]);

    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Docker Compose" }),
    );
    const compose: Array<string> = codeBlocksIn(dialog);
    expect(compose).toHaveLength(2);
    expect(compose[1]).toBe(DOCKER_SWARM_AGENT_COMPOSE_UPGRADE_COMMAND);
  });

  test("Database: the install script with a note for another folder, the engine's Compose files, and the Deployment in Kubernetes", async () => {
    const route: Route = new Route("/dashboard/p1/databases/d1/documentation");
    render(
      <AgentVersion
        kind={AgentKind.DatabaseAgent}
        version="0.154.0"
        setupGuideRoute={route}
        upgradeGuideContext={{
          databaseEngine: "postgresql",
          databaseRunsInKubernetes: true,
        }}
      />,
    );
    const dialog: HTMLElement = await openDialog(
      "Agent 0.154.0 is outdated. A newer agent is available: 0.161.0. Show how to upgrade.",
    );

    expect(
      within(dialog).getByRole("heading", {
        name: "Upgrade the OneUptime Database Agent",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
    ).toEqual(["Install script", "Docker Compose", "Kubernetes"]);

    expect(codeBlocksIn(dialog)).toEqual([getDatabaseAgentUpgradeCommand()]);
    expect(
      within(dialog).getByTestId("agent-upgrade-method-note"),
    ).toHaveTextContent(
      "Installed it outside /opt/oneuptime-database-agent? Run the script with INSTALL_DIR set to that folder: INSTALL_DIR=<folder> bash install.sh.",
    );

    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Docker Compose" }),
    );
    expect(codeBlocksIn(dialog)).toEqual([
      getDatabaseAgentDownloadCommand("postgresql"),
      DATABASE_AGENT_RECREATE_COMMAND,
    ]);

    fireEvent.click(within(dialog).getByRole("tab", { name: "Kubernetes" }));
    expect(codeBlocksIn(dialog)).toEqual([]);
    expect(
      within(dialog).getByRole("link", { name: "Open the setup guide" }),
    ).toHaveAttribute("href", route.toString());
  });

  test("Runner: called a Runner throughout, with its image's commands", async () => {
    jest.useFakeTimers();
    render(<AgentVersion kind={AgentKind.Runner} version="14.0.10" />);

    const name: string =
      "Runner 14.0.10 is outdated. A newer Runner is available: 14.0.14. Show how to upgrade.";
    fireEvent.mouseEnter(screen.getByRole("button", { name }));
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(
      screen.getByText("A newer Runner is available: 14.0.14"),
    ).toBeInTheDocument();
    jest.useRealTimers();

    const dialog: HTMLElement = await openDialog(name);
    expect(
      within(dialog).getByRole("heading", { name: "Upgrade the Runner" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "This Runner runs version 14.0.10. Version 14.0.14 is available.",
      ),
    ).toBeInTheDocument();
    expect(codeBlocksIn(dialog)).toEqual([getRunnerUpgradeCommand()]);
    expect(
      within(dialog).getByText(
        "Run the docker run command under Setup Instructions on this page. It starts the Runner on the new image with the same ID and key.",
      ),
    ).toBeVisible();
  });
});

describe("the hero chip", () => {
  const OLD_CHIP_CLASS: string =
    "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700";

  test("up to date, it is the same gray chip the heroes always drew", () => {
    render(
      <AgentVersion
        kind={AgentKind.DockerSwarmAgent}
        version="0.161.0"
        variant="chip"
      />,
    );

    const chip: HTMLElement = screen.getByTestId("agent-version-chip");
    expect(chip.tagName).toBe("SPAN");
    expect(chip.className).toBe(OLD_CHIP_CLASS);
    expect(within(chip).getByText("Agent 0.161.0")).toHaveClass("font-medium");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("an agent OneUptime does not release keeps the gray chip", () => {
    render(
      <AgentVersion
        kind={AgentKind.IoTExporter}
        version="0.1.0"
        variant="chip"
      />,
    );
    expect(screen.getByTestId("agent-version-chip").className).toBe(
      OLD_CHIP_CLASS,
    );
  });

  test("outdated, the chip turns amber with the sign and opens the dialog", async () => {
    render(
      <AgentVersion
        kind={AgentKind.DockerSwarmAgent}
        version="0.154.0"
        variant="chip"
      />,
    );

    const chip: HTMLElement = screen.getByRole("button", {
      name: "Agent 0.154.0 is outdated. A newer agent is available: 0.161.0. Show how to upgrade.",
    });
    expect(chip).toHaveTextContent("Agent 0.154.0");
    expect(chip.className).toContain("border-amber-200");
    expect(chip.className).toContain("bg-amber-50");
    expect(chip.querySelectorAll("svg")).toHaveLength(2);

    fireEvent.click(chip);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  test.each([[undefined], [""]])(
    "with no version there is no chip at all (%p), placeholder or not",
    (version: string | undefined) => {
      const { container }: RenderResult = render(
        <AgentVersion
          kind={AgentKind.ProxmoxAgent}
          version={version}
          variant="chip"
          placeholder="Not reported"
        />,
      );
      expect(container.innerHTML).toBe("");
    },
  );
});

/*
 * Hosts, Proxmox, Ceph and VMware: their agents now report the collector
 * release their files pin, so an older one gets the sign, compared with the
 * pin whatever the server's own version is, and the dialog shows that
 * agent's own upgrade, taken from its setup guide.
 */
describe("the agents that report the collector they pin", () => {
  const OUTDATED_COLLECTOR: string =
    "Agent 0.154.0 is outdated. A newer agent is available: 0.161.0. Show how to upgrade.";

  test.each([
    [AgentKind.HostCollector],
    [AgentKind.ProxmoxAgent],
    [AgentKind.CephAgent],
    [AgentKind.VMwareAgent],
  ])(
    "%s: an older collector shows the sign, compared with the pin even when the server knows no version",
    (kind: AgentKind) => {
      setServerVersion("");
      render(<AgentVersion kind={kind} version="0.154.0" />);

      const trigger: HTMLElement = screen.getByRole("button", {
        name: OUTDATED_COLLECTOR,
      });
      expect(trigger).toHaveAttribute("data-agent-kind", kind);
      expect(trigger).toHaveTextContent("0.154.0");
    },
  );

  test.each([
    [AgentKind.HostCollector],
    [AgentKind.ProxmoxAgent],
    [AgentKind.CephAgent],
    [AgentKind.VMwareAgent],
  ])(
    "%s: the pinned release, or a newer one, is drawn exactly as before",
    (kind: AgentKind) => {
      for (const version of ["0.161.0", "0.162.0"]) {
        const { container }: RenderResult = render(
          <AgentVersion kind={kind} version={version} />,
        );
        expect(container.innerHTML).toBe(version);
        cleanup();
      }
    },
  );

  test.each([
    [AgentKind.HostCollector],
    [AgentKind.ProxmoxAgent],
    [AgentKind.CephAgent],
    [AgentKind.VMwareAgent],
  ])(
    "%s: an install from before the pin reports nothing, which reads Not reported, never outdated",
    (kind: AgentKind) => {
      render(
        <AgentVersion
          kind={kind}
          version={undefined}
          placeholder="Not reported"
        />,
      );
      expect(screen.getByTestId("placeholder-text")).toHaveTextContent(
        "Not reported",
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  test.each([
    [
      AgentKind.ProxmoxAgent,
      "Upgrade the OneUptime Proxmox Agent",
      getProxmoxAgentDownloadCommand,
      getProxmoxAgentRecreateCommand,
    ],
    [
      AgentKind.CephAgent,
      "Upgrade the OneUptime Ceph Agent",
      getCephAgentDownloadCommand,
      getCephAgentRecreateCommand,
    ],
  ])(
    "%s: the files again and a recreate, in the install script's folder or the reader's own",
    async (
      kind: AgentKind,
      title: string,
      download: (method: "install-script" | "docker-compose") => string,
      recreate: (method: "install-script" | "docker-compose") => string,
    ) => {
      render(<AgentVersion kind={kind} version="0.154.0" />);
      const dialog: HTMLElement = await openDialog(OUTDATED_COLLECTOR);

      expect(
        within(dialog).getByRole("heading", { name: title }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          "This agent runs version 0.154.0. Version 0.161.0 is available.",
        ),
      ).toBeInTheDocument();
      expect(
        within(dialog)
          .getAllByRole("tab")
          .map((tab: HTMLElement): string => {
            return tab.textContent || "";
          }),
      ).toEqual(["Install script", "Docker Compose"]);

      expect(codeBlocksIn(dialog)).toEqual([
        download("install-script"),
        recreate("install-script"),
      ]);
      expect(
        within(dialog).getByText("Download the latest files"),
      ).toBeVisible();
      expect(
        within(dialog).getByText(
          "Pull the latest images and recreate the agent",
        ),
      ).toBeVisible();
      expect(
        within(dialog).getAllByRole("button", { name: "Copy to clipboard" }),
      ).toHaveLength(2);
      // Nothing to fill in from a guide.
      expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByRole("tab", { name: "Docker Compose" }),
      );
      expect(codeBlocksIn(dialog)).toEqual([
        download("docker-compose"),
        recreate("docker-compose"),
      ]);
    },
  );

  test("VMware: the hero chip turns amber and opens the install script again, or the files", async () => {
    render(
      <AgentVersion
        kind={AgentKind.VMwareAgent}
        version="0.154.0"
        variant="chip"
      />,
    );

    const chip: HTMLElement = screen.getByRole("button", {
      name: OUTDATED_COLLECTOR,
    });
    expect(chip).toHaveTextContent("Agent 0.154.0");
    expect(chip.className).toContain("bg-amber-50");

    fireEvent.click(chip);
    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Upgrade the OneUptime VMware Agent",
      }),
    ).toBeInTheDocument();
    expect(codeBlocksIn(dialog)).toEqual([getVMwareAgentUpgradeCommand()]);
    expect(
      within(dialog).getByText("Run the install script again"),
    ).toBeVisible();

    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Docker Compose" }),
    );
    expect(codeBlocksIn(dialog)).toEqual([
      getVMwareAgentDownloadCommand(),
      VMWARE_AGENT_RECREATE_COMMAND,
    ]);
  });

  test("Host on Linux: a tab per Linux install, the config from the setup guide, then the new release", async () => {
    const route: Route = new Route("/dashboard/p1/hosts/h1/documentation");
    render(
      <AgentVersion
        kind={AgentKind.HostCollector}
        version="0.154.0"
        setupGuideRoute={route}
        upgradeGuideContext={{ hostOsType: "linux" }}
      />,
    );
    const dialog: HTMLElement = await openDialog(OUTDATED_COLLECTOR);

    expect(
      within(dialog).getByRole("heading", {
        name: "Upgrade the OpenTelemetry Collector",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
    ).toEqual(["Docker", "Debian / Ubuntu", "RHEL / Fedora", "Linux Tarball"]);

    // Step 1: the config, which only the guide fills in with a key.
    expect(within(dialog).getByText("Save the new config")).toBeVisible();
    expect(
      within(dialog).getByRole("link", { name: "Open the setup guide" }),
    ).toHaveAttribute("href", route.toString());
    // Step 2: the new release, the guide's own command.
    expect(within(dialog).getByText("Install the new release")).toBeVisible();
    expect(codeBlocksIn(dialog)).toEqual([
      getHostCollectorUpgradeCommand("docker"),
    ]);

    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Debian / Ubuntu" }),
    );
    expect(codeBlocksIn(dialog)).toEqual([
      getHostCollectorUpgradeCommand("linux-deb"),
    ]);
    expect(findNestedControls(document.body)).toEqual([]);
  });

  test("Host on Windows: one way, so no tabs, and the PowerShell is shown as it is", async () => {
    render(
      <AgentVersion
        kind={AgentKind.HostCollector}
        version="0.154.0"
        setupGuideRoute={SETUP_GUIDE}
        upgradeGuideContext={{ hostOsType: "windows" }}
      />,
    );
    const dialog: HTMLElement = await openDialog(OUTDATED_COLLECTOR);

    expect(within(dialog).queryByRole("tab")).not.toBeInTheDocument();
    expect(codeBlocksIn(dialog)).toEqual([
      getHostCollectorUpgradeCommand("windows"),
    ]);
    const code: Element | null = dialog.querySelector("pre code");
    expect(code?.className).toContain("language-powershell");
    // Not highlighted as bash: plain text, every character as written.
    expect(code?.querySelector(".hljs-built_in")).toBeNull();
  });

  test("Host on a Mac: the macOS install alone", async () => {
    render(
      <AgentVersion
        kind={AgentKind.HostCollector}
        version="0.154.0"
        upgradeGuideContext={{ hostOsType: "darwin" }}
      />,
    );
    const dialog: HTMLElement = await openDialog(OUTDATED_COLLECTOR);
    expect(within(dialog).queryByRole("tab")).not.toBeInTheDocument();
    expect(codeBlocksIn(dialog)).toEqual([
      getHostCollectorUpgradeCommand("macos"),
    ]);
    // Without the guide's route the step still says where the config is.
    expect(
      within(dialog).getByText(
        "Copy config.yaml from the setup guide again, with the ingestion key you pick there: it reports the new version. Copy across any change you made to yours.",
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
  });

  test("Host with an unknown OS: every install method, Docker first", async () => {
    render(<AgentVersion kind={AgentKind.HostCollector} version="0.154.0" />);
    const dialog: HTMLElement = await openDialog(OUTDATED_COLLECTOR);
    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
    ).toEqual([
      "Docker",
      "Debian / Ubuntu",
      "RHEL / Fedora",
      "Linux Tarball",
      "macOS",
      "Windows",
    ]);
  });
});
