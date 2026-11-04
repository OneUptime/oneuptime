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
 * "Test connection": an OpenStackCloudConnectionTest row created from what the form holds, then
 * read until the probe has answered, with exactly what it found: what the credential logged in
 * as and what it reads, or exactly why not and what to do. A certificate the probe does not
 * trust is shown and trusted in one click, and a catalog on plain HTTP says to turn on TLS.
 *
 * Only the network and the signed-in user's permissions are stubbed: the permission gate is the
 * real one.
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

import OpenStackConnectionTestPanel from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackConnectionTestPanel";
import {
  OPENSTACK_TEST_MAX_WAIT_IN_MS,
  OPENSTACK_TEST_POLL_INTERVAL_IN_MS,
  OpenStackConnectionTestInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackProbeCollectionView";
import OpenStackCloudConnectionTest from "../../../Models/DatabaseModels/OpenStackCloudConnectionTest";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionErrorCode from "../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackConnectionTestStatus from "../../../Types/OpenStack/OpenStackConnectionTestStatus";
import { OpenStackConnectionTestSummary } from "../../../Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "../../../Types/OpenStack/OpenStackResourceKind";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const TEST_ID: string = "6d6d6d6d-0000-4000-8000-000000000001";
const PROBE_ID: string = "6d6d6d6d-0000-4000-8000-000000000002";
const CLOUD_ID: string = "6d6d6d6d-0000-4000-8000-000000000003";
const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
const OTHER_FINGERPRINT: string =
  "01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF";

const INPUT: OpenStackConnectionTestInput = {
  authUrl: " https://keystone.example.com:5000/v3 ",
  endpointInterface: "internal",
  regions: ["RegionOne"],
  credentialKind: "applicationCredential",
  applicationCredentialId: " credential-id ",
  keystoneUsername: "",
  userDomainName: "",
  projectName: "",
  projectDomainName: "",
  credentialSecret: "a secret ",
  probeId: PROBE_ID,
  trustedCertificateFingerprints: [],
};

const WORKED: OpenStackConnectionTestSummary = {
  credentialKind: "applicationCredential",
  projectName: "monitoring",
  roleNames: ["reader"],
  hasAccessRules: true,
  isUnrestricted: false,
  canProbablyWrite: false,
  regionsInCatalog: ["RegionOne", "RegionTwo"],
  servicesByRegion: {},
  accessLevel: "ProjectView",
  reads: [
    {
      regionName: "RegionOne",
      service: OpenStackServiceType.Compute,
      read: "servers",
      access: "OwnProjectOnly",
      reason: "1 project in 3 rows",
      goesWithout: "Every other project's instances",
      fix: "openstack role add --user oneuptime --project other reader",
    },
    {
      regionName: "RegionOne",
      service: OpenStackServiceType.Network,
      read: "agents",
      access: "Refused",
      reason: "HTTP 403",
    },
    {
      regionName: "RegionOne",
      service: OpenStackServiceType.Image,
      read: "images",
      access: "ReadsEverything",
    },
  ],
  warnings: ["Keystone's list_limit cut the project list short."],
};

let answers: Array<Partial<OpenStackCloudConnectionTest>> = [];

function answer(
  data: Partial<OpenStackCloudConnectionTest>,
): OpenStackCloudConnectionTest {
  const item: OpenStackCloudConnectionTest = new OpenStackCloudConnectionTest();
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
    jest.advanceTimersByTime(OPENSTACK_TEST_POLL_INTERVAL_IN_MS);
  });
  await flush();
}

function created(): OpenStackCloudConnectionTest {
  return (
    createMock.mock.calls[0]![0] as { model: OpenStackCloudConnectionTest }
  ).model;
}

async function startTest(): Promise<void> {
  fireEvent.click(screen.getByTestId("openstack-test-connection-button"));
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

describe("what it tests", () => {
  test("cannot test before the address, credential and probe are in", () => {
    render(
      <OpenStackConnectionTestPanel
        input={{ ...INPUT, credentialSecret: "" }}
      />,
    );

    const button: HTMLElement = screen.getByTestId(
      "openstack-test-connection-button",
    );

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("an application credential: what the form holds, trimmed, and the secret as typed", async () => {
    render(
      <OpenStackConnectionTestPanel
        input={{
          ...INPUT,
          trustedCertificateFingerprints: [FINGERPRINT],
        }}
      />,
    );

    await startTest();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(created().authUrl).toBe("https://keystone.example.com:5000/v3");
    expect(created().endpointInterface).toBe("internal");
    expect(created().collectionRegions).toEqual(["RegionOne"]);
    expect(created().applicationCredentialId).toBe("credential-id");
    // A secret's spaces are its own.
    expect(created().credentialSecret).toBe("a secret ");
    expect(created().keystoneUsername).toBeUndefined();
    expect(created().projectName).toBeUndefined();
    expect(created().probeId?.toString()).toBe(PROBE_ID);
    expect(created().trustedCertificateFingerprints).toEqual([FINGERPRINT]);
    expect(created().openStackCloudId).toBeUndefined();
  });

  test("a user name and password: its names go with it, and no application credential", async () => {
    render(
      <OpenStackConnectionTestPanel
        input={{
          ...INPUT,
          credentialKind: "password",
          applicationCredentialId: "typed before the switch",
          keystoneUsername: " reader ",
          userDomainName: " Example ",
          projectName: " monitoring ",
          projectDomainName: " Example ",
        }}
      />,
    );

    await startTest();

    expect(created().keystoneUsername).toBe("reader");
    expect(created().userDomainName).toBe("Example");
    expect(created().projectName).toBe("monitoring");
    expect(created().projectDomainName).toBe("Example");
    expect(created().applicationCredentialId).toBeUndefined();
  });

  test("a saved cloud is tested with its own credential when no secret is typed", async () => {
    render(
      <OpenStackConnectionTestPanel
        input={{
          ...INPUT,
          credentialSecret: "",
          openStackCloudId: new ObjectID(CLOUD_ID),
        }}
      />,
    );

    await startTest();

    expect(created().credentialSecret).toBeUndefined();
    expect(created().applicationCredentialId).toBeUndefined();
    expect(created().openStackCloudId?.toString()).toBe(CLOUD_ID);
  });
});

describe("what it says", () => {
  test("waits, then connects, then lists what the credential reads and stops asking", async () => {
    answers = [
      { status: OpenStackConnectionTestStatus.Running },
      { status: OpenStackConnectionTestStatus.Succeeded, summary: WORKED },
    ];

    render(<OpenStackConnectionTestPanel input={INPUT} />);

    await startTest();

    expect(
      screen.getByText("Waiting for the probe to pick the test up…"),
    ).toBeInTheDocument();

    await tick();
    expect(
      screen.getByText("The probe is connecting to the cloud…"),
    ).toBeInTheDocument();

    await tick();
    expect(
      screen.getByText(
        "Connected. This credential has the Project view: its own project's instances, volumes and networks, and no infrastructure.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Logged in to project monitoring with the roles reader.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("openstack-test-full-reads")).toHaveTextContent(
      "1 read answered in full.",
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "openstack-test-read",
    );

    // What is refused comes first.
    expect(rows[0]).toHaveAttribute("data-access", "Refused");
    expect(rows[0]).toHaveTextContent(
      "Networking (Neutron), RegionOne: agents",
    );
    expect(rows[0]).toHaveTextContent("HTTP 403");
    expect(rows[1]).toHaveAttribute("data-access", "OwnProjectOnly");
    expect(rows[1]).toHaveTextContent("Own project only");
    expect(rows[1]).toHaveTextContent("1 project in 3 rows");
    expect(rows[1]).toHaveTextContent(
      "Goes without it: Every other project's instances",
    );
    expect(rows[1]).toHaveTextContent(
      "What opens it: openstack role add --user oneuptime --project other reader",
    );

    expect(screen.getByTestId("openstack-test-warnings")).toHaveTextContent(
      "Keystone's list_limit cut the project list short.",
    );

    // Settled: no more reads.
    const reads: number = getItemMock.mock.calls.length;
    await tick();
    expect(getItemMock.mock.calls.length).toBe(reads);

    expect(
      (getItemMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(TEST_ID);
    // It never asks for the secret back.
    expect(
      (getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select["credentialSecret"],
    ).toBeUndefined();
  });

  test.each([
    [
      OpenStackCollectionErrorCode.AddressNotFound,
      "The probe cannot find this host name",
      "Check the spelling, or use an IP address.",
    ],
    [
      OpenStackCollectionErrorCode.ConnectionRefused,
      "Nothing answers on that port",
      "Check the address and port.",
    ],
    [
      OpenStackCollectionErrorCode.TlsFailed,
      "The secure connection failed",
      "The API and the probe could not agree on TLS.",
    ],
  ])(
    "%s says exactly what failed and what to do",
    async (
      code: OpenStackCollectionErrorCode,
      title: string,
      nextStep: string,
    ) => {
      answers = [
        {
          status: OpenStackConnectionTestStatus.Failed,
          errorCode: code,
          errorMessage: "What the probe wrote about keystone.example.com.",
        },
      ];

      render(<OpenStackConnectionTestPanel input={INPUT} />);

      await startTest();
      await tick();

      expect(screen.getByText(title)).toBeInTheDocument();
      expect(
        screen.getByText("What the probe wrote about keystone.example.com."),
      ).toBeInTheDocument();
      expect(screen.getByTestId("openstack-test-result")).toHaveTextContent(
        nextStep,
      );
      expect(
        screen.queryByTestId("openstack-trust-certificate-button"),
      ).toBeNull();
    },
  );

  test("a catalog on plain HTTP says exactly that: turn on TLS, or use the agent", async () => {
    answers = [
      {
        status: OpenStackConnectionTestStatus.Failed,
        errorCode: OpenStackCollectionErrorCode.InsecureEndpoint,
        errorMessage:
          "The catalog puts Compute (Nova) on plain HTTP, such as http://10.0.0.1:8774. A credential's token is never sent unencrypted, so the probe read none of them. Turn on TLS for these APIs, pick another endpoint interface, or use the OpenStack agent for this cloud.",
      },
    ];

    render(<OpenStackConnectionTestPanel input={INPUT} />);

    await startTest();
    await tick();

    expect(
      screen.getByText("The catalog names a plain HTTP endpoint"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("openstack-test-result")).toHaveTextContent(
      "http://10.0.0.1:8774",
    );
    expect(screen.getByTestId("openstack-test-result")).toHaveTextContent(
      "Turn on TLS for that API, pick another endpoint interface, or use the OpenStack agent for this cloud.",
    );
  });

  test("an untrusted certificate is shown with who presented it, and trusted in one click", async () => {
    answers = [
      {
        status: OpenStackConnectionTestStatus.Failed,
        errorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
        errorMessage:
          "nova.example.com's certificate is not trusted by the probe. Nothing was sent.",
        presentedCertificate: {
          fingerprint256: FINGERPRINT,
          subject: "CN=nova.example.com",
          issuer: "CN=Cloud CA",
          isSelfSigned: false,
          validTo: "2028-01-01T00:00:00.000Z",
          host: "nova.example.com",
          port: 8774,
        },
      },
    ];

    const trusted: Array<string> = [];

    render(
      <OpenStackConnectionTestPanel
        input={INPUT}
        onTrustCertificate={(fingerprint: string) => {
          trusted.push(fingerprint);
        }}
      />,
    );

    await startTest();
    await tick();

    expect(
      screen.getByText("The API's certificate is not trusted"),
    ).toBeInTheDocument();
    expect(screen.getByText("CN=nova.example.com")).toBeInTheDocument();
    expect(screen.getByText("CN=Cloud CA")).toBeInTheDocument();
    // A cloud can have a host per service: it says whose this one is.
    expect(screen.getByText("nova.example.com:8774")).toBeInTheDocument();
    expect(
      screen.getByTestId("openstack-presented-fingerprint"),
    ).toHaveTextContent(FINGERPRINT);

    fireEvent.click(screen.getByTestId("openstack-trust-certificate-button"));
    expect(trusted).toEqual([FINGERPRINT]);
  });

  test("a certificate that changed is offered the same way, and only when there is somewhere to trust it", async () => {
    answers = [
      {
        status: OpenStackConnectionTestStatus.Failed,
        errorCode: OpenStackCollectionErrorCode.CertificateChanged,
        presentedCertificate: {
          fingerprint256: OTHER_FINGERPRINT,
          subject: "CN=keystone.example.com",
          issuer: "CN=Cloud CA",
          isSelfSigned: true,
        },
      },
    ];

    render(<OpenStackConnectionTestPanel input={INPUT} />);

    await startTest();
    await tick();

    expect(
      screen.getByTestId("openstack-presented-fingerprint"),
    ).toHaveTextContent(OTHER_FINGERPRINT);
    expect(
      screen.queryByTestId("openstack-trust-certificate-button"),
    ).toBeNull();
  });

  test("a test that stopped part of the way says what it found first", async () => {
    answers = [
      {
        status: OpenStackConnectionTestStatus.Failed,
        errorCode: OpenStackCollectionErrorCode.NoPermission,
        errorMessage: "The credential may not read what monitoring needs.",
        summary: { ...WORKED, accessLevel: "Other" },
      },
    ];

    render(<OpenStackConnectionTestPanel input={INPUT} />);

    await startTest();
    await tick();

    expect(screen.getAllByTestId("openstack-test-read")).toHaveLength(2);
    expect(screen.getByTestId("openstack-test-regions")).toHaveTextContent(
      "RegionTwo",
    );
  });

  test("the regions the catalog names fill in the form, unless they already have", async () => {
    answers = [
      { status: OpenStackConnectionTestStatus.Succeeded, summary: WORKED },
    ];

    const picked: Array<Array<string>> = [];

    const { unmount } = render(
      <OpenStackConnectionTestPanel
        input={INPUT}
        onUseRegions={(regions: Array<string>) => {
          picked.push(regions);
        }}
      />,
    );

    await startTest();
    await tick();

    fireEvent.click(screen.getByTestId("openstack-use-regions-button"));
    expect(picked).toEqual([["RegionOne", "RegionTwo"]]);

    unmount();

    answers = [
      { status: OpenStackConnectionTestStatus.Succeeded, summary: WORKED },
    ];

    render(
      <OpenStackConnectionTestPanel
        input={{ ...INPUT, regions: ["RegionTwo", "RegionOne"] }}
        onUseRegions={(regions: Array<string>) => {
          picked.push(regions);
        }}
      />,
    );

    await startTest();
    await tick();

    expect(screen.queryByTestId("openstack-use-regions-button")).toBeNull();
  });

  test("a second test starts clean and the first one's late answer is dropped", async () => {
    answers = [
      {
        status: OpenStackConnectionTestStatus.Failed,
        errorCode: OpenStackCollectionErrorCode.ConnectionRefused,
      },
    ];

    render(<OpenStackConnectionTestPanel input={INPUT} />);

    await startTest();
    await tick();

    expect(
      screen.getByText("Nothing answers on that port"),
    ).toBeInTheDocument();
    expect(screen.getByText("Test again")).toBeInTheDocument();

    answers = [
      { status: OpenStackConnectionTestStatus.Succeeded, summary: WORKED },
    ];

    await startTest();

    expect(screen.queryByText("Nothing answers on that port")).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(2);

    await tick();

    expect(
      screen.getByText(
        "Logged in to project monitoring with the roles reader.",
      ),
    ).toBeInTheDocument();
  });

  test("a refusal from the server is said as it is", async () => {
    createMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Enter an application credential's ID and secret.");
    });

    render(<OpenStackConnectionTestPanel input={INPUT} />);

    await startTest();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter an application credential's ID and secret.",
    );
  });

  test("a read that fails says so and stops asking", async () => {
    getItemMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("The server is not answering.");
    });

    render(<OpenStackConnectionTestPanel input={INPUT} />);

    await startTest();
    await tick();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server is not answering.",
    );

    const reads: number = getItemMock.mock.calls.length;
    await tick();
    expect(getItemMock.mock.calls.length).toBe(reads);
  });

  test("a test nobody answers stops being waited for, and says what to check", async () => {
    render(<OpenStackConnectionTestPanel input={INPUT} />);

    const started: number = Date.now();
    jest.setSystemTime(started);

    await startTest();
    await tick();

    jest.setSystemTime(started + OPENSTACK_TEST_MAX_WAIT_IN_MS + 1);
    await tick();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The test did not finish. Check that the probe is connected, then test again.",
    );

    const reads: number = getItemMock.mock.calls.length;
    await tick();
    expect(getItemMock.mock.calls.length).toBe(reads);
  });

  test("leaving the page stops asking", async () => {
    answers = [{ status: OpenStackConnectionTestStatus.Running }];

    const { unmount } = render(<OpenStackConnectionTestPanel input={INPUT} />);

    await startTest();
    await tick();

    const reads: number = getItemMock.mock.calls.length;

    unmount();
    await tick();

    expect(getItemMock.mock.calls.length).toBe(reads);
  });

  test("is not offered to someone who may not test a connection", () => {
    permissionsForTest = [Permission.Viewer];
    PermissionGate.clearPermissionPropsCache();

    render(<OpenStackConnectionTestPanel input={INPUT} />);

    expect(screen.queryByTestId("openstack-test-connection-button")).toBeNull();
  });
});
