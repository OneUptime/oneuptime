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
import { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Connect vCenter and Edit Connection: what they ask, on which step, and the
 * certificate step's "Test connection" filling in the certificate it found
 * when "Trust this certificate" is clicked.
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

import {
  VMWARE_CONNECTION_EDIT_FORM_STEPS,
  VMWARE_CONNECT_FORM_STEPS,
  getVMwareConnectFormFields,
  getVMwareConnectionFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareConnectionFormFields";
import { VMWARE_TEST_POLL_INTERVAL_IN_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareProbeCollectionView";
import Probe from "../../../Models/DatabaseModels/Probe";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterConnectionTest from "../../../Models/DatabaseModels/VMwareVCenterConnectionTest";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import VMwareCollectionErrorCode from "../../../Types/VMware/VMwareCollectionError";
import VMwareConnectionTestStatus from "../../../Types/VMware/VMwareConnectionTestStatus";
import Field, {
  FieldFooterProps,
} from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

const ENGLISH: Translator = createTranslator(undefined, "en");

const OWN_PROBE: string = "8e8e8e8e-0000-4000-8000-000000000001";
const GLOBAL_PROBE: string = "8e8e8e8e-0000-4000-8000-000000000002";
const VCENTER_ID: string = "8e8e8e8e-0000-4000-8000-000000000003";
const TEST_ID: string = "8e8e8e8e-0000-4000-8000-000000000004";
const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

function probes(): Array<Probe> {
  const own: Probe = new Probe();
  own._id = OWN_PROBE;
  own.name = "Datacenter probe";
  own.isGlobalProbe = false;

  const global: Probe = new Probe();
  global._id = GLOBAL_PROBE;
  global.name = "probe-1";
  global.isGlobalProbe = true;

  return [own, global];
}

type VCenterField = Field<VMwareVCenter>;

function keyOf(field: VCenterField): string {
  return Object.keys(field.field || {})[0] || "";
}

function fieldNamed(fields: Array<VCenterField>, key: string): VCenterField {
  const found: VCenterField | undefined = fields.find(
    (field: VCenterField): boolean => {
      return keyOf(field) === key;
    },
  );

  expect(found).toBeDefined();
  return found!;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 8; index++) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();

  createMock.mockReset();
  createMock.mockImplementation(async (): Promise<unknown> => {
    const test: VMwareVCenterConnectionTest = new VMwareVCenterConnectionTest();
    test._id = TEST_ID;
    return { data: test };
  });

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const test: VMwareVCenterConnectionTest = new VMwareVCenterConnectionTest();
    test.status = VMwareConnectionTestStatus.Failed;
    test.errorCode = VMwareCollectionErrorCode.UntrustedCertificate;
    test.presentedCertificate = {
      fingerprint256: FINGERPRINT,
      subject: "CN=vcsa",
      issuer: "CN=CA",
      isSelfSigned: false,
    };
    return test;
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Connect vCenter", () => {
  const fields: () => Array<VCenterField> = (): Array<VCenterField> => {
    return getVMwareConnectFormFields({
      probes: probes(),
      isBillingEnabled: true,
      translator: ENGLISH,
    }) as Array<VCenterField>;
  };

  test("walks two steps: where vCenter is and how to log in, then its certificate and name", () => {
    expect(
      VMWARE_CONNECT_FORM_STEPS.map((step: { id: string; title: string }) => {
        return [step.id, step.title];
      }),
    ).toEqual([
      ["connection", "vCenter"],
      ["certificate-and-name", "Certificate and Name"],
    ]);

    expect(
      fields().map((field: VCenterField) => {
        return [keyOf(field), field.stepId, Boolean(field.collapsibleSection)];
      }),
    ).toEqual([
      ["vcenterUrl", "connection", false],
      ["vcenterUsername", "connection", false],
      ["vcenterPassword", "connection", false],
      ["collectionProbe", "connection", false],
      ["trustedCertificateFingerprint", "certificate-and-name", false],
      ["name", "certificate-and-name", false],
      ["description", "certificate-and-name", true],
      ["collectionIntervalInMinutes", "certificate-and-name", true],
      ["labels", "certificate-and-name", true],
    ]);
  });

  test("asks for the address, user, password and probe; the name defaults to the host", () => {
    const all: Array<VCenterField> = fields();

    expect(fieldNamed(all, "vcenterUrl").required).toBe(true);
    expect(fieldNamed(all, "vcenterUsername").required).toBe(true);
    expect(fieldNamed(all, "vcenterPassword")).toMatchObject({
      required: true,
      fieldType: FormFieldSchemaType.Password,
      autoComplete: "new-password",
    });
    expect(fieldNamed(all, "collectionProbe").required).toBe(true);
    expect(fieldNamed(all, "trustedCertificateFingerprint").required).toBe(
      false,
    );
    expect(fieldNamed(all, "name")).toMatchObject({
      required: false,
      placeholder: "Defaults to the vCenter's host name",
    });
    expect(fieldNamed(all, "collectionIntervalInMinutes").defaultValue).toBe(2);
  });

  test("offers only probes that may receive a password, starting on the only one", () => {
    const probe: VCenterField = fieldNamed(fields(), "collectionProbe");

    expect(probe.dropdownOptions).toEqual([
      { label: "Datacenter probe", value: OWN_PROBE },
    ]);
    expect(probe.defaultValue).toBe(OWN_PROBE);

    const selfHosted: VCenterField = fieldNamed(
      getVMwareConnectFormFields({
        probes: probes(),
        isBillingEnabled: false,
        translator: ENGLISH,
      }) as Array<VCenterField>,
      "collectionProbe",
    );

    expect(selfHosted.dropdownOptions).toHaveLength(2);
    expect(selfHosted.defaultValue).toBe("");
  });

  test("holds the address and the certificate to the server's rules as they are typed", () => {
    const all: Array<VCenterField> = fields();

    expect(
      fieldNamed(all, "vcenterUrl").customValidation!({
        vcenterUrl: "http://vcsa",
      } as FormValues<VMwareVCenter>),
    ).toBe(
      "Use https://. vCenter serves its API over HTTPS only, and OneUptime never sends a password unencrypted.",
    );
    expect(
      fieldNamed(all, "trustedCertificateFingerprint").customValidation!({
        trustedCertificateFingerprint: "AB:CD",
      } as FormValues<VMwareVCenter>),
    ).toBe(
      "Enter a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
    );
  });

  test("Test connection under the certificate fills it in with the one vCenter presented", async () => {
    jest.useFakeTimers();

    const certificate: VCenterField = fieldNamed(
      fields(),
      "trustedCertificateFingerprint",
    );
    const setValues: Array<unknown> = [];
    const footer: FieldFooterProps = {
      setValue: (value: unknown): void => {
        setValues.push(value);
      },
    };

    render(
      certificate.getFooterElement!(
        {
          vcenterUrl: "vcsa.example.com",
          vcenterUsername: "oneuptime@vsphere.local",
          vcenterPassword: "secret",
          collectionProbe: OWN_PROBE,
        } as FormValues<VMwareVCenter>,
        undefined,
        footer,
      ) as ReactElement,
    );

    fireEvent.click(screen.getByTestId("vmware-test-connection-button"));
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(VMWARE_TEST_POLL_INTERVAL_IN_MS);
    });
    await flush();

    fireEvent.click(screen.getByTestId("vmware-trust-certificate-button"));
    expect(setValues).toEqual([FINGERPRINT]);
  });
});

describe("Edit Connection", () => {
  const fields: () => Array<VCenterField> = (): Array<VCenterField> => {
    return getVMwareConnectionFormFields({
      probes: probes(),
      isBillingEnabled: true,
      translator: ENGLISH,
      vmwareVCenterId: new ObjectID(VCENTER_ID),
    }) as Array<VCenterField>;
  };

  test("is how the vCenter is reached - its name, description and labels are edited with its details", () => {
    expect(
      VMWARE_CONNECTION_EDIT_FORM_STEPS.map((step: { id: string }) => {
        return step.id;
      }),
    ).toEqual(["connection", "certificate"]);

    expect(fields().map(keyOf)).toEqual([
      "vcenterUrl",
      "vcenterUsername",
      "vcenterPassword",
      "collectionProbe",
      "trustedCertificateFingerprint",
      "collectionIntervalInMinutes",
    ]);
  });

  test("keeps the saved password unless one is typed, and keeps the probe it has", () => {
    const all: Array<VCenterField> = fields();

    expect(fieldNamed(all, "vcenterPassword").required).toBe(false);
    expect(fieldNamed(all, "collectionProbe").defaultValue).toBeUndefined();
    expect(
      fieldNamed(all, "collectionIntervalInMinutes").defaultValue,
    ).toBeUndefined();
  });

  test("a test with no password typed is of the saved vCenter's", async () => {
    render(
      fieldNamed(fields(), "trustedCertificateFingerprint").getFooterElement!(
        {
          vcenterUrl: "https://vcsa.example.com",
          vcenterUsername: "oneuptime@vsphere.local",
          collectionProbe: { _id: OWN_PROBE },
        } as FormValues<VMwareVCenter>,
        undefined,
        { setValue: (): void => {} },
      ) as ReactElement,
    );

    fireEvent.click(screen.getByTestId("vmware-test-connection-button"));
    await flush();

    const created: VMwareVCenterConnectionTest = (
      createMock.mock.calls[0]![0] as { model: VMwareVCenterConnectionTest }
    ).model;
    expect(created.vmwareVCenterId?.toString()).toBe(VCENTER_ID);
    expect(created.vcenterPassword).toBeUndefined();
    expect(created.probeId?.toString()).toBe(OWN_PROBE);
  });
});
