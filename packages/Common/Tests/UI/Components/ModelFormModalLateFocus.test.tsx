import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The real ModelFormModal, ModelForm and BasicForm, with only transport and
 * permissions stubbed. An edit dialog reads its record before it draws a
 * field: ModelForm shows a loader until the read lands. The dialog's first
 * focus was placed while that loader showed, on the footer's Save, and
 * stayed there once the fields came. Now the first field takes it as the
 * form draws.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: async (): Promise<{
        data: Record<string, unknown>;
      }> => {
        return { data: {} };
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

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: (): { permissions: Array<UserPermission> } => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: OWNER_PERMISSIONS };
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
    },
  };
});

import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import Probe from "../../../Models/DatabaseModels/Probe";

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
}

const deferred: () => Deferred = (): Deferred => {
  let resolve: (value: unknown) => void = (): void => {};
  const promise: Promise<unknown> = new Promise<unknown>(
    (done: (value: unknown) => void) => {
      resolve = done;
    },
  );

  return { promise, resolve };
};

const loadedProbe: () => Probe = (): Probe => {
  const probe: Probe = new Probe();
  probe._id = PROBE_ID.toString();
  probe.name = "Frankfurt";
  probe.description = "The EU probe";
  return probe;
};

beforeEach(() => {
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("an edit dialog that reads its record first", () => {
  test("its first field takes the focus once the read lands, not the footer's Save", async () => {
    const read: Deferred = deferred();
    getItemMock.mockReturnValue(read.promise);

    await act(async () => {
      render(
        <ModelFormModal<Probe>
          title="Edit Probe"
          modelType={Probe}
          modelIdToEdit={PROBE_ID}
          submitButtonText="Save Changes"
          onClose={(): void => {}}
          formProps={{
            id: "edit-probe",
            modelType: Probe,
            formType: FormType.Update,
            fields: [
              {
                field: { name: true },
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "Probe name",
              },
              {
                field: { description: true },
                title: "Description",
                fieldType: FormFieldSchemaType.LongText,
                required: false,
                placeholder: "What this probe is for",
              },
            ],
          }}
        />,
      );
    });

    // While the record is read, nothing is there to fill in.
    expect(screen.queryByPlaceholderText("Probe name")).toBeNull();
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveFocus();

    await act(async () => {
      read.resolve(loadedProbe());
    });

    const name: HTMLElement = await screen.findByPlaceholderText("Probe name");

    await waitFor(() => {
      expect(name).toHaveFocus();
    });
    expect(screen.getByTestId("modal-footer-submit-button")).not.toHaveFocus();
  });

  /*
   * A text field focuses itself as it draws (FormField's autoFocus); a form
   * that starts on a switch, a dropdown or a picker has nothing that does,
   * and BasicForm draws no <form> element. The dialog's own watch is what
   * moves the focus there.
   */
  test("an edit dialog that starts on a switch: the switch takes the focus once the read lands", async () => {
    const read: Deferred = deferred();
    getItemMock.mockReturnValue(read.promise);

    await act(async () => {
      render(
        <ModelFormModal<Probe>
          title="Edit Probe"
          modelType={Probe}
          modelIdToEdit={PROBE_ID}
          submitButtonText="Save Changes"
          onClose={(): void => {}}
          formProps={{
            id: "edit-probe-switch-first",
            modelType: Probe,
            formType: FormType.Update,
            fields: [
              {
                field: { shouldAutoEnableProbeOnNewMonitors: true },
                title: "Add to new monitors",
                fieldType: FormFieldSchemaType.Toggle,
                required: false,
              },
              {
                field: { name: true },
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "Probe name",
              },
            ],
          }}
        />,
      );
    });

    expect(screen.getByTestId("modal-footer-submit-button")).toHaveFocus();

    await act(async () => {
      read.resolve(loadedProbe());
    });

    const toggle: HTMLElement = await screen.findByRole("switch");

    await waitFor(() => {
      expect(toggle).toHaveFocus();
    });
    expect(screen.getByTestId("modal-footer-submit-button")).not.toHaveFocus();
    // BasicForm's root is the form scope the dialog looks for, not a <form>.
    expect(document.querySelector("form")).toBeNull();
  });

  test("a create dialog draws its fields at once and starts on the first, as before", async () => {
    await act(async () => {
      render(
        <ModelFormModal<Probe>
          title="Create New Probe"
          modelType={Probe}
          submitButtonText="Create Probe"
          onClose={(): void => {}}
          formProps={{
            id: "create-probe",
            modelType: Probe,
            formType: FormType.Create,
            fields: [
              {
                field: { name: true },
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "Probe name",
              },
            ],
          }}
        />,
      );
    });

    const name: HTMLElement = await screen.findByPlaceholderText("Probe name");

    await waitFor(() => {
      expect(name).toHaveFocus();
    });
    expect(getItemMock).not.toHaveBeenCalled();
  });
});
