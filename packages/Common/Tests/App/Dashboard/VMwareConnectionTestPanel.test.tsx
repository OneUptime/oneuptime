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
 * "Test connection" under a vCenter's certificate: a VMwareVCenterConnection
 * Test row created from what the form holds, then read until the probe has
 * answered - with what vCenter is and what the account can read, or exactly
 * why not and, for a certificate the probe does not trust, the certificate
 * and "Trust this certificate".
 *
 * Only the network and the signed-in user's permissions are stubbed: the
 * permission gate is the real one.
 */

const createMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
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

import VMwareConnectionTestPanel from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareConnectionTestPanel";
import {
  VMWARE_TEST_POLL_INTERVAL_IN_MS,
  VMwareConnectionTestInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareProbeCollectionView";
import VMwareVCenterConnectionTest from "../../../Models/DatabaseModels/VMwareVCenterConnectionTest";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import VMwareCollectionErrorCode from "../../../Types/VMware/VMwareCollectionError";
import VMwareConnectionTestStatus from "../../../Types/VMware/VMwareConnectionTestStatus";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const TEST_ID: string = "6c6c6c6c-0000-4000-8000-000000000001";
const PROBE_ID: string = "6c6c6c6c-0000-4000-8000-000000000002";
const VCENTER_ID: string = "6c6c6c6c-0000-4000-8000-000000000003";
const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

const INPUT: VMwareConnectionTestInput = {
  vcenterUrl: " vcsa.example.com ",
  vcenterUsername: "oneuptime@vsphere.local ",
  vcenterPassword: "secret",
  probeId: PROBE_ID,
  trustedCertificateFingerprint: "",
};

let answers: Array<Partial<VMwareVCenterConnectionTest>> = [];

function answer(
  data: Partial<VMwareVCenterConnectionTest>,
): VMwareVCenterConnectionTest {
  const item: VMwareVCenterConnectionTest = new VMwareVCenterConnectionTest();
  Object.assign(item, data);
  return item;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 8; index++) {
      await Promise.resolve();
    }
  });
}

async function tick(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(VMWARE_TEST_POLL_INTERVAL_IN_MS);
  });
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
  answers = [];

  createMock.mockReset();
  createMock.mockImplementation(async (): Promise<unknown> => {
    return { data: answer({ _id: TEST_ID }) };
  });

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    return answer(answers.shift() || {});
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("VMwareConnectionTestPanel", () => {
  test("cannot test before the address, user, password and probe are in", () => {
    render(
      <VMwareConnectionTestPanel input={{ ...INPUT, vcenterPassword: "" }} />,
    );

    const button: HTMLElement = screen.getByTestId(
      "vmware-test-connection-button",
    );

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("tests what the form holds, and shows what the account can read once the probe answers", async () => {
    answers = [
      { status: VMwareConnectionTestStatus.Running },
      {
        status: VMwareConnectionTestStatus.Succeeded,
        summary: {
          productName: "VMware vCenter Server",
          version: "8.0.2",
          datacenterCount: 1,
          clusterCount: 2,
          hostCount: 5,
          vmCount: 10,
          poweredOnVmCount: 9,
          templateCount: 0,
          datastoreCount: 1,
          resourcePoolCount: 4,
          warnings: [],
        },
      },
    ];

    render(<VMwareConnectionTestPanel input={INPUT} />);

    fireEvent.click(screen.getByTestId("vmware-test-connection-button"));
    await flush();

    expect(createMock).toHaveBeenCalledTimes(1);
    const created: VMwareVCenterConnectionTest = (
      createMock.mock.calls[0]![0] as { model: VMwareVCenterConnectionTest }
    ).model;
    expect(created.vcenterUrl).toBe("vcsa.example.com");
    expect(created.vcenterUsername).toBe("oneuptime@vsphere.local");
    expect(created.vcenterPassword).toBe("secret");
    expect(created.probeId?.toString()).toBe(PROBE_ID);
    expect(created.trustedCertificateFingerprint).toBeUndefined();
    expect(created.vmwareVCenterId).toBeUndefined();

    expect(
      screen.getByText("Waiting for the probe to pick the test up…"),
    ).toBeInTheDocument();

    await tick();
    expect(
      screen.getByText("The probe is connecting to vCenter…"),
    ).toBeInTheDocument();

    await tick();
    expect(
      screen.getByText(
        "Connected to VMware vCenter Server 8.0.2. The account can read:",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("5 hosts")).toBeInTheDocument();
    expect(
      screen.getByText("10 virtual machines (9 running)"),
    ).toBeInTheDocument();

    // Settled: no more reads.
    const reads: number = getItemMock.mock.calls.length;
    await tick();
    expect(getItemMock.mock.calls.length).toBe(reads);

    expect(
      (getItemMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(TEST_ID);
  });

  test("a saved vCenter is tested with its own password when none is typed", async () => {
    render(
      <VMwareConnectionTestPanel
        input={{
          ...INPUT,
          vcenterPassword: "",
          trustedCertificateFingerprint: FINGERPRINT,
          vmwareVCenterId: new ObjectID(VCENTER_ID),
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("vmware-test-connection-button"));
    await flush();

    const created: VMwareVCenterConnectionTest = (
      createMock.mock.calls[0]![0] as { model: VMwareVCenterConnectionTest }
    ).model;
    expect(created.vcenterPassword).toBeUndefined();
    expect(created.vmwareVCenterId?.toString()).toBe(VCENTER_ID);
    expect(created.trustedCertificateFingerprint).toBe(FINGERPRINT);
  });

  test("an untrusted certificate is shown, and trusted in one click", async () => {
    answers = [
      {
        status: VMwareConnectionTestStatus.Failed,
        errorCode: VMwareCollectionErrorCode.UntrustedCertificate,
        errorMessage:
          "vcsa.example.com's certificate is not trusted by the probe. Nothing was sent.",
        presentedCertificate: {
          fingerprint256: FINGERPRINT,
          subject: "CN=vcsa.example.com",
          issuer: "CN=CA, DC=vsphere, DC=local",
          isSelfSigned: false,
          validTo: "2028-01-01T00:00:00.000Z",
        },
      },
    ];

    const trusted: Array<string> = [];

    render(
      <VMwareConnectionTestPanel
        input={INPUT}
        onTrustCertificate={(fingerprint: string) => {
          trusted.push(fingerprint);
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("vmware-test-connection-button"));
    await flush();
    await tick();

    expect(
      screen.getByText("vCenter's certificate is not trusted"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "vcsa.example.com's certificate is not trusted by the probe. Nothing was sent.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("CN=vcsa.example.com")).toBeInTheDocument();
    expect(
      screen.getByTestId("vmware-presented-fingerprint"),
    ).toHaveTextContent(FINGERPRINT);

    fireEvent.click(screen.getByTestId("vmware-trust-certificate-button"));
    expect(trusted).toEqual([FINGERPRINT]);
  });

  test("a refusal from the server is said as it is", async () => {
    createMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Enter the vCenter password.");
    });

    render(<VMwareConnectionTestPanel input={INPUT} />);

    fireEvent.click(screen.getByTestId("vmware-test-connection-button"));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the vCenter password.",
    );
  });

  test("is not offered to someone who may not test a connection", () => {
    permissionsForTest = [Permission.Viewer];
    PermissionGate.clearPermissionPropsCache();

    render(<VMwareConnectionTestPanel input={INPUT} />);

    expect(screen.queryByTestId("vmware-test-connection-button")).toBeNull();
  });
});
