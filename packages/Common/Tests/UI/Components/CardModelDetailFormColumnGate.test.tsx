import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
 * CardModelDetail's Edit button weighed the record's update list alone, and
 * the form it opens drops every field its viewer may not change. Once a
 * Billing Admin could update a project - for its four notification channels
 * and nothing else - the project's other cards (its name, say) would have
 * offered them an Edit button that opened an empty form. The button now
 * weighs the card's own fields too: locked, naming who could change them,
 * when the viewer may change none of them.
 */

let isMasterAdminForTest: boolean = false;
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
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    },
  };
});

import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import FieldType from "../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

type CardColumn =
  | "name"
  | "enableSmsNotifications"
  | "enableCallNotifications"
  | "financeAccountingEmail";

const findEditButton: () => HTMLButtonElement | null =
  (): HTMLButtonElement | null => {
    return (
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button: HTMLButtonElement) => {
          return (button.textContent || "").trim().startsWith("Edit Project");
        },
      ) || null
    );
  };

const renderCard: (columns: Array<CardColumn>) => void = (
  columns: Array<CardColumn>,
): void => {
  render(
    <CardModelDetail<Project>
      name="Project Card"
      cardProps={{ title: "Project Card", description: "About it" }}
      isEditable={true}
      formFields={columns.map((column: CardColumn) => {
        return {
          field: { [column]: true },
          title: column,
          fieldType:
            column === "name" || column === "financeAccountingEmail"
              ? FormFieldSchemaType.Text
              : FormFieldSchemaType.Toggle,
          required: false,
        };
      })}
      modelDetailProps={{
        modelType: Project,
        id: "project-detail",
        modelId: PROJECT_ID,
        fields: columns.map((column: CardColumn) => {
          return {
            field: { [column]: true },
            title: column,
            fieldType: FieldType.Text,
          };
        }),
      }}
    />,
  );
};

const hoverEdit: () => HTMLElement = (): HTMLElement => {
  fireEvent.mouseEnter(findEditButton()!.parentElement as HTMLElement);

  return screen.getByRole("tooltip");
};

describe("CardModelDetail weighs the card's own fields", () => {
  beforeEach(() => {
    isMasterAdminForTest = false;
    permissionsForTest = [];
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("a Billing Admin opens the card of a project's channels", async () => {
    permissionsForTest = [Permission.BillingAdmin, Permission.ProjectUser];

    renderCard(["enableSmsNotifications", "enableCallNotifications"]);

    await waitFor(() => {
      expect(findEditButton()).not.toBeNull();
    });

    expect(findEditButton()).not.toBeDisabled();
  });

  test("a Billing Admin finds the project's name card locked, and is told who may change it", async () => {
    permissionsForTest = [Permission.BillingAdmin, Permission.ProjectUser];

    renderCard(["name"]);

    await waitFor(() => {
      expect(findEditButton()).not.toBeNull();
    });

    expect(findEditButton()).toBeDisabled();
    expect(hoverEdit()).toHaveTextContent(
      "You do not have permission to update this Project. You need one of these permissions: Project Owner, Manage Billing, Edit Project.",
    );
  });

  test("a project admin finds the channels card locked, naming a Billing Admin among who may", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    renderCard(["enableSmsNotifications", "enableCallNotifications"]);

    await waitFor(() => {
      expect(findEditButton()).not.toBeNull();
    });

    expect(findEditButton()).toBeDisabled();
    expect(hoverEdit()).toHaveTextContent(
      "You need one of these permissions: Project Owner, Billing Admin, Manage Billing.",
    );
  });

  /*
   * Project.name's update list is a project owner, Manage Billing and Edit
   * Project: a project admin's Edit on that card used to open an empty form.
   */
  test("a project admin finds the name card locked too: a project's name is not theirs to change", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    renderCard(["name"]);

    await waitFor(() => {
      expect(findEditButton()).not.toBeNull();
    });

    expect(findEditButton()).toBeDisabled();
    expect(hoverEdit()).toHaveTextContent(
      "You need one of these permissions: Project Owner, Manage Billing, Edit Project.",
    );
  });

  test("one field the viewer may change opens the card", async () => {
    permissionsForTest = [Permission.BillingAdmin];

    renderCard(["name", "enableSmsNotifications"]);

    await waitFor(() => {
      expect(findEditButton()).not.toBeNull();
    });

    expect(findEditButton()).not.toBeDisabled();
  });

  test("Manage Billing opens both cards", async () => {
    permissionsForTest = [Permission.ManageProjectBilling];

    renderCard(["name", "financeAccountingEmail"]);

    await waitFor(() => {
      expect(findEditButton()).not.toBeNull();
    });

    expect(findEditButton()).not.toBeDisabled();
  });

  test("a master admin opens every card", async () => {
    isMasterAdminForTest = true;

    renderCard(["financeAccountingEmail"]);

    await waitFor(() => {
      expect(findEditButton()).not.toBeNull();
    });

    expect(findEditButton()).not.toBeDisabled();
  });

  test("before the permission snapshot lands there is no button to blame anybody with", async () => {
    permissionsForTest = [];

    renderCard(["name"]);

    await waitFor(() => {
      expect(screen.getByText("Project Card")).toBeInTheDocument();
    });

    expect(findEditButton()).toBeNull();
  });
});
