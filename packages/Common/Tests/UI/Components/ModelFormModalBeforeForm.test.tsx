import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import Permission, { UserPermission } from "../../../Types/Permission";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction from "../../MockType";

/*
 * What a model form dialog is about, drawn above its fields
 * (beforeFormElement), as BasicFormModal draws the rows a form is about:
 * Save as Hunt says the search it saves - the search, its filters and how
 * far back it looks - over the name and the schedule. In the dialog's body,
 * as wide as the fields: in the header's description it was squeezed
 * beside the close button. The real ModelFormModal, ModelForm and
 * BasicForm, with only transport and permissions stubbed.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
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

function renderModal(beforeFormElement?: React.ReactElement): void {
  render(
    <ModelFormModal<Probe>
      modelType={Probe}
      title="Save as Hunt"
      description="Save the search on screen with a name."
      submitButtonText="Save Hunt"
      onClose={getJestMockFunction()}
      beforeFormElement={beforeFormElement}
      formProps={{
        modelType: Probe,
        id: "save-as-hunt-form",
        formType: FormType.Create,
        fields: [
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ],
      }}
    />,
  );
}

describe("ModelFormModal beforeFormElement", () => {
  afterEach(() => {
    cleanup();
  });

  test("is drawn in the body, above the fields, not in the header's description", async () => {
    renderModal(
      <p data-testid="saved-search">user:svc-backup + 1 filter Past 1 Day</p>,
    );

    const field: HTMLElement = await screen.findByRole("textbox", {
      name: "Name",
    });
    const before: HTMLElement = screen.getByTestId("form-modal-before-form");

    expect(within(before).getByTestId("saved-search")).toHaveTextContent(
      "user:svc-backup + 1 filter Past 1 Day",
    );
    // Above the field it is about.
    expect(
      before.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // In the dialog's body, as wide as the fields.
    expect(
      within(screen.getByTestId("modal-content")).getByTestId(
        "form-modal-before-form",
      ),
    ).toBe(before);
    expect(
      within(screen.getByTestId("modal-header")).queryByTestId("saved-search"),
    ).toBeNull();
    // The header keeps its own one-line description.
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Save the search on screen with a name.",
    );
  });

  test("without one, the fields start the body as they always did", async () => {
    renderModal();

    await screen.findByRole("textbox", { name: "Name" });

    expect(screen.queryByTestId("form-modal-before-form")).toBeNull();
  });
});
