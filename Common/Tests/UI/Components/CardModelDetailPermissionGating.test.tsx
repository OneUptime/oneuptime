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
import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import FieldType from "../../../UI/Components/Types/FieldType";

/*
 * CardModelDetail's Edit button was the only model-level permission check in
 * the app outside of tables, and it got three things wrong at once:
 *
 *   1. it HID the button, so a viewer saw a detail card that looked like it
 *      was simply not editable by anybody;
 *   2. it consulted project permissions only, so a permission granted
 *      globally - which is where master-admin-adjacent grants live - did not
 *      count;
 *   3. it computed the answer inside a mount-only effect, so a card that
 *      rendered before the permission snapshot arrived kept the wrong answer
 *      for as long as the page stayed open.
 *
 * Each of those is pinned below.
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
      /*
       * Deliberately empty. The old implementation read ONLY this, so if the
       * component ever goes back to it every test below that grants a
       * permission starts failing.
       */
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
      getItem: async (): Promise<Monitor> => {
        const monitor: Monitor = new Monitor();
        monitor.name = "Production API";
        return monitor;
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

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type FindEditButtonFunction = () => HTMLButtonElement | null;

const findEditButton: FindEditButtonFunction = (): HTMLButtonElement | null => {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button: HTMLButtonElement) => {
        return (button.textContent || "").trim().startsWith("Edit Monitor");
      },
    ) || null
  );
};

type RenderCardFunction = (
  refresher?: boolean,
  compact?: boolean,
  isEditable?: boolean,
) => ReturnType<typeof render>;

const renderCard: RenderCardFunction = (
  refresher: boolean = false,
  compact: boolean = false,
  isEditable: boolean = true,
): ReturnType<typeof render> => {
  return render(
    <CardModelDetail<Monitor>
      name="Monitor Details"
      compact={compact}
      cardProps={{ title: "Monitor Details", description: "About it" }}
      isEditable={isEditable}
      refresher={refresher}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: "Text" as never,
          required: true,
        },
      ]}
      modelDetailProps={{
        modelType: Monitor,
        id: "monitor-detail",
        modelId: MONITOR_ID,
        fields: [
          {
            field: { name: true },
            title: "Name",
            fieldType: FieldType.Text,
          },
        ],
      }}
    />,
  );
};

describe.each([false, true])(
  "CardModelDetail permission gating (compact: %s)",
  (compact: boolean) => {
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

    test("offers a working Edit button when the viewer may update", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      renderCard(false, compact);

      await waitFor(() => {
        expect(findEditButton()).not.toBeNull();
      });

      expect(findEditButton()).not.toBeDisabled();
    });

    test("locks the Edit button rather than removing it", async () => {
      permissionsForTest = [Permission.Viewer];

      renderCard(false, compact);

      await waitFor(() => {
        expect(findEditButton()).not.toBeNull();
      });

      expect(findEditButton()).toBeDisabled();
    });

    test("explains the locked Edit on hover", async () => {
      permissionsForTest = [Permission.Viewer];

      renderCard(false, compact);

      await waitFor(() => {
        expect(findEditButton()).not.toBeNull();
      });

      fireEvent.mouseEnter(findEditButton()!.parentElement as HTMLElement);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "You do not have permission to update this Monitor.",
      );
      expect(screen.getByRole("tooltip")).toHaveTextContent("Edit Monitor");
    });

    /*
     * The check used to run against getProjectPermissions() alone. This grant
     * arrives through getAllPermissions(), which merges global and project - so
     * it only passes if the component is reading the merged view.
     */
    test("honours a permission that is not in the project snapshot", async () => {
      permissionsForTest = [Permission.ProjectOwner];

      renderCard(false, compact);

      await waitFor(() => {
        expect(findEditButton()).not.toBeNull();
      });

      expect(findEditButton()).not.toBeDisabled();
    });

    /*
     * The snapshot lands on an API response header, which can easily be after
     * the card's first paint. A mount-only effect froze the button in whatever
     * state that first paint implied.
     */
    test("re-evaluates when the permission snapshot arrives after first paint", async () => {
      permissionsForTest = [];

      const { rerender } = renderCard(false, compact);

      await waitFor(() => {
        expect(screen.getByText("Monitor Details")).toBeInTheDocument();
      });

      // Nothing honest to say yet, so no button at all.
      expect(findEditButton()).toBeNull();

      permissionsForTest = [Permission.ProjectAdmin];

      rerender(
        <CardModelDetail<Monitor>
          name="Monitor Details"
          compact={compact}
          cardProps={{ title: "Monitor Details", description: "About it" }}
          isEditable={true}
          refresher={true}
          formFields={[
            {
              field: { name: true },
              title: "Name",
              fieldType: "Text" as never,
              required: true,
            },
          ]}
          modelDetailProps={{
            modelType: Monitor,
            id: "monitor-detail",
            modelId: MONITOR_ID,
            fields: [
              {
                field: { name: true },
                title: "Name",
                fieldType: FieldType.Text,
              },
            ],
          }}
        />,
      );

      await waitFor(() => {
        expect(findEditButton()).not.toBeNull();
      });

      expect(findEditButton()).not.toBeDisabled();
    });

    test("works for a master admin", async () => {
      isMasterAdminForTest = true;
      permissionsForTest = [];

      renderCard(false, compact);

      await waitFor(() => {
        expect(findEditButton()).not.toBeNull();
      });

      expect(findEditButton()).not.toBeDisabled();
    });

    test("respects read-only cards even when the viewer has update permission", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      renderCard(false, compact, false);

      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "Monitor Details" }),
        ).toBeInTheDocument();
      });

      expect(findEditButton()).toBeNull();
      expect(screen.getByText("About it")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Monitor Details" }),
      ).toHaveClass(compact ? "text-sm" : "text-lg");
    });

    test("renders loaded details with the appropriate density without dropping field content", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      renderCard(false, compact);

      expect(await screen.findByText("Production API")).toBeInTheDocument();
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(document.getElementById("monitor-detail")).toHaveClass(
        compact ? "py-3" : "py-5",
      );
    });
  },
);
