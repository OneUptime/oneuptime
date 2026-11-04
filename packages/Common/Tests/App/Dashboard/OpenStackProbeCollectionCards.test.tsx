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
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A cloud a probe collects, on its pages: the Data Collection card on its Overview (collecting,
 * checking, partly collecting or not collecting: why, which services went without, and "Trust
 * this certificate" where that is the fix), and the one on its Settings page (how it is
 * connected, what it reads beyond the defaults, and the switch between a probe and the OpenStack
 * agent).
 *
 * Only the network and the signed-in user's permissions are stubbed: the permission gate is the
 * real one.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const getAllProbesMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (...args: Array<unknown>): unknown => {
        return getAllProbesMock(...args);
      },
    },
  };
});

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import OpenStackCollectionStatusCard from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackCollectionStatusCard";
import OpenStackDataCollectionCard from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackDataCollectionCard";
import { OPENSTACK_STATUS_POLL_INTERVAL_IN_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackProbeCollectionView";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudConnectionTest from "../../../Models/DatabaseModels/OpenStackCloudConnectionTest";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionErrorCode from "../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "../../../Types/OpenStack/OpenStackCollectionStatus";
import OpenStackConnectionTestStatus from "../../../Types/OpenStack/OpenStackConnectionTestStatus";
import { OpenStackCollectionSummary } from "../../../Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "../../../Types/OpenStack/OpenStackResourceKind";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const CLOUD_ID: string = "7e7e7e7e-0000-4000-8000-000000000001";
const PROBE_ID: string = "7e7e7e7e-0000-4000-8000-000000000002";
const TEST_ID: string = "7e7e7e7e-0000-4000-8000-000000000003";
const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
const OTHER_FINGERPRINT: string =
  "01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF";

let stored: Record<string, unknown> = {};

function cloud(): OpenStackCloud {
  const item: OpenStackCloud = new OpenStackCloud();
  item._id = CLOUD_ID;
  Object.assign(item, stored);
  return item;
}

function modelId(): ObjectID {
  return new ObjectID(CLOUD_ID);
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 10; index++) {
      await Promise.resolve();
    }
  });
}

const PROBE_COLLECTED: Record<string, unknown> = {
  collectionMethod: OpenStackCollectionMethod.Probe,
  authUrl: "https://keystone.example.com:5000",
  endpointInterface: "public",
  collectionRegions: ["RegionOne", "RegionTwo"],
  credentialKind: "applicationCredential",
  applicationCredentialId: "credential-id",
  isCredentialSet: true,
  collectionProbeId: new ObjectID(PROBE_ID),
  collectionProbe: { name: "Datacenter probe" },
  collectionIntervalInMinutes: 5,
};

function summary(
  overrides: Partial<OpenStackCollectionSummary> = {},
): OpenStackCollectionSummary {
  return {
    credentialKind: "applicationCredential",
    regionNames: ["RegionOne"],
    services: [],
    hypervisorCount: 2,
    instanceCount: 3,
    networkCount: 1,
    volumeCount: 4,
    projectCount: 5,
    warnings: [],
    ...overrides,
  };
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
  stored = { ...PROBE_COLLECTED };

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    return cloud();
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });

  createMock.mockReset();
  createMock.mockImplementation(async (): Promise<unknown> => {
    const test: OpenStackCloudConnectionTest =
      new OpenStackCloudConnectionTest();
    test._id = TEST_ID;
    return { data: test };
  });

  getAllProbesMock.mockReset();
  getAllProbesMock.mockImplementation(async (): Promise<unknown> => {
    const probe: Probe = new Probe();
    probe._id = PROBE_ID;
    probe.name = "Datacenter probe";
    probe.isGlobalProbe = false;
    return [probe];
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the Overview's Data Collection card", () => {
  test("says nothing for a cloud the OpenStack agent sends", async () => {
    stored = { collectionMethod: OpenStackCollectionMethod.Agent };

    const { container } = render(
      <OpenStackCollectionStatusCard modelId={modelId()} />,
    );
    await flush();

    expect(container).toBeEmptyDOMElement();
  });

  test("a cloud being collected: by which probe, from where, how often, and what it read", async () => {
    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: OpenStackCollectionStatus.Succeeded,
      lastCollectionAt: new Date(),
      lastSuccessfulCollectionAt: new Date(),
      collectionSummary: summary({
        warnings: ["Keystone's list_limit cut the project list short."],
      }),
    };

    render(<OpenStackCollectionStatusCard modelId={modelId()} />);
    await flush();

    expect(screen.getByText("Collecting")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Collected by Datacenter probe from https://keystone.example.com:5000, every 5 minutes. No agent runs for it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The probe is collecting this cloud."),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("openstack-collection-inventory"),
    ).toHaveTextContent("2 hypervisors");
    expect(
      screen.getByText("Keystone's list_limit cut the project list short."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-collection-services")).toBeNull();
  });

  test("a probe the reader cannot see, collecting every minute: 'its probe', and the count named", async () => {
    stored = {
      ...PROBE_COLLECTED,
      collectionProbe: undefined,
      collectionIntervalInMinutes: 1,
      collectionStatus: OpenStackCollectionStatus.Succeeded,
    };

    render(<OpenStackCollectionStatusCard modelId={modelId()} />);
    await flush();

    expect(
      screen.getByText(
        "Collected by its probe from https://keystone.example.com:5000, every 1 minute. No agent runs for it.",
      ),
    ).toBeInTheDocument();
  });

  test("partly collecting: says which services were not read, and why", async () => {
    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: OpenStackCollectionStatus.PartiallySucceeded,
      collectionErrorCode: OpenStackCollectionErrorCode.ServiceOverloaded,
      collectionError: "Neutron kept answering HTTP 503.",
      collectionSummary: summary({
        services: [
          {
            service: OpenStackServiceType.Compute,
            regionName: "RegionOne",
            outcome: "Succeeded",
            durationInMs: 10,
            requestCount: 3,
          },
          {
            service: OpenStackServiceType.Network,
            regionName: "RegionOne",
            outcome: "BackingOff",
            errorMessage: "Neutron kept answering HTTP 503.",
            durationInMs: 10,
            requestCount: 3,
          },
          {
            service: OpenStackServiceType.Image,
            regionName: "RegionOne",
            outcome: "NotDeployed",
            durationInMs: 10,
            requestCount: 0,
          },
        ],
      }),
    };

    render(<OpenStackCollectionStatusCard modelId={modelId()} />);
    await flush();

    expect(screen.getByText("Partly collecting")).toBeInTheDocument();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "openstack-collection-service",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-outcome", "BackingOff");
    expect(rows[0]).toHaveTextContent("Backing off");
    expect(rows[0]).toHaveTextContent("Networking (Neutron), RegionOne");
    expect(rows[0]).toHaveTextContent("Neutron kept answering HTTP 503.");

    // What it did read still counts for something.
    expect(
      screen.getByTestId("openstack-collection-inventory"),
    ).toHaveTextContent("3 instances");
  });

  test("not collecting: why, what to do, and the certificate, added to the rest in one click", async () => {
    stored = {
      ...PROBE_COLLECTED,
      trustedCertificateFingerprints: [OTHER_FINGERPRINT],
      collectionStatus: OpenStackCollectionStatus.Failed,
      collectionErrorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
      collectionError:
        "nova.example.com's certificate is not trusted by the probe.",
      presentedCertificate: {
        fingerprint256: FINGERPRINT,
        subject: "CN=nova.example.com",
        issuer: "CN=Cloud CA",
        isSelfSigned: false,
        host: "nova.example.com",
        port: 8774,
      },
      collectionSummary: summary(),
    };

    render(<OpenStackCollectionStatusCard modelId={modelId()} />);
    await flush();

    expect(screen.getByText("Not collecting")).toBeInTheDocument();
    expect(
      screen.getByText("The API's certificate is not trusted"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "nova.example.com's certificate is not trusted by the probe.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("nova.example.com:8774")).toBeInTheDocument();
    // A failing collection's old counts are not news.
    expect(screen.queryByTestId("openstack-collection-inventory")).toBeNull();

    fireEvent.click(screen.getByTestId("openstack-trust-certificate-button"));
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    const call: { modelType: unknown; id: ObjectID; data: unknown } =
      updateByIdMock.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        data: unknown;
      };
    expect(call.modelType).toBe(OpenStackCloud);
    expect(call.id.toString()).toBe(CLOUD_ID);
    expect(call.data).toEqual({
      trustedCertificateFingerprints: [OTHER_FINGERPRINT, FINGERPRINT],
    });
    // Read again, to show what the probe does with it.
    expect(getItemMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("a refused trust says why, and the card stays", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Enter the credential's secret again.");
    });
    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: OpenStackCollectionStatus.Failed,
      collectionErrorCode: OpenStackCollectionErrorCode.CertificateChanged,
      presentedCertificate: {
        fingerprint256: FINGERPRINT,
        subject: "CN=keystone.example.com",
        issuer: "CN=Cloud CA",
        isSelfSigned: false,
      },
    };

    render(<OpenStackCollectionStatusCard modelId={modelId()} />);
    await flush();

    fireEvent.click(screen.getByTestId("openstack-trust-certificate-button"));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the credential's secret again.",
    );
    expect(
      screen.getByTestId("openstack-trust-certificate-button"),
    ).toBeInTheDocument();
  });

  test("a viewer sees the certificate but cannot trust it", async () => {
    permissionsForTest = [Permission.Viewer];
    PermissionGate.clearPermissionPropsCache();
    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: OpenStackCollectionStatus.Failed,
      collectionErrorCode: OpenStackCollectionErrorCode.CertificateChanged,
      presentedCertificate: {
        fingerprint256: FINGERPRINT,
        subject: "CN=keystone.example.com",
        issuer: "CN=Cloud CA",
        isSelfSigned: false,
      },
    };

    render(<OpenStackCollectionStatusCard modelId={modelId()} />);
    await flush();

    expect(
      screen.getByTestId("openstack-presented-fingerprint"),
    ).toHaveTextContent(FINGERPRINT);
    expect(
      screen.queryByTestId("openstack-trust-certificate-button"),
    ).toBeNull();
  });

  test("a catalog on plain HTTP says to turn on TLS, with nothing to trust", async () => {
    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: OpenStackCollectionStatus.Failed,
      collectionErrorCode: OpenStackCollectionErrorCode.InsecureEndpoint,
      collectionError:
        "The catalog puts Compute (Nova) on plain HTTP, such as http://10.0.0.1:8774.",
    };

    render(<OpenStackCollectionStatusCard modelId={modelId()} />);
    await flush();

    expect(
      screen.getByText("The catalog names a plain HTTP endpoint"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A credential's token is never sent unencrypted. Turn on TLS for that API, pick another endpoint interface, or use the OpenStack agent for this cloud.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("openstack-trust-certificate-button"),
    ).toBeNull();
  });

  test("checking: asks again until the probe has answered, and then stops", async () => {
    jest.useFakeTimers();

    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: OpenStackCollectionStatus.Pending,
    };

    render(<OpenStackCollectionStatusCard modelId={modelId()} />);
    await flush();

    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The probe collects this cloud with its new settings within a minute.",
      ),
    ).toBeInTheDocument();

    const firstReads: number = getItemMock.mock.calls.length;

    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: OpenStackCollectionStatus.Succeeded,
    };

    await act(async () => {
      jest.advanceTimersByTime(OPENSTACK_STATUS_POLL_INTERVAL_IN_MS);
    });
    await flush();

    expect(getItemMock.mock.calls.length).toBe(firstReads + 1);
    expect(screen.getByText("Collecting")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(OPENSTACK_STATUS_POLL_INTERVAL_IN_MS * 3);
    });
    await flush();

    expect(getItemMock.mock.calls.length).toBe(firstReads + 1);
  });

  test("a read that fails says so", async () => {
    getItemMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("The server is not answering.");
    });

    render(<OpenStackCollectionStatusCard modelId={modelId()} />);
    await flush();

    expect(
      screen.getByText("The server is not answering."),
    ).toBeInTheDocument();
  });

  test("never asks for the secret", async () => {
    render(<OpenStackCollectionStatusCard modelId={modelId()} />);
    await flush();

    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["credentialSecret"]).toBeUndefined();
  });
});

describe("the Settings page's Data Collection card", () => {
  test("a probe-collected cloud: how it is connected, never its secret", async () => {
    render(<OpenStackDataCollectionCard modelId={modelId()} />);
    await flush();

    expect(
      screen.getByText("https://keystone.example.com:5000"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Application credential credential-id"),
    ).toBeInTheDocument();
    expect(screen.getByText("Datacenter probe")).toBeInTheDocument();
    expect(screen.getByText("RegionOne, RegionTwo")).toBeInTheDocument();
    expect(
      screen.getByText("Any certificate from an authority the probe trusts"),
    ).toBeInTheDocument();
    expect(screen.getByText("5 minutes")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();

    // The secret is never asked for: nobody may read it.
    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["credentialSecret"]).toBeUndefined();

    expect(screen.getByText("Edit Connection")).toBeInTheDocument();
    expect(screen.getByText("Test Connection")).toBeInTheDocument();
    expect(screen.getByText("Use the OpenStack Agent")).toBeInTheDocument();
  });

  test("a password cloud says who it logs in as", async () => {
    stored = {
      ...PROBE_COLLECTED,
      credentialKind: "password",
      applicationCredentialId: undefined,
      keystoneUsername: "reader",
      projectName: "monitoring",
    };

    render(<OpenStackDataCollectionCard modelId={modelId()} />);
    await flush();

    expect(
      screen.getByText("User reader, on project monitoring"),
    ).toBeInTheDocument();
  });

  test("lists each certificate trusted, and says when the secret is missing", async () => {
    stored = {
      ...PROBE_COLLECTED,
      isCredentialSet: false,
      trustedCertificateFingerprints: [FINGERPRINT, OTHER_FINGERPRINT],
    };

    render(<OpenStackDataCollectionCard modelId={modelId()} />);
    await flush();

    expect(screen.getByText(FINGERPRINT)).toBeInTheDocument();
    expect(screen.getByText(OTHER_FINGERPRINT)).toBeInTheDocument();
    expect(screen.getByText("Not saved")).toBeInTheDocument();
  });

  test("switching to the OpenStack agent asks first, then forgets the secret", async () => {
    render(<OpenStackDataCollectionCard modelId={modelId()} />);
    await flush();

    fireEvent.click(screen.getByText("Use the OpenStack Agent"));
    await flush();

    expect(
      screen.getByText(
        "The probe stops collecting this cloud and its saved credential is deleted. Start the OpenStack agent first, so nothing is missed.",
      ),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
    ).toEqual({ collectionMethod: OpenStackCollectionMethod.Agent });
  });

  test("a refused switch says why, and stays open", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You may not change this cloud.");
    });

    render(<OpenStackDataCollectionCard modelId={modelId()} />);
    await flush();

    fireEvent.click(screen.getByText("Use the OpenStack Agent"));
    await flush();
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(
      screen.getByText("You may not change this cloud."),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("modal-footer-submit-button"),
    ).toBeInTheDocument();
  });

  test("a cloud the agent sends offers to collect it with a probe instead", async () => {
    stored = { collectionMethod: OpenStackCollectionMethod.Agent };

    render(<OpenStackDataCollectionCard modelId={modelId()} />);
    await flush();

    expect(
      screen.getByText(
        "The OpenStack agent you run sends this cloud's data. Collect it with a probe instead, and no agent or machine of its own is needed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Collect With a Probe")).toBeInTheDocument();
    expect(screen.queryByText("Edit Connection")).toBeNull();
    expect(screen.queryByTestId("openstack-collection-options")).toBeNull();
  });

  test("someone who may only read the cloud changes nothing here", async () => {
    permissionsForTest = [Permission.Viewer];
    PermissionGate.clearPermissionPropsCache();

    render(<OpenStackDataCollectionCard modelId={modelId()} />);
    await flush();

    expect(
      screen.getByText("https://keystone.example.com:5000"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Edit Connection")).toBeNull();
    expect(screen.queryByText("Use the OpenStack Agent")).toBeNull();
    expect(screen.queryByText("Test Connection")).toBeNull();
    expect(
      within(screen.getByTestId("openstack-collection-options")).getByTestId(
        "openstack-option-project-limits",
      ),
    ).toHaveAttribute("aria-disabled", "true");
  });

  describe("what it reads beyond the defaults", () => {
    test("Project limits, which the Projects page sends people here for, with what it costs", async () => {
      render(<OpenStackDataCollectionCard modelId={modelId()} />);
      await flush();

      const options: HTMLElement = screen.getByTestId(
        "openstack-collection-options",
      );

      expect(within(options).getByText("Project limits")).toBeInTheDocument();
      expect(
        within(options).getByText(
          "Quotas and limits per project, for the Projects page. Costs four API calls per project, on every collection.",
        ),
      ).toBeInTheDocument();
      expect(within(options).getByText("Ports")).toBeInTheDocument();
      expect(
        within(options).getByText(
          "One series per port, and how many have no address or a load balancer that is down. Costs one paged list per network or project you name, or of every port if you name none. An unscoped list of ports can saturate Neutron on a large cloud.",
        ),
      ).toBeInTheDocument();

      // Nothing to save until something changes.
      expect(
        screen.queryByTestId("openstack-save-collection-options"),
      ).toBeNull();

      fireEvent.click(screen.getByTestId("openstack-option-project-limits"));

      fireEvent.click(screen.getByTestId("openstack-save-collection-options"));
      await flush();

      expect(updateByIdMock).toHaveBeenCalledTimes(1);
      expect(
        (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
      ).toEqual({ collectionOptions: { collectProjectLimits: true } });
    });

    test("Ports can be scoped to networks and projects", async () => {
      render(<OpenStackDataCollectionCard modelId={modelId()} />);
      await flush();

      expect(screen.queryByTestId("openstack-option-port-networks")).toBeNull();

      fireEvent.click(screen.getByTestId("openstack-option-ports"));

      fireEvent.change(screen.getByTestId("openstack-option-port-networks"), {
        target: { value: "network-1, network-2" },
      });
      fireEvent.change(screen.getByTestId("openstack-option-port-projects"), {
        target: { value: "project-1" },
      });

      fireEvent.click(screen.getByTestId("openstack-save-collection-options"));
      await flush();

      expect(
        (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
      ).toEqual({
        collectionOptions: {
          collectPorts: true,
          portNetworkIds: ["network-1", "network-2"],
          portProjectIds: ["project-1"],
        },
      });
    });

    test("too long a list is said before anything is sent, and the switch stays on", async () => {
      render(<OpenStackDataCollectionCard modelId={modelId()} />);
      await flush();

      fireEvent.click(screen.getByTestId("openstack-option-ports"));

      fireEvent.change(screen.getByTestId("openstack-option-port-networks"), {
        target: {
          value: Array.from(
            { length: 65 },
            (_value: unknown, index: number): string => {
              return `network-${index}`;
            },
          ).join(", "),
        },
      });

      fireEvent.click(screen.getByTestId("openstack-save-collection-options"));
      await flush();

      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Name at most 64 networks and projects to read ports from: each is a list on every collection.",
      );
      expect(
        screen.getByTestId("openstack-option-port-networks"),
      ).toBeInTheDocument();
    });

    test("what is saved shows on, and turning it off saves that", async () => {
      stored = {
        ...PROBE_COLLECTED,
        collectionOptions: {
          collectProjectLimits: true,
          collectPorts: true,
          portNetworkIds: ["network-1"],
        },
      };

      render(<OpenStackDataCollectionCard modelId={modelId()} />);
      await flush();

      expect(screen.getByTestId("openstack-option-port-networks")).toHaveValue(
        "network-1",
      );

      fireEvent.click(screen.getByTestId("openstack-option-project-limits"));
      fireEvent.click(screen.getByTestId("openstack-save-collection-options"));
      await flush();

      expect(
        (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
      ).toEqual({
        collectionOptions: {
          collectPorts: true,
          portNetworkIds: ["network-1"],
        },
      });
    });

    test("a refusal from the server is said beside them", async () => {
      updateByIdMock.mockImplementation(async (): Promise<unknown> => {
        throw new Error("You may not change this cloud.");
      });

      render(<OpenStackDataCollectionCard modelId={modelId()} />);
      await flush();

      fireEvent.click(screen.getByTestId("openstack-option-project-limits"));
      fireEvent.click(screen.getByTestId("openstack-save-collection-options"));
      await flush();

      expect(screen.getByRole("alert")).toHaveTextContent(
        "You may not change this cloud.",
      );
    });
  });

  describe("Test Connection", () => {
    async function openTest(): Promise<void> {
      render(<OpenStackDataCollectionCard modelId={modelId()} />);
      await flush();

      fireEvent.click(screen.getByText("Test Connection"));
      await flush();
    }

    test("tests the saved settings with the saved credential", async () => {
      stored = {
        ...PROBE_COLLECTED,
        trustedCertificateFingerprints: [FINGERPRINT],
      };

      await openTest();

      fireEvent.click(screen.getByTestId("openstack-test-connection-button"));
      await flush();

      const created: OpenStackCloudConnectionTest = (
        createMock.mock.calls[0]![0] as {
          model: OpenStackCloudConnectionTest;
        }
      ).model;

      expect(created.openStackCloudId?.toString()).toBe(CLOUD_ID);
      expect(created.authUrl).toBe("https://keystone.example.com:5000");
      expect(created.endpointInterface).toBe("public");
      expect(created.collectionRegions).toEqual(["RegionOne", "RegionTwo"]);
      expect(created.probeId?.toString()).toBe(PROBE_ID);
      expect(created.trustedCertificateFingerprints).toEqual([FINGERPRINT]);
      expect(created.credentialSecret).toBeUndefined();
    });

    test("Use these regions saves the regions the catalog names", async () => {
      jest.useFakeTimers();

      stored = {
        ...PROBE_COLLECTED,
        trustedCertificateFingerprints: [OTHER_FINGERPRINT],
      };

      await openTest();

      getItemMock.mockImplementation(async (): Promise<unknown> => {
        const test: OpenStackCloudConnectionTest =
          new OpenStackCloudConnectionTest();
        test.status = OpenStackConnectionTestStatus.Failed;
        test.errorCode = OpenStackCollectionErrorCode.UntrustedCertificate;
        test.presentedCertificate = {
          fingerprint256: FINGERPRINT,
          subject: "CN=nova",
          issuer: "CN=Cloud CA",
          isSelfSigned: false,
        };
        test.summary = {
          credentialKind: "applicationCredential",
          roleNames: [],
          hasAccessRules: false,
          isUnrestricted: false,
          canProbablyWrite: false,
          regionsInCatalog: ["RegionOne", "RegionTwo", "RegionThree"],
          servicesByRegion: {},
          accessLevel: "Other",
          reads: [],
          warnings: [],
        };
        return test;
      });

      fireEvent.click(screen.getByTestId("openstack-test-connection-button"));
      await flush();
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      await flush();

      fireEvent.click(screen.getByTestId("openstack-use-regions-button"));
      await flush();

      expect(
        (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
      ).toEqual({
        collectionRegions: ["RegionOne", "RegionTwo", "RegionThree"],
      });
    });

    test("Trust this certificate adds it to what is trusted already", async () => {
      jest.useFakeTimers();

      stored = {
        ...PROBE_COLLECTED,
        trustedCertificateFingerprints: [OTHER_FINGERPRINT],
      };

      await openTest();

      getItemMock.mockImplementation(async (): Promise<unknown> => {
        const test: OpenStackCloudConnectionTest =
          new OpenStackCloudConnectionTest();
        test.status = OpenStackConnectionTestStatus.Failed;
        test.errorCode = OpenStackCollectionErrorCode.UntrustedCertificate;
        test.presentedCertificate = {
          fingerprint256: FINGERPRINT,
          subject: "CN=nova",
          issuer: "CN=Cloud CA",
          isSelfSigned: false,
        };
        return test;
      });

      fireEvent.click(screen.getByTestId("openstack-test-connection-button"));
      await flush();
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      await flush();

      fireEvent.click(screen.getByTestId("openstack-trust-certificate-button"));
      await flush();

      expect(
        (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
      ).toEqual({
        trustedCertificateFingerprints: [OTHER_FINGERPRINT, FINGERPRINT],
      });
    });
  });

  test("Edit Connection opens the form that keeps the saved secret", async () => {
    render(<OpenStackDataCollectionCard modelId={modelId()} />);
    await flush();

    fireEvent.click(screen.getByText("Edit Connection"));
    await flush();

    expect(getAllProbesMock).toHaveBeenCalled();
    expect(
      screen.getByText(
        "Changing the address or the probe, or trusting another certificate, needs the secret again: a saved credential is only sent where it was entered for.",
      ),
    ).toBeInTheDocument();
  });

  test("Collect With a Probe says to stop the agent after the first collection", async () => {
    stored = { collectionMethod: OpenStackCollectionMethod.Agent };

    render(<OpenStackDataCollectionCard modelId={modelId()} />);
    await flush();

    fireEvent.click(screen.getByText("Collect With a Probe"));
    await flush();

    expect(
      screen.getByText(
        "Enter Keystone's address, a read-only credential and a probe that reaches the cloud. Stop the OpenStack agent after the first collection, or every metric arrives twice.",
      ),
    ).toBeInTheDocument();
  });
});
