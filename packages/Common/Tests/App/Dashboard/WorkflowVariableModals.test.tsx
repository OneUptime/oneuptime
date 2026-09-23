import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The three modals a workflow variable's own page opens.
 *
 * They used to live inside the variables table as row actions - "Update
 * Content" on a static variable, "Update Credentials" on an OAuth 2.0 one, and
 * the result of fetching a token. The list is now just a list with a View
 * button, and the variable page mounts these as components of their own. The
 * behaviour the table tests pinned down still matters, so it is pinned down
 * here against the components themselves:
 *
 *   - content, a client secret and a refresh token are write-only, so these
 *     forms prefill nothing and never fetch;
 *   - a failed write stays on screen, with the reason and with what the user
 *     typed, instead of looking like a save that worked;
 *   - only what was typed is written, and only to the variable that was open;
 *   - the token result names what was saved and quotes the identity provider.
 *
 * BasicFormModal and ConfirmModal are replaced by prop recorders: what is under
 * test is what each modal hands them and what it does when their callbacks
 * fire.
 */

const updateById: ReturnType<
  typeof jest.fn<(data: unknown) => Promise<unknown>>
> = jest.fn<(data: unknown) => Promise<unknown>>();

// Anything that reads a variable back. None of these modals may call it.
const getItem: ReturnType<typeof jest.fn<(data: unknown) => Promise<unknown>>> =
  jest.fn<(data: unknown) => Promise<unknown>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (data: unknown): Promise<unknown> => {
        return updateById(data);
      },
      getItem: (data: unknown): Promise<unknown> => {
        return getItem(data);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-header" };
      },
    },
  };
});

const apiPost: ReturnType<typeof jest.fn<(data: unknown) => Promise<unknown>>> =
  jest.fn<(data: unknown) => Promise<unknown>>();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (data: unknown): Promise<unknown> => {
        return apiPost(data);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : "Request failed.";
      },
    },
  };
});

type FormFieldEntry = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  description?: string | undefined;
  fieldType?: string | undefined;
  required?: boolean | undefined;
  placeholder?: string | undefined;
  disableSpellCheck?: boolean | undefined;
};

type CapturedFormModalProps = {
  title: string;
  name?: string | undefined;
  error?: string | undefined;
  isLoading?: boolean | undefined;
  description?: string | undefined;
  submitButtonText?: string | undefined;
  onClose?: (() => void) | undefined;
  onSubmit?:
    | ((data: Record<string, unknown>) => void | Promise<void>)
    | undefined;
  formProps: {
    initialValues?: Record<string, unknown> | undefined;
    fields: Array<FormFieldEntry>;
  };
};

let capturedFormModalProps: CapturedFormModalProps | null = null;

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedFormModalProps): ReactElement => {
      capturedFormModalProps = props;
      return <div data-testid="form-modal" />;
    },
  };
});

type CapturedConfirmProps = {
  title: string;
  description: string;
  submitButtonText?: string | undefined;
  submitButtonType?: unknown;
  isLoading?: boolean | undefined;
  disableSubmitButton?: boolean | undefined;
  onClose?: (() => void) | undefined;
  onSubmit: () => void;
};

let capturedConfirmProps: CapturedConfirmProps | null = null;

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedConfirmProps): ReactElement => {
      capturedConfirmProps = props;
      return <div data-testid="confirm-modal" />;
    },
  };
});

import UpdateWorkflowVariableContentModal from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/UpdateWorkflowVariableContentModal";
import UpdateWorkflowVariableCredentialsModal from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/UpdateWorkflowVariableCredentialsModal";
import WorkflowVariableTokenRefreshModal from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableTokenRefreshModal";
import {
  TokenRefreshOutcome,
  fetchTokenRefreshOutcome,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowVariableUtil";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

const VARIABLE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_VARIABLE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const EXPIRES_AT: Date = new Date("2030-01-01T10:00:00.000Z");

type VoidMock = ReturnType<typeof jest.fn<() => void>>;
type SavedMock = ReturnType<typeof jest.fn<(savedWhat: string) => void>>;

type Deferred = {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function deferred(): Deferred {
  let resolve: (value: unknown) => void = (): void => {
    // replaced below
  };
  let reject: (error: unknown) => void = (): void => {
    // replaced below
  };

  const promise: Promise<unknown> = new Promise<unknown>(
    (
      promiseResolve: (value: unknown) => void,
      promiseReject: (error: unknown) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise, resolve, reject };
}

/*
 * A failing request, rejected from a native async function. A plain
 * mockRejectedValue builds its rejection with the zone.js Promise the UI code
 * loads, and zone reports it as unhandled before the component's native
 * await gets to it - noise, not a failure, but it buries real warnings.
 */
function rejectWith(error: unknown): () => Promise<unknown> {
  return async (): Promise<unknown> => {
    throw error;
  };
}

function staticVariable(data?: {
  id?: ObjectID | null | undefined;
  name?: string | null | undefined;
}): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();

  if (data?.id !== null) {
    variable._id = (data?.id || VARIABLE_ID).toString();
  }

  if (data?.name !== null) {
    variable.name = data?.name || "AirflowToken";
  }

  variable.variableType = WorkflowVariableType.Static;
  return variable;
}

function oauthVariable(data?: {
  id?: ObjectID | null | undefined;
  name?: string | null | undefined;
  grantType?: OAuth2GrantType | null | undefined;
}): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();

  if (data?.id !== null) {
    variable._id = (data?.id || VARIABLE_ID).toString();
  }

  if (data?.name !== null) {
    variable.name = data?.name || "API_TOKEN";
  }

  variable.variableType = WorkflowVariableType.OAuth2;

  if (data?.grantType !== null) {
    variable.oauthGrantType =
      data?.grantType || OAuth2GrantType.ClientCredentials;
  }

  return variable;
}

function modal(): CapturedFormModalProps {
  if (!capturedFormModalProps) {
    throw new Error("No form modal is open");
  }

  return capturedFormModalProps;
}

function confirm(): CapturedConfirmProps {
  if (!capturedConfirmProps) {
    throw new Error("No confirm modal is open");
  }

  return capturedConfirmProps;
}

function fieldNames(): Array<string | undefined> {
  return modal().formProps.fields.map((field: FormFieldEntry) => {
    return Object.keys(field.field || {})[0];
  });
}

function fieldNamed(name: string): FormFieldEntry {
  const entry: FormFieldEntry | undefined = modal().formProps.fields.find(
    (field: FormFieldEntry) => {
      return Object.keys(field.field || {})[0] === name;
    },
  );

  if (!entry) {
    throw new Error(`The modal has no "${name}" field`);
  }

  return entry;
}

function updateCall(callIndex: number = 0): {
  id: ObjectID;
  data: Record<string, unknown>;
  modelType: unknown;
} {
  return updateById.mock.calls[callIndex]![0] as {
    id: ObjectID;
    data: Record<string, unknown>;
    modelType: unknown;
  };
}

async function submit(data: Record<string, unknown>): Promise<void> {
  await act(async () => {
    await modal().onSubmit?.(data);
  });
}

beforeEach(() => {
  capturedFormModalProps = null;
  capturedConfirmProps = null;
  updateById.mockReset();
  updateById.mockResolvedValue(undefined);
  getItem.mockReset();
  apiPost.mockReset();
  apiPost.mockResolvedValue({
    data: { oauthAccessTokenExpiresAt: EXPIRES_AT.toISOString() },
  });
});

afterEach(() => {
  cleanup();
});

describe("UpdateWorkflowVariableContentModal", () => {
  type ContentHandles = {
    onClose: VoidMock;
    onSuccess: VoidMock;
    rerender: (variable: WorkflowVariable) => void;
  };

  function renderContentModal(variable?: WorkflowVariable): ContentHandles {
    const onClose: VoidMock = jest.fn<() => void>();
    const onSuccess: VoidMock = jest.fn<() => void>();

    const element: (item: WorkflowVariable) => ReactElement = (
      item: WorkflowVariable,
    ): ReactElement => {
      return (
        <UpdateWorkflowVariableContentModal
          variable={item}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );
    };

    const result: ReturnType<typeof render> = render(
      element(variable || staticVariable()),
    );

    return {
      onClose,
      onSuccess,
      rerender: (item: WorkflowVariable): void => {
        result.rerender(element(item));
      },
    };
  }

  describe("when it opens", () => {
    test("is titled for what it does", () => {
      renderContentModal();

      expect(modal().title).toBe("Update Content");
      expect(modal().submitButtonText).toBe("Update Content");
      expect(modal().isLoading).toBe(false);
      expect(modal().error).toBeUndefined();
    });

    /*
     * content is write-only - its read list is empty - so there is nothing to
     * prefill, and asking the API for it would be refused outright.
     */
    test("prefills nothing and never reads the variable back", () => {
      renderContentModal();

      expect(modal().formProps.initialValues).toEqual({});
      expect(getItem).not.toHaveBeenCalled();
      expect(updateById).not.toHaveBeenCalled();
    });

    test("asks for exactly one field: the content, required, as long text", () => {
      renderContentModal();

      expect(fieldNames()).toEqual(["content"]);
      expect(fieldNamed("content").title).toBe("Content");
      expect(fieldNamed("content").required).toBe(true);
      expect(fieldNamed("content").fieldType).toBe(
        FormFieldSchemaType.LongText,
      );
    });

    // Somebody expecting to edit in place should be told why the box is empty.
    test("says the stored content cannot be shown and will be replaced", () => {
      renderContentModal();

      const description: string = fieldNamed("content").description || "";

      expect(description).toContain("cannot be retrieved");
      expect(description).toContain("replaces it");
    });

    test("names the variable whose content is being replaced", () => {
      renderContentModal(staticVariable({ name: "AirflowToken" }));

      expect(modal().description).toContain('"AirflowToken"');
      expect(modal().description).toContain("next run");
    });

    test("falls back to 'this variable' when the variable has no name", () => {
      renderContentModal(staticVariable({ name: null }));

      expect(modal().description).toContain('"this variable"');
    });
  });

  describe("saving", () => {
    test("writes only the content column, on the variable it was given", async () => {
      renderContentModal();

      await submit({ content: "rotated-token" });

      expect(updateById).toHaveBeenCalledTimes(1);
      expect(updateCall().id.toString()).toBe(VARIABLE_ID.toString());
      expect(updateCall().data).toEqual({ content: "rotated-token" });
      expect(updateCall().modelType).toBe(WorkflowVariable);
    });

    /*
     * The variable page closes this modal from onSuccess and flags that the
     * content was replaced; onClose is for Cancel. Calling the wrong one would
     * close the modal without telling anybody the save worked.
     */
    test("reports success through onSuccess, not onClose", async () => {
      const handles: ContentHandles = renderContentModal();

      await submit({ content: "rotated-token" });

      expect(handles.onSuccess).toHaveBeenCalledTimes(1);
      expect(handles.onClose).not.toHaveBeenCalled();
      expect(modal().isLoading).toBe(false);
      expect(modal().error).toBeUndefined();
    });

    /*
     * The stale-selection class of bug: with one id everywhere, "the variable
     * that is open" cannot be told apart from "whichever was opened first".
     * Rotating a credential onto the wrong variable would be invisible, since
     * content is never read back.
     */
    test("writes the second variable when it is re-rendered for a second one", async () => {
      const handles: ContentHandles = renderContentModal(
        staticVariable({ id: VARIABLE_ID, name: "First" }),
      );

      handles.rerender(
        staticVariable({ id: OTHER_VARIABLE_ID, name: "Second" }),
      );

      expect(modal().description).toContain("Second");

      await submit({ content: "second-token" });

      expect(updateById).toHaveBeenCalledTimes(1);
      expect(updateCall().id.toString()).toBe(OTHER_VARIABLE_ID.toString());
    });

    /*
     * BasicFormModal unmounts its form while isLoading is true, which is what
     * stops a double submit while the write is in flight.
     */
    test("is loading while the write is in flight, and stops when it lands", async () => {
      const pending: Deferred = deferred();
      updateById.mockReturnValue(pending.promise);

      const handles: ContentHandles = renderContentModal();

      const submission: { current?: void | Promise<void> } = {};

      act(() => {
        submission.current = modal().onSubmit?.({ content: "rotated-token" });
      });

      expect(modal().isLoading).toBe(true);
      expect(handles.onSuccess).not.toHaveBeenCalled();

      await act(async () => {
        pending.resolve(undefined);
        await submission.current;
      });

      expect(modal().isLoading).toBe(false);
      expect(handles.onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the write fails", () => {
    /*
     * Swallowing this looks exactly like a save that worked. On a credential
     * that is the difference between a rotation and a silent non-rotation.
     */
    test("stays open and says why", async () => {
      updateById.mockImplementation(rejectWith(new Error("Not authorized.")));

      const handles: ContentHandles = renderContentModal();

      await submit({ content: "rotated-token" });

      expect(modal().error).toBe("Not authorized.");
      expect(handles.onSuccess).not.toHaveBeenCalled();
      expect(handles.onClose).not.toHaveBeenCalled();
      expect(screen.queryByTestId("form-modal")).toBeInTheDocument();
    });

    test("uses the friendly message for an error that is not an Error", async () => {
      updateById.mockImplementation(rejectWith("socket hang up"));

      renderContentModal();

      await submit({ content: "rotated-token" });

      expect(modal().error).toBe("Request failed.");
    });

    /*
     * BasicFormModal unmounts its form while it is loading, so the form that
     * comes back after a failure is a fresh one. Without the draft it comes
     * back empty, and the person who just pasted a long token has to go and
     * find it again.
     */
    test("keeps what the user typed", async () => {
      updateById.mockImplementation(rejectWith(new Error("Not authorized.")));

      renderContentModal();

      expect(modal().formProps.initialValues).toEqual({});

      await submit({ content: "rotated-token" });

      expect(modal().formProps.initialValues).toEqual({
        content: "rotated-token",
      });
    });

    /*
     * A flag left stuck on turns the error state into a modal with a message,
     * no field to retry in, and nothing the user typed.
     */
    test("stops loading", async () => {
      updateById.mockImplementation(rejectWith(new Error("Not authorized.")));

      renderContentModal();

      await submit({ content: "rotated-token" });

      expect(modal().isLoading).toBe(false);
    });

    test("a retry that works clears the error and the draft", async () => {
      updateById.mockImplementationOnce(
        rejectWith(new Error("Not authorized.")),
      );

      const handles: ContentHandles = renderContentModal();

      await submit({ content: "rotated-token" });

      expect(modal().error).toBe("Not authorized.");

      await submit({ content: "rotated-token" });

      expect(updateById).toHaveBeenCalledTimes(2);
      expect(modal().error).toBeUndefined();
      expect(modal().formProps.initialValues).toEqual({});
      expect(modal().isLoading).toBe(false);
      expect(handles.onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe("closing", () => {
    test("clears the error and the draft, then tells the caller", async () => {
      updateById.mockImplementation(rejectWith(new Error("Not authorized.")));

      const handles: ContentHandles = renderContentModal();

      await submit({ content: "rotated-token" });

      expect(modal().error).toBe("Not authorized.");
      expect(modal().formProps.initialValues).toEqual({
        content: "rotated-token",
      });

      act(() => {
        modal().onClose?.();
      });

      expect(handles.onClose).toHaveBeenCalledTimes(1);
      expect(handles.onSuccess).not.toHaveBeenCalled();
      expect(modal().error).toBeUndefined();
      expect(modal().formProps.initialValues).toEqual({});
      expect(modal().isLoading).toBe(false);
    });

    // A draft typed for one variable must never be offered for the next one.
    test("does not carry a draft into the next variable", async () => {
      updateById.mockImplementation(rejectWith(new Error("Not authorized.")));

      const handles: ContentHandles = renderContentModal(
        staticVariable({ id: VARIABLE_ID, name: "First" }),
      );

      await submit({ content: "first-token" });

      act(() => {
        modal().onClose?.();
      });

      handles.rerender(
        staticVariable({ id: OTHER_VARIABLE_ID, name: "Second" }),
      );

      expect(modal().formProps.initialValues).toEqual({});
      expect(modal().error).toBeUndefined();
    });
  });

  /*
   * The guard that replaced a bare non-null assertion on the id. It must fail
   * loudly and leave the modal usable rather than fire a request at an
   * undefined id.
   */
  test("refuses a variable that has no id, without calling the API", async () => {
    const handles: ContentHandles = renderContentModal(
      staticVariable({ id: null }),
    );

    await submit({ content: "rotated-token" });

    expect(updateById).not.toHaveBeenCalled();
    expect(modal().error).toContain("no id");
    expect(modal().error).toContain("Refresh the page");
    expect(modal().isLoading).toBe(false);
    expect(handles.onSuccess).not.toHaveBeenCalled();
    expect(handles.onClose).not.toHaveBeenCalled();
  });

  /*
   * How the variable page mounts it: shown while a flag is set, the flag
   * cleared from onSuccess and from onClose. The recorder only ever gains
   * props, so whether the modal is gone is asked of the DOM.
   */
  describe("mounted the way the variable page mounts it", () => {
    const Host: () => ReactElement = (): ReactElement => {
      const [open, setOpen] = useState<boolean>(true);
      const [updated, setUpdated] = useState<boolean>(false);

      return (
        <div>
          {updated ? <span data-testid="content-updated" /> : <></>}
          {open ? (
            <UpdateWorkflowVariableContentModal
              variable={staticVariable()}
              onClose={() => {
                setOpen(false);
              }}
              onSuccess={() => {
                setOpen(false);
                setUpdated(true);
              }}
            />
          ) : (
            <></>
          )}
        </div>
      );
    };

    test("closes on success", async () => {
      render(<Host />);

      expect(screen.queryByTestId("form-modal")).toBeInTheDocument();

      await submit({ content: "rotated-token" });

      expect(screen.queryByTestId("form-modal")).not.toBeInTheDocument();
      expect(screen.queryByTestId("content-updated")).toBeInTheDocument();
    });

    test("stays open on failure", async () => {
      updateById.mockImplementation(rejectWith(new Error("Not authorized.")));

      render(<Host />);

      await submit({ content: "rotated-token" });

      expect(screen.queryByTestId("form-modal")).toBeInTheDocument();
      expect(screen.queryByTestId("content-updated")).not.toBeInTheDocument();
    });

    test("closes on Cancel without claiming an update", () => {
      render(<Host />);

      act(() => {
        modal().onClose?.();
      });

      expect(screen.queryByTestId("form-modal")).not.toBeInTheDocument();
      expect(screen.queryByTestId("content-updated")).not.toBeInTheDocument();
      expect(updateById).not.toHaveBeenCalled();
    });
  });
});

describe("UpdateWorkflowVariableCredentialsModal", () => {
  type CredentialsHandles = {
    onClose: VoidMock;
    onSaved: SavedMock;
  };

  function renderCredentialsModal(
    variable?: WorkflowVariable,
  ): CredentialsHandles {
    const onClose: VoidMock = jest.fn<() => void>();
    const onSaved: SavedMock = jest.fn<(savedWhat: string) => void>();

    render(
      <UpdateWorkflowVariableCredentialsModal
        variable={variable || oauthVariable()}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    return { onClose, onSaved };
  }

  describe("when it opens", () => {
    test("is titled for what it does, and says a token is fetched on save", () => {
      renderCredentialsModal();

      expect(modal().title).toBe("Update Credentials");
      expect(modal().submitButtonText).toBe("Save and Refresh Token");
      expect(modal().isLoading).toBe(false);
      expect(modal().error).toBeUndefined();
    });

    test("names the variable and says an empty field keeps what is saved", () => {
      renderCredentialsModal(oauthVariable({ name: "API_TOKEN" }));

      expect(modal().description).toContain('"API_TOKEN"');
      expect(modal().description).toContain(
        "Leave a field empty to keep what is saved",
      );
      expect(modal().description).toContain("as soon as you save");
    });

    test("falls back to 'this variable' when the variable has no name", () => {
      renderCredentialsModal(oauthVariable({ name: null }));

      expect(modal().description).toContain('"this variable"');
    });

    // Both credentials are write-only and encrypted: nothing to prefill.
    test("prefills nothing and never reads the variable back", () => {
      renderCredentialsModal(
        oauthVariable({ grantType: OAuth2GrantType.RefreshToken }),
      );

      expect(modal().formProps.initialValues || {}).toEqual({});
      expect(getItem).not.toHaveBeenCalled();
      expect(updateById).not.toHaveBeenCalled();
    });

    test("asks only for a new client secret on a client credentials variable", () => {
      renderCredentialsModal(
        oauthVariable({ grantType: OAuth2GrantType.ClientCredentials }),
      );

      expect(fieldNames()).toEqual(["oauthClientSecret"]);
      expect(fieldNamed("oauthClientSecret").title).toBe("New Client Secret");
    });

    /*
     * The grant type decides the fields, so a variable loaded without it must
     * not be offered a refresh token it has no use for.
     */
    test("asks only for a new client secret when the grant type is unknown", () => {
      renderCredentialsModal(oauthVariable({ grantType: null }));

      expect(fieldNames()).toEqual(["oauthClientSecret"]);
    });

    test("also asks for a new refresh token on a refresh token variable", () => {
      renderCredentialsModal(
        oauthVariable({ grantType: OAuth2GrantType.RefreshToken }),
      );

      expect(fieldNames()).toEqual(["oauthClientSecret", "oauthRefreshToken"]);
      expect(fieldNamed("oauthRefreshToken").title).toBe("New Refresh Token");
      expect(fieldNamed("oauthRefreshToken").description).toContain("revoked");
    });

    /*
     * Empty means "keep what is saved", so neither field may be required; and
     * both are secrets, so they are masked and spell check stays off (a
     * browser's spell checker can send what is typed to a remote service).
     */
    test("makes every field optional, masked and exempt from spell check", () => {
      renderCredentialsModal(
        oauthVariable({ grantType: OAuth2GrantType.RefreshToken }),
      );

      for (const field of modal().formProps.fields) {
        expect(field.required).toBe(false);
        expect(field.fieldType).toBe(FormFieldSchemaType.EncryptedText);
        expect(field.disableSpellCheck).toBe(true);
        expect(field.description).toContain("Leave empty to keep the saved");
      }
    });
  });

  describe("refusing to save nothing", () => {
    const BLANK_SUBMISSIONS: Array<{
      label: string;
      data: Record<string, unknown>;
    }> = [
      { label: "no fields at all", data: {} },
      { label: "an empty client secret", data: { oauthClientSecret: "" } },
      {
        label: "a client secret of only spaces",
        data: { oauthClientSecret: "   " },
      },
      {
        label: "both fields blank",
        data: { oauthClientSecret: " \t", oauthRefreshToken: "\n  " },
      },
    ];

    test.each(BLANK_SUBMISSIONS)(
      "with $label: says so and writes nothing",
      async (entry: { label: string; data: Record<string, unknown> }) => {
        const handles: CredentialsHandles = renderCredentialsModal(
          oauthVariable({ grantType: OAuth2GrantType.RefreshToken }),
        );

        await submit(entry.data);

        expect(updateById).not.toHaveBeenCalled();
        expect(modal().error).toContain(
          "Enter a new client secret or refresh token",
        );
        expect(modal().isLoading).toBe(false);
        expect(handles.onSaved).not.toHaveBeenCalled();
        expect(handles.onClose).not.toHaveBeenCalled();
      },
    );

    test("a later submit with a value clears that error", async () => {
      const handles: CredentialsHandles = renderCredentialsModal();

      await submit({ oauthClientSecret: "   " });

      expect(modal().error).toContain("Enter a new client secret");

      await submit({ oauthClientSecret: "new-secret" });

      expect(modal().error).toBeUndefined();
      expect(handles.onSaved).toHaveBeenCalledWith("Client secret");
    });
  });

  describe("saving", () => {
    /*
     * Only what was typed is sent. An empty field must not reach the API as an
     * empty string - that would be a request to remove the credential.
     */
    test("writes only the refresh token when only that was typed, trimmed", async () => {
      renderCredentialsModal(
        oauthVariable({ grantType: OAuth2GrantType.RefreshToken }),
      );

      await submit({
        oauthClientSecret: "",
        oauthRefreshToken: " new-refresh-token ",
      });

      expect(updateById).toHaveBeenCalledTimes(1);
      expect(updateCall().id.toString()).toBe(VARIABLE_ID.toString());
      expect(updateCall().data).toEqual({
        oauthRefreshToken: "new-refresh-token",
      });
      expect(updateCall().modelType).toBe(WorkflowVariable);
    });

    test("writes only the client secret when only that was typed, trimmed", async () => {
      renderCredentialsModal(
        oauthVariable({ grantType: OAuth2GrantType.RefreshToken }),
      );

      await submit({
        oauthClientSecret: "\tnew-secret\n",
        oauthRefreshToken: "   ",
      });

      expect(updateCall().data).toEqual({ oauthClientSecret: "new-secret" });
    });

    test("writes both when both were typed", async () => {
      renderCredentialsModal(
        oauthVariable({ grantType: OAuth2GrantType.RefreshToken }),
      );

      await submit({
        oauthClientSecret: "new-secret",
        oauthRefreshToken: "new-refresh-token",
      });

      expect(updateCall().data).toEqual({
        oauthClientSecret: "new-secret",
        oauthRefreshToken: "new-refresh-token",
      });
    });

    test("writes to the variable it was given", async () => {
      renderCredentialsModal(oauthVariable({ id: OTHER_VARIABLE_ID }));

      await submit({ oauthClientSecret: "new-secret" });

      expect(updateCall().id.toString()).toBe(OTHER_VARIABLE_ID.toString());
    });

    /*
     * The caller fetches a token straight after, and its result opens with
     * "<savedWhat> saved." - so these words are what the user reads.
     */
    const SAVES: Array<{ savedWhat: string; data: Record<string, unknown> }> = [
      { savedWhat: "Client secret", data: { oauthClientSecret: "new-secret" } },
      {
        savedWhat: "Refresh token",
        data: { oauthRefreshToken: "new-refresh-token" },
      },
      {
        savedWhat: "Client secret and refresh token",
        data: {
          oauthClientSecret: "new-secret",
          oauthRefreshToken: "new-refresh-token",
        },
      },
    ];

    test.each(SAVES)(
      "tells the caller it saved: $savedWhat",
      async (entry: { savedWhat: string; data: Record<string, unknown> }) => {
        const handles: CredentialsHandles = renderCredentialsModal(
          oauthVariable({ grantType: OAuth2GrantType.RefreshToken }),
        );

        await submit(entry.data);

        expect(handles.onSaved).toHaveBeenCalledTimes(1);
        expect(handles.onSaved).toHaveBeenCalledWith(entry.savedWhat);
        expect(handles.onClose).not.toHaveBeenCalled();
        expect(modal().isLoading).toBe(false);
      },
    );

    test("is loading while the write is in flight, and reports only once it lands", async () => {
      const pending: Deferred = deferred();
      updateById.mockReturnValue(pending.promise);

      const handles: CredentialsHandles = renderCredentialsModal();

      const submission: { current?: void | Promise<void> } = {};

      act(() => {
        submission.current = modal().onSubmit?.({
          oauthClientSecret: "new-secret",
        });
      });

      expect(modal().isLoading).toBe(true);
      expect(handles.onSaved).not.toHaveBeenCalled();

      await act(async () => {
        pending.resolve(undefined);
        await submission.current;
      });

      expect(modal().isLoading).toBe(false);
      expect(handles.onSaved).toHaveBeenCalledWith("Client secret");
    });
  });

  describe("when the write fails", () => {
    /*
     * onSaved is what makes the caller fetch a token. Calling it after a failed
     * save would fetch with the old credentials and report success.
     */
    test("stays open with the reason, stops loading and does not report a save", async () => {
      updateById.mockImplementation(
        rejectWith(new Error("You do not have permission.")),
      );

      const handles: CredentialsHandles = renderCredentialsModal();

      await submit({ oauthClientSecret: "new-secret" });

      expect(modal().error).toBe("You do not have permission.");
      expect(modal().isLoading).toBe(false);
      expect(handles.onSaved).not.toHaveBeenCalled();
      expect(handles.onClose).not.toHaveBeenCalled();
      expect(screen.queryByTestId("form-modal")).toBeInTheDocument();
    });

    test("a retry that works clears the error and reports the save", async () => {
      updateById.mockImplementationOnce(
        rejectWith(new Error("You do not have permission.")),
      );

      const handles: CredentialsHandles = renderCredentialsModal();

      await submit({ oauthClientSecret: "new-secret" });
      await submit({ oauthClientSecret: "new-secret" });

      expect(updateById).toHaveBeenCalledTimes(2);
      expect(modal().error).toBeUndefined();
      expect(handles.onSaved).toHaveBeenCalledTimes(1);
    });
  });

  test("refuses a variable that has no id, without calling the API", async () => {
    const handles: CredentialsHandles = renderCredentialsModal(
      oauthVariable({ id: null }),
    );

    await submit({ oauthClientSecret: "new-secret" });

    expect(updateById).not.toHaveBeenCalled();
    expect(modal().error).toContain("no id");
    expect(modal().isLoading).toBe(false);
    expect(handles.onSaved).not.toHaveBeenCalled();
  });

  test("closing clears the error and tells the caller", async () => {
    updateById.mockImplementation(
      rejectWith(new Error("You do not have permission.")),
    );

    const handles: CredentialsHandles = renderCredentialsModal();

    await submit({ oauthClientSecret: "new-secret" });

    expect(modal().error).toBe("You do not have permission.");

    act(() => {
      modal().onClose?.();
    });

    expect(handles.onClose).toHaveBeenCalledTimes(1);
    expect(handles.onSaved).not.toHaveBeenCalled();
    expect(modal().error).toBeUndefined();
    expect(modal().isLoading).toBe(false);
  });
});

describe("WorkflowVariableTokenRefreshModal", () => {
  function renderRefreshModal(
    outcome: TokenRefreshOutcome | null,
    variableName?: string,
  ): { onClose: VoidMock; rerender: (next: TokenRefreshOutcome) => void } {
    const onClose: VoidMock = jest.fn<() => void>();

    const result: ReturnType<typeof render> = render(
      <WorkflowVariableTokenRefreshModal
        variableName={variableName || "API_TOKEN"}
        outcome={outcome}
        onClose={onClose}
      />,
    );

    return {
      onClose,
      rerender: (next: TokenRefreshOutcome): void => {
        result.rerender(
          <WorkflowVariableTokenRefreshModal
            variableName={variableName || "API_TOKEN"}
            outcome={next}
            onClose={onClose}
          />,
        );
      },
    };
  }

  const validUntil: string = `It is valid until ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    EXPIRES_AT,
  )}`;

  /*
   * A token request can take up to 20 seconds. The modal opens as soon as it
   * goes out so the page is not silent in the meantime, and nothing on it can
   * be pressed until the answer replaces it.
   */
  describe("while the request is still out", () => {
    test("says it is fetching, for which variable, with a spinner", () => {
      renderRefreshModal(null, "API_TOKEN");

      expect(confirm().title).toBe("Fetching an Access Token");
      expect(confirm().description).toContain('"API_TOKEN"');
      expect(confirm().description).toContain("identity provider");
      expect(confirm().isLoading).toBe(true);
    });

    test("cannot be submitted, and pressing submit does not close it", () => {
      const handles: { onClose: VoidMock } = renderRefreshModal(null);

      expect(confirm().disableSubmitButton).toBe(true);
      expect(confirm().submitButtonText).toBe("Close");

      act(() => {
        confirm().onSubmit();
      });

      expect(handles.onClose).not.toHaveBeenCalled();
      expect(screen.queryByTestId("confirm-modal")).toBeInTheDocument();
    });

    test("is replaced by the answer when it arrives", () => {
      const handles: {
        onClose: VoidMock;
        rerender: (next: TokenRefreshOutcome) => void;
      } = renderRefreshModal(null);

      handles.rerender({ variableName: "API_TOKEN", expiresAt: EXPIRES_AT });

      expect(confirm().title).toBe("Access Token Fetched");
      expect(confirm().isLoading).toBeFalsy();
      expect(confirm().disableSubmitButton).toBeFalsy();

      act(() => {
        confirm().onSubmit();
      });

      expect(handles.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("after a token was fetched", () => {
    test("says so, for which variable, and until when it is valid", () => {
      renderRefreshModal({ variableName: "API_TOKEN", expiresAt: EXPIRES_AT });

      expect(confirm().title).toBe("Access Token Fetched");
      expect(confirm().description).toContain(
        'OneUptime fetched a new access token for "API_TOKEN"',
      );
      expect(confirm().description).toContain(validUntil);
      expect(confirm().description).toContain(
        "a new one is fetched automatically",
      );
      expect(confirm().description).not.toContain("said no");
    });

    const NO_EXPIRY: Array<{
      label: string;
      expiresAt: Date | null | undefined;
    }> = [
      { label: "null", expiresAt: null },
      { label: "missing", expiresAt: undefined },
    ];

    test.each(NO_EXPIRY)(
      "explains the per-run fetch when the expiry is $label",
      (entry: { label: string; expiresAt: Date | null | undefined }) => {
        renderRefreshModal({
          variableName: "API_TOKEN",
          expiresAt: entry.expiresAt,
        });

        expect(confirm().title).toBe("Access Token Fetched");
        expect(confirm().description).toContain(
          "The provider did not say when it expires",
        );
        expect(confirm().description).toContain(
          "every workflow run fetches a new one",
        );
        expect(confirm().description).not.toContain("valid until");
      },
    );

    test("is a plain Close, not a confirmation", () => {
      renderRefreshModal({ variableName: "API_TOKEN", expiresAt: EXPIRES_AT });

      expect(confirm().submitButtonText).toBe("Close");
      expect(confirm().submitButtonType).toBe(ButtonStyleType.NORMAL);
    });

    test("closes when Close is pressed", () => {
      const handles: { onClose: VoidMock } = renderRefreshModal({
        variableName: "API_TOKEN",
        expiresAt: EXPIRES_AT,
      });

      act(() => {
        confirm().onSubmit();
      });

      expect(handles.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("after the identity provider refused", () => {
    // The provider's own words are the thing somebody needs to read.
    test("says so and quotes the provider", () => {
      renderRefreshModal({
        variableName: "API_TOKEN",
        error:
          "The token endpoint refused the request (HTTP 401): invalid_client.",
      });

      expect(confirm().title).toBe("Could Not Fetch an Access Token");
      expect(confirm().description).toContain('"API_TOKEN"');
      expect(confirm().description).toContain("it said no");
      expect(confirm().description).toContain(
        "The token endpoint refused the request (HTTP 401): invalid_client.",
      );
      expect(confirm().description).not.toContain("valid until");
      expect(confirm().description).not.toContain("did not ask");
    });

    // An error wins over a stale expiry: the token was not fetched.
    test("reports the refusal even when an expiry is also present", () => {
      renderRefreshModal({
        variableName: "API_TOKEN",
        expiresAt: EXPIRES_AT,
        error: "invalid_grant",
      });

      expect(confirm().title).toBe("Could Not Fetch an Access Token");
      expect(confirm().description).not.toContain("valid until");
    });

    test("closes when Close is pressed", () => {
      const handles: { onClose: VoidMock } = renderRefreshModal({
        variableName: "API_TOKEN",
        error: "invalid_client",
      });

      expect(confirm().disableSubmitButton).toBeFalsy();

      act(() => {
        confirm().onSubmit();
      });

      expect(handles.onClose).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * A 401, 403 or 422 from the refresh route: OneUptime turned the request
   * down, so the identity provider never heard of it. Saying "it said no"
   * would send somebody off to check a client secret nobody tried.
   */
  describe("after OneUptime itself refused", () => {
    test("says the identity provider was not asked, and quotes OneUptime", () => {
      renderRefreshModal({
        variableName: "API_TOKEN",
        error: "You do not have permission to update this variable.",
        isRefusedByOneUptime: true,
      });

      expect(confirm().title).toBe("Could Not Fetch an Access Token");
      expect(confirm().description).toBe(
        'OneUptime did not ask your identity provider for an access token for "API_TOKEN": You do not have permission to update this variable.',
      );
      expect(confirm().description).not.toContain("said no");
      expect(confirm().description).not.toContain("valid until");
    });

    test("leads with what was saved", () => {
      renderRefreshModal({
        variableName: "API_TOKEN",
        savedWhat: "Client secret",
        error: "You do not have permission to update this variable.",
        isRefusedByOneUptime: true,
      });

      expect(confirm().title).toBe("Could Not Fetch an Access Token");
      expect(confirm().description).toBe(
        'Client secret saved. OneUptime did not ask your identity provider for an access token for "API_TOKEN": You do not have permission to update this variable.',
      );
    });

    test("is a plain Close that closes", () => {
      const handles: { onClose: VoidMock } = renderRefreshModal({
        variableName: "API_TOKEN",
        error: "Not authorized.",
        isRefusedByOneUptime: true,
      });

      expect(confirm().submitButtonText).toBe("Close");
      expect(confirm().disableSubmitButton).toBeFalsy();

      act(() => {
        confirm().onSubmit();
      });

      expect(handles.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("after credentials were saved", () => {
    test("leads with what was saved when the token was fetched", () => {
      renderRefreshModal({
        variableName: "API_TOKEN",
        savedWhat: "Client secret",
        expiresAt: EXPIRES_AT,
      });

      expect(confirm().description.startsWith("Client secret saved. ")).toBe(
        true,
      );
      expect(confirm().description).toContain(validUntil);
    });

    /*
     * A secret the provider refuses was still saved. Saying only "could not
     * fetch" would leave somebody believing the old secret is still in place.
     */
    test("leads with what was saved when the provider then refused", () => {
      renderRefreshModal({
        variableName: "API_TOKEN",
        savedWhat: "Client secret and refresh token",
        error: "invalid_client",
      });

      expect(confirm().title).toBe("Could Not Fetch an Access Token");
      expect(
        confirm().description.startsWith(
          "Client secret and refresh token saved. ",
        ),
      ).toBe(true);
      expect(confirm().description).toContain("invalid_client");
    });

    test("says nothing about a save when nothing was saved", () => {
      renderRefreshModal({ variableName: "API_TOKEN", expiresAt: EXPIRES_AT });

      expect(confirm().description.startsWith("OneUptime fetched")).toBe(true);
      expect(confirm().description).not.toContain("saved.");
    });
  });

  /*
   * The page builds the outcome with fetchTokenRefreshOutcome and hands it to
   * this modal. Run end to end against a mocked API.post so the wording is
   * checked on the path it really takes.
   */
  describe("fed by fetchTokenRefreshOutcome", () => {
    test("posts to the variable's refresh route with the project header", async () => {
      await fetchTokenRefreshOutcome({ variable: oauthVariable() });

      expect(apiPost).toHaveBeenCalledTimes(1);

      const call: { url: unknown; headers: Record<string, string> } = apiPost
        .mock.calls[0]![0] as { url: unknown; headers: Record<string, string> };

      expect(String(call.url)).toContain(
        `/workflow-variable/${VARIABLE_ID.toString()}/refresh-oauth-token`,
      );
      expect(call.headers).toEqual({ tenantid: "project-header" });
    });

    test("a fetched token is reported with its expiry", async () => {
      const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
        variable: oauthVariable(),
      });

      renderRefreshModal(outcome);

      expect(confirm().title).toBe("Access Token Fetched");
      expect(confirm().description).toContain(validUntil);
    });

    test("a secret the provider then refused is reported as saved and refused", async () => {
      apiPost.mockImplementation(rejectWith(new Error("invalid_client")));

      const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
        variable: oauthVariable(),
        savedWhat: "Client secret",
      });

      renderRefreshModal(outcome);

      expect(confirm().title).toBe("Could Not Fetch an Access Token");
      expect(confirm().description).toContain("Client secret saved.");
      expect(confirm().description).toContain("invalid_client");
    });

    /*
     * The real route answers a caller who may not update the variable with
     * NotAuthorizedException, a 422 error response. Its status code alone must
     * carry through to the wording. (API.getFriendlyMessage is mocked in this
     * file and words anything that is not an Error as "Request failed.".)
     */
    test("a 422 is reported as OneUptime refusing, not the provider", async () => {
      apiPost.mockResolvedValue(
        new HTTPErrorResponse(
          422,
          { message: "You do not have permission to update this variable." },
          {},
        ),
      );

      const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
        variable: oauthVariable(),
        savedWhat: "Client secret",
      });

      expect(outcome.isRefusedByOneUptime).toBe(true);

      renderRefreshModal(outcome);

      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(confirm().title).toBe("Could Not Fetch an Access Token");
      expect(confirm().description).toBe(
        'Client secret saved. OneUptime did not ask your identity provider for an access token for "API_TOKEN": Request failed.',
      );
      expect(confirm().description).not.toContain("said no");
    });

    // A 400 is the route passing on the provider's own refusal.
    test("a 400 is still reported as the provider saying no", async () => {
      apiPost.mockResolvedValue(
        new HTTPErrorResponse(400, { message: "invalid_client" }, {}),
      );

      const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
        variable: oauthVariable(),
      });

      expect(outcome.isRefusedByOneUptime).toBe(false);

      renderRefreshModal(outcome);

      expect(confirm().title).toBe("Could Not Fetch an Access Token");
      expect(confirm().description).toContain(
        'OneUptime asked your identity provider for an access token for "API_TOKEN" and it said no',
      );
      expect(confirm().description).not.toContain("did not ask");
    });

    test("a variable with no id is refused without a request", async () => {
      const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
        variable: oauthVariable({ id: null }),
      });

      renderRefreshModal(outcome);

      expect(apiPost).not.toHaveBeenCalled();
      expect(confirm().title).toBe("Could Not Fetch an Access Token");
      expect(confirm().description).toContain("no id");
    });
  });
});
