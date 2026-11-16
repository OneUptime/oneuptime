import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A CUSTOM DOMAIN'S UPLOADED KEY ON THE EDIT DIALOG: NEVER LOADED, KEPT WHEN
 * LEFT BLANK.
 *
 * The key a status page's, a dashboard's or a form's custom domain serves
 * its own certificate with is write-only (nobody reads it back, not even a
 * Project Owner). The edit dialog - Upload Custom Certificate, Certificate,
 * Certificate Private Key, as CustomDomainsTable gives them - therefore
 * never asks for the key, offers it empty saying that blank keeps the stored
 * one, and sends a key only when one is pasted. The certificate itself
 * still loads, so a renewal edits it in place. ModelForm's write-only
 * fields do this for any column nobody may read; these pin it for the key.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): { permissions: Array<unknown> } => {
        return {
          permissions: permissionsForTest.map((permission: unknown) => {
            return {
              _type: "UserPermission",
              permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
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

import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FormDomain from "../../../Models/DatabaseModels/FormDomain";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

type DomainModel = StatusPageDomain | DashboardDomain | FormDomain;

const DOMAIN_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

// One line each: the display-value matcher reads a textarea's lines as one.
const STORED_CERTIFICATE: string = "-----BEGIN CERTIFICATE----- stored";
const KEY_PLACEHOLDER: string =
  "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----";
const KEEP_HINT: string = "Leave blank to keep the stored value.";

let capturedSelect: Record<string, unknown> | null = null;
let savedModels: Array<JSONObject> = [];

function makeModelAPI(
  modelType: { new (): DomainModel },
  storedKey: string,
): typeof ModelAPI {
  return {
    getItem: async (data: {
      select: Record<string, unknown>;
    }): Promise<DomainModel | null> => {
      capturedSelect = data.select;

      const domain: DomainModel = new modelType();
      domain._id = DOMAIN_ID.toString();
      domain.isCustomCertificate = true;
      domain.customCertificate = STORED_CERTIFICATE;

      // The API answers what was asked for, and nothing else.
      if (data.select["customCertificateKey"]) {
        domain.customCertificateKey = storedKey;
      }

      return domain;
    },
    getList: async (): Promise<JSONObject> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
    getCommonHeaders: (): JSONObject => {
      return {};
    },
    createOrUpdate: async (data: {
      model: DomainModel;
    }): Promise<{ data: JSONObject }> => {
      savedModels.push(
        (modelType as unknown as typeof DatabaseBaseModel).toJSON(
          data.model,
          modelType,
        ) as JSONObject,
      );
      return { data: {} };
    },
  } as unknown as typeof ModelAPI;
}

// The certificate options as CustomDomainsTable's Edit gives them.
function editFields(): Array<ModelField<DomainModel>> {
  return [
    {
      field: { isCustomCertificate: true },
      title: "Upload Custom Certificate",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: false,
    },
    {
      field: { customCertificate: true },
      title: "Certificate",
      fieldType: FormFieldSchemaType.LongText,
      required: (item: FormValues<DomainModel>): boolean => {
        return Boolean(item.isCustomCertificate);
      },
      placeholder:
        "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      hideColumnDescription: true,
      showIf: (item: FormValues<DomainModel>): boolean => {
        return Boolean(item.isCustomCertificate);
      },
    },
    {
      field: { customCertificateKey: true },
      title: "Certificate Private Key",
      fieldType: FormFieldSchemaType.LongText,
      required: (item: FormValues<DomainModel>): boolean => {
        return Boolean(item.isCustomCertificate);
      },
      placeholder: KEY_PLACEHOLDER,
      hideColumnDescription: true,
      showIf: (item: FormValues<DomainModel>): boolean => {
        return Boolean(item.isCustomCertificate);
      },
    },
  ];
}

const KINDS: Array<[string, { new (): DomainModel }]> = [
  ["a status page's", StatusPageDomain],
  ["a dashboard's", DashboardDomain],
  ["a form's", FormDomain],
];

describe.each(KINDS)(
  "editing %s custom domain as a Project Owner",
  (_name: string, modelType: { new (): DomainModel }) => {
    async function renderEditForm(): Promise<void> {
      await act(async (): Promise<void> => {
        render(
          <ModelForm<DomainModel>
            modelType={modelType}
            modelAPI={makeModelAPI(modelType, "stored-key-never-shown")}
            id="custom-domain-edit-form"
            name="Custom Domain"
            fields={editFields()}
            formType={FormType.Update}
            modelIdToEdit={DOMAIN_ID}
            submitButtonText="Save"
            onSuccess={() => {
              // not exercised
            }}
          />,
        );
      });

      await waitFor(() => {
        expect(capturedSelect).not.toBeNull();
      });

      await screen.findByDisplayValue(STORED_CERTIFICATE);
    }

    async function save(): Promise<void> {
      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      await waitFor(() => {
        expect(savedModels.length).toBe(1);
      });
    }

    beforeEach(() => {
      capturedSelect = null;
      savedModels = [];
      permissionsForTest = [Permission.ProjectOwner];
      PermissionGate.clearPermissionPropsCache();
    });

    afterEach(() => {
      cleanup();
      jest.restoreAllMocks();
    });

    test("never asks for the key, and still loads the certificate", async () => {
      await renderEditForm();

      expect(capturedSelect?.["customCertificate"]).toBe(true);
      expect(capturedSelect?.["isCustomCertificate"]).toBe(true);
      expect(capturedSelect?.["customCertificateKey"]).toBeUndefined();
      expect(
        screen.queryByDisplayValue("stored-key-never-shown"),
      ).not.toBeInTheDocument();
    });

    test("offers the key empty, says blank keeps the stored one, and does not require it", async () => {
      await renderEditForm();

      const keyInput: HTMLTextAreaElement = screen.getByPlaceholderText(
        "Unchanged",
      ) as HTMLTextAreaElement;

      expect(keyInput.value).toBe("");
      expect(keyInput).not.toBeRequired();
      expect(screen.getByText(KEEP_HINT)).toBeInTheDocument();
    });

    test("a renewed certificate saved with the key left blank keeps the stored key", async () => {
      await renderEditForm();

      fireEvent.change(screen.getByDisplayValue(STORED_CERTIFICATE), {
        target: { value: "-----BEGIN CERTIFICATE----- renewed" },
      });

      await save();

      expect(savedModels[0]?.["customCertificate"]).toBe(
        "-----BEGIN CERTIFICATE----- renewed",
      );
      expect("customCertificateKey" in (savedModels[0] || {})).toBe(false);
    });

    test("a key pasted in is sent", async () => {
      await renderEditForm();

      fireEvent.change(screen.getByPlaceholderText("Unchanged"), {
        target: { value: "-----BEGIN PRIVATE KEY-----\nnew" },
      });

      await save();

      expect(savedModels[0]?.["customCertificateKey"]).toBe(
        "-----BEGIN PRIVATE KEY-----\nnew",
      );
    });
  },
);
