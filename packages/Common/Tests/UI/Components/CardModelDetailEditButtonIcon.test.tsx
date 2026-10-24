import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import Icon from "../../../UI/Components/Icon/Icon";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A detail card's edit button draws a pencil. A card whose button adds what
 * is not there yet - the project's "Add AI context" - draws a plus instead
 * (editButtonIcon), as every other Add in the product does; every other
 * card keeps its pencil.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
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
import Probe from "../../../Models/DatabaseModels/Probe";

const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

function renderProbeCard(props: {
  editButtonText?: string;
  editButtonIcon?: IconProp;
}): void {
  render(
    <CardModelDetail<Probe>
      name="Probe Details"
      cardProps={{
        title: "Probe Details",
        description: "The probe's name.",
      }}
      isEditable={true}
      {...(props.editButtonText
        ? { editButtonText: props.editButtonText }
        : {})}
      {...(props.editButtonIcon
        ? { editButtonIcon: props.editButtonIcon }
        : {})}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
      ]}
      modelDetailProps={{
        modelType: Probe,
        id: "probe-detail",
        modelId: PROBE_ID,
        fields: [
          {
            field: { name: true },
            title: "Name",
          },
        ],
      }}
    />,
  );
}

// The picture a button draws, by its path.
function iconOf(element: HTMLElement): string | null {
  return element.querySelector("svg path")?.getAttribute("d") || null;
}

function iconPath(icon: IconProp): string | null {
  const drawn: { container: HTMLElement; unmount: () => void } = render(
    <Icon icon={icon} />,
  );
  const path: string | null = iconOf(drawn.container);
  drawn.unmount();
  return path;
}

describe("CardModelDetail's edit button picture", () => {
  beforeEach(() => {
    cleanup();
    getItemMock.mockReset();
    getItemMock.mockImplementation(() => {
      return new Promise(() => {});
    });
  });

  it("is a pencil by default", async () => {
    renderProbeCard({});

    const button: HTMLElement = await screen.findByRole(
      "button",
      { name: "Edit Probe" },
      { timeout: WAIT_TIMEOUT },
    );

    expect(iconOf(button)).toBe(iconPath(IconProp.Edit));
  });

  it("is the one the card names: a plus on a button that adds", async () => {
    renderProbeCard({
      editButtonText: "Add details",
      editButtonIcon: IconProp.Add,
    });

    const button: HTMLElement = await screen.findByRole(
      "button",
      { name: "Add details" },
      { timeout: WAIT_TIMEOUT },
    );

    expect(iconOf(button)).toBe(iconPath(IconProp.Add));
    expect(iconOf(button)).not.toBe(iconPath(IconProp.Edit));
  });
});
