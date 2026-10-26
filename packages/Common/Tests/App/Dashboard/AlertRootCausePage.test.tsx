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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An alert's Root Cause page, rendered for real: the card and its Edit
 * dialog, with the real permission gate. Only the network is stubbed, and
 * the Markdown editor and viewer, which have their own tests.
 *
 * The page said isEditable but handed its card no formFields, and the
 * alert's rootCause column let nobody change it. So the card offered Edit
 * Alert - the record allowed that - and the button opened an empty dialog:
 * nothing to change, and a Save Changes that saved nothing. The page now
 * asks for the root cause, as the incident's Root Cause page does, and
 * whoever may edit the alert may change it (the column itself is pinned in
 * Tests/Models/DatabaseModels/AlertRootCauseColumn).
 */

const ALERT_ID: string = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const STORED_ROOT_CAUSE: string = "Disk full on db-1.";
const NEW_ROOT_CAUSE: string = "Log rotation was switched off.";
const EMPTY_STATE: string = "No root cause identified for this alert.";

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
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
      getProjectPermissions: (): {
        permissions: Array<Record<string, unknown>>;
      } => {
        return {
          permissions: permissionsForTest.map(
            (permission: string): Record<string, unknown> => {
              return {
                permission,
                labelIds: [],
                _type: "UserPermission",
              };
            },
          ),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
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

/*
 * The rich text editor as a textarea named by the field's label: same
 * props, same callback, and it takes `initialValue` once per mount the way
 * the real one does.
 */
jest.mock("../../../UI/Components/Markdown.tsx/MarkdownEditor", () => {
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (props: {
      ariaLabelledby?: string;
      initialValue?: string;
      placeholder?: string;
      onChange?: (value: string) => void;
    }): ReactElement => {
      const [value, setValue] = ReactModule.useState<string>(
        props.initialValue || "",
      );
      return (
        <textarea
          aria-labelledby={props.ariaLabelledby}
          placeholder={props.placeholder}
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setValue(event.target.value);
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return <div data-testid="markdown">{props.text}</div>;
    },
  };
});

import AlertRootCause from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/RootCause";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Alert from "../../../Models/DatabaseModels/Alert";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const WAIT: { timeout: number } = { timeout: 20000 };

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

const SIGNED_IN: Array<string> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

/*
 * Everyone who may edit an alert. Edit Alert alone may not read one, so it
 * is granted with Read Alert, as a role that edits alerts is.
 */
const EDITORS: Array<Array<Permission>> = [
  [Permission.ProjectOwner],
  [Permission.ProjectAdmin],
  [Permission.ProjectMember],
  [Permission.AlertAdmin],
  [Permission.AlertMember],
  [Permission.ReadAlert, Permission.EditAlert],
];

// Who may read alerts but not change them.
const READ_ONLY: Array<Permission> = [
  Permission.Viewer,
  Permission.AlertViewer,
  Permission.ReadAlert,
];

// The root cause the fake server holds; a save writes it.
let storedRootCause: string | null = STORED_ROOT_CAUSE;

interface GetItemRequest {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

interface SaveRequest {
  model: Alert;
  modelType: unknown;
}

beforeEach(() => {
  permissionsForTest = [...SIGNED_IN, Permission.ProjectOwner];
  storedRootCause = STORED_ROOT_CAUSE;
  PermissionGate.clearPermissionPropsCache();

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<Alert> => {
    const alert: Alert = new Alert();
    alert._id = ALERT_ID;

    if (storedRootCause !== null) {
      alert.rootCause = storedRootCause;
    }

    return alert;
  });

  createOrUpdateMock.mockReset();
  createOrUpdateMock.mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      const request: SaveRequest = args[0] as SaveRequest;
      storedRootCause = request.model.rootCause ?? null;
      return { data: {} };
    },
  );

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(ALERT_ID));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  const shown: string = storedRootCause?.trim() ? storedRootCause : EMPTY_STATE;

  await act(async () => {
    render(<AlertRootCause {...PAGE_PROPS} />);
  });

  // The card has loaded the alert: its root cause, or that there is none.
  await screen.findByText(shown, {}, WAIT);
}

function editButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Edit Root Cause" });
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

async function openEditor(): Promise<HTMLElement> {
  await renderPage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Edit Root Cause" }, WAIT),
  );

  await screen.findByTestId("modal", {}, WAIT);

  // The dialog has read the alert and drawn its one field.
  return within(dialog()).findByRole("textbox", { name: /^Root Cause/ }, WAIT);
}

function save(): void {
  fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
}

// The request the dialog saved.
async function savedRequest(): Promise<SaveRequest> {
  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  }, WAIT);

  return createOrUpdateMock.mock.calls[0]![0] as SaveRequest;
}

function getItemRequests(): Array<GetItemRequest> {
  return getItemMock.mock.calls.map((call: Array<unknown>): GetItemRequest => {
    return call[0] as GetItemRequest;
  });
}

describe("the alert's Root Cause card", () => {
  test("shows the alert's root cause", async () => {
    await renderPage();

    expect(screen.getByText("Root Cause", { selector: "h2" })).toBeVisible();
    expect(
      screen.getByText(
        "Why did this alert happen? Here is the root cause of this alert.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("markdown")).toHaveTextContent(STORED_ROOT_CAUSE);
  });

  test("reads the alert's root cause, by the alert's id", async () => {
    await renderPage();

    const request: GetItemRequest = getItemRequests()[0]!;

    expect(request.modelType).toBe(Alert);
    expect(request.id.toString()).toBe(ALERT_ID);
    expect(request.select).toEqual(
      expect.objectContaining({ rootCause: true }),
    );
  });

  test("says so when the alert has no root cause yet", async () => {
    storedRootCause = null;

    await renderPage();

    expect(screen.getByText(EMPTY_STATE)).toBeInTheDocument();
    expect(editButton()).toBeEnabled();
  });

  test("offers Edit Root Cause, and no bare Edit Alert", async () => {
    await renderPage();

    expect(editButton()).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Edit Alert" })).toBeNull();
  });
});

describe("Edit Root Cause", () => {
  test("opens on the alert's root cause, not an empty dialog", async () => {
    const editor: HTMLElement = await openEditor();

    expect(editor).toHaveValue(STORED_ROOT_CAUSE);
    expect(
      within(dialog()).getByText("Describe the root cause of this alert here."),
    ).toBeInTheDocument();
  });

  test("asks for the root cause and nothing else", async () => {
    const editor: HTMLElement = await openEditor();

    expect(within(dialog()).getAllByRole("textbox")).toEqual([editor]);
    expect(within(dialog()).queryByRole("checkbox")).toBeNull();
    expect(within(dialog()).queryByRole("combobox")).toBeNull();
    expect(editor).toHaveAttribute("placeholder", "Root Cause");
  });

  test("the root cause is optional", async () => {
    const editor: HTMLElement = await openEditor();

    expect(editor).toHaveAccessibleName(/\(Optional\)/);
  });

  test("the dialog reads the alert's root cause before it is drawn", async () => {
    await openEditor();

    // The card's read, then the dialog's own.
    expect(getItemRequests().length).toBeGreaterThanOrEqual(2);

    const requests: Array<GetItemRequest> = getItemRequests();
    const dialogRead: GetItemRequest = requests[requests.length - 1]!;

    expect(dialogRead.modelType).toBe(Alert);
    expect(dialogRead.id.toString()).toBe(ALERT_ID);
    expect(dialogRead.select).toEqual(
      expect.objectContaining({ rootCause: true }),
    );
  });

  test("saving sends the new root cause, for this alert", async () => {
    const editor: HTMLElement = await openEditor();

    fireEvent.change(editor, { target: { value: NEW_ROOT_CAUSE } });
    save();

    const request: SaveRequest = await savedRequest();

    expect(request.modelType).toBe(Alert);
    expect(request.model.rootCause).toBe(NEW_ROOT_CAUSE);
    expect(request.model.id?.toString()).toBe(ALERT_ID);
  });

  test("saving sends no other field of the alert", async () => {
    const editor: HTMLElement = await openEditor();

    fireEvent.change(editor, { target: { value: NEW_ROOT_CAUSE } });
    save();

    const saved: Alert = (await savedRequest()).model;

    expect(saved.title).toBeUndefined();
    expect(saved.description).toBeUndefined();
    expect(saved.remediationNotes).toBeUndefined();
  });

  test("keeps Markdown as it was written", async () => {
    const markdown: string =
      "## What happened\n\n- The disk filled up.\n- Writes failed.";
    const editor: HTMLElement = await openEditor();

    fireEvent.change(editor, { target: { value: markdown } });
    save();

    expect((await savedRequest()).model.rootCause).toBe(markdown);
  });

  test("after saving, the dialog closes and the card shows the new root cause", async () => {
    const editor: HTMLElement = await openEditor();
    const readsBeforeSave: number = getItemMock.mock.calls.length;

    fireEvent.change(editor, { target: { value: NEW_ROOT_CAUSE } });
    save();

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    }, WAIT);

    expect(await screen.findByText(NEW_ROOT_CAUSE, {}, WAIT)).toBeVisible();
    expect(screen.queryByText(STORED_ROOT_CAUSE)).toBeNull();
    // The card read the alert again rather than trusting the form.
    expect(getItemMock.mock.calls.length).toBeGreaterThan(readsBeforeSave);
  });

  test("a root cause can be cleared: saving an empty one is not refused", async () => {
    const editor: HTMLElement = await openEditor();

    fireEvent.change(editor, { target: { value: "" } });
    save();

    const saved: Alert = (await savedRequest()).model;

    expect(saved.rootCause || "").toBe("");
    expect(screen.queryByText(/Root Cause is required/)).toBeNull();

    // The card says there is none now.
    expect(await screen.findByText(EMPTY_STATE, {}, WAIT)).toBeVisible();
  });

  test("an alert with no root cause yet opens empty, and the first one is saved", async () => {
    storedRootCause = null;

    const editor: HTMLElement = await openEditor();

    expect(editor).toHaveValue("");

    fireEvent.change(editor, { target: { value: NEW_ROOT_CAUSE } });
    save();

    expect((await savedRequest()).model.rootCause).toBe(NEW_ROOT_CAUSE);
    expect(await screen.findByText(NEW_ROOT_CAUSE, {}, WAIT)).toBeVisible();
  });

  test("Cancel closes the dialog and saves nothing", async () => {
    const editor: HTMLElement = await openEditor();

    fireEvent.change(editor, { target: { value: NEW_ROOT_CAUSE } });
    fireEvent.click(within(dialog()).getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    }, WAIT);

    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(screen.getByText(STORED_ROOT_CAUSE)).toBeInTheDocument();
  });

  test("reopened after Cancel, it starts again from the stored root cause", async () => {
    const editor: HTMLElement = await openEditor();

    fireEvent.change(editor, { target: { value: NEW_ROOT_CAUSE } });
    fireEvent.click(within(dialog()).getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    }, WAIT);

    fireEvent.click(editButton()!);

    const reopened: HTMLElement = await within(
      await screen.findByTestId("modal", {}, WAIT),
    ).findByRole("textbox", { name: /^Root Cause/ }, WAIT);

    expect(reopened).toHaveValue(STORED_ROOT_CAUSE);
  });

  test("a save the server refuses says why, and keeps the dialog open with what was written", async () => {
    createOrUpdateMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "User is not allowed to update on rootCause column of Alert.",
      );
    });

    const editor: HTMLElement = await openEditor();

    fireEvent.change(editor, { target: { value: NEW_ROOT_CAUSE } });
    save();

    expect(
      await within(dialog()).findByText(
        /User is not allowed to update on rootCause column of Alert\./,
        {},
        WAIT,
      ),
    ).toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    expect(
      within(dialog()).getByRole("textbox", { name: /^Root Cause/ }),
    ).toHaveValue(NEW_ROOT_CAUSE);
  });
});

describe("who may edit the root cause", () => {
  test.each(
    EDITORS.map((grants: Array<Permission>): [string, Array<Permission>] => {
      return [grants.join(" + "), grants];
    }),
  )(
    "%s may: Edit Root Cause opens the dialog",
    async (_name: string, grants: Array<Permission>) => {
      permissionsForTest = [...SIGNED_IN, ...grants];

      const editor: HTMLElement = await openEditor();

      expect(editor).toHaveValue(STORED_ROOT_CAUSE);
    },
  );

  test.each(READ_ONLY)(
    "%s reads it, and Edit Root Cause is locked for them",
    async (permission: Permission) => {
      permissionsForTest = [...SIGNED_IN, permission];

      await renderPage();

      expect(screen.getByText(STORED_ROOT_CAUSE)).toBeInTheDocument();
      expect(editButton()).toBeDisabled();

      fireEvent.click(editButton()!);

      expect(screen.queryByTestId("modal")).toBeNull();
    },
  );

  test("a read-only role beside an editing one may edit", async () => {
    permissionsForTest = [
      ...SIGNED_IN,
      Permission.Viewer,
      Permission.AlertMember,
    ];

    await renderPage();

    expect(editButton()).toBeEnabled();
  });
});
