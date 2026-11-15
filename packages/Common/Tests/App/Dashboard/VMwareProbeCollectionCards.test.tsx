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
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A vCenter a probe collects, on its pages: the status card at the top of
 * its Overview (collecting, checking, or not collecting - why, and "Trust
 * this certificate" where that is the fix), and the Data Collection card on
 * its Settings page (how it is connected, and the switch between a probe
 * and the VMware agent).
 *
 * Only the network and the signed-in user's permissions are stubbed: the
 * permission gate is the real one.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
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

import VMwareCollectionStatusCard from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareCollectionStatusCard";
import VMwareDataCollectionCard from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareDataCollectionCard";
import Probe from "../../../Models/DatabaseModels/Probe";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import VMwareCollectionErrorCode from "../../../Types/VMware/VMwareCollectionError";
import VMwareCollectionMethod from "../../../Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus from "../../../Types/VMware/VMwareCollectionStatus";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const VCENTER_ID: string = "7d7d7d7d-0000-4000-8000-000000000001";
const PROBE_ID: string = "7d7d7d7d-0000-4000-8000-000000000002";
const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

let stored: Record<string, unknown> = {};

function vcenter(): VMwareVCenter {
  const item: VMwareVCenter = new VMwareVCenter();
  item._id = VCENTER_ID;
  Object.assign(item, stored);
  return item;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 10; index++) {
      await Promise.resolve();
    }
  });
}

const PROBE_COLLECTED: Record<string, unknown> = {
  collectionMethod: VMwareCollectionMethod.Probe,
  vcenterUrl: "https://vcsa.example.com",
  vcenterUsername: "oneuptime@vsphere.local",
  isVCenterPasswordSet: true,
  collectionProbeId: new ObjectID(PROBE_ID),
  collectionProbe: { name: "Datacenter probe" },
  collectionIntervalInMinutes: 5,
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
  stored = { ...PROBE_COLLECTED };

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    return vcenter();
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
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
  jest.restoreAllMocks();
});

describe("the Overview's data collection card", () => {
  test("says nothing for a vCenter the VMware agent sends", async () => {
    stored = { collectionMethod: VMwareCollectionMethod.Agent };

    const { container } = render(
      <VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />,
    );
    await flush();

    expect(container).toBeEmptyDOMElement();
  });

  test("a vCenter being collected: by which probe, from where, how often", async () => {
    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: VMwareCollectionStatus.Succeeded,
      lastCollectionAt: new Date(),
      lastSuccessfulCollectionAt: new Date(),
      collectionSummary: {
        productName: "VMware vCenter Server",
        version: "8.0.2",
        datacenterCount: 1,
        clusterCount: 1,
        hostCount: 2,
        vmCount: 3,
        poweredOnVmCount: 3,
        templateCount: 0,
        datastoreCount: 1,
        resourcePoolCount: 1,
        warnings: ["vSAN is not enabled on cluster Prod."],
      },
    };

    render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
    await flush();

    expect(screen.getByText("Collecting")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Collected by Datacenter probe from https://vcsa.example.com, every 5 minutes. No agent runs for it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The probe is collecting this vCenter."),
    ).toBeInTheDocument();
    expect(screen.getByText("VMware vCenter Server 8.0.2")).toBeInTheDocument();
    expect(
      screen.getByText("vSAN is not enabled on cluster Prod."),
    ).toBeInTheDocument();
  });

  test("a probe the reader cannot see, collecting every minute: 'its probe', and the count named", async () => {
    stored = {
      ...PROBE_COLLECTED,
      collectionProbe: undefined,
      collectionIntervalInMinutes: 1,
      collectionStatus: VMwareCollectionStatus.Succeeded,
    };

    render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
    await flush();

    /*
     * The one form names the count: it is also Russian's form for 21, 31,
     * 41 and 51 minutes.
     */
    expect(
      screen.getByText(
        "Collected by its probe from https://vcsa.example.com, every 1 minute. No agent runs for it.",
      ),
    ).toBeInTheDocument();
  });

  test("not collecting: why, what to do, and the certificate - trusted in one click", async () => {
    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: VMwareCollectionStatus.Failed,
      collectionErrorCode: VMwareCollectionErrorCode.UntrustedCertificate,
      collectionError:
        "vcsa.example.com's certificate is not trusted by the probe.",
      presentedCertificate: {
        fingerprint256: FINGERPRINT,
        subject: "CN=vcsa.example.com",
        issuer: "CN=CA",
        isSelfSigned: false,
      },
    };

    render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
    await flush();

    expect(screen.getByText("Not collecting")).toBeInTheDocument();
    expect(
      screen.getByText("vCenter's certificate is not trusted"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "vcsa.example.com's certificate is not trusted by the probe.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("vmware-trust-certificate-button"));
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    const call: { modelType: unknown; id: ObjectID; data: unknown } =
      updateByIdMock.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        data: unknown;
      };
    expect(call.modelType).toBe(VMwareVCenter);
    expect(call.id.toString()).toBe(VCENTER_ID);
    expect(call.data).toEqual({ trustedCertificateFingerprint: FINGERPRINT });
    // Read again, to show what the probe does with it.
    expect(getItemMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("a viewer sees the certificate but cannot trust it", async () => {
    permissionsForTest = [Permission.Viewer];
    PermissionGate.clearPermissionPropsCache();
    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: VMwareCollectionStatus.Failed,
      collectionErrorCode: VMwareCollectionErrorCode.CertificateChanged,
      presentedCertificate: {
        fingerprint256: FINGERPRINT,
        subject: "CN=vcsa.example.com",
        issuer: "CN=CA",
        isSelfSigned: false,
      },
    };

    render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
    await flush();

    expect(
      screen.getByTestId("vmware-presented-fingerprint"),
    ).toHaveTextContent(FINGERPRINT);
    expect(screen.queryByTestId("vmware-trust-certificate-button")).toBeNull();
  });

  test("checking: the new settings are being tried", async () => {
    stored = {
      ...PROBE_COLLECTED,
      collectionStatus: VMwareCollectionStatus.Pending,
    };

    render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
    await flush();

    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The probe collects this vCenter with its new settings within a minute.",
      ),
    ).toBeInTheDocument();
  });

  /*
   * A vCenter nothing may collect is set aside by the probes' claim a
   * quarter of an hour at a time (OneUptime issue #8042), so its
   * nextCollectionAt keeps moving: the card read "Collecting", or a new
   * vCenter's "Checking ... within a minute", for good. It says why from the
   * vCenter's own row, and promises no next time.
   */
  describe("a vCenter no probe may collect", () => {
    const MINUTE_IN_MS: number = 60 * 1000;
    const PROJECT_ID: string = "7d7d7d7d-0000-4000-8000-000000000009";

    const SET_ASIDE: Record<string, unknown> = {
      ...PROBE_COLLECTED,
      projectId: new ObjectID(PROJECT_ID),
      collectionStatus: VMwareCollectionStatus.Succeeded,
      lastCollectionAt: new Date(Date.now() - 600 * MINUTE_IN_MS),
      nextCollectionAt: new Date(Date.now() + 17 * MINUTE_IN_MS),
    };

    /*
     * The description is what the vCenter is set to, never "Collected by" beside Not
     * collecting (OneUptime issue #8326), and nothing at all when the probe or the address is
     * what is missing: the body says so.
     */
    test.each([
      [
        "with no password",
        { isVCenterPasswordSet: false },
        "No password is saved for this vCenter.",
        "Enter the vCenter user's password in Settings, and test the connection.",
        "Set to be collected by Datacenter probe from https://vcsa.example.com, every 5 minutes.",
      ],
      [
        "with no address",
        { vcenterUrl: undefined },
        "This vCenter has no address.",
        "Enter vCenter's address in Settings, and test the connection.",
        null,
      ],
      [
        "with no user name",
        { vcenterUsername: undefined },
        "This vCenter has no user name.",
        "Enter the vCenter user's name in Settings, and test the connection.",
        "Set to be collected by Datacenter probe from https://vcsa.example.com, every 5 minutes.",
      ],
      [
        "with no probe",
        { collectionProbeId: undefined, collectionProbe: undefined },
        "No probe is set to collect this vCenter.",
        "Pick one of this project's probes in Settings.",
        null,
      ],
      [
        "on another project's probe",
        {
          collectionProbe: {
            name: "Datacenter probe",
            isGlobalProbe: false,
            projectId: new ObjectID("7d7d7d7d-0000-4000-8000-00000000000a"),
          },
        },
        "This probe may not collect this vCenter",
        "Pick a probe of this project's own. Shared OneUptime probes never receive vCenter passwords.",
        "Set to be collected by Datacenter probe from https://vcsa.example.com, every 5 minutes.",
      ],
    ])(
      "%s: not collecting, why, the fix, no next collection, and no promise of one",
      async (
        _name: string,
        stop: Record<string, unknown>,
        title: string,
        nextStep: string,
        description: string | null,
      ) => {
        for (const report of [
          { collectionStatus: VMwareCollectionStatus.Succeeded },
          // A new vCenter: never "Checking ... within a minute".
          { collectionStatus: undefined },
        ]) {
          stored = { ...SET_ASIDE, ...report, ...stop };

          render(
            <VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />,
          );
          await flush();

          const status: HTMLElement = screen.getByTestId(
            "vmware-collection-status",
          );

          expect(screen.getByText("Not collecting")).toBeInTheDocument();
          expect(screen.queryByText("Collecting")).toBeNull();
          expect(screen.queryByText("Checking")).toBeNull();
          expect(status).toHaveTextContent(title);
          expect(status).toHaveTextContent(nextStep);
          expect(
            screen.getByTestId("vmware-next-collection"),
          ).toHaveTextContent("Not scheduled");
          expect(screen.queryByText(/^Collected by /)).toBeNull();

          if (description) {
            expect(screen.getByText(description)).toBeInTheDocument();
          } else {
            expect(screen.queryByText(/^Set to be collected by /)).toBeNull();
          }

          cleanup();
        }
      },
    );

    test("a disconnected probe: named, and nothing collects the vCenter until it is back", async () => {
      stored = {
        ...SET_ASIDE,
        collectionProbe: {
          name: "Datacenter probe",
          isGlobalProbe: false,
          projectId: new ObjectID(PROJECT_ID),
          connectionStatus: "disconnected",
        },
      };

      render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
      await flush();

      expect(screen.getByText("Not collecting")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Nothing collects this vCenter while Datacenter probe is disconnected.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Set to be collected by Datacenter probe from https://vcsa.example.com, every 5 minutes.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^Collected by /)).toBeNull();
    });

    test("a probe the reader may not read, on a vCenter with no password: the setting, by 'its probe'", async () => {
      stored = {
        ...SET_ASIDE,
        isVCenterPasswordSet: false,
        collectionProbe: undefined,
        collectionIntervalInMinutes: 1,
      };

      render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
      await flush();

      expect(
        screen.getByText(
          "Set to be collected by its probe from https://vcsa.example.com, every 1 minute.",
        ),
      ).toBeInTheDocument();
    });

    test("an archived vCenter is still collected", async () => {
      stored = { ...SET_ASIDE, isArchived: true };

      render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
      await flush();

      expect(screen.getByText("Collecting")).toBeInTheDocument();
      expect(screen.getByTestId("vmware-next-collection").textContent).toBe(
        OneUptimeDate.fromNow(SET_ASIDE["nextCollectionAt"] as Date),
      );
      expect(
        screen.getByText(
          "Collected by Datacenter probe from https://vcsa.example.com, every 5 minutes. No agent runs for it.",
        ),
      ).toBeInTheDocument();
    });

    test("it asks for what decides whether a probe may collect it", async () => {
      render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
      await flush();

      const select: Record<string, unknown> = (
        getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
      ).select;

      for (const column of [
        "projectId",
        "isVCenterPasswordSet",
        "vcenterUrl",
        "vcenterUsername",
        "collectionProbeId",
        "nextCollectionAt",
      ]) {
        expect(select[column]).toBe(true);
      }

      expect(select["collectionProbe"]).toEqual({
        name: true,
        isGlobalProbe: true,
        projectId: true,
        connectionStatus: true,
      });
    });
  });

  // VMware's card had no overdue: a probe that went offline left it saying "Collecting".
  describe("a probe that stopped coming", () => {
    const MINUTE_IN_MS: number = 60 * 1000;

    test("overdue, with a probe able to take it: not collecting, and when it was due", async () => {
      stored = {
        ...PROBE_COLLECTED,
        collectionStatus: VMwareCollectionStatus.Succeeded,
        nextCollectionAt: new Date(Date.now() - 60 * MINUTE_IN_MS),
      };

      render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
      await flush();

      expect(screen.getByText("Not collecting")).toBeInTheDocument();
      expect(
        screen.getByText("The probe did not pick this up"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("vmware-collection-status")).toHaveTextContent(
        /This vCenter was due to be collected .+, and no probe has come for it\./,
      );
      expect(screen.getByTestId("vmware-next-collection")).toHaveTextContent(
        "Overdue",
      );
      // No probe has come for it: what it is set to, not a promise.
      expect(
        screen.getByText(
          "Set to be collected by Datacenter probe from https://vcsa.example.com, every 5 minutes.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^Collected by /)).toBeNull();
    });

    test("a collection running its full time budget and upload is not that", async () => {
      stored = {
        ...PROBE_COLLECTED,
        collectionStatus: VMwareCollectionStatus.Succeeded,
        nextCollectionAt: new Date(Date.now() - 15 * MINUTE_IN_MS),
      };

      render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
      await flush();

      expect(screen.getByText("Collecting")).toBeInTheDocument();
      expect(screen.getByTestId("vmware-next-collection")).toHaveTextContent(
        "Due now",
      );
      // Due now: a probe is coming, so the promise stands.
      expect(
        screen.getByText(
          "Collected by Datacenter probe from https://vcsa.example.com, every 5 minutes. No agent runs for it.",
        ),
      ).toBeInTheDocument();
    });

    test("never collected, with a probe able to take it: checking, due now", async () => {
      render(<VMwareCollectionStatusCard modelId={new ObjectID(VCENTER_ID)} />);
      await flush();

      expect(screen.getByText("Checking")).toBeInTheDocument();
      expect(screen.getByTestId("vmware-next-collection")).toHaveTextContent(
        "Due now",
      );
    });
  });
});

describe("the Settings page's Data Collection card", () => {
  test("a probe-collected vCenter: how it is connected, never its password", async () => {
    render(<VMwareDataCollectionCard modelId={new ObjectID(VCENTER_ID)} />);
    await flush();

    expect(screen.getByText("https://vcsa.example.com")).toBeInTheDocument();
    expect(screen.getByText("oneuptime@vsphere.local")).toBeInTheDocument();
    expect(screen.getByText("Datacenter probe")).toBeInTheDocument();
    expect(
      screen.getByText("Any certificate from an authority the probe trusts"),
    ).toBeInTheDocument();
    expect(screen.getByText("5 minutes")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();

    // The password is never asked for: nobody may read it.
    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["vcenterPassword"]).toBeUndefined();

    expect(screen.getByText("Edit Connection")).toBeInTheDocument();
    expect(screen.getByText("Test Connection")).toBeInTheDocument();
  });

  test("switching to the VMware agent asks first, then forgets the password", async () => {
    render(<VMwareDataCollectionCard modelId={new ObjectID(VCENTER_ID)} />);
    await flush();

    fireEvent.click(screen.getByText("Use the VMware Agent"));
    await flush();

    expect(
      screen.getByText(
        "The probe stops collecting this vCenter and its saved password is deleted. Start the VMware agent first, so nothing is missed.",
      ),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
    ).toEqual({ collectionMethod: VMwareCollectionMethod.Agent });
  });

  test("a vCenter the agent sends offers to collect it with a probe instead", async () => {
    stored = { collectionMethod: VMwareCollectionMethod.Agent };

    render(<VMwareDataCollectionCard modelId={new ObjectID(VCENTER_ID)} />);
    await flush();

    expect(
      screen.getByText(
        "The VMware agent you run sends this vCenter's data. Collect it with a probe instead, and no agent or machine of its own is needed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Collect With a Probe")).toBeInTheDocument();
    expect(screen.queryByText("Edit Connection")).toBeNull();
  });

  test("someone who may only read the vCenter changes nothing here", async () => {
    permissionsForTest = [Permission.Viewer];
    PermissionGate.clearPermissionPropsCache();

    render(<VMwareDataCollectionCard modelId={new ObjectID(VCENTER_ID)} />);
    await flush();

    expect(screen.getByText("https://vcsa.example.com")).toBeInTheDocument();
    expect(screen.queryByText("Edit Connection")).toBeNull();
    expect(screen.queryByText("Use the VMware Agent")).toBeNull();
    expect(screen.queryByText("Test Connection")).toBeNull();
  });
});
