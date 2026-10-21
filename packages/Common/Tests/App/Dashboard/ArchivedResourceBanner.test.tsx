import "@testing-library/jest-dom";
import {
  act,
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
import { Mock } from "jest-mock";

/*
 * The banner across the top of every page of an archived workflow, monitor,
 * status page, dashboard or on-call policy, and the Archive card on its
 * Settings page.
 *
 * The banner says the resource is archived and what that means for it, and
 * unarchives it in place. The card archives and unarchives it from Settings.
 * Both are on screen at once on the Settings page, so each announces what it
 * did and each follows the other: the page never says "archived" in one place
 * and offers "Archive" in another until a reload.
 */

let permissionsForTest: Array<unknown> = [];

const getItemMock: Mock<(args: unknown) => Promise<unknown>> =
  jest.fn<(args: unknown) => Promise<unknown>>();
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
      getItem: (args: unknown): Promise<unknown> => {
        return getItemMock(args);
      },
      updateById: (args: unknown): Promise<void> => {
        return updateByIdMock(args);
      },
    },
  };
});

import ArchivedResourceBanner from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ArchivedResourceBanner";
import {
  ARCHIVE_STATE_CHANGED_EVENT,
  announceArchiveStateChange,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ArchiveStateEvents";
import {
  MONITOR_ARCHIVE_COPY,
  WORKFLOW_ARCHIVE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";
import ArchiveResourceCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "../../../UI/Components/SideMenu/CountModelSideMenuItem";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0b6f3a2e-5c4d-4e8f-9a1b-2c3d4e5f6a7b",
);
const OTHER_WORKFLOW_ID: ObjectID = new ObjectID(
  "1c7a4b3f-6d5e-4f90-8b2c-3d4e5f6a7b8c",
);

interface HeardEvents {
  archiveChanges: Array<Record<string, unknown>>;
  sidebarRefreshes: number;
}

let heard: HeardEvents;

const onArchiveChange: (event: Event) => void = (event: Event): void => {
  heard.archiveChanges.push(
    (event as CustomEvent).detail as Record<string, unknown>,
  );
};

const onSidebarRefresh: () => void = (): void => {
  heard.sidebarRefreshes++;
};

function archivedState(isArchived: boolean): void {
  getItemMock.mockResolvedValue({ isArchived } as never);
}

function renderBanner(modelId: ObjectID = WORKFLOW_ID): {
  rerender: (modelId: ObjectID) => void;
  unmount: () => void;
} {
  const result: ReturnType<typeof render> = render(
    <ArchivedResourceBanner
      modelType={Workflow}
      modelId={modelId}
      copy={WORKFLOW_ARCHIVE_COPY}
    />,
  );

  return {
    rerender: (newId: ObjectID): void => {
      result.rerender(
        <ArchivedResourceBanner
          modelType={Workflow}
          modelId={newId}
          copy={WORKFLOW_ARCHIVE_COPY}
        />,
      );
    },
    unmount: result.unmount,
  };
}

function banner(): HTMLElement | null {
  return screen.queryByTestId("archived-resource-banner");
}

async function bannerShown(): Promise<HTMLElement> {
  return screen.findByTestId("archived-resource-banner");
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
  getItemMock.mockReset();
  updateByIdMock.mockReset().mockResolvedValue(undefined);
  heard = { archiveChanges: [], sidebarRefreshes: 0 };
  window.addEventListener(ARCHIVE_STATE_CHANGED_EVENT, onArchiveChange);
  window.addEventListener(REFRESH_SIDEBAR_COUNT_EVENT, onSidebarRefresh);
});

afterEach(() => {
  cleanup();
  window.removeEventListener(ARCHIVE_STATE_CHANGED_EVENT, onArchiveChange);
  window.removeEventListener(REFRESH_SIDEBAR_COUNT_EVENT, onSidebarRefresh);
});

describe("the archived banner", () => {
  test("says the resource is archived, and what that means for it", async () => {
    archivedState(true);

    renderBanner();

    const shown: HTMLElement = await bannerShown();
    expect(shown).toHaveTextContent(WORKFLOW_ARCHIVE_COPY.bannerTitle);
    expect(shown).toHaveTextContent(WORKFLOW_ARCHIVE_COPY.bannerBody);
    expect(
      screen.getByTestId("archived-resource-banner-unarchive"),
    ).toHaveTextContent("Unarchive");
  });

  test("reads only the archive flag of the resource it is on", async () => {
    archivedState(true);

    renderBanner();
    await bannerShown();

    expect(getItemMock).toHaveBeenCalledWith({
      modelType: Workflow,
      id: WORKFLOW_ID,
      select: { isArchived: true },
    });
  });

  test("renders nothing for a resource that is not archived", async () => {
    archivedState(false);

    renderBanner();
    await settle();

    expect(getItemMock).toHaveBeenCalled();
    expect(banner()).toBeNull();
  });

  test("renders nothing while it loads, and nothing when the read fails", async () => {
    let fail: (error: Error) => void = () => {};
    getItemMock.mockReturnValue(
      new Promise<unknown>(
        (
          _resolve: (value: unknown) => void,
          reject: (error: Error) => void,
        ) => {
          fail = reject;
        },
      ),
    );

    renderBanner();
    expect(banner()).toBeNull();

    await act(async () => {
      fail(new Error("Network error"));
    });

    expect(banner()).toBeNull();
    expect(screen.queryByText("Network error")).toBeNull();
  });

  test("unarchives after a confirmation in the resource's words, and goes away", async () => {
    archivedState(true);
    renderBanner();
    await bannerShown();

    fireEvent.click(screen.getByTestId("archived-resource-banner-unarchive"));

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      WORKFLOW_ARCHIVE_COPY.unarchiveConfirmMessage,
    );
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Unarchive workflow",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(updateByIdMock).toHaveBeenCalledWith({
      modelType: Workflow,
      id: WORKFLOW_ID,
      data: { isArchived: false },
    });
    await waitFor(() => {
      expect(banner()).toBeNull();
    });
  });

  test("tells the rest of the screen it was unarchived: the Settings card and the side-menu counts", async () => {
    archivedState(true);
    renderBanner();
    await bannerShown();

    fireEvent.click(screen.getByTestId("archived-resource-banner-unarchive"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(heard.archiveChanges).toEqual([
      {
        tableName: "Workflow",
        modelId: WORKFLOW_ID.toString(),
        isArchived: false,
      },
    ]);
    expect(heard.sidebarRefreshes).toBe(1);
  });

  test("keeps the banner, and says why, when unarchiving fails", async () => {
    archivedState(true);
    updateByIdMock.mockRejectedValue(
      new Error("You do not have permission to edit this workflow."),
    );
    renderBanner();
    await bannerShown();

    fireEvent.click(screen.getByTestId("archived-resource-banner-unarchive"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(banner()).not.toBeNull();
    expect(
      await screen.findByTestId("archived-resource-banner-error"),
    ).toHaveTextContent("You do not have permission to edit this workflow.");
    expect(heard.archiveChanges).toEqual([]);
  });

  test("closing the confirmation unarchives nothing", async () => {
    archivedState(true);
    renderBanner();
    await bannerShown();

    fireEvent.click(screen.getByTestId("archived-resource-banner-unarchive"));
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("confirm-modal-description")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(banner()).not.toBeNull();
  });

  test("without permission to edit the resource, Unarchive is disabled and opens nothing", async () => {
    permissionsForTest = [];
    PermissionGate.clearPermissionPropsCache();
    archivedState(true);
    renderBanner();
    await bannerShown();

    const button: HTMLElement = screen.getByTestId(
      "archived-resource-banner-unarchive",
    );
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(screen.queryByTestId("confirm-modal-description")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("appears and goes away as the resource is archived and unarchived elsewhere on the screen", async () => {
    archivedState(false);
    renderBanner();
    await settle();
    expect(banner()).toBeNull();

    act(() => {
      announceArchiveStateChange({
        modelType: Workflow,
        modelId: WORKFLOW_ID,
        isArchived: true,
      });
    });
    expect(banner()).not.toBeNull();

    act(() => {
      announceArchiveStateChange({
        modelType: Workflow,
        modelId: WORKFLOW_ID,
        isArchived: false,
      });
    });
    expect(banner()).toBeNull();
  });

  test("ignores changes to another workflow, and to another kind of resource with the same id", async () => {
    archivedState(false);
    renderBanner();
    await settle();

    act(() => {
      announceArchiveStateChange({
        modelType: Workflow,
        modelId: OTHER_WORKFLOW_ID,
        isArchived: true,
      });
      announceArchiveStateChange({
        modelType: Monitor,
        modelId: WORKFLOW_ID,
        isArchived: true,
      });
    });

    expect(banner()).toBeNull();
  });

  test("moving to another resource drops the last one's banner and reads the new one", async () => {
    archivedState(true);
    const view: { rerender: (modelId: ObjectID) => void } = renderBanner();
    await bannerShown();

    archivedState(false);
    view.rerender(OTHER_WORKFLOW_ID);
    await settle();

    expect(getItemMock).toHaveBeenLastCalledWith({
      modelType: Workflow,
      id: OTHER_WORKFLOW_ID,
      select: { isArchived: true },
    });
    expect(banner()).toBeNull();
  });

  test("stops listening once it is gone", async () => {
    const added: Array<unknown> = [];
    const removed: Array<unknown> = [];
    const addSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(window, "addEventListener")
      .mockImplementation(((name: string, listener: unknown) => {
        if (name === ARCHIVE_STATE_CHANGED_EVENT) {
          added.push(listener);
        }
      }) as never);
    const removeSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(window, "removeEventListener")
      .mockImplementation(((name: string, listener: unknown) => {
        if (name === ARCHIVE_STATE_CHANGED_EVENT) {
          removed.push(listener);
        }
      }) as never);

    try {
      archivedState(false);
      const view: { unmount: () => void } = renderBanner();
      await settle();

      expect(added).toHaveLength(1);
      expect(removed).toHaveLength(0);

      view.unmount();

      // The very listener it added, and no other.
      expect(removed).toEqual(added);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});

describe("the Archive card and the banner, on one Settings page", () => {
  function renderSettingsPage(): void {
    render(
      <>
        <ArchivedResourceBanner
          modelType={Monitor}
          modelId={WORKFLOW_ID}
          copy={MONITOR_ARCHIVE_COPY}
        />
        <ArchiveResourceCard
          modelType={Monitor}
          modelId={WORKFLOW_ID}
          singularName={MONITOR_ARCHIVE_COPY.singularName}
          archiveCardDescription={MONITOR_ARCHIVE_COPY.archiveCardDescription}
          unarchiveCardDescription={
            MONITOR_ARCHIVE_COPY.unarchiveCardDescription
          }
          archiveConfirmMessage={MONITOR_ARCHIVE_COPY.archiveConfirmMessage}
          unarchiveConfirmMessage={MONITOR_ARCHIVE_COPY.unarchiveConfirmMessage}
        />
      </>,
    );
  }

  test("archiving from the card puts the banner up at once, and announces it", async () => {
    archivedState(false);
    renderSettingsPage();

    await screen.findByText("Archive monitor");
    expect(banner()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      MONITOR_ARCHIVE_COPY.archiveConfirmMessage,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(updateByIdMock).toHaveBeenCalledWith({
      modelType: Monitor,
      id: WORKFLOW_ID,
      data: { isArchived: true },
    });
    expect(await bannerShown()).toHaveTextContent(
      MONITOR_ARCHIVE_COPY.bannerTitle,
    );
    expect(screen.getByText("Unarchive monitor")).toBeInTheDocument();
    expect(heard.archiveChanges).toEqual([
      {
        tableName: "Monitor",
        modelId: WORKFLOW_ID.toString(),
        isArchived: true,
      },
    ]);
    expect(heard.sidebarRefreshes).toBe(1);
  });

  test("unarchiving from the banner turns the card back to Archive, without a reload", async () => {
    archivedState(true);
    renderSettingsPage();

    await screen.findByText("Unarchive monitor");
    expect(
      screen.getByText(MONITOR_ARCHIVE_COPY.unarchiveCardDescription),
    ).toBeInTheDocument();
    await bannerShown();

    fireEvent.click(screen.getByTestId("archived-resource-banner-unarchive"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(await screen.findByText("Archive monitor")).toBeInTheDocument();
    expect(
      screen.getByText(MONITOR_ARCHIVE_COPY.archiveCardDescription),
    ).toBeInTheDocument();
    expect(banner()).toBeNull();
    // Read once each on load; nothing re-fetched to catch up.
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });
});
