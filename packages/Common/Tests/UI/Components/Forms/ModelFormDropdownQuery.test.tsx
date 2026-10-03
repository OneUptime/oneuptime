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
 * dropdownModal.query: an entity dropdown that offers only some rows of its
 * model.
 *
 * The status page Custom Domains form listed every domain of the project in
 * its Domain dropdown - verified or not - and the server then refused an
 * unverified one with "This domain is not verified" after the form was
 * filled in. A dropdown is filled from two lists: the one ModelForm fetches
 * when the form opens, and the one EntityDropdown searches for as its menu
 * opens and the reader types. Both have to be narrowed, or the menu offers
 * the rows the form left out. These drive the real ModelForm, BasicForm,
 * FormField and EntityDropdown against the real StatusPageDomain and Domain
 * models, with only the network stubbed.
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

const VERIFIED_ID: string = "0193c0de-0000-4aaa-8bbb-000000000001";
const UNVERIFIED_ID: string = "0193c0de-0000-4aaa-8bbb-000000000002";

// The project's domains; a request is answered with the ones its query keeps.
const DOMAINS: Array<{ _id: string; domain: string; isVerified: boolean }> = [
  { _id: VERIFIED_ID, domain: "acme.com", isVerified: true },
  { _id: UNVERIFIED_ID, domain: "not-yet-verified.com", isVerified: false },
];

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
        listRequests.push({
          tableName: new data.modelType().tableName || "",
          query: { ...data.query },
          limit: data.limit,
        });

        // Cross a task boundary, as a real request does.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        const rows: Array<unknown> = DOMAINS.filter(
          (row: { isVerified: boolean }) => {
            return (
              data.query["isVerified"] === undefined ||
              data.query["isVerified"] === row.isVerified
            );
          },
        );

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
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import Domain from "../../../../Models/DatabaseModels/Domain";
import StatusPageDomain from "../../../../Models/DatabaseModels/StatusPageDomain";
import Permission from "../../../../Types/Permission";
import PermissionGate from "../../../../UI/Utils/PermissionGate";

function domainField(
  title: string,
  query: Record<string, unknown> | undefined,
  overrideFieldKey?: string,
): Field<StatusPageDomain> {
  const field: Field<StatusPageDomain> = {
    field: { domain: true },
    title: title,
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownModal: {
      type: Domain,
      labelField: "domain",
      valueField: "_id",
      query: query,
    },
    required: false,
    placeholder: "Select domain",
  };

  if (overrideFieldKey) {
    field.overrideFieldKey = overrideFieldKey;
  }

  return field;
}

async function renderForm(fields: Fields<StatusPageDomain>): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<StatusPageDomain>
        modelType={StatusPageDomain}
        name="Create Status Page Domain"
        id="create-status-page-domain-form"
        formType={FormType.Create}
        submitButtonText="Create"
        onSuccess={() => {}}
        fields={fields}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
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

async function openMenu(name: RegExp): Promise<HTMLElement> {
  const input: HTMLElement = await screen.findByRole("combobox", {
    name: name,
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

describe("dropdownModal.query narrows an entity dropdown", () => {
  beforeEach(() => {
    permissionsForTest = [Permission.ProjectOwner];
    PermissionGate.clearPermissionPropsCache();
    listRequests = [];
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("the form fetches only the rows the query keeps", async () => {
    await renderForm([domainField("Domain", { isVerified: true })]);

    await waitFor(() => {
      expect(formRequests()).toHaveLength(1);
    });

    expect(formRequests()[0]!.query).toEqual({ isVerified: true });
  });

  /*
   * EntityDropdown searches the server itself as its menu opens. Without
   * the query there, the menu put the unverified domain right back.
   */
  test("the dropdown's own search is narrowed too, so the menu offers only those rows", async () => {
    await renderForm([domainField("Domain", { isVerified: true })]);

    const menu: HTMLElement = await openMenu(/^Domain/);

    expect(searchRequests().length).toBeGreaterThan(0);

    for (const request of searchRequests()) {
      expect(request.query).toEqual(
        expect.objectContaining({ isVerified: true }),
      );
    }

    expect(optionNames(menu)).toEqual(["acme.com"]);
  });

  test("a dropdown without a query is unchanged: every row, an empty query", async () => {
    await renderForm([domainField("Domain", undefined)]);

    const menu: HTMLElement = await openMenu(/^Domain/);

    expect(formRequests()[0]!.query).toEqual({});
    expect(searchRequests()[0]!.query).toEqual({});
    expect(optionNames(menu).sort()).toEqual([
      "acme.com",
      "not-yet-verified.com",
    ]);
  });

  test("two dropdowns of one model with different queries each get their own list", async () => {
    await renderForm([
      domainField("Verified Domain", { isVerified: true }),
      domainField("Any Domain", { isVerified: false }, "otherDomain"),
    ]);

    await waitFor(() => {
      expect(formRequests()).toHaveLength(2);
    });

    expect(
      formRequests()
        .map((request: ListRequest) => {
          return request.query["isVerified"];
        })
        .sort(),
    ).toEqual([false, true]);
  });

  /*
   * ModelForm caches each dropdown's list by what the list depends on, and
   * fetches again only what it has not seen. A dropdown whose query changes
   * must not be handed the list of the query it had before.
   */
  test("a list under another query is fetched again; the same query is not", async () => {
    const Harness: React.FunctionComponent = (): React.ReactElement => {
      const [onlyVerified, setOnlyVerified] = React.useState<boolean>(true);

      return (
        <>
          <button
            type="button"
            onClick={() => {
              setOnlyVerified(!onlyVerified);
            }}
          >
            Flip query
          </button>
          <ModelForm<StatusPageDomain>
            modelType={StatusPageDomain}
            name="Create Status Page Domain"
            id="create-status-page-domain-form"
            formType={FormType.Create}
            submitButtonText="Create"
            onSuccess={() => {}}
            fields={[domainField("Domain", { isVerified: onlyVerified })]}
          />
        </>
      );
    };

    await act(async (): Promise<void> => {
      render(<Harness />);
    });

    // The first list answers, and is remembered.
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    });

    expect(formRequests()).toHaveLength(1);
    expect(formRequests()[0]!.query).toEqual({ isVerified: true });

    await act(async (): Promise<void> => {
      screen.getByRole("button", { name: "Flip query" }).click();
    });

    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    });

    expect(formRequests()).toHaveLength(2);
    expect(formRequests()[1]!.query).toEqual({ isVerified: false });

    // Back to the first query: that list is already known.
    await act(async (): Promise<void> => {
      screen.getByRole("button", { name: "Flip query" }).click();
    });

    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    });

    expect(formRequests()).toHaveLength(2);
  });
});
