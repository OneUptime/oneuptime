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
 * A CUSTOM DOMAIN'S UPLOADED KEY ON THE EDIT DIALOG: NEVER LOADED, ASKED FOR
 * WHEN THE DOMAIN MOVES TO ITS OWN CERTIFICATE, KEPT WHEN IT IS LEFT BLANK ON
 * ONE THAT SERVES IT ALREADY.
 *
 * The key a status page's, a dashboard's or a form's custom domain serves
 * its own certificate with is write-only: nobody reads it back, not even a
 * Project Owner. The Edit dialog's certificate options, as CustomDomainsTable
 * gives them (CustomDomainCertificateFields), therefore never load the key,
 * and what they ask depends on the domain as the dialog read it:
 *
 *   - a domain that serves its own certificate has a key stored: the field
 *     is empty, optional, and says that blank keeps the stored key, so a
 *     renewed certificate is pasted alone;
 *   - a domain on the free certificate has none: switching Upload Custom
 *     Certificate on asks for the key, required, saying why it is needed and
 *     that it is never shown again. It used to say "Leave blank to keep the
 *     stored value." with nothing stored, and the save was refused over the
 *     form.
 *
 * And a save the server refuses because of the pair says why under the half
 * it is about - a key that does not belong to the certificate under
 * Certificate Private Key - never above the form, and never with what was
 * pasted.
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
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FormDomain from "../../../Models/DatabaseModels/FormDomain";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  UPLOADED_CERTIFICATE_MISSING_MESSAGE,
  UPLOADED_CERTIFICATE_REFUSALS,
  UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE,
  UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE,
  UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE,
  UPLOADED_KEY_UNREADABLE_MESSAGE,
} from "../../../Types/CustomDomain/UploadedCertificateRefusals";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import { getCustomDomainCertificateFields } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCertificateFields";
import type { CustomDomainModel } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainKinds";

const DOMAIN_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

// One line each: the display-value matcher reads a textarea's lines as one.
const STORED_CERTIFICATE: string = "-----BEGIN CERTIFICATE----- stored";
const PASTED_CERTIFICATE: string = "-----BEGIN CERTIFICATE----- pasted";
const PASTED_KEY: string = "-----BEGIN PRIVATE KEY----- pasted-key-body";

const CERTIFICATE_PLACEHOLDER: string =
  "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----";
const KEY_PLACEHOLDER: string =
  "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----";

const WHY_THE_KEY: string =
  "OneUptime needs this key to serve your domain over HTTPS. It is stored encrypted and never shown again.";
const KEEP_HINT: string = "Leave blank to keep the stored value.";

const SWITCH_NAME: string = "Upload Custom Certificate";

// A matcher for text that holds these words, read as they are written.
function containing(words: string): RegExp {
  return new RegExp(escapeRegExp(words));
}

// What the domain holds, as the dialog reads it.
interface StoredDomain {
  isCustomCertificate: boolean;
  customCertificate?: string | undefined;
}

let capturedSelect: Record<string, unknown> | null = null;
let savedModels: Array<JSONObject> = [];
// The server's refusal of the next save, if it refuses it.
let saveRefusal: string | null = null;

function makeModelAPI(
  modelType: { new (): CustomDomainModel },
  stored: StoredDomain,
): typeof ModelAPI {
  return {
    getItem: async (data: {
      select: Record<string, unknown>;
    }): Promise<CustomDomainModel | null> => {
      capturedSelect = data.select;

      const domain: CustomDomainModel = new modelType();
      domain._id = DOMAIN_ID.toString();
      domain.isCustomCertificate = stored.isCustomCertificate;

      if (stored.customCertificate) {
        domain.customCertificate = stored.customCertificate;
      }

      // The API answers what was asked for, and nothing else.
      if (data.select["customCertificateKey"]) {
        domain.customCertificateKey = "stored-key-never-shown";
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
      model: CustomDomainModel;
    }): Promise<{ data: JSONObject }> => {
      if (saveRefusal) {
        // As the API refuses a pair it cannot serve: a 400 with the reason.
        throw new HTTPErrorResponse(400, { message: saveRefusal }, {});
      }

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

const KINDS: Array<[string, { new (): CustomDomainModel }]> = [
  ["a status page's", StatusPageDomain],
  ["a dashboard's", DashboardDomain],
  ["a form's", FormDomain],
];

const originalScrollIntoView: unknown = Element.prototype.scrollIntoView;

function useFormEnvironment(): void {
  beforeEach(() => {
    capturedSelect = null;
    savedModels = [];
    saveRefusal = null;
    permissionsForTest = [Permission.ProjectOwner];
    PermissionGate.clearPermissionPropsCache();
    // A field the server refused is brought into view; jsdom scrolls nothing.
    Element.prototype.scrollIntoView = (): void => {};
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    Element.prototype.scrollIntoView =
      originalScrollIntoView as typeof Element.prototype.scrollIntoView;
  });
}

async function renderEditForm(
  modelType: { new (): CustomDomainModel },
  stored: StoredDomain,
): Promise<void> {
  const fields: Array<ModelField<CustomDomainModel>> =
    getCustomDomainCertificateFields();

  await act(async (): Promise<void> => {
    render(
      <ModelForm<CustomDomainModel>
        modelType={modelType}
        modelAPI={makeModelAPI(modelType, stored)}
        id="custom-domain-edit-form"
        name="Custom Domain"
        fields={fields}
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

  await screen.findByRole("switch", { name: SWITCH_NAME });
}

async function flipSwitch(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("switch", { name: SWITCH_NAME }));
  });
}

async function type(element: HTMLElement, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(element, { target: { value: value } });
  });
}

async function pressSave(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
}

async function save(): Promise<void> {
  await pressSave();

  await waitFor(() => {
    expect(savedModels.length).toBe(1);
  });
}

function keyBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: /Certificate Private Key/,
  }) as HTMLTextAreaElement;
}

function certificateBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: /^Certificate$/,
  }) as HTMLTextAreaElement;
}

describe.each(KINDS)(
  "editing %s custom domain that serves its own certificate",
  (_name: string, modelType: { new (): CustomDomainModel }) => {
    useFormEnvironment();

    const SERVES_OWN: StoredDomain = {
      isCustomCertificate: true,
      customCertificate: STORED_CERTIFICATE,
    };

    test("never asks for the key, and still loads the certificate", async () => {
      await renderEditForm(modelType, SERVES_OWN);

      expect(capturedSelect?.["customCertificate"]).toBe(true);
      expect(capturedSelect?.["isCustomCertificate"]).toBe(true);
      expect(capturedSelect?.["customCertificateKey"]).toBeUndefined();
      expect(await screen.findByDisplayValue(STORED_CERTIFICATE)).toBe(
        certificateBox(),
      );
      expect(
        screen.queryByDisplayValue("stored-key-never-shown"),
      ).not.toBeInTheDocument();
    });

    test("offers the key empty and optional, saying why it is empty and that blank keeps it", async () => {
      await renderEditForm(modelType, SERVES_OWN);

      expect(keyBox()).toBe(screen.getByPlaceholderText("Unchanged"));
      expect(keyBox().value).toBe("");
      expect(keyBox()).toHaveAccessibleName(containing("(Optional)"));
      expect(
        screen.getByText(`${WHY_THE_KEY} ${KEEP_HINT}`),
      ).toBeInTheDocument();
    });

    test("a renewed certificate saved with the key left blank keeps the stored key", async () => {
      await renderEditForm(modelType, SERVES_OWN);

      await type(
        screen.getByDisplayValue(STORED_CERTIFICATE),
        "-----BEGIN CERTIFICATE----- renewed",
      );

      await save();

      expect(savedModels[0]?.["customCertificate"]).toBe(
        "-----BEGIN CERTIFICATE----- renewed",
      );
      expect("customCertificateKey" in (savedModels[0] || {})).toBe(false);
    });

    test("a key pasted in is sent", async () => {
      await renderEditForm(modelType, SERVES_OWN);

      await type(keyBox(), PASTED_KEY);

      await save();

      expect(savedModels[0]?.["customCertificateKey"]).toBe(PASTED_KEY);
    });

    test("switched off and on again, it still keeps its key: one is stored", async () => {
      await renderEditForm(modelType, SERVES_OWN);

      await flipSwitch();
      expect(
        screen.queryByRole("textbox", { name: /Certificate Private Key/ }),
      ).toBeNull();

      await flipSwitch();
      expect(keyBox()).toHaveAccessibleName(containing("(Optional)"));
      expect(keyBox()).toBe(screen.getByPlaceholderText("Unchanged"));
    });

    test("a key the server finds missing is said under Certificate Private Key", async () => {
      await renderEditForm(modelType, SERVES_OWN);

      saveRefusal = UPLOADED_CERTIFICATE_MISSING_MESSAGE;
      await pressSave();

      await waitFor(() => {
        expect(keyBox()).toHaveAttribute("aria-invalid", "true");
      });

      expect(keyBox()).toHaveAccessibleDescription(
        containing(UPLOADED_CERTIFICATE_MISSING_MESSAGE),
      );
      expect(
        screen.getAllByText(UPLOADED_CERTIFICATE_MISSING_MESSAGE),
      ).toHaveLength(1);
    });
  },
);

describe.each(KINDS)(
  "editing %s custom domain on the free certificate",
  (_name: string, modelType: { new (): CustomDomainModel }) => {
    useFormEnvironment();

    const FREE_CERTIFICATE: StoredDomain = { isCustomCertificate: false };

    async function switchToOwnCertificate(): Promise<void> {
      await renderEditForm(modelType, FREE_CERTIFICATE);
      await flipSwitch();
      await screen.findByRole("textbox", { name: /Certificate Private Key/ });
    }

    async function pasteThePair(): Promise<void> {
      await type(certificateBox(), PASTED_CERTIFICATE);
      await type(keyBox(), PASTED_KEY);
    }

    test("shows no key while it stays on the free certificate, and never reads one", async () => {
      await renderEditForm(modelType, FREE_CERTIFICATE);

      expect(capturedSelect?.["customCertificateKey"]).toBeUndefined();
      expect(
        screen.queryByRole("textbox", { name: /Certificate Private Key/ }),
      ).toBeNull();
      expect(screen.queryByPlaceholderText("Unchanged")).toBeNull();
    });

    test("switching to its own certificate asks for the key: required, empty, with why", async () => {
      await switchToOwnCertificate();

      expect(keyBox()).toHaveAttribute("placeholder", KEY_PLACEHOLDER);
      expect(keyBox().value).toBe("");
      // Required: its label says no "(Optional)".
      expect(keyBox()).toHaveAccessibleName("Certificate Private Key");
      expect(certificateBox()).toHaveAttribute(
        "placeholder",
        CERTIFICATE_PLACEHOLDER,
      );
      expect(screen.getByText(WHY_THE_KEY)).toBeInTheDocument();
      expect(screen.queryByText(new RegExp(KEEP_HINT))).toBeNull();
      expect(screen.queryByPlaceholderText("Unchanged")).toBeNull();
    });

    test("a save without the key is stopped before it is sent, and says the key is needed", async () => {
      await switchToOwnCertificate();

      await type(certificateBox(), PASTED_CERTIFICATE);
      await pressSave();

      expect(
        await screen.findByText("Certificate Private Key is required."),
      ).toBeInTheDocument();
      expect(savedModels).toEqual([]);
    });

    test("the certificate and its key pasted in are sent, with the switch on", async () => {
      await switchToOwnCertificate();
      await pasteThePair();

      await save();

      expect(savedModels[0]?.["isCustomCertificate"]).toBe(true);
      expect(savedModels[0]?.["customCertificate"]).toBe(PASTED_CERTIFICATE);
      expect(savedModels[0]?.["customCertificateKey"]).toBe(PASTED_KEY);
    });

    test("a key that does not belong to the certificate is said under Certificate Private Key, not above the form", async () => {
      await switchToOwnCertificate();
      await pasteThePair();

      saveRefusal = UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE;
      await pressSave();

      await waitFor(() => {
        expect(keyBox()).toHaveAttribute("aria-invalid", "true");
      });

      expect(keyBox()).toHaveAccessibleDescription(
        containing(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE),
      );
      expect(certificateBox()).not.toHaveAttribute("aria-invalid");
      // Once: not again in the alert above the form.
      expect(
        screen.getAllByText(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE),
      ).toHaveLength(1);
      // What was pasted stays in its box, and is quoted nowhere else.
      expect(
        screen.getByText(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE).textContent,
      ).not.toContain("pasted-key-body");
      expect(keyBox().value).toBe(PASTED_KEY);
      expect(savedModels).toEqual([]);
    });

    test.each([
      UPLOADED_KEY_UNREADABLE_MESSAGE,
      UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE,
    ])(
      "the refusal %s is said under Certificate Private Key",
      async (refusal: string) => {
        await switchToOwnCertificate();
        await pasteThePair();

        saveRefusal = refusal;
        await pressSave();

        await waitFor(() => {
          expect(keyBox()).toHaveAttribute("aria-invalid", "true");
        });

        expect(keyBox()).toHaveAccessibleDescription(containing(refusal));
        expect(certificateBox()).not.toHaveAttribute("aria-invalid");
      },
    );

    test("a certificate that cannot be read is said under Certificate", async () => {
      await switchToOwnCertificate();
      await pasteThePair();

      saveRefusal = UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE;
      await pressSave();

      await waitFor(() => {
        expect(certificateBox()).toHaveAttribute("aria-invalid", "true");
      });

      expect(certificateBox()).toHaveAccessibleDescription(
        containing(UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE),
      );
      expect(keyBox()).not.toHaveAttribute("aria-invalid");
      expect(
        screen.getAllByText(UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE),
      ).toHaveLength(1);
    });

    test("pasting a new key puts the refusal about the key away", async () => {
      await switchToOwnCertificate();
      await pasteThePair();

      saveRefusal = UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE;
      await pressSave();

      await waitFor(() => {
        expect(keyBox()).toHaveAttribute("aria-invalid", "true");
      });

      await type(keyBox(), "-----BEGIN PRIVATE KEY----- the right one");

      expect(
        screen.queryByText(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE),
      ).toBeNull();
      expect(keyBox()).not.toHaveAttribute("aria-invalid");
    });

    test("a refusal about neither half stays above the form", async () => {
      await switchToOwnCertificate();
      await pasteThePair();

      saveRefusal =
        "You do not have permission to edit this custom domain. Ask a project admin.";
      await pressSave();

      expect(await screen.findByText(saveRefusal)).toBeInTheDocument();
      expect(keyBox()).not.toHaveAttribute("aria-invalid");
      expect(certificateBox()).not.toHaveAttribute("aria-invalid");
    });
  },
);

describe("the certificate options' own words", () => {
  test("each refusal of the server is said under exactly one half", () => {
    const fields: Array<ModelField<CustomDomainModel>> =
      getCustomDomainCertificateFields();
    const certificate: ModelField<CustomDomainModel> = fields[1]!;
    const key: ModelField<CustomDomainModel> = fields[2]!;

    for (const refusal of UPLOADED_CERTIFICATE_REFUSALS) {
      const owners: Array<boolean> = [
        Boolean(certificate.ownsServerError?.(refusal)),
        Boolean(key.ownsServerError?.(refusal)),
      ];

      expect(
        owners.filter((owns: boolean): boolean => {
          return owns;
        }),
      ).toHaveLength(1);
    }

    expect(
      certificate.ownsServerError?.(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE),
    ).toBe(false);
    expect(key.ownsServerError?.("Something else entirely.")).toBe(false);
  });

  test("the key's help says why it is needed and that it is never shown again, in one short line", () => {
    const key: ModelField<CustomDomainModel> =
      getCustomDomainCertificateFields()[2]!;

    expect(key.description).toBe(WHY_THE_KEY);
    // With "Leave blank to keep the stored value." after it, still short.
    expect(`${WHY_THE_KEY} ${KEEP_HINT}`.length).toBeLessThanOrEqual(150);
  });

  test("the key is asked for only when the domain as read stored none", () => {
    const key: ModelField<CustomDomainModel> =
      getCustomDomainCertificateFields()[2]!;
    const rule: unknown = key.hasNothingStoredWhenEditing;

    expect(typeof rule).toBe("function");

    const hasNothingStored: (values: Record<string, unknown>) => boolean =
      rule as (values: Record<string, unknown>) => boolean;

    expect(hasNothingStored({ isCustomCertificate: false })).toBe(true);
    expect(hasNothingStored({})).toBe(true);
    expect(hasNothingStored({ isCustomCertificate: true })).toBe(false);
  });
});
