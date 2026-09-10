import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "I am unable to edit the variables, I am having to delete the variable and
 * add it again if I want to make a modification to it."
 *
 * Both variable tables - Workflow > Variables (global) and Workflow > View >
 * Variables (local) - passed isEditable={false}, so a variable was immutable
 * from the moment it was saved. There was a reason for that, and it is why
 * turning the flag on is not the whole fix:
 *
 *   `content` is write-only. Its ColumnAccessControl.read is [] while its
 *   update list is not, and ModelForm builds the edit modal's prefetch select
 *   from each field's UPDATE list (getFieldPermissions), never its read list.
 *   So an edit form that still carries the content field asks the API to select
 *   a column nobody may read, and SelectPermission refuses the whole GET - the
 *   modal opens on a red error instead of a form.
 *
 * The fix is therefore two-part, and both parts are asserted here: content is
 * marked doNotShowWhenEditing (which drops it from the edit form, its select
 * AND its payload, because ModelTable filters the array before ModelForm sees
 * it), and it gets its own door - an "Update Content" row action writing that
 * one column through ModelAPI.
 *
 * ModelTable is replaced by a prop recorder: what is under test is the
 * configuration the page hands it, and the real table fetches on mount.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        return WORKFLOW_ID;
      },
    },
  };
});

const updateById: ReturnType<
  typeof jest.fn<(data: unknown) => Promise<unknown>>
> = jest.fn<(data: unknown) => Promise<unknown>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (data: unknown): Promise<unknown> => {
        return updateById(data);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : "Request failed.";
      },
    },
  };
});

type FormFieldEntry = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  doNotShowWhenEditing?: boolean | undefined;
  doNotShowWhenCreating?: boolean | undefined;
  required?: boolean | undefined;
  description?: string | undefined;
};

type ActionButtonEntry = {
  title: string;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  isVisible?: ((item: unknown) => boolean | undefined) | undefined;
  onClick: (
    item: unknown,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
};

type CapturedTableProps = {
  isEditable?: boolean | undefined;
  editButtonText?: string | undefined;
  filters?: Array<{ field?: Record<string, unknown> | undefined }> | undefined;
  selectMoreFields?: Record<string, unknown> | undefined;
  isCreateable?: boolean | undefined;
  isDeleteable?: boolean | undefined;
  query?: Record<string, unknown> | undefined;
  formFields?: Array<FormFieldEntry> | undefined;
  actionButtons?: Array<ActionButtonEntry> | undefined;
  onBeforeCreate?: ((item: unknown) => Promise<unknown>) | undefined;
  cardProps?: { title?: string | undefined } | undefined;
  columns?: Array<{ field?: Record<string, unknown> | undefined }> | undefined;
  searchableFields?: Array<string> | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): null => {
      capturedTableProps = props;
      return null;
    },
  };
});

type CapturedModalProps = {
  title: string;
  error?: string | undefined;
  isLoading?: boolean | undefined;
  description?: string | undefined;
  onClose?: (() => void) | undefined;
  onSubmit?: ((data: Record<string, unknown>) => void) | undefined;
  formProps: {
    initialValues: Record<string, unknown>;
    fields: Array<FormFieldEntry>;
  };
};

let capturedModalProps: CapturedModalProps | null = null;

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModalProps): ReactElement => {
      capturedModalProps = props;
      return <div data-testid="update-content-modal" />;
    },
  };
});

import GlobalVariablesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Variable";
import WorkflowVariablesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Variable";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const VARIABLE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_VARIABLE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

type Page = "global" | "local";

function renderPage(page: Page): void {
  const props: Record<string, unknown> = {};

  if (page === "global") {
    render(
      <GlobalVariablesPage
        {...(props as unknown as React.ComponentProps<
          typeof GlobalVariablesPage
        >)}
      />,
    );
    return;
  }

  render(
    <WorkflowVariablesPage
      {...(props as unknown as React.ComponentProps<
        typeof WorkflowVariablesPage
      >)}
    />,
  );
}

function table(): CapturedTableProps {
  if (!capturedTableProps) {
    throw new Error("The page rendered no ModelTable");
  }

  return capturedTableProps;
}

function formField(name: string): FormFieldEntry {
  const entry: FormFieldEntry | undefined = (table().formFields || []).find(
    (field: FormFieldEntry) => {
      return Object.keys(field.field || {})[0] === name;
    },
  );

  if (!entry) {
    throw new Error(`No form field for the "${name}" column`);
  }

  return entry;
}

function updateContentButton(): ActionButtonEntry {
  const button: ActionButtonEntry | undefined = (
    table().actionButtons || []
  ).find((entry: ActionButtonEntry) => {
    return entry.title === "Update Content";
  });

  if (!button) {
    throw new Error("The table offers no Update Content action");
  }

  return button;
}

function makeVariable(
  id?: ObjectID | null | undefined,
  name?: string | undefined,
): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();

  if (id !== null) {
    variable._id = (id || VARIABLE_ID).toString();
  }

  variable.name = name || "AirflowToken";
  return variable;
}

function openUpdateContentModal(variable?: WorkflowVariable | undefined): void {
  act(() => {
    updateContentButton().onClick(
      variable || makeVariable(),
      (): void => {
        // onCompleteAction
      },
      (): void => {
        // onError
      },
    );
  });
}

function modal(): CapturedModalProps {
  if (!capturedModalProps) {
    throw new Error("The Update Content modal is not open");
  }

  return capturedModalProps;
}

const PAGES: Array<Page> = ["global", "local"];

beforeEach(() => {
  capturedTableProps = null;
  capturedModalProps = null;
  updateById.mockReset();
  updateById.mockResolvedValue(undefined);
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  cleanup();
});

describe.each(PAGES)("the %s workflow variables table", (page: Page) => {
  /*
   * The customer's report, stated as a test. Everything else in this file is
   * about making this safe rather than about making it true.
   */
  test("offers Edit", () => {
    renderPage(page);

    expect(table().isEditable).toBe(true);
    expect(table().isCreateable).toBe(true);
    expect(table().isDeleteable).toBe(true);
  });

  test("keeps content off the edit form, because it can never be prefilled", () => {
    renderPage(page);

    expect(formField("content").doNotShowWhenEditing).toBe(true);
    // Still required when creating - a variable with no content is useless.
    expect(formField("content").required).toBe(true);
    expect(formField("content").doNotShowWhenCreating).toBeFalsy();
  });

  test("leaves the editable columns on the edit form", () => {
    renderPage(page);

    for (const column of ["name", "description", "isSecret"]) {
      expect(formField(column).doNotShowWhenEditing).toBeFalsy();
    }
  });

  /*
   * isSecret is on the edit form only because the model's own
   * ColumnAccessControl.update for that column is non-empty - ModelForm drops a
   * field whose update list is empty, silently and without an error. Asserting
   * it here from the model keeps the two ends of that from drifting apart.
   */
  test("the secret toggle is actually updatable at the model level", () => {
    const variable: WorkflowVariable = new WorkflowVariable();

    expect(
      variable.getColumnAccessControlForAllColumns()["isSecret"]?.update,
    ).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditWorkflowVariable,
      ]),
    );

    // And the widening did not drag content's read list along with it.
    expect(
      variable.getColumnAccessControlForAllColumns()["content"]?.read,
    ).toEqual([]);
  });

  /*
   * "Edit" is the verb a user reaches for when they want to change a variable's
   * value, and it is the one button that cannot. Naming it for what it edits is
   * what makes the neighbouring Update Content action findable.
   */
  test("names the Edit button for what it actually edits", () => {
    renderPage(page);

    expect(table().editButtonText).toBe("Edit Details");
  });

  /*
   * The copy this replaces asked "Should this be encrypted in the Database?".
   * content carries no `encrypted: true` and its DDL is a plain text column, so
   * somebody turning the toggle on would come away believing a database dump
   * was no longer a credential exposure.
   */
  test("the Secret toggle describes redaction, not encryption", () => {
    renderPage(page);

    const description: string = formField("isSecret").description || "";

    expect(description.toLowerCase()).not.toContain("encrypt");
    expect(description).toContain("[REDACTED]");
    expect(description.toLowerCase()).toContain("run logs");
  });

  test("warns on the name field that renaming does not rewrite references", () => {
    renderPage(page);

    const description: string = formField("name").description || "";

    expect(description).toContain(
      page === "global" ? "global.variables." : "local.variables.",
    );
    expect(description.toLowerCase()).toContain("renaming");
    expect(description.toLowerCase()).toContain("old name");
  });

  describe("the Update Content action", () => {
    test("is offered, and opens a modal that prefills nothing", () => {
      renderPage(page);

      expect(capturedModalProps).toBeNull();

      openUpdateContentModal();

      expect(modal().title).toBe("Update Content");
      expect(modal().formProps.initialValues).toEqual({});
      expect(Object.keys(modal().formProps.fields[0]?.field || {})).toEqual([
        "content",
      ]);
      expect(modal().description).toContain("AirflowToken");
    });

    test("writes only the content column, on the row that was clicked", async () => {
      renderPage(page);
      openUpdateContentModal();

      await act(async () => {
        modal().onSubmit?.({ content: "rotated-token" });
      });

      expect(updateById).toHaveBeenCalledTimes(1);

      const call: Record<string, unknown> = updateById.mock
        .calls[0]?.[0] as Record<string, unknown>;

      expect(String(call["id"])).toBe(VARIABLE_ID.toString());
      expect(call["data"]).toEqual({ content: "rotated-token" });
      expect(call["modelType"]).toBe(WorkflowVariable);
    });

    test("closes on success", async () => {
      renderPage(page);
      openUpdateContentModal();

      expect(screen.queryByTestId("update-content-modal")).not.toBeNull();

      await act(async () => {
        modal().onSubmit?.({ content: "rotated-token" });
      });

      /*
       * Asked of the DOM rather than of the recorder: the recorder only ever
       * gains props, so a modal that unmounted still has its last render
       * sitting in it.
       */
      expect(screen.queryByTestId("update-content-modal")).toBeNull();
    });

    /*
     * The neighbouring secret-rotation modals swallow this error, which loses
     * whatever the user typed and looks exactly like a save that worked. On a
     * credential that is the difference between a rotation and a silent
     * non-rotation.
     */
    test("stays open and says why when the write fails", async () => {
      renderPage(page);
      openUpdateContentModal();

      updateById.mockRejectedValue(new Error("Not authorized."));

      await act(async () => {
        modal().onSubmit?.({ content: "rotated-token" });
      });

      expect(screen.queryByTestId("update-content-modal")).not.toBeNull();
      expect(modal().error).toBe("Not authorized.");
    });

    /*
     * BasicFormModal unmounts its form while it is loading, so the form that
     * comes back after a failure is a fresh one. Without the draft it comes back
     * empty - and the person who has just pasted a long token has to go and find
     * it again, which is exactly the friction this whole change is about.
     */
    test("keeps what the user typed when the write fails", async () => {
      renderPage(page);
      openUpdateContentModal();

      expect(modal().formProps.initialValues).toEqual({});

      updateById.mockRejectedValue(new Error("Not authorized."));

      await act(async () => {
        modal().onSubmit?.({ content: "rotated-token" });
      });

      expect(modal().formProps.initialValues).toEqual({
        content: "rotated-token",
      });
    });

    test("does not carry the draft into the next variable", async () => {
      renderPage(page);
      openUpdateContentModal();

      updateById.mockRejectedValue(new Error("Not authorized."));

      await act(async () => {
        modal().onSubmit?.({ content: "rotated-token" });
      });

      expect(modal().formProps.initialValues).toEqual({
        content: "rotated-token",
      });

      act(() => {
        modal().onClose?.();
      });

      openUpdateContentModal();

      expect(modal().formProps.initialValues).toEqual({});
    });

    test("does not keep the draft after a write that worked", async () => {
      renderPage(page);
      openUpdateContentModal();

      await act(async () => {
        modal().onSubmit?.({ content: "rotated-token" });
      });

      openUpdateContentModal();

      expect(modal().formProps.initialValues).toEqual({});
    });

    /*
     * makeVariable defaulted to one id, so "the row that was clicked" could not
     * be told apart from "whichever row was opened first" - which is the exact
     * class of stale-selection bug this change fixes in BaseModelTable. Rotating
     * a credential onto the wrong variable would be invisible: content is never
     * read back, so it would surface only as a workflow authenticating with the
     * wrong token.
     */
    test("writes the second variable when the second one was clicked", async () => {
      renderPage(page);

      openUpdateContentModal(makeVariable(VARIABLE_ID, "First"));

      act(() => {
        modal().onClose?.();
      });

      openUpdateContentModal(makeVariable(OTHER_VARIABLE_ID, "Second"));

      expect(modal().description).toContain("Second");

      await act(async () => {
        modal().onSubmit?.({ content: "second-token" });
      });

      const call: Record<string, unknown> = updateById.mock
        .calls[0]?.[0] as Record<string, unknown>;

      expect(String(call["id"])).toBe(OTHER_VARIABLE_ID.toString());
    });

    /*
     * BasicFormModal unmounts its form while isLoading is true. A flag left
     * stuck on turns the error state into a modal with a message, no field to
     * retry in, and nothing the user typed - reachable only by reloading.
     */
    test("stops loading whether the write succeeds or fails", async () => {
      renderPage(page);
      openUpdateContentModal();

      updateById.mockRejectedValue(new Error("Not authorized."));

      await act(async () => {
        modal().onSubmit?.({ content: "rotated-token" });
      });

      expect(modal().isLoading).toBe(false);

      updateById.mockResolvedValue(undefined);

      await act(async () => {
        modal().onSubmit?.({ content: "rotated-token" });
      });

      expect(screen.queryByTestId("update-content-modal")).toBeNull();
    });

    /*
     * The guard that replaced a bare non-null assertion on the id. It must fail
     * loudly and leave the modal usable rather than firing a request at an
     * undefined id.
     */
    test("refuses to write a variable that has no id", async () => {
      renderPage(page);
      openUpdateContentModal(makeVariable(null));

      await act(async () => {
        modal().onSubmit?.({ content: "rotated-token" });
      });

      expect(updateById).not.toHaveBeenCalled();
      expect(screen.queryByTestId("update-content-modal")).not.toBeNull();
      expect(modal().error).toContain("no id");
      expect(modal().isLoading).toBe(false);
    });

    test("clears the error when reopened", async () => {
      renderPage(page);
      openUpdateContentModal();

      updateById.mockRejectedValue(new Error("Not authorized."));

      await act(async () => {
        modal().onSubmit?.({ content: "rotated-token" });
      });

      expect(modal().error).toBe("Not authorized.");

      act(() => {
        modal().onClose?.();
      });

      openUpdateContentModal();

      expect(modal().error).toBeUndefined();
    });
  });

  describe("who may use it", () => {
    /*
     * The action writes through ModelAPI directly, which ModelTable's own edit
     * gating never sees - so without its own gate a member without update
     * permission would get a modal that 403s after they had pasted a token
     * into it.
     */
    test("is locked, with the missing permission named, for a viewer", () => {
      permissionsForTest = [Permission.Viewer];

      renderPage(page);

      expect(updateContentButton().disabled).toBe(true);
      expect(updateContentButton().tooltip).toContain(
        "You do not have permission to update",
      );
      expect(updateContentButton().isVisible?.(makeVariable())).toBe(true);
    });

    test("is enabled for a key holding EditWorkflowVariable", () => {
      permissionsForTest = [Permission.EditWorkflowVariable];

      renderPage(page);

      expect(updateContentButton().disabled).toBe(false);
    });

    /*
     * The permission snapshot rides in on a response header, so it is empty for
     * the first paint after a login or a project switch. PermissionGate reports
     * that as "not allowed, no reason" precisely so callers hide the affordance
     * rather than accuse somebody who may well hold the permission.
     */
    test("is hidden entirely while the permission snapshot is still empty", () => {
      permissionsForTest = [];

      renderPage(page);

      expect(updateContentButton().isVisible?.(makeVariable())).toBe(false);
    });
  });
});

describe("the two tables are scoped to different variables", () => {
  test("the global table asks for the rows with no workflow", () => {
    renderPage("global");

    expect(table().query?.["workflowId"]).toBeInstanceOf(IsNull);
    expect(String(table().query?.["projectId"])).toBe(PROJECT_ID.toString());
    expect(table().cardProps?.title).toBe("Global Variables");
  });

  test("the workflow table asks for that workflow's rows", () => {
    renderPage("local");

    expect(String(table().query?.["workflowId"])).toBe(WORKFLOW_ID.toString());
    expect(String(table().query?.["projectId"])).toBe(PROJECT_ID.toString());
    expect(table().cardProps?.title).toBe("Workflow Variables");
  });

  /*
   * The stamp that makes a new row local rather than global. Getting it wrong
   * in the other direction is worse: a global variable created with a
   * workflowId disappears from the page that created it.
   */
  test("a variable created on the workflow page is stamped with the workflow", async () => {
    renderPage("local");

    const created: WorkflowVariable = (await table().onBeforeCreate?.(
      new WorkflowVariable(),
    )) as WorkflowVariable;

    expect(created.workflowId?.toString()).toBe(WORKFLOW_ID.toString());
  });

  test("a variable created on the global page is left unstamped", async () => {
    renderPage("global");

    const created: WorkflowVariable = (await table().onBeforeCreate?.(
      new WorkflowVariable(),
    )) as WorkflowVariable;

    expect(created.workflowId).toBeUndefined();
  });
});

describe("the content column never travels back to the browser", () => {
  /*
   * The read-back inventory. `content` is write-only by design, so every list
   * the table builds a select from has to stay clear of it - the columns, the
   * filters and the search fields alike - and the Update Content modal must
   * never fetch. If any of these ever names content, the list request stops
   * failing loudly and starts succeeding with the secret in the response.
   */
  test.each(PAGES)("%s", (page: Page) => {
    renderPage(page);

    for (const column of table().columns || []) {
      expect(Object.keys(column.field || {})).not.toContain("content");
    }

    /*
     * A filter on content would fail the list request the same way a column
     * would; selectMoreFields is injected straight into the select, so that one
     * would succeed and ship every variable's value to the browser.
     */
    for (const filter of table().filters || []) {
      expect(Object.keys(filter.field || {})).not.toContain("content");
    }

    expect(Object.keys(table().selectMoreFields || {})).not.toContain(
      "content",
    );
    expect(table().searchableFields || []).not.toContain("content");

    openUpdateContentModal();
    expect(modal().formProps.initialValues).toEqual({});
  });
});
