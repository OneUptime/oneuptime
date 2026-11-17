import "@testing-library/jest-dom";
import { act, cleanup, render, waitFor } from "@testing-library/react";
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
 * A LIST'S CREATE FORM, OPENED FROM ITS ADDRESS (#7035).
 *
 * Search's Create Status Page, Create On-Call Policy, Create On-Call
 * Schedule, Create Dashboard and Create Workflow open their list with
 * "?create=1", and the shared table opens the list's create form from it
 * (opensCreateFormFromAddress): only for someone the list's Create is open
 * to, again after a reload, and never again once the form is closed - its
 * closing takes the ask off the address, in place, so Back to the list does
 * not open it a second time.
 *
 * The real ModelTable is rendered, with its API injected and its form
 * dialog recorded, so what opens and what closes it are the table's own.
 */

let isMasterAdminForTest: boolean = false;
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
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
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

type RecordedModalProps = {
  title: string;
  formProps: { formType: unknown };
  onClose?: (() => void) | undefined;
  onSuccess?: ((item: unknown) => void | Promise<void>) | undefined;
};

let recordedModalProps: Array<RecordedModalProps> = [];

// The form dialog is recorded, not drawn: what matters is whether it opens.
jest.mock("../../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: RecordedModalProps): React.ReactElement => {
      recordedModalProps.push(props);
      return <div data-testid="model-form-modal" />;
    },
  };
});

import ModelTable from "../../../../UI/Components/ModelTable/ModelTable";
import { ModalType } from "../../../../UI/Components/ModelTable/BaseModelTable";
import { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../../UI/Components/Types/FieldType";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import CreateFormAddress, {
  CREATE_FORM_QUERY_STRING,
} from "../../../../UI/Utils/CreateFormAddress";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { getJestSpyOn } from "../../../Spy";

const LIST_PATH: string = "/dashboard/project-a/status-pages";

function makeModelAPI(): typeof ModelAPI {
  return {
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<StatusPage>> => {
      return {
        data: [],
        count: 0,
        skip: data.skip,
        limit: data.limit,
      };
    },
    count: async (): Promise<number> => {
      return 0;
    },
  } as unknown as typeof ModelAPI;
}

interface TableOptions {
  opensCreateFormFromAddress?: boolean | undefined;
  onCreateClick?: (() => void) | undefined;
  onCreateSuccess?: ((item: StatusPage) => Promise<StatusPage>) | undefined;
  createDisabledReason?: string | undefined;
  isCreateable?: boolean | undefined;
}

function table(options: TableOptions = {}): React.ReactElement {
  return (
    <ModelTable<StatusPage>
      modelType={StatusPage}
      modelAPI={makeModelAPI()}
      id="status-page-table"
      name="Status Pages"
      userPreferencesKey="status-page-table-create-from-address"
      isCreateable={options.isCreateable ?? true}
      isEditable={false}
      isDeleteable={false}
      isViewable={false}
      opensCreateFormFromAddress={
        options.opensCreateFormFromAddress === undefined
          ? true
          : options.opensCreateFormFromAddress
      }
      onCreateClick={options.onCreateClick}
      onCreateSuccess={options.onCreateSuccess}
      createDisabledReason={options.createDisabledReason}
      cardProps={{ title: "Status Pages", description: "Your status pages." }}
      filters={[]}
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
      ]}
    />
  );
}

function goTo(address: string): void {
  window.history.pushState(window.history.state, "", address);
}

// The browser's Back: the entry before this one, as it was left.
async function back(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    window.addEventListener(
      "popstate",
      () => {
        resolve();
      },
      { once: true },
    );
    window.history.back();
  });
}

// The props of each time the form dialog was drawn, the create form's only.
function createForms(): Array<RecordedModalProps> {
  return recordedModalProps.filter((props: RecordedModalProps): boolean => {
    return props.formProps.formType === FormType.Create;
  });
}

// Whether the create form is open now.
function isCreateFormOpen(): boolean {
  return (
    document.querySelector('[data-testid="model-form-modal"]') !== null &&
    createForms().length > 0
  );
}

// The open create form, as it was last drawn.
function lastCreateForm(): RecordedModalProps {
  const forms: Array<RecordedModalProps> = createForms();
  const last: RecordedModalProps | undefined = forms[forms.length - 1];

  if (!last) {
    throw new Error("No create form was opened.");
  }

  return last;
}

// Lets the table's first reads and effects settle.
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

describe("a list's create form, opened from its address (#7035)", () => {
  beforeEach(() => {
    isMasterAdminForTest = false;
    // A Project Admin may create status pages.
    permissionsForTest = [Permission.ProjectAdmin];
    recordedModalProps = [];
    PermissionGate.clearPermissionPropsCache();
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
    window.history.replaceState(window.history.state, "", LIST_PATH);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("?create=1 opens the list's create form, as its Create button does", async () => {
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    render(table());

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });
    expect(lastCreateForm().title).toContain("Status Page");
    // While the form is open, the address still asks for it.
    expect(window.location.search).toBe("?create=1");
  });

  test("a reload keeps it open: the table drawn again from the same address opens it again", async () => {
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    const first: ReturnType<typeof render> = render(table());

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });

    // The page is drawn again from scratch, the address as it was.
    first.unmount();
    recordedModalProps = [];
    render(table());

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });
  });

  test("closing the form takes create=1 off the address, in place, and keeps the rest of it", async () => {
    goTo(`${LIST_PATH}?view=compact&create=1`);
    const historyLength: number = window.history.length;
    render(table());

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });

    act(() => {
      lastCreateForm().onClose!();
    });

    expect(window.location.pathname).toBe(LIST_PATH);
    expect(window.location.search).toBe("?view=compact");
    // Replaced, not added: Back leaves the list rather than opening the form.
    expect(window.history.length).toBe(historyLength);
    expect(CreateFormAddress.isAskedFor()).toBe(false);
  });

  test("Back to the list once the form is closed never opens it again", async () => {
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    const page: ReturnType<typeof render> = render(table());

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });

    act(() => {
      lastCreateForm().onClose!();
    });

    // On to a status page, and Back: the list's entry no longer asks.
    page.unmount();
    goTo("/dashboard/project-a/status-pages/a-status-page");
    await back();

    expect(window.location.pathname).toBe(LIST_PATH);
    expect(window.location.search).toBe("");

    recordedModalProps = [];
    render(table());
    await settle();

    expect(isCreateFormOpen()).toBe(false);
  });

  test("without the form closed, Back would have opened it again: the ask was in the list's entry", async () => {
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    goTo("/dashboard/project-a/status-pages/a-status-page");
    await back();

    expect(window.location.search).toBe("?create=1");

    render(table());

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });
  });

  test("saving takes it off the address before the list opens the new record", async () => {
    let searchWhenCreated: string | null = null;
    const onCreateSuccess: (item: StatusPage) => Promise<StatusPage> = (
      item: StatusPage,
    ): Promise<StatusPage> => {
      searchWhenCreated = window.location.search;
      return Promise.resolve(item);
    };

    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    render(table({ onCreateSuccess }));

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });

    const created: StatusPage = new StatusPage();
    created._id = "8b1b1f0e-9d55-4f6f-b3a8-3d1f3c4f9a11";

    await act(async () => {
      await lastCreateForm().onSuccess!(created);
    });

    expect(searchWhenCreated).toBe("");
    expect(window.location.search).toBe("");
  });

  test("an address that does not ask opens nothing", async () => {
    render(table());
    await settle();

    expect(isCreateFormOpen()).toBe(false);
  });

  test("create=anything-but-1 opens nothing", async () => {
    goTo(`${LIST_PATH}?create=true`);
    render(table());
    await settle();

    expect(isCreateFormOpen()).toBe(false);
  });

  test("a list that does not open its form from the address ignores it, and leaves the address alone", async () => {
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    render(table({ opensCreateFormFromAddress: false }));
    await settle();

    expect(isCreateFormOpen()).toBe(false);
    expect(window.location.search).toBe("?create=1");
  });

  test("a list nobody creates from ignores it", async () => {
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    render(table({ isCreateable: false }));
    await settle();

    expect(isCreateFormOpen()).toBe(false);
  });

  test("without permission to create, it is ignored: the list shows with Create locked", async () => {
    // A viewer reads status pages and creates none.
    permissionsForTest = [Permission.Viewer, Permission.ReadProjectStatusPage];
    expect(new StatusPage().getCreatePermissions()).not.toContain(
      Permission.ReadProjectStatusPage,
    );
    expect(new StatusPage().getCreatePermissions()).not.toContain(
      Permission.Viewer,
    );

    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    const { container } = render(table());
    await settle();

    expect(isCreateFormOpen()).toBe(false);

    const createButton: HTMLButtonElement | undefined = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button: HTMLButtonElement): boolean => {
      return (button.textContent || "").includes("Create Status Page");
    });

    expect(createButton).toBeDefined();
    expect(createButton).toBeDisabled();
  });

  test("a Create locked for its own reason is ignored too", async () => {
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    render(table({ createDisabledReason: "Not on this list." }));
    await settle();

    expect(isCreateFormOpen()).toBe(false);
  });

  test("while the permissions are still on their way it waits, and opens once they arrive", async () => {
    permissionsForTest = [];
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    const page: ReturnType<typeof render> = render(table());
    await settle();

    expect(isCreateFormOpen()).toBe(false);

    permissionsForTest = [Permission.ProjectAdmin];
    PermissionGate.clearPermissionPropsCache();
    page.rerender(table());

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });
  });

  test("a master admin's form opens whatever their permissions", async () => {
    isMasterAdminForTest = true;
    permissionsForTest = [];
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    render(table());

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });
  });

  test("a link to the list from the list itself opens the form", async () => {
    const page: ReturnType<typeof render> = render(table());
    await settle();
    expect(isCreateFormOpen()).toBe(false);

    // Search's Create Status Page, chosen on the list.
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    page.rerender(table());

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });
  });

  test("a list whose Create opens a dialog of the page's own opens that one, for whoever may create", async () => {
    const onCreateClick: MockFunction = getJestMockFunction();

    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    render(table({ onCreateClick: onCreateClick as unknown as () => void }));

    await waitFor(() => {
      expect(onCreateClick).toHaveBeenCalledTimes(1);
    });
    expect(isCreateFormOpen()).toBe(false);
    // The page's dialog takes the ask off when it closes (CreateFormAddress.clear).
    expect(window.location.search).toBe("?create=1");
  });

  test("…and not for someone who may not", async () => {
    permissionsForTest = [Permission.Viewer, Permission.ReadProjectStatusPage];
    const onCreateClick: MockFunction = getJestMockFunction();

    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    render(table({ onCreateClick: onCreateClick as unknown as () => void }));
    await settle();

    expect(onCreateClick).not.toHaveBeenCalled();
  });

  test("the form opened from the address is the create form, never an edit", async () => {
    goTo(`${LIST_PATH}${CREATE_FORM_QUERY_STRING}`);
    render(table());

    await waitFor(() => {
      expect(isCreateFormOpen()).toBe(true);
    });
    expect(
      recordedModalProps.every((props: RecordedModalProps): boolean => {
        return props.formProps.formType === FormType.Create;
      }),
    ).toBe(true);
    expect(ModalType.Create).toBeDefined();
  });
});

describe("CreateFormAddress", () => {
  beforeEach(() => {
    window.history.replaceState(window.history.state, "", LIST_PATH);
  });

  test("reads ?create=1 only", () => {
    expect(CreateFormAddress.isAskedFor()).toBe(false);

    goTo(`${LIST_PATH}?create=1`);
    expect(CreateFormAddress.isAskedFor()).toBe(true);

    goTo(`${LIST_PATH}?create=0`);
    expect(CreateFormAddress.isAskedFor()).toBe(false);
  });

  test("clear() takes it off, keeps the rest and the anchor, and does nothing to an address that does not ask", () => {
    goTo(`${LIST_PATH}?a=1&create=1&b=2#card`);
    CreateFormAddress.clear();
    expect(`${window.location.search}${window.location.hash}`).toBe(
      "?a=1&b=2#card",
    );

    const replaceState: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      window.history,
      "replaceState",
    );
    CreateFormAddress.clear();
    expect(replaceState).not.toHaveBeenCalled();
  });

  test("the query string a link appends is ?create=1", () => {
    expect(CREATE_FORM_QUERY_STRING).toBe("?create=1");
  });
});
