import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import * as React from "react";
import { ReactElement } from "react";

/*
 * Archive and Unarchive in a row's ⋯ menu (useBulkArchiveActions'
 * archiveRowActions and unarchiveRowActions): the row counterparts of the
 * bulk ones, on every list that archives in bulk - Archive on the live list,
 * Unarchive on its Archived page.
 *
 *   - Each asks first, naming the row and saying what archiving does: the
 *     list's own sentence (an archived SLO stops being evaluated), or the
 *     telemetry one every archivable resource list has said.
 *   - It writes the record's switch, and the list reads its rows again: the
 *     row leaves it.
 *   - It is not offered on a row already where it would put it.
 *   - Someone who may not update the record finds it locked.
 */

let permissionsForTest: Array<unknown> = [];

const updateByIdMock: Mock<(args: unknown) => Promise<void>> =
  jest.fn<(args: unknown) => Promise<void>>();

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
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
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
      updateById: (args: unknown): Promise<void> => {
        return updateByIdMock(args);
      },
    },
  };
});

import useBulkArchiveActions, {
  BulkArchiveActionsConfig,
  BulkArchiveActionsResult,
  ROW_ARCHIVE_TELEMETRY_SENTENCE,
  ROW_UNARCHIVE_SENTENCE,
} from "../../../UI/Components/BulkUpdate/BulkArchiveActions";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { withRowActionContext } from "../../../UI/Components/ActionButton/RowActionContext";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";

const HOST_ID: string = "77777777-7777-4777-8777-777777777771";

const host: (isArchived?: boolean) => PodmanHost = (
  isArchived?: boolean,
): PodmanHost => {
  const row: PodmanHost = new PodmanHost();
  row._id = HOST_ID;
  row.name = "build-runner-3";

  if (isArchived !== undefined) {
    row.isArchived = isArchived;
  }

  return row;
};

let refreshCount: number = 0;

type ExtraConfig = Omit<BulkArchiveActionsConfig<PodmanHost>, "modelType">;

function RowHarness(props: {
  item: PodmanHost;
  mode: "archive" | "unarchive";
  config?: ExtraConfig;
}): ReactElement {
  const result: BulkArchiveActionsResult<PodmanHost> =
    useBulkArchiveActions<PodmanHost>({
      modelType: PodmanHost,
      singularName: "Host",
      pluralName: "Hosts",
      ...(props.config || {}),
    });

  const view: ActionButtonSchema<PodmanHost> = {
    title: "View",
    icon: IconProp.ChevronRight,
    buttonStyleType: ButtonStyleType.OUTLINE,
    onClick: (): void => {},
  };

  return (
    <RowActions<PodmanHost>
      item={props.item}
      actionButtons={withRowActionContext<PodmanHost>(
        [
          view,
          ...(props.mode === "archive"
            ? result.archiveRowActions
            : result.unarchiveRowActions),
        ],
        {
          refresh: () => {
            refreshCount++;
          },
        },
      )}
    />
  );
}

const clickMenuItem: (name: string) => void = (name: string): void => {
  fireEvent.click(screen.getByTestId("row-actions-more-button"));
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", { name: name }),
  );
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue(undefined);
  refreshCount = 0;
});

afterEach(() => {
  cleanup();
});

describe("Archive in a row", () => {
  test("is in the ⋯ menu, asks first naming the row, and says what archiving does", () => {
    render(<RowHarness item={host()} mode="archive" />);

    expect(
      within(screen.getByTestId("row-actions")).queryByRole("button", {
        name: "Archive",
      }),
    ).toBeNull();

    clickMenuItem("Archive");

    expect(screen.getByTestId("modal-title")).toHaveTextContent("Archive Host");
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Are you sure you want to archive build-runner-3?",
    );
    expect(screen.getByTestId("row-archive-name")).toHaveTextContent(
      /^build-runner-3$/,
    );
    expect(screen.getByTestId("row-archive-consequence")).toHaveTextContent(
      ROW_ARCHIVE_TELEMETRY_SENTENCE,
    );
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("answered, it archives the row and the list is read again", async () => {
    render(<RowHarness item={host()} mode="archive" />);

    clickMenuItem("Archive");
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    const request: { id: { toString: () => string }; data: unknown } =
      updateByIdMock.mock.calls[0]![0] as {
        id: { toString: () => string };
        data: unknown;
      };

    expect(request.id.toString()).toBe(HOST_ID);
    expect(request.data).toEqual({ isArchived: true });
    expect(refreshCount).toBe(1);
  });

  test("says the list's own sentence where it has one, and names the row as the list does", () => {
    render(
      <RowHarness
        item={host()}
        mode="archive"
        config={{
          archiveConfirmMessage:
            "An archived host stops reporting its containers.",
          getItemName: (item: PodmanHost): string => {
            return `Host: ${item.name}`;
          },
        }}
      />,
    );

    clickMenuItem("Archive");

    expect(screen.getByTestId("row-archive-consequence")).toHaveTextContent(
      "An archived host stops reporting its containers.",
    );
    expect(screen.getByTestId("row-archive-name")).toHaveTextContent(
      "Host: build-runner-3",
    );
  });

  test("is not offered on a row that is archived already", () => {
    render(<RowHarness item={host(true)} mode="archive" />);

    expect(screen.queryByTestId("row-actions-more-button")).toBeNull();
  });

  test("a refusal is said in the dialog, and the list is not read again", async () => {
    updateByIdMock.mockRejectedValue(
      new Error("You do not have permission to archive this host."),
    );

    render(<RowHarness item={host()} mode="archive" />);

    clickMenuItem("Archive");
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "You do not have permission to archive this host.",
      );
    });
    expect(refreshCount).toBe(0);
  });

  test("someone who may not update the record finds it locked, and it writes nothing", () => {
    permissionsForTest = [Permission.Viewer];

    render(<RowHarness item={host()} mode="archive" />);

    fireEvent.click(screen.getByTestId("row-actions-more-button"));

    const archive: HTMLElement = within(screen.getByRole("menu")).getByRole(
      "menuitem",
      { name: "Archive" },
    );

    expect(archive).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(archive);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("Unarchive in a row of an Archived page", () => {
  test("asks, saying the row comes back to the main list, and unarchives it", async () => {
    render(<RowHarness item={host(true)} mode="unarchive" />);

    clickMenuItem("Unarchive");

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Unarchive Host",
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Are you sure you want to unarchive build-runner-3?",
    );
    expect(screen.getByTestId("row-archive-consequence")).toHaveTextContent(
      ROW_UNARCHIVE_SENTENCE,
    );

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(refreshCount).toBe(1);
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: unknown }).data,
    ).toEqual({ isArchived: false });
  });

  test("is not offered on a row that is live", () => {
    render(<RowHarness item={host(false)} mode="unarchive" />);

    expect(screen.queryByTestId("row-actions-more-button")).toBeNull();
  });

  test("both sit in the ⋯ menu with their icons", () => {
    let archive: ActionButtonSchema<PodmanHost> | undefined;
    let unarchive: ActionButtonSchema<PodmanHost> | undefined;

    function Read(): ReactElement {
      const result: BulkArchiveActionsResult<PodmanHost> =
        useBulkArchiveActions<PodmanHost>({ modelType: PodmanHost });

      archive = result.archiveRowActions[0];
      unarchive = result.unarchiveRowActions[0];

      return <></>;
    }

    render(<Read />);

    expect([archive!.title, archive!.icon, archive!.placement]).toEqual([
      "Archive",
      IconProp.Archive,
      ActionButtonPlacement.MoreMenu,
    ]);
    expect([unarchive!.title, unarchive!.icon, unarchive!.placement]).toEqual([
      "Unarchive",
      IconProp.Unarchive,
      ActionButtonPlacement.MoreMenu,
    ]);
  });
});
