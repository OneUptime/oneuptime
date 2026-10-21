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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import CephDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/DocumentationCard";
import ProxmoxDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Proxmox/DocumentationCard";
import VMwareDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/DocumentationCard";
import { SETUP_GUIDE_API_KEY_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";

/*
 * The Ceph, Proxmox and VMware guides as they reach the screen: each card
 * is SetupGuideCard with its own picker, and its guide is rebuilt from the
 * picked option and the picked key. What is pinned here is the wiring the
 * pure guide tests cannot see — the question above the picker, that the
 * card hands the selected key's secret (not the placeholder) to the guide,
 * that a resource's own tab passes its name through, and that Proxmox's
 * native push points step 1 at the OTLP endpoint.
 *
 * The markdown viewer is a lazy boundary; it is rendered as plain text here
 * (as in SetupGuideCard.test.tsx) because these tests are about which
 * content is on screen, not how markdown is styled.
 */

interface MarkdownViewerProps {
  text: string;
}

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const SECRET: string = "secret-production";

const makeKey: () => TelemetryIngestionKey = (): TelemetryIngestionKey => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID("key-1");
  key.name = "Production Key";
  key.secretKey = new ObjectID(SECRET);
  key.keyType = TelemetryIngestionKeyType.Server;
  return key;
};

const mockKeys: (keys: Array<TelemetryIngestionKey>) => void = (
  keys: Array<TelemetryIngestionKey>,
): void => {
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: keys,
    count: keys.length,
    skip: 0,
    limit: 50,
  } as never);
};

const renderElement: (element: React.ReactElement) => HTMLElement = (
  element: React.ReactElement,
): HTMLElement => {
  const { container } = render(<MemoryRouter>{element}</MemoryRouter>);
  return container;
};

const radio: (name: string) => HTMLElement = (name: string): HTMLElement => {
  return screen.getByRole("radio", { name: new RegExp(`^${name}`) });
};

const radioNames: () => Array<string> = (): Array<string> => {
  return screen.getAllByRole("radio").map((element: HTMLElement): string => {
    return element.textContent || "";
  });
};

// Resolves once the key has been loaded and handed to the guide.
const waitForKey: (container: HTMLElement) => Promise<void> = async (
  container: HTMLElement,
): Promise<void> => {
  await waitFor(() => {
    expect(container.textContent).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SECRET}`,
    );
  });
};

describe("the Ceph, Proxmox and VMware setup guide cards", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("CephDocumentationCard", () => {
    test("asks how to install and opens on the install script, with the picked key", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <CephDocumentationCard
          title="Getting Started with Ceph Monitoring"
          description="No Ceph clusters connected yet."
        />,
      );

      expect(
        screen.getByRole("heading", {
          name: "Getting Started with Ceph Monitoring",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radiogroup", {
          name: "How do you want to install the agent?",
        }),
      ).toBeInTheDocument();
      expect(radioNames()).toEqual([
        expect.stringMatching(/^Install scriptRecommended/),
        expect.stringMatching(/^Docker Compose/),
      ]);
      expect(radio("Install script")).toHaveAttribute("aria-checked", "true");

      await waitForKey(container);
      expect(container.textContent).toContain(
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SECRET} bash install.sh`,
      );
      expect(container.textContent).toContain(
        "Enable the mgr prometheus module",
      );
      expect(container.textContent).not.toContain(
        SETUP_GUIDE_API_KEY_PLACEHOLDER,
      );
    });

    test("Docker Compose swaps in the .env file, with the key and the example cluster", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <CephDocumentationCard title="Connect" description="A guide." />,
      );
      await waitForKey(container);

      fireEvent.click(radio("Docker Compose"));

      expect(radio("Docker Compose")).toHaveAttribute("aria-checked", "true");
      expect(container.textContent).toContain(
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SECRET}\nCEPH_CLUSTER_NAME=my-ceph-cluster`,
      );
      expect(container.textContent).toContain("docker compose up -d");
      expect(container.textContent).not.toContain("bash install.sh");
    });

    test("a cluster's own tab installs for that cluster", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <CephDocumentationCard
          clusterName="ceph-prod"
          title="Ceph Agent Installation Guide"
          description="A guide."
        />,
      );
      await waitForKey(container);
      expect(container.textContent).toContain("enter **`ceph-prod`** exactly");

      fireEvent.click(radio("Docker Compose"));

      expect(container.textContent).toContain("CEPH_CLUSTER_NAME=ceph-prod");
    });

    test("without a key, the install script prompts for everything", async () => {
      mockKeys([]);
      const container: HTMLElement = renderElement(
        <CephDocumentationCard title="Connect" description="A guide." />,
      );
      await waitFor(() => {
        expect(screen.getByText("No ingestion keys yet")).toBeInTheDocument();
      });
      expect(container.textContent).toContain("-o install.sh\nbash install.sh");
      expect(container.textContent).not.toContain(
        "ONEUPTIME_TELEMETRY_INGESTION_KEY=",
      );
    });

    test("folds Advanced and Troubleshooting away", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <CephDocumentationCard title="Connect" description="A guide." />,
      );
      await waitForKey(container);
      expect(screen.getByTestId("setup-guide-advanced-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(
        screen.getByTestId("setup-guide-troubleshooting-toggle"),
      ).toHaveAttribute("aria-expanded", "false");
      expect(container.textContent).not.toContain("honor_labels: true");
    });
  });

  describe("ProxmoxDocumentationCard", () => {
    test("asks how to connect and offers the agent and the native push", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <ProxmoxDocumentationCard
          title="Getting Started with Proxmox Monitoring"
          description="No Proxmox clusters connected yet."
        />,
      );

      expect(
        screen.getByRole("radiogroup", {
          name: "How do you want to connect your cluster?",
        }),
      ).toBeInTheDocument();
      expect(radioNames()).toEqual([
        expect.stringMatching(/^Install scriptRecommended/),
        expect.stringMatching(/^Docker Compose/),
        expect.stringMatching(/^Native push \(Proxmox VE 9\+\)/),
      ]);

      await waitForKey(container);
      expect(container.textContent).toContain("Create a read-only API token");
      expect(
        within(screen.getByTestId("setup-guide-step-1")).getByText(
          "OneUptime URL",
        ),
      ).toBeInTheDocument();
    });

    test("the native push points step 1 at the OTLP endpoint and installs nothing", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <ProxmoxDocumentationCard title="Connect" description="A guide." />,
      );
      await waitForKey(container);

      fireEvent.click(radio("Native push"));

      const first: HTMLElement = screen.getByTestId("setup-guide-step-1");
      expect(
        within(first).getByText(
          "Proxmox VE sends its metrics with this key, in the x-oneuptime-token header. Pick an existing key or create a new one — the settings below update to use it.",
        ),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(
          within(first).getByText("OTLP metrics endpoint"),
        ).toBeInTheDocument();
      });
      expect(container.textContent).toContain(
        `{"x-oneuptime-token": "${SECRET}"}`,
      );
      expect(container.textContent).toContain(
        "Add OneUptime as a metric server",
      );
      expect(container.textContent).not.toContain("install.sh");
      expect(container.textContent).not.toContain("pveum");
    });

    test("a cluster's own tab installs for that cluster", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <ProxmoxDocumentationCard
          clusterName="pve-prod"
          title="Proxmox Agent Installation Guide"
          description="A guide."
        />,
      );
      await waitForKey(container);

      fireEvent.click(radio("Docker Compose"));

      expect(container.textContent).toContain("PROXMOX_CLUSTER_NAME=pve-prod");
    });
  });

  describe("VMwareDocumentationCard", () => {
    test("asks how to install, and Docker Compose writes the .env with the key", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <VMwareDocumentationCard
          title="Getting Started with VMware Monitoring"
          description="No vCenters connected yet."
        />,
      );

      expect(
        screen.getByRole("radiogroup", {
          name: "How do you want to install the agent?",
        }),
      ).toBeInTheDocument();
      await waitForKey(container);
      expect(container.textContent).toContain(
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SECRET} bash install.sh`,
      );

      fireEvent.click(radio("Docker Compose"));

      expect(container.textContent).toContain(
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SECRET}\nVMWARE_VCENTER_NAME=my-vcenter`,
      );
      expect(container.textContent).toContain(
        "VCENTER_PASSWORD='a-strong-password'",
      );
    });

    test("offers the install without Docker, which writes the key into a .env for systemd and starts the service", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <VMwareDocumentationCard
          title="Getting Started with VMware Monitoring"
          description="No vCenters connected yet."
        />,
      );

      expect(radioNames()).toEqual([
        expect.stringMatching(/^Install scriptRecommended/),
        expect.stringMatching(/^Docker Compose/),
        expect.stringMatching(/^Without Docker/),
      ]);
      await waitForKey(container);

      fireEvent.click(radio("Without Docker"));

      expect(container.textContent).toContain(
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SECRET}\nVMWARE_VCENTER_NAME=my-vcenter`,
      );
      expect(container.textContent).toContain(
        'VCENTER_USERNAME="oneuptime@vsphere.local"',
      );
      expect(container.textContent).toContain(
        "sudo systemctl enable oneuptime-vmware-agent",
      );
      expect(container.textContent).toContain(
        "otelcol-contrib_${VERSION}_linux_${ARCH}.tar.gz",
      );
      expect(container.textContent).not.toContain("docker compose up -d\n");
      expect(container.textContent).not.toContain(
        SETUP_GUIDE_API_KEY_PLACEHOLDER,
      );
    });

    test("the read-only user step shows its tabs", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <VMwareDocumentationCard title="Connect" description="A guide." />,
      );
      await waitForKey(container);
      expect(
        screen.getAllByRole("tab").map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
      ).toEqual(["vSphere Client", "govc", "Standalone ESXi"]);
    });

    test("a vCenter's own tab installs for that vCenter", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderElement(
        <VMwareDocumentationCard
          vcenterName="vcenter-prod"
          title="VMware Agent Installation Guide"
          description="A guide."
        />,
      );
      await waitForKey(container);

      fireEvent.click(radio("Docker Compose"));

      expect(container.textContent).toContain(
        "VMWARE_VCENTER_NAME=vcenter-prod",
      );

      fireEvent.click(radio("Without Docker"));

      expect(container.textContent).toContain(
        "VMWARE_VCENTER_NAME=vcenter-prod",
      );
      expect(container.textContent).toContain(
        "This installs the agent for **`vcenter-prod`**",
      );
    });
  });
});
