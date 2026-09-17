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
 * The cards on a resource's own pages - Delete, Edit, Duplicate, Reset Key -
 * are where a viewer meets the same problem the tables had, in a sharper form.
 *
 * ModelDelete had no permission logic at all: 60 pages rendered a live, red
 * "Delete <X>" button for everybody, with a confirmation dialog behind it, and
 * the refusal only arrived from the API after the user had confirmed they
 * wanted to destroy something. CardModelDetail did check, but hid the Edit
 * button - and checked only project permissions, so a permission granted
 * globally did not count, and it read the answer once at mount and never
 * again.
 *
 * All of them now behave the same way: the button stays, locked, and names the
 * permission it wants.
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
      deleteItem: async (): Promise<void> => {
        deleteItemCalls++;
      },
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

let deleteItemCalls: number = 0;

import ModelDelete from "../../../UI/Components/ModelDelete/ModelDelete";
import DuplicateModel from "../../../UI/Components/DuplicateModel/DuplicateModel";
import ResetObjectID from "../../../UI/Components/ResetObjectID/ResetObjectID";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type FindButtonFunction = (label: string) => HTMLButtonElement | null;

const findButton: FindButtonFunction = (
  label: string,
): HTMLButtonElement | null => {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button: HTMLButtonElement) => {
        return (button.textContent || "").trim().startsWith(label);
      },
    ) || null
  );
};

describe("resource card permission gating", () => {
  beforeEach(() => {
    isMasterAdminForTest = false;
    permissionsForTest = [];
    deleteItemCalls = 0;
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("ModelDelete", () => {
    test("offers a working Delete button when the viewer may delete", () => {
      permissionsForTest = [Permission.ProjectAdmin];

      render(
        <ModelDelete<Monitor>
          modelType={Monitor}
          modelId={MONITOR_ID}
          onDeleteSuccess={() => {}}
        />,
      );

      const button: HTMLButtonElement = findButton("Delete Monitor")!;

      expect(button).not.toBeDisabled();

      fireEvent.click(button);

      // The confirmation dialog restates the question before anything happens.
      expect(
        screen.getAllByText("Are you sure you want to delete this monitor?")
          .length,
      ).toBeGreaterThan(0);
    });

    /*
     * The worst version of the old behaviour: a red Delete button, a
     * confirmation the user has to actively agree to, and only then a refusal
     * from the server.
     */
    test("locks the Delete button when the viewer may not delete", () => {
      permissionsForTest = [Permission.Viewer];

      render(
        <ModelDelete<Monitor>
          modelType={Monitor}
          modelId={MONITOR_ID}
          onDeleteSuccess={() => {}}
        />,
      );

      expect(findButton("Delete Monitor")).toBeDisabled();
    });

    test("explains the locked Delete on hover", () => {
      permissionsForTest = [Permission.Viewer];

      render(
        <ModelDelete<Monitor>
          modelType={Monitor}
          modelId={MONITOR_ID}
          onDeleteSuccess={() => {}}
        />,
      );

      fireEvent.mouseEnter(
        findButton("Delete Monitor")!.parentElement as HTMLElement,
      );

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "You do not have permission to delete this Monitor.",
      );
      expect(screen.getByRole("tooltip")).toHaveTextContent("Delete Monitor");
    });

    test("a locked Delete opens no confirmation and deletes nothing", () => {
      permissionsForTest = [Permission.Viewer];

      render(
        <ModelDelete<Monitor>
          modelType={Monitor}
          modelId={MONITOR_ID}
          onDeleteSuccess={() => {}}
        />,
      );

      fireEvent.click(findButton("Delete Monitor")!);

      expect(
        screen.queryAllByText("Are you sure you want to delete this monitor?")
          .length,
      ).toBe(1); // only the card's own description, never the dialog's copy
      expect(deleteItemCalls).toBe(0);
    });

    test("works for a master admin", () => {
      isMasterAdminForTest = true;
      permissionsForTest = [];

      render(
        <ModelDelete<Monitor>
          modelType={Monitor}
          modelId={MONITOR_ID}
          onDeleteSuccess={() => {}}
        />,
      );

      expect(findButton("Delete Monitor")).not.toBeDisabled();
    });
  });

  describe("DuplicateModel", () => {
    /*
     * Duplicating writes a new record, so it is a create - not, as the button's
     * position on an existing record might suggest, an update.
     */
    test("locks Duplicate behind create permission", () => {
      permissionsForTest = [Permission.Viewer];

      render(
        <DuplicateModel<Monitor>
          modelType={Monitor}
          modelId={MONITOR_ID}
          fieldsToDuplicate={{}}
          navigateToOnSuccess={undefined as never}
          fieldsToChange={[]}
          onDuplicateSuccess={() => {}}
        />,
      );

      const button: HTMLButtonElement = findButton("Duplicate Monitor")!;

      expect(button).toBeDisabled();

      fireEvent.mouseEnter(button.parentElement as HTMLElement);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "You do not have permission to create this Monitor.",
      );
    });

    test("leaves Duplicate working for someone who may create", () => {
      permissionsForTest = [Permission.ProjectAdmin];

      render(
        <DuplicateModel<Monitor>
          modelType={Monitor}
          modelId={MONITOR_ID}
          fieldsToDuplicate={{}}
          navigateToOnSuccess={undefined as never}
          fieldsToChange={[]}
          onDuplicateSuccess={() => {}}
        />,
      );

      expect(findButton("Duplicate Monitor")).not.toBeDisabled();
    });
  });

  describe("ResetObjectID", () => {
    /*
     * Resetting a secret key rewrites a column on the record, so it needs
     * update permission - and it is exactly the kind of destructive action
     * that should say so rather than silently vanish.
     */
    test("locks the reset behind update permission", () => {
      permissionsForTest = [Permission.Viewer];

      render(
        <ResetObjectID<Monitor>
          modelType={Monitor}
          modelId={MONITOR_ID}
          fieldName={"_id" as keyof Monitor}
          title="Reset Key"
          description="Reset the key for this monitor."
          onUpdateComplete={() => {}}
        />,
      );

      const button: HTMLButtonElement = findButton("Reset Key")!;

      expect(button).toBeDisabled();

      fireEvent.mouseEnter(button.parentElement as HTMLElement);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "You do not have permission to update this Monitor.",
      );
    });

    test("leaves the reset working for someone who may update", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      render(
        <ResetObjectID<Monitor>
          modelType={Monitor}
          modelId={MONITOR_ID}
          fieldName={"_id" as keyof Monitor}
          title="Reset Key"
          description="Reset the key for this monitor."
          onUpdateComplete={() => {}}
        />,
      );

      await waitFor(() => {
        expect(findButton("Reset Key")).not.toBeDisabled();
      });
    });
  });
});
