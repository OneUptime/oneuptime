import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
 * The overview pages' right-hand column is about 300px wide. A detail card
 * there used to put a long "Edit Scheduled Maintenance Event" button beside
 * its title, squeezing the title and description into a column one word
 * wide. The pages now hand CardModelDetail a stacked header and a short
 * "Edit" label. CardModelDetail passes cardProps straight to Card, so what
 * is pinned here is that the layout survives that hop and that the short
 * label changes nothing about how the button is gated.
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
import { CardHeaderLayout } from "../../../UI/Components/Card/Card";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import FieldType from "../../../UI/Components/Types/FieldType";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

interface RenderOptions {
  headerLayout?: CardHeaderLayout | undefined;
  editButtonText?: string | undefined;
}

type RenderCardFunction = (options: RenderOptions) => ReturnType<typeof render>;

const renderCard: RenderCardFunction = (
  options: RenderOptions,
): ReturnType<typeof render> => {
  return render(
    <CardModelDetail<Monitor>
      name="Monitor Details"
      cardProps={{
        title: "Monitor Details",
        description: "Key facts about this monitor.",
        headerLayout: options.headerLayout,
      }}
      isEditable={true}
      editButtonText={options.editButtonText}
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

type FindButtonFunction = (label: string) => HTMLButtonElement | null;

const findButton: FindButtonFunction = (
  label: string,
): HTMLButtonElement | null => {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button: HTMLButtonElement) => {
        return (button.textContent || "").trim() === label;
      },
    ) || null
  );
};

describe("CardModelDetail header layout", () => {
  beforeEach(() => {
    permissionsForTest = [];
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("forwards a stacked header to the card, with Edit on its own row", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    renderCard({ headerLayout: "stacked", editButtonText: "Edit" });

    await waitFor(() => {
      expect(findButton("Edit")).not.toBeNull();
    });

    const header: HTMLElement = screen.getByTestId("card-header");
    const actions: HTMLElement = screen.getByTestId("card-header-actions");

    expect(header).toHaveAttribute("data-header-layout", "stacked");
    expect(within(header).getByText("Monitor Details")).toBeInTheDocument();
    expect(actions).toContainElement(findButton("Edit"));
    expect(findButton("Edit Monitor")).toBeNull();
  });

  test("keeps the side-by-side header when the page does not ask", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    renderCard({});

    await waitFor(() => {
      expect(findButton("Edit Monitor")).not.toBeNull();
    });

    expect(screen.queryByTestId("card-header")).toBeNull();
    expect(screen.queryByTestId("card-header-actions")).toBeNull();
  });

  test("the short label is still offered only to someone who may update", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    renderCard({ headerLayout: "stacked", editButtonText: "Edit" });

    await waitFor(() => {
      expect(findButton("Edit")).not.toBeNull();
    });

    expect(findButton("Edit")).not.toBeDisabled();
  });

  test("the short label is locked, not removed, and explains itself without permission", async () => {
    permissionsForTest = [Permission.Viewer];

    renderCard({ headerLayout: "stacked", editButtonText: "Edit" });

    await waitFor(() => {
      expect(findButton("Edit")).not.toBeNull();
    });

    expect(findButton("Edit")).toBeDisabled();

    fireEvent.mouseEnter(findButton("Edit")!.parentElement as HTMLElement);

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "You do not have permission to update this Monitor.",
    );
  });

  test("with no permission snapshot yet there is no button, and no empty row", async () => {
    permissionsForTest = [];

    renderCard({ headerLayout: "stacked", editButtonText: "Edit" });

    await waitFor(() => {
      expect(screen.getByText("Monitor Details")).toBeInTheDocument();
    });

    expect(findButton("Edit")).toBeNull();
    expect(screen.queryByTestId("card-header-actions")).toBeNull();
  });
});
