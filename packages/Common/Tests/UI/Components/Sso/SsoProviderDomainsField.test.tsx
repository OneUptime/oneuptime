import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE DOMAINS A PROJECT'S SSO PROVIDER SERVES, AS ITS FORM OFFERS THEM
 * (#9824).
 *
 * "Sign in with SSO" finds a project's SAML or OIDC provider by an address's
 * domain: the verified domains of the project the provider lists. So the
 * Domains field on the provider's Sign-in step (Settings > SSO) offers only
 * the domains the project has VERIFIED: an unverified one serves nobody, and
 * picking it would look like it did. The project's own, as every list the
 * Dashboard reads is the project's (its tenant). With none verified yet, the
 * open list says where a domain is verified.
 *
 * These drive the real ModelForm, BasicForm, FormField and EntityDropdown,
 * with the field the provider forms are built with
 * (Common/UI/Components/Sso/SsoProviderFormFields) and the real ProjectSSO,
 * ProjectOIDC and Domain models; only the network is stubbed.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: permissionsForTest };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
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

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

interface ListRequest {
  tableName: string;
  query: Record<string, unknown>;
  limit: number;
}

let listRequests: Array<ListRequest> = [];

interface StoredDomain {
  _id: string;
  domain: string;
  isVerified: boolean;
}

// The project's domains; a request is answered with the ones its query keeps.
let projectDomains: Array<StoredDomain> = [];

const VERIFIED: StoredDomain = {
  _id: "0194d0a1-0000-4aaa-8bbb-000000000001",
  domain: "acme.com",
  isVerified: true,
};

const ALSO_VERIFIED: StoredDomain = {
  _id: "0194d0a1-0000-4aaa-8bbb-000000000002",
  domain: "acme.io",
  isVerified: true,
};

const UNVERIFIED: StoredDomain = {
  _id: "0194d0a1-0000-4aaa-8bbb-000000000003",
  domain: "not-yet-verified.com",
  isVerified: false,
};

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (data: {
        modelType: { new (): { tableName: string | null } };
        query: Record<string, unknown>;
        limit: number;
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        const tableName: string = new data.modelType().tableName || "";

        listRequests.push({
          tableName: tableName,
          query: { ...data.query },
          limit: data.limit,
        });

        // Cross a task boundary, as a real request does.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        const rows: Array<unknown> =
          tableName === "Domain"
            ? projectDomains.filter((row: StoredDomain): boolean => {
                return (
                  data.query["isVerified"] === undefined ||
                  data.query["isVerified"] === row.isVerified
                );
              })
            : [];

        return { data: rows, count: rows.length, skip: 0, limit: data.limit };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string })?.message || "Server Error";
      },
    },
  };
});

import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import Field from "../../../../UI/Components/Forms/Types/Field";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectOIDC from "../../../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../../../Models/DatabaseModels/ProjectSso";
import Permission from "../../../../Types/Permission";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import { getOidcProviderFormFields } from "../../../../UI/Components/Sso/OidcProviderFormFields";
import { getSamlProviderFormFields } from "../../../../UI/Components/Sso/SamlProviderFormFields";
import { SSO_PROVIDER_DOMAINS_EMPTY_LIST } from "../../../../UI/Components/Sso/SsoProviderFormFields";

interface ProviderCase {
  label: string;
  modelType: { new (): BaseModel };
  // The Domains field, as Settings > SSO builds the provider's form.
  domainsField: () => Field<BaseModel>;
}

const domainsOf: (fields: Array<Field<BaseModel>>) => Field<BaseModel> = (
  fields: Array<Field<BaseModel>>,
): Field<BaseModel> => {
  const found: Field<BaseModel> | undefined = fields.find(
    (field: Field<BaseModel>): boolean => {
      return Object.keys(field.field || {})[0] === "domains";
    },
  );

  if (!found) {
    throw new Error("The provider's form has no Domains field.");
  }

  // One step of its own here: the form is drawn without its steps.
  return { ...found, stepId: undefined };
};

const PROVIDERS: Array<ProviderCase> = [
  {
    label: "a SAML provider",
    modelType: ProjectSSO,
    domainsField: (): Field<BaseModel> => {
      return domainsOf(
        getSamlProviderFormFields<BaseModel>({
          withTeams: true,
          withDomains: true,
        }),
      );
    },
  },
  {
    label: "an OIDC provider",
    modelType: ProjectOIDC,
    domainsField: (): Field<BaseModel> => {
      return domainsOf(
        getOidcProviderFormFields<BaseModel>({
          withTeams: true,
          withDomains: true,
          withIdentityProviderSignOut: true,
        }),
      );
    },
  },
];

async function renderForm(providerCase: ProviderCase): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<BaseModel>
        modelType={providerCase.modelType}
        name="Add Provider"
        id="add-provider-form"
        formType={FormType.Create}
        submitButtonText="Add"
        onSuccess={() => {}}
        fields={[providerCase.domainsField()]}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
}

// The form's own list requests; the dropdown's search asks for 50 at a time.
function formRequests(): Array<ListRequest> {
  return listRequests.filter((request: ListRequest): boolean => {
    return request.tableName === "Domain" && request.limit !== 50;
  });
}

function searchRequests(): Array<ListRequest> {
  return listRequests.filter((request: ListRequest): boolean => {
    return request.tableName === "Domain" && request.limit === 50;
  });
}

async function openMenu(): Promise<HTMLElement> {
  const input: HTMLElement = await screen.findByRole("combobox", {
    name: /^Domains/,
  });

  await act(async (): Promise<void> => {
    fireEvent.focus(input);
  });

  // The search behind the menu answers after a task boundary.
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
  });

  return screen.getByTestId("entity-dropdown-menu");
}

function optionNames(menu: HTMLElement): Array<string> {
  return within(menu)
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.textContent?.trim() || "";
    });
}

describe.each(PROVIDERS)(
  "the Domains field of $label",
  (providerCase: ProviderCase) => {
    beforeEach(() => {
      permissionsForTest = [Permission.ProjectOwner];
      PermissionGate.clearPermissionPropsCache();
      listRequests = [];
      projectDomains = [VERIFIED, UNVERIFIED, ALSO_VERIFIED];
    });

    afterEach(() => {
      cleanup();
      jest.restoreAllMocks();
    });

    test("is fetched with the project's verified domains only", async () => {
      await renderForm(providerCase);

      await waitFor(() => {
        expect(formRequests()).toHaveLength(1);
      });

      expect(formRequests()[0]!.query).toEqual({ isVerified: true });
      // Nothing but domains is read for it.
      expect(
        listRequests.every((request: ListRequest): boolean => {
          return request.tableName === "Domain";
        }),
      ).toBe(true);
    });

    test("offers every verified domain, by its name, and never an unverified one", async () => {
      await renderForm(providerCase);

      const menu: HTMLElement = await openMenu();

      for (const request of searchRequests()) {
        expect(request.query).toEqual(
          expect.objectContaining({ isVerified: true }),
        );
      }

      expect(optionNames(menu).sort()).toEqual(["acme.com", "acme.io"]);
      expect(optionNames(menu)).not.toContain("not-yet-verified.com");
    });

    test("with no verified domain, says where to verify one", async () => {
      projectDomains = [UNVERIFIED];

      await renderForm(providerCase);

      const menu: HTMLElement = await openMenu();

      expect(optionNames(menu)).toEqual([]);
      expect(
        within(menu).getByText(SSO_PROVIDER_DOMAINS_EMPTY_LIST),
      ).toBeInTheDocument();
    });

    test("is labelled Domains, says what it does, and is not required", async () => {
      await renderForm(providerCase);

      expect(
        screen.getByText(
          "Sign in with SSO offers this provider to anyone whose email is on one of these domains, which you verify in Project Settings > Advanced > Domains.",
        ),
      ).toBeInTheDocument();
      expect(providerCase.domainsField().required).toBe(false);
    });
  },
);
