import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * CardModelDetail titles its edit dialog "Edit <model>". On a card that
 * edits a few of a project's settings that reads "Edit Project", which is
 * not what the person clicked: the Number Prefix card's Update said
 * nothing about editing the project. Such a card names the dialog itself
 * (editModalTitle) and can say what a change does under the title
 * (editModalDescription). Every other card keeps the old title.
 */

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
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
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
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
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import Project from "../../../Models/DatabaseModels/Project";

const WAIT_TIMEOUT: number = 20000;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function renderCard(props: {
  editModalTitle?: string;
  editModalDescription?: string;
}): void {
  render(
    <CardModelDetail<Project>
      name="Number Prefix"
      cardProps={{
        title: "Number Prefix",
        description: "The short text in front of incident numbers.",
      }}
      isEditable={true}
      editButtonText="Update"
      {...props}
      formFields={[
        {
          field: { incidentNumberPrefix: true },
          title: "Incident Number Prefix",
          fieldType: FormFieldSchemaType.Text,
          required: false,
        },
      ]}
      modelDetailProps={{
        modelType: Project,
        id: "project-prefix",
        modelId: PROJECT_ID,
        fields: [
          {
            field: { incidentNumberPrefix: true },
            title: "Incidents",
          },
        ],
      }}
    />,
  );
}

async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(
    await screen.findByText("Update", {}, { timeout: WAIT_TIMEOUT }),
  );
  return await screen.findByRole("dialog", {}, { timeout: WAIT_TIMEOUT });
}

describe("CardModelDetail's edit dialog title", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    getItemMock.mockImplementation(async () => {
      const project: Project = new Project();
      project.id = PROJECT_ID;
      project.incidentNumberPrefix = "INC-";
      return project;
    });
  });

  it("is Edit <model> when the card does not name it", async () => {
    renderCard({});

    const dialog: HTMLElement = await openDialog();

    expect(within(dialog).getByText("Edit Project")).toBeTruthy();
  });

  it("is the card's own title when it names one", async () => {
    renderCard({ editModalTitle: "Edit Number Prefix" });

    const dialog: HTMLElement = await openDialog();

    expect(within(dialog).getByText("Edit Number Prefix")).toBeTruthy();
    expect(within(dialog).queryByText("Edit Project")).toBeNull();
  });

  it("shows the card's description under the title", async () => {
    renderCard({
      editModalTitle: "Edit Number Prefix",
      editModalDescription:
        "Only new incidents use the new prefix. Existing ones keep their numbers.",
    });

    const dialog: HTMLElement = await openDialog();

    expect(
      within(dialog).getByText(
        "Only new incidents use the new prefix. Existing ones keep their numbers.",
      ),
    ).toBeTruthy();
  });

  it("names the dialog by its title for assistive technology", async () => {
    renderCard({ editModalTitle: "Edit Number Prefix" });

    await openDialog();

    expect(
      screen.getByRole("dialog", { name: "Edit Number Prefix" }),
    ).toBeTruthy();
  });

  it("does not change the button that opens it", async () => {
    renderCard({ editModalTitle: "Edit Number Prefix" });

    expect(
      await screen.findByText("Update", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeTruthy();
    expect(screen.queryByText("Edit Number Prefix")).toBeNull();
  });
});
