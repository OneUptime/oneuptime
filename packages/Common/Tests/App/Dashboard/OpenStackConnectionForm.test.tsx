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
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Connect Cloud, Collect With a Probe and Edit Connection: what they ask, on which step, what
 * reaches the server, and the last step's "Test connection" filling in the certificate it found
 * and the regions the catalog names.
 *
 * The walks drive the real ModelFormModal, ModelForm and BasicForm. Only the network and the
 * signed-in user's permissions are stubbed.
 */

const createMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const getAllProbesMock: MockFunction = getJestMockFunction();

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
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
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

const OWNER_PERMISSIONS: Array<Permission> = [
  "Public" as Permission,
  "User" as Permission,
  "CurrentUser" as Permission,
  "ProjectOwner" as Permission,
];

let permissionsForTest: Array<Permission> = OWNER_PERMISSIONS;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return permissionsForTest;
      },
      // A snapshot of what the user holds: a form leaves out what they may not read.
      getProjectPermissions: (): { permissions: Array<unknown> } => {
        return {
          permissions: permissionsForTest.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            };
          }),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: permissionsForTest };
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
  OPENSTACK_CONNECTION_EDIT_FORM_STEPS,
  OPENSTACK_CONNECT_FORM_STEPS,
  getOpenStackConnectFormFields,
  getOpenStackConnectionFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackConnectionFormFields";
import OpenStackConnectionFormModal, {
  OpenStackConnectCloudModal,
  OpenStackConnectionFormMode,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackConnectionFormModal";
import { OPENSTACK_TEST_POLL_INTERVAL_IN_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackProbeCollectionView";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudConnectionTest from "../../../Models/DatabaseModels/OpenStackCloudConnectionTest";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionErrorCode from "../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackConnectionTestStatus from "../../../Types/OpenStack/OpenStackConnectionTestStatus";
import Permission from "../../../Types/Permission";
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

const OWN_PROBE: string = "8f8f8f8f-0000-4000-8000-000000000001";
const GLOBAL_PROBE: string = "8f8f8f8f-0000-4000-8000-000000000002";
const CLOUD_ID: string = "8f8f8f8f-0000-4000-8000-000000000003";
const TEST_ID: string = "8f8f8f8f-0000-4000-8000-000000000004";
const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
const OTHER_FINGERPRINT: string =
  "01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF";

const WAIT_TIMEOUT: number = 20000;

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

function onlyOwnProbe(): Array<Probe> {
  return probes().slice(0, 1);
}

type CloudField = Field<OpenStackCloud>;

function keyOf(field: CloudField): string {
  return Object.keys(field.field || {})[0] || "";
}

function fieldNamed(fields: Array<CloudField>, key: string): CloudField {
  const found: CloudField | undefined = fields.find(
    (field: CloudField): boolean => {
      return keyOf(field) === key;
    },
  );

  expect(found).toBeDefined();
  return found!;
}

function isRequired(
  field: CloudField,
  values: Record<string, unknown>,
): boolean {
  return typeof field.required === "function"
    ? field.required(values as FormValues<OpenStackCloud>)
    : Boolean(field.required);
}

function isShown(field: CloudField, values: Record<string, unknown>): boolean {
  return !field.showIf || field.showIf(values as FormValues<OpenStackCloud>);
}

beforeEach(() => {
  permissionsForTest = OWNER_PERMISSIONS;
  PermissionGate.clearPermissionPropsCache();

  createMock.mockReset();
  createMock.mockImplementation(async (): Promise<unknown> => {
    const test: OpenStackCloudConnectionTest =
      new OpenStackCloudConnectionTest();
    test._id = TEST_ID;
    return { data: test };
  });

  getItemMock.mockReset();

  createOrUpdateMock.mockReset();
  createOrUpdateMock.mockImplementation(async (): Promise<unknown> => {
    return { data: { _id: CLOUD_ID } };
  });

  getAllProbesMock.mockReset();
  getAllProbesMock.mockImplementation(async (): Promise<unknown> => {
    return onlyOwnProbe();
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("what Connect Cloud asks", () => {
  const fields: () => Array<CloudField> = (): Array<CloudField> => {
    return getOpenStackConnectFormFields({
      probes: probes(),
      isBillingEnabled: true,
      translator: ENGLISH,
    }) as Array<CloudField>;
  };

  test("walks three steps: where Keystone is, how to log in, then certificates, regions and name", () => {
    expect(
      OPENSTACK_CONNECT_FORM_STEPS.map(
        (step: { id: string; title: string }) => {
          return [step.id, step.title];
        },
      ),
    ).toEqual([
      ["connection", "Keystone"],
      ["credential", "Credential"],
      ["regions-and-name", "Certificates, Regions and Name"],
    ]);

    expect(
      fields().map((field: CloudField) => {
        return [keyOf(field), field.stepId, Boolean(field.collapsibleSection)];
      }),
    ).toEqual([
      ["authUrl", "connection", false],
      ["collectionProbe", "connection", false],
      ["credentialKind", "connection", false],
      ["applicationCredentialId", "credential", false],
      ["keystoneUsername", "credential", false],
      ["projectName", "credential", false],
      ["credentialSecret", "credential", false],
      ["userDomainName", "credential", true],
      ["projectDomainName", "credential", true],
      ["trustedCertificateFingerprints", "regions-and-name", false],
      ["collectionRegions", "regions-and-name", false],
      ["name", "regions-and-name", false],
      ["description", "regions-and-name", true],
      ["endpointInterface", "regions-and-name", true],
      ["collectionIntervalInMinutes", "regions-and-name", true],
      ["collectionOptions", "regions-and-name", true],
      ["labels", "regions-and-name", true],
    ]);
  });

  test("asks for the address, a credential, regions and a probe; the name defaults to the host", () => {
    const all: Array<CloudField> = fields();

    expect(fieldNamed(all, "authUrl").required).toBe(true);
    expect(fieldNamed(all, "collectionProbe").required).toBe(true);
    expect(fieldNamed(all, "credentialSecret")).toMatchObject({
      required: true,
      fieldType: FormFieldSchemaType.Password,
      autoComplete: "new-password",
    });
    expect(fieldNamed(all, "collectionRegions").required).toBe(true);
    expect(fieldNamed(all, "trustedCertificateFingerprints").required).toBe(
      false,
    );
    expect(fieldNamed(all, "name")).toMatchObject({
      required: false,
      placeholder: "Defaults to Keystone's host name",
    });
    expect(fieldNamed(all, "collectionIntervalInMinutes").defaultValue).toBe(2);
    expect(fieldNamed(all, "endpointInterface").defaultValue).toBe("public");
    expect(fieldNamed(all, "credentialKind").defaultValue).toBe(
      "applicationCredential",
    );
  });

  test("asks for what each kind of credential is called, and only that", () => {
    const all: Array<CloudField> = fields();
    const onApplicationCredential: Record<string, unknown> = {
      credentialKind: "applicationCredential",
    };
    const onPassword: Record<string, unknown> = { credentialKind: "password" };

    const id: CloudField = fieldNamed(all, "applicationCredentialId");
    expect(isShown(id, onApplicationCredential)).toBe(true);
    expect(isRequired(id, onApplicationCredential)).toBe(true);
    expect(isShown(id, onPassword)).toBe(false);
    expect(isRequired(id, onPassword)).toBe(false);

    for (const key of ["keystoneUsername", "projectName"]) {
      const field: CloudField = fieldNamed(all, key);
      expect(isShown(field, onPassword)).toBe(true);
      expect(isRequired(field, onPassword)).toBe(true);
      expect(isShown(field, onApplicationCredential)).toBe(false);
      expect(isRequired(field, onApplicationCredential)).toBe(false);
    }

    for (const key of ["userDomainName", "projectDomainName"]) {
      const field: CloudField = fieldNamed(all, key);
      expect(isShown(field, onPassword)).toBe(true);
      expect(isRequired(field, onPassword)).toBe(false);
      expect(isShown(field, onApplicationCredential)).toBe(false);
    }
  });

  test("offers only probes that may receive a credential, starting on the only one", () => {
    const probe: CloudField = fieldNamed(fields(), "collectionProbe");

    expect(probe.dropdownOptions).toEqual([
      { label: "Datacenter probe", value: OWN_PROBE },
    ]);
    expect(probe.defaultValue).toBe(OWN_PROBE);

    const selfHosted: CloudField = fieldNamed(
      getOpenStackConnectFormFields({
        probes: probes(),
        isBillingEnabled: false,
        translator: ENGLISH,
      }) as Array<CloudField>,
      "collectionProbe",
    );

    expect(selfHosted.dropdownOptions).toHaveLength(2);
    expect(selfHosted.defaultValue).toBe("");
  });

  test("holds what is typed to the server's rules, and says what to do about plain HTTP", () => {
    const all: Array<CloudField> = fields();

    expect(
      fieldNamed(all, "authUrl").customValidation!({
        authUrl: "http://keystone.example.com:5000/v3",
      } as FormValues<OpenStackCloud>),
    ).toBe(
      "Use https://. OneUptime never sends a credential or a token unencrypted. For a cloud whose APIs only speak plain HTTP, turn on TLS, or use the OpenStack agent, which runs beside it.",
    );
    expect(
      fieldNamed(all, "trustedCertificateFingerprints").customValidation!({
        trustedCertificateFingerprints: ["AB:CD"],
      } as unknown as FormValues<OpenStackCloud>),
    ).not.toBeNull();
    expect(
      fieldNamed(all, "collectionRegions").customValidation!({
        collectionRegions: ["x".repeat(256)],
      } as unknown as FormValues<OpenStackCloud>),
    ).toBe("That region's name is too long to be one.");
    expect(
      fieldNamed(all, "collectionOptions").customValidation!({
        collectionOptions: { portNetworkIds: "not a list" },
      } as unknown as FormValues<OpenStackCloud>),
    ).toBe("Name ports' networks and projects by their IDs.");
  });

  test("moving to the other kind of credential clears what named the first", () => {
    const kind: CloudField = fieldNamed(fields(), "credentialKind");
    const set: Array<Record<string, unknown>> = [];

    kind.onChange!(
      "password",
      {
        authUrl: "https://keystone.example.com",
        applicationCredentialId: "typed",
      } as FormValues<OpenStackCloud>,
      (values: FormValues<OpenStackCloud>) => {
        set.push(values as Record<string, unknown>);
      },
    );

    expect(set[0]).toEqual({
      authUrl: "https://keystone.example.com",
      applicationCredentialId: "",
    });

    kind.onChange!(
      "applicationCredential",
      {
        keystoneUsername: "typed",
        userDomainName: "typed",
        projectName: "typed",
        projectDomainName: "typed",
      } as FormValues<OpenStackCloud>,
      (values: FormValues<OpenStackCloud>) => {
        set.push(values as Record<string, unknown>);
      },
    );

    expect(set[1]).toEqual({
      keystoneUsername: "",
      userDomainName: "",
      projectName: "",
      projectDomainName: "",
    });
  });

  test("Test connection under the certificates adds the one an API presented to the rest", async () => {
    jest.useFakeTimers();

    getItemMock.mockImplementation(async (): Promise<unknown> => {
      const test: OpenStackCloudConnectionTest =
        new OpenStackCloudConnectionTest();
      test.status = OpenStackConnectionTestStatus.Failed;
      test.errorCode = OpenStackCollectionErrorCode.UntrustedCertificate;
      test.presentedCertificate = {
        fingerprint256: FINGERPRINT,
        subject: "CN=nova",
        issuer: "CN=CA",
        isSelfSigned: false,
      };
      return test;
    });

    const certificates: CloudField = fieldNamed(
      fields(),
      "trustedCertificateFingerprints",
    );
    const setValues: Array<unknown> = [];
    const footer: FieldFooterProps = {
      setValue: (value: unknown): void => {
        setValues.push(value);
      },
    };

    render(
      certificates.getFooterElement!(
        {
          authUrl: "https://keystone.example.com",
          applicationCredentialId: "credential-id",
          credentialSecret: "secret",
          collectionProbe: OWN_PROBE,
          trustedCertificateFingerprints: [OTHER_FINGERPRINT],
        } as unknown as FormValues<OpenStackCloud>,
        undefined,
        footer,
      ) as ReactElement,
    );

    fireEvent.click(screen.getByTestId("openstack-test-connection-button"));

    await act(async () => {
      for (let index: number = 0; index < 8; index++) {
        await Promise.resolve();
      }
    });
    await act(async () => {
      jest.advanceTimersByTime(OPENSTACK_TEST_POLL_INTERVAL_IN_MS);
    });
    await act(async () => {
      for (let index: number = 0; index < 8; index++) {
        await Promise.resolve();
      }
    });

    fireEvent.click(screen.getByTestId("openstack-trust-certificate-button"));
    // A cloud can have a certificate per service.
    expect(setValues).toEqual([[OTHER_FINGERPRINT, FINGERPRINT]]);
  });
});

describe("what Edit Connection asks", () => {
  const fields: () => Array<CloudField> = (): Array<CloudField> => {
    return getOpenStackConnectionFormFields({
      probes: probes(),
      isBillingEnabled: true,
      translator: ENGLISH,
      openStackCloudId: new ObjectID(CLOUD_ID),
    }) as Array<CloudField>;
  };

  test("is how the cloud is reached: its name, description and labels are edited with its details", () => {
    expect(
      OPENSTACK_CONNECTION_EDIT_FORM_STEPS.map((step: { id: string }) => {
        return step.id;
      }),
    ).toEqual(["connection", "credential", "regions-and-name"]);

    expect(fields().map(keyOf)).toEqual([
      "authUrl",
      "collectionProbe",
      "credentialKind",
      "applicationCredentialId",
      "keystoneUsername",
      "projectName",
      "credentialSecret",
      "userDomainName",
      "projectDomainName",
      "trustedCertificateFingerprints",
      "collectionRegions",
      "endpointInterface",
      "collectionIntervalInMinutes",
      "collectionOptions",
    ]);
  });

  test("keeps the saved secret unless one is typed, and what the cloud has saved", () => {
    const all: Array<CloudField> = fields();

    expect(fieldNamed(all, "credentialSecret").required).toBe(false);
    expect(
      fieldNamed(all, "credentialSecret").hasNothingStoredWhenEditing,
    ).toBe(false);
    expect(fieldNamed(all, "collectionProbe").defaultValue).toBeUndefined();
    expect(
      fieldNamed(all, "collectionIntervalInMinutes").defaultValue,
    ).toBeUndefined();
    expect(fieldNamed(all, "endpointInterface").defaultValue).toBeUndefined();
  });

  test("a cloud with no secret saved has to give one", () => {
    const secret: CloudField = fieldNamed(
      getOpenStackConnectionFormFields({
        probes: probes(),
        isBillingEnabled: true,
        translator: ENGLISH,
        openStackCloudId: new ObjectID(CLOUD_ID),
        isSecretRequired: true,
      }) as Array<CloudField>,
      "credentialSecret",
    );

    expect(secret.required).toBe(true);
    expect(secret.hasNothingStoredWhenEditing).toBe(true);
  });

  test("a test with no secret typed is of the saved cloud's", async () => {
    render(
      fieldNamed(fields(), "trustedCertificateFingerprints").getFooterElement!(
        {
          authUrl: "https://keystone.example.com",
          applicationCredentialId: "credential-id",
          collectionProbe: { _id: OWN_PROBE },
        } as unknown as FormValues<OpenStackCloud>,
        undefined,
        { setValue: (): void => {} },
      ) as ReactElement,
    );

    fireEvent.click(screen.getByTestId("openstack-test-connection-button"));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const created: OpenStackCloudConnectionTest = (
      createMock.mock.calls[0]![0] as { model: OpenStackCloudConnectionTest }
    ).model;

    expect(created.openStackCloudId?.toString()).toBe(CLOUD_ID);
    expect(created.credentialSecret).toBeUndefined();
    expect(created.probeId?.toString()).toBe(OWN_PROBE);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The forms themselves
 * ---------------------------------------------------------------------------
 */

function nextButton(): HTMLElement {
  return screen.getByTestId("modal-footer-next-button");
}

function submitButton(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

function submitted(): Record<string, unknown> {
  return (
    createOrUpdateMock.mock.calls[0]![0] as { model: Record<string, unknown> }
  ).model;
}

function typeInto(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value: value } });
}

async function goToNextStep(
  user: UserEvent,
  expectedTestId: string,
): Promise<void> {
  await user.click(nextButton());
  await screen.findByTestId(
    expectedTestId,
    {},
    {
      timeout: WAIT_TIMEOUT,
    },
  );
}

async function openConnectForm(): Promise<{
  user: UserEvent;
  onSuccess: MockFunction;
}> {
  const onSuccess: MockFunction = getJestMockFunction();
  const user: UserEvent = userEvent.setup({ delay: null });

  await act(async (): Promise<void> => {
    render(
      <OpenStackConnectCloudModal
        onClose={() => {}}
        onSuccess={onSuccess as (cloud: OpenStackCloud) => void}
      />,
    );
  });

  await screen.findByTestId(
    "openstack-auth-url",
    {},
    { timeout: WAIT_TIMEOUT },
  );

  return { user, onSuccess };
}

describe("connecting a cloud", () => {
  test("waits for the probes, because the form reads its default probe as it opens", async () => {
    let answer: (value: Array<Probe>) => void = (): void => {};

    getAllProbesMock.mockImplementation((): Promise<Array<Probe>> => {
      return new Promise<Array<Probe>>(
        (resolve: (value: Array<Probe>) => void) => {
          answer = resolve;
        },
      );
    });

    await act(async (): Promise<void> => {
      render(
        <OpenStackConnectCloudModal onClose={() => {}} onSuccess={() => {}} />,
      );
    });

    expect(screen.queryByTestId("openstack-auth-url")).toBeNull();

    await act(async (): Promise<void> => {
      answer(onlyOwnProbe());
    });

    await screen.findByTestId(
      "openstack-auth-url",
      {},
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("with an application credential: makes the cloud a probe collects, with the one kind of credential", async () => {
    const { user, onSuccess } = await openConnectForm();

    typeInto("openstack-auth-url", "https://keystone.example.com:5000/v3");
    await goToNextStep(user, "openstack-application-credential-id");

    // The other kind's fields are not on the form.
    expect(screen.queryByTestId("openstack-keystone-username")).toBeNull();
    expect(screen.queryByTestId("openstack-project-name")).toBeNull();
    expect(screen.queryByText("User Domain")).toBeNull();

    typeInto("openstack-application-credential-id", "credential-id");
    typeInto("openstack-credential-secret", "a secret");
    await goToNextStep(user, "openstack-collection-regions");

    typeInto("openstack-collection-regions", "RegionOne, RegionTwo");
    typeInto("openstack-cloud-name", "prod-eu");

    expect(submitButton()).toHaveTextContent("Connect Cloud");
    await user.click(submitButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const model: Record<string, unknown> = submitted();

    expect(model["collectionMethod"]).toBe(OpenStackCollectionMethod.Probe);
    expect(model["authUrl"]).toBe("https://keystone.example.com:5000/v3");
    expect(model["credentialKind"]).toBe("applicationCredential");
    expect(model["applicationCredentialId"]).toBe("credential-id");
    expect(String(model["credentialSecret"])).toBe("a secret");
    expect(model["keystoneUsername"]).toBeUndefined();
    expect(model["projectName"]).toBeUndefined();
    expect(model["userDomainName"]).toBeUndefined();
    expect(model["projectDomainName"]).toBeUndefined();
    expect((model["collectionProbe"] as Probe)._id).toBe(OWN_PROBE);
    expect(model["collectionRegions"]).toEqual(["RegionOne", "RegionTwo"]);
    expect(model["name"]).toBe("prod-eu");
    expect(model["endpointInterface"]).toBe("public");
    expect(model["collectionIntervalInMinutes"]).toBe(2);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(
      (onSuccess.mock.calls[0]![0] as OpenStackCloud)._id?.toString(),
    ).toBe(CLOUD_ID);
  });

  test("with a user name and password: asks for its names, and clears what named the first kind", async () => {
    const { user } = await openConnectForm();

    typeInto("openstack-auth-url", "https://keystone.example.com:5000/v3");
    await goToNextStep(user, "openstack-application-credential-id");
    typeInto("openstack-application-credential-id", "typed before the switch");

    // Back to the first step, and over to the other kind.
    const progress: HTMLElement = screen.getByRole("navigation", {
      name: "Progress",
    });
    await user.click(within(progress).getByText("Keystone"));
    await screen.findByTestId(
      "openstack-auth-url",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    await user.click(
      screen.getByRole("radio", { name: "User name and password" }),
    );

    await goToNextStep(user, "openstack-keystone-username");
    expect(
      screen.queryByTestId("openstack-application-credential-id"),
    ).toBeNull();

    // Nothing typed yet: what a password needs is said on this step.
    await user.click(nextButton());
    expect(
      await screen.findByText(
        "User Name is required.",
        {},
        {
          timeout: WAIT_TIMEOUT,
        },
      ),
    ).toBeVisible();
    expect(screen.getByText("Project is required.")).toBeVisible();
    expect(screen.getByText("Secret or Password is required.")).toBeVisible();

    typeInto("openstack-keystone-username", "reader");
    typeInto("openstack-project-name", "monitoring");
    typeInto("openstack-credential-secret", "a password");
    await goToNextStep(user, "openstack-collection-regions");
    typeInto("openstack-collection-regions", "RegionOne");

    await user.click(submitButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const model: Record<string, unknown> = submitted();

    expect(model["credentialKind"]).toBe("password");
    expect(model["keystoneUsername"]).toBe("reader");
    expect(model["projectName"]).toBe("monitoring");
    expect(String(model["credentialSecret"])).toBe("a password");
    expect(model["applicationCredentialId"]).toBeUndefined();
  });

  test("a plain HTTP address stops on its step, and says what to do", async () => {
    const { user } = await openConnectForm();

    typeInto("openstack-auth-url", "http://keystone.example.com:5000/v3");
    await user.click(nextButton());

    expect(
      await screen.findByText(
        "Use https://. OneUptime never sends a credential or a token unencrypted. For a cloud whose APIs only speak plain HTTP, turn on TLS, or use the OpenStack agent, which runs beside it.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeVisible();
    expect(
      screen.queryByTestId("openstack-application-credential-id"),
    ).toBeNull();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("it does not connect without a region", async () => {
    const { user } = await openConnectForm();

    typeInto("openstack-auth-url", "https://keystone.example.com:5000/v3");
    await goToNextStep(user, "openstack-application-credential-id");
    typeInto("openstack-application-credential-id", "credential-id");
    typeInto("openstack-credential-secret", "a secret");
    await goToNextStep(user, "openstack-collection-regions");

    await user.click(submitButton());

    expect(
      await screen.findByText(
        "Regions is required.",
        {},
        {
          timeout: WAIT_TIMEOUT,
        },
      ),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("Test connection fills in the certificate it found and the regions the catalog names", async () => {
    getItemMock.mockImplementation(async (): Promise<unknown> => {
      const test: OpenStackCloudConnectionTest =
        new OpenStackCloudConnectionTest();
      test.status = OpenStackConnectionTestStatus.Failed;
      test.errorCode = OpenStackCollectionErrorCode.UntrustedCertificate;
      test.presentedCertificate = {
        fingerprint256: FINGERPRINT,
        subject: "CN=keystone.example.com",
        issuer: "CN=Cloud CA",
        isSelfSigned: false,
      };
      test.summary = {
        credentialKind: "applicationCredential",
        roleNames: [],
        hasAccessRules: false,
        isUnrestricted: false,
        canProbablyWrite: false,
        regionsInCatalog: ["RegionOne", "RegionTwo"],
        servicesByRegion: {},
        accessLevel: "Other",
        reads: [],
        warnings: [],
      };
      return test;
    });

    const { user } = await openConnectForm();

    typeInto("openstack-auth-url", "https://keystone.example.com:5000/v3");
    await goToNextStep(user, "openstack-application-credential-id");
    typeInto("openstack-application-credential-id", "credential-id");
    typeInto("openstack-credential-secret", "a secret");
    await goToNextStep(user, "openstack-collection-regions");

    await user.click(screen.getByTestId("openstack-test-connection-button"));

    await screen.findByTestId(
      "openstack-trust-certificate-button",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    const test: OpenStackCloudConnectionTest = (
      createMock.mock.calls[0]![0] as { model: OpenStackCloudConnectionTest }
    ).model;

    expect(test.authUrl).toBe("https://keystone.example.com:5000/v3");
    expect(test.applicationCredentialId).toBe("credential-id");
    expect(test.credentialSecret).toBe("a secret");
    expect(test.probeId?.toString()).toBe(OWN_PROBE);
    expect(test.collectionRegions).toEqual([]);

    await user.click(screen.getByTestId("openstack-trust-certificate-button"));
    await waitFor(() => {
      expect(screen.getByTestId("openstack-trusted-certificates")).toHaveValue(
        FINGERPRINT,
      );
    });

    await user.click(screen.getByTestId("openstack-use-regions-button"));
    await waitFor(() => {
      expect(screen.getByTestId("openstack-collection-regions")).toHaveValue(
        "RegionOne, RegionTwo",
      );
    });

    await user.click(submitButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(submitted()["trustedCertificateFingerprints"]).toEqual([
      FINGERPRINT,
    ]);
    expect(submitted()["collectionRegions"]).toEqual([
      "RegionOne",
      "RegionTwo",
    ]);
  }, 60000);
});

// A saved cloud as the API returns it: a column holding nothing is a null.
function savedCloud(data: Record<string, unknown>): OpenStackCloud {
  const item: OpenStackCloud = new OpenStackCloud();
  item._id = CLOUD_ID;
  Object.assign(item, data);
  return item;
}

const SAVED_APPLICATION_CREDENTIAL: Record<string, unknown> = {
  collectionMethod: OpenStackCollectionMethod.Probe,
  authUrl: "https://keystone.example.com:5000",
  endpointInterface: "public",
  collectionRegions: ["RegionOne"],
  credentialKind: "applicationCredential",
  applicationCredentialId: "credential-id",
  keystoneUsername: null,
  userDomainName: null,
  projectName: null,
  projectDomainName: null,
  collectionProbe: { _id: OWN_PROBE, name: "Datacenter probe" },
  trustedCertificateFingerprints: [FINGERPRINT],
  collectionIntervalInMinutes: 5,
  collectionOptions: { collectProjectLimits: true },
};

const AGENT_CLOUD: Record<string, unknown> = {
  collectionMethod: OpenStackCollectionMethod.Agent,
  authUrl: null,
  endpointInterface: "public",
  collectionRegions: null,
  credentialKind: null,
  applicationCredentialId: null,
  keystoneUsername: null,
  userDomainName: null,
  projectName: null,
  projectDomainName: null,
  collectionProbe: null,
  trustedCertificateFingerprints: null,
  collectionIntervalInMinutes: 2,
  collectionOptions: null,
};

async function openEditForm(
  mode: OpenStackConnectionFormMode,
  saved: Record<string, unknown>,
  savedForSwitch?: Pick<
    OpenStackCloud,
    "credentialKind" | "collectionProbeId"
  > | null,
): Promise<{ user: UserEvent; onSuccess: MockFunction }> {
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    return savedCloud(saved);
  });

  const onSuccess: MockFunction = getJestMockFunction();
  const user: UserEvent = userEvent.setup({ delay: null });

  await act(async (): Promise<void> => {
    render(
      <OpenStackConnectionFormModal
        mode={mode}
        modelId={new ObjectID(CLOUD_ID)}
        savedCloud={savedForSwitch}
        onClose={() => {}}
        onSuccess={onSuccess as () => void}
      />,
    );
  });

  await screen.findByTestId(
    "openstack-auth-url",
    {},
    { timeout: WAIT_TIMEOUT },
  );

  return { user, onSuccess };
}

async function openStep(user: UserEvent, title: string): Promise<void> {
  const progress: HTMLElement = screen.getByRole("navigation", {
    name: "Progress",
  });
  await user.click(within(progress).getByText(title));
  await waitFor(() => {
    expect(
      progress.querySelector('[aria-current="step"]')?.textContent,
    ).toContain(title);
  });
}

describe("editing a saved cloud's connection", () => {
  test("opens on what is saved, never reads the secret back, and says an empty box keeps it", async () => {
    const { user } = await openEditForm(
      OpenStackConnectionFormMode.Edit,
      SAVED_APPLICATION_CREDENTIAL,
    );

    expect(screen.getByTestId("openstack-auth-url")).toHaveValue(
      "https://keystone.example.com:5000",
    );

    await openStep(user, "Credential");

    expect(
      screen.getByText(
        "Encrypted, never shown again, and sent only to the probe you picked. Leave blank to keep the stored value.",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("openstack-credential-secret")).toHaveAttribute(
      "placeholder",
      "Unchanged",
    );

    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["credentialSecret"]).toBeUndefined();
    expect(select["authUrl"]).toBe(true);
  });

  test("saving with no secret typed sends no secret and none of the other kind's boxes", async () => {
    const { user, onSuccess } = await openEditForm(
      OpenStackConnectionFormMode.Edit,
      SAVED_APPLICATION_CREDENTIAL,
    );

    await openStep(user, "Certificates and Regions");

    typeInto("openstack-collection-regions", "RegionOne, RegionTwo");

    expect(submitButton()).toHaveTextContent("Save Changes");
    await user.click(submitButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const model: Record<string, unknown> = submitted();

    expect(model["_id"]).toBe(CLOUD_ID);
    expect(model["collectionRegions"]).toEqual(["RegionOne", "RegionTwo"]);
    expect(model["credentialSecret"]).toBeUndefined();
    expect(model["applicationCredentialId"]).toBe("credential-id");
    expect(model["credentialKind"]).toBe("applicationCredential");
    // A null or an empty box beside the saved secret would read as a new credential.
    expect(model["keystoneUsername"]).toBeUndefined();
    expect(model["userDomainName"]).toBeUndefined();
    expect(model["projectName"]).toBeUndefined();
    expect(model["projectDomainName"]).toBeUndefined();
    // An edit keeps what it does not change, and stays with the probe.
    expect(model["collectionMethod"]).toBeUndefined();
    expect(model["trustedCertificateFingerprints"]).toEqual([FINGERPRINT]);
    expect(model["collectionIntervalInMinutes"]).toBe(5);
    expect(model["collectionOptions"]).toEqual({ collectProjectLimits: true });
    expect((model["collectionProbe"] as Probe)._id).toBe(OWN_PROBE);

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  test("a password cloud opens on its names, and sends them", async () => {
    const { user } = await openEditForm(OpenStackConnectionFormMode.Edit, {
      ...SAVED_APPLICATION_CREDENTIAL,
      credentialKind: "password",
      applicationCredentialId: null,
      keystoneUsername: "reader",
      userDomainName: "Example",
      projectName: "monitoring",
      projectDomainName: "Example",
    });

    await openStep(user, "Credential");

    expect(screen.getByTestId("openstack-keystone-username")).toHaveValue(
      "reader",
    );
    expect(screen.getByTestId("openstack-project-name")).toHaveValue(
      "monitoring",
    );
    expect(
      screen.queryByTestId("openstack-application-credential-id"),
    ).toBeNull();

    await openStep(user, "Certificates and Regions");
    await user.click(submitButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const model: Record<string, unknown> = submitted();

    expect(model["keystoneUsername"]).toBe("reader");
    expect(model["userDomainName"]).toBe("Example");
    expect(model["projectName"]).toBe("monitoring");
    expect(model["projectDomainName"]).toBe("Example");
    expect(model["applicationCredentialId"]).toBeUndefined();
  });

  test("a refusal from the server is said on the form", async () => {
    createOrUpdateMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "Enter the credential's secret again: a saved one only goes with the credential it was entered for.",
      );
    });

    const { user, onSuccess } = await openEditForm(
      OpenStackConnectionFormMode.Edit,
      SAVED_APPLICATION_CREDENTIAL,
    );

    await openStep(user, "Certificates and Regions");
    await user.click(submitButton());

    expect(
      await screen.findByText(
        "Enter the credential's secret again: a saved one only goes with the credential it was entered for.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeVisible();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe("collecting an agent's cloud with a probe", () => {
  test("starts on an application credential and the only probe, though the columns hold nothing", async () => {
    const { user } = await openEditForm(
      OpenStackConnectionFormMode.SwitchToProbe,
      AGENT_CLOUD,
      null,
    );

    expect(
      screen.getByRole("radio", { name: "Application credential" }),
    ).toBeChecked();

    typeInto("openstack-auth-url", "https://keystone.example.com:5000/v3");
    await goToNextStep(user, "openstack-application-credential-id");
    typeInto("openstack-application-credential-id", "credential-id");

    // Nothing is saved for an agent's cloud, so the secret cannot be kept.
    expect(screen.queryByText("Leave blank", { exact: false })).toBeNull();
    expect(
      screen.getByTestId("openstack-credential-secret"),
    ).not.toHaveAttribute("placeholder", "Unchanged");

    await user.click(nextButton());
    expect(
      await screen.findByText(
        "Secret or Password is required.",
        {},
        {
          timeout: WAIT_TIMEOUT,
        },
      ),
    ).toBeVisible();

    typeInto("openstack-credential-secret", "a secret");
    await goToNextStep(user, "openstack-collection-regions");
    typeInto("openstack-collection-regions", "RegionOne");

    await user.click(submitButton());

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const model: Record<string, unknown> = submitted();

    expect(model["collectionMethod"]).toBe(OpenStackCollectionMethod.Probe);
    expect(model["credentialKind"]).toBe("applicationCredential");
    expect(model["applicationCredentialId"]).toBe("credential-id");
    expect(String(model["credentialSecret"])).toBe("a secret");
    expect((model["collectionProbe"] as Probe)._id).toBe(OWN_PROBE);
    expect(model["collectionRegions"]).toEqual(["RegionOne"]);
    expect(model["keystoneUsername"]).toBeUndefined();
  });

  test("a cloud that had a probe before starts from how it last logged in", async () => {
    await openEditForm(
      OpenStackConnectionFormMode.SwitchToProbe,
      {
        ...AGENT_CLOUD,
        authUrl: "https://keystone.example.com:5000",
        credentialKind: "password",
        keystoneUsername: "reader",
        projectName: "monitoring",
        collectionProbe: { _id: OWN_PROBE },
      },
      {
        credentialKind: "password",
        collectionProbeId: new ObjectID(OWN_PROBE),
      },
    );

    expect(
      screen.getByRole("radio", { name: "User name and password" }),
    ).toBeChecked();
    expect(screen.getByTestId("openstack-auth-url")).toHaveValue(
      "https://keystone.example.com:5000",
    );
  });
});
