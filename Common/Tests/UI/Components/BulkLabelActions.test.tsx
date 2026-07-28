import { describe, expect, test, beforeEach, jest } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  RenderResult,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import useBulkLabelActions from "../../../UI/Components/BulkUpdate/BulkLabelActions";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Label from "../../../Models/DatabaseModels/Label";
import ObjectID from "../../../Types/ObjectID";

/*
 * react-i18next is not initialized in the test environment.
 */
jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI");
jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("00000000-0000-4000-8000-000000000000");
      },
    },
  };
});

const ENV_LABEL: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_LABEL: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHARED_LABEL: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UNUSED_LABEL: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeLabel(id: string, name: string): Label {
  const label: Label = new Label();
  label._id = id;
  label.name = name;
  return label;
}

const LABEL_NAMES: Record<string, string> = {
  [ENV_LABEL]: "env:production",
  [TEAM_LABEL]: "team:axxos",
  [SHARED_LABEL]: "team:SharedServices-Prod",
  [UNUSED_LABEL]: "team:not-in-use",
};

function makeMonitor(id: string, labelIds: Array<string>): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.labels = labelIds.map((labelId: string) => {
    return makeLabel(labelId, LABEL_NAMES[labelId] || labelId);
  });
  return monitor;
}

/** Labels currently on each monitor, keyed by monitor id. */
let monitorLabels: Record<string, Array<string>> = {};
let updateCalls: Array<{ id: string; labelIds: Array<string> }> = [];
let progressUpdates: Array<ProgressInfo<Monitor>> = [];

interface HarnessProps {
  items: Array<Monitor>;
}

/*
 * Drives the hook the way ModelTable's bulk action bar does: hand the action
 * the selected rows plus the progress callbacks, and render the modals.
 */
function Harness(props: HarnessProps): ReactElement {
  const { bulkActions, modals } = useBulkLabelActions<Monitor>({
    modelType: Monitor,
  });

  const removeAction: BulkActionButtonSchema<Monitor> | undefined =
    bulkActions.find((action: BulkActionButtonSchema<Monitor>) => {
      return action.title === "Remove Labels";
    });

  const actionProps: BulkActionOnClickProps<Monitor> = {
    items: props.items,
    onProgressInfo: (info: ProgressInfo<Monitor>): void => {
      progressUpdates.push({
        totalItems: [...info.totalItems],
        successItems: [...info.successItems],
        failed: [...info.failed],
        inProgressItems: [...info.inProgressItems],
      });
    },
    onBulkActionStart: (): void => {
      // no-op
    },
    onBulkActionEnd: (): void => {
      // no-op
    },
  };

  return (
    <>
      <button
        data-testid="open-remove"
        onClick={() => {
          removeAction?.onClick(actionProps);
        }}
      >
        open
      </button>
      {modals}
    </>
  );
}

async function openRemoveModal(items: Array<Monitor>): Promise<RenderResult> {
  const result: RenderResult = render(<Harness items={items} />);

  fireEvent.click(screen.getByTestId("open-remove"));

  /*
   * The modal renders a loader until the "which labels are on these items"
   * fetch settles; the form (and its field title) only appears after that.
   */
  await waitFor(
    () => {
      expect(screen.queryByText("Select Labels")).toBeTruthy();
    },
    { timeout: 5000 },
  );

  return result;
}

function openDropdown(): void {
  fireEvent.keyDown(screen.getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

/** Pick an option out of the dropdown by its visible label. */
async function selectLabel(name: string): Promise<void> {
  openDropdown();
  fireEvent.click(await screen.findByText(name));
}

describe("useBulkLabelActions - Remove Labels", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateCalls = [];
    progressUpdates = [];
    monitorLabels = {
      "monitor-1": [ENV_LABEL, TEAM_LABEL, SHARED_LABEL],
      "monitor-2": [ENV_LABEL, SHARED_LABEL],
      "monitor-3": [ENV_LABEL, TEAM_LABEL],
    };

    (ModelAPI.getList as jest.Mock).mockImplementation(
      async (data: { modelType: { new (): unknown } }) => {
        if ((data.modelType as unknown) === Label) {
          return {
            data: [
              makeLabel(ENV_LABEL, "env:production"),
              makeLabel(TEAM_LABEL, "team:axxos"),
              makeLabel(SHARED_LABEL, "team:SharedServices-Prod"),
              makeLabel(UNUSED_LABEL, "team:not-in-use"),
            ],
            count: 4,
            skip: 0,
            limit: 100,
          };
        }

        // The "which labels can be removed" query for the selected items.
        return {
          data: Object.keys(monitorLabels).map((id: string) => {
            return makeMonitor(id, monitorLabels[id]!);
          }),
          count: 3,
          skip: 0,
          limit: 100,
        };
      },
    );

    (ModelAPI.getItem as jest.Mock).mockImplementation(
      async (data: { id: ObjectID }) => {
        const id: string = data.id.toString();
        return makeMonitor(id, monitorLabels[id] || []);
      },
    );

    (ModelAPI.updateById as jest.Mock).mockImplementation(
      async (data: { id: ObjectID; data: { labels: Array<string> } }) => {
        const id: string = data.id.toString();
        updateCalls.push({ id: id, labelIds: data.data.labels });
        monitorLabels[id] = [...data.data.labels];
        return {};
      },
    );
  });

  test("offers only labels that are actually on the selected items", async () => {
    await openRemoveModal([
      makeMonitor("monitor-1", monitorLabels["monitor-1"]!),
      makeMonitor("monitor-2", monitorLabels["monitor-2"]!),
      makeMonitor("monitor-3", monitorLabels["monitor-3"]!),
    ]);

    openDropdown();

    expect(await screen.findByText("env:production")).toBeTruthy();

    expect(screen.queryByText("team:axxos")).toBeTruthy();
    expect(screen.queryByText("team:SharedServices-Prod")).toBeTruthy();
    // Present in the project, but on none of the selected items.
    expect(screen.queryByText("team:not-in-use")).toBeNull();
  });

  test("removes the selected label from every item, preserving the others", async () => {
    await openRemoveModal([
      makeMonitor("monitor-1", monitorLabels["monitor-1"]!),
      makeMonitor("monitor-2", monitorLabels["monitor-2"]!),
      makeMonitor("monitor-3", monitorLabels["monitor-3"]!),
    ]);

    await selectLabel("team:SharedServices-Prod");

    fireEvent.click(screen.getByRole("button", { name: /^Remove Labels$/ }));

    await waitFor(() => {
      expect(updateCalls).toHaveLength(2);
    });

    expect(monitorLabels["monitor-1"]).toEqual([ENV_LABEL, TEAM_LABEL]);
    expect(monitorLabels["monitor-2"]).toEqual([ENV_LABEL]);
    // monitor-3 never had the label, so it is not written at all.
    expect(monitorLabels["monitor-3"]).toEqual([ENV_LABEL, TEAM_LABEL]);
    expect(
      updateCalls.map((call: { id: string }) => {
        return call.id;
      }),
    ).toEqual(["monitor-1", "monitor-2"]);
  });

  test("reports every selected item as processed, including no-op items", async () => {
    await openRemoveModal([
      makeMonitor("monitor-1", monitorLabels["monitor-1"]!),
      makeMonitor("monitor-2", monitorLabels["monitor-2"]!),
      makeMonitor("monitor-3", monitorLabels["monitor-3"]!),
    ]);

    await selectLabel("team:SharedServices-Prod");
    fireEvent.click(screen.getByRole("button", { name: /^Remove Labels$/ }));

    await waitFor(() => {
      expect(
        progressUpdates[progressUpdates.length - 1]?.successItems,
      ).toHaveLength(3);
    });

    expect(progressUpdates[progressUpdates.length - 1]?.failed).toHaveLength(0);
  });

  test("surfaces a per-item failure instead of silently reporting success", async () => {
    (ModelAPI.updateById as jest.Mock).mockImplementation(
      async (data: { id: ObjectID }) => {
        if (data.id.toString() === "monitor-2") {
          throw new Error("permission denied");
        }
        return {};
      },
    );

    await openRemoveModal([
      makeMonitor("monitor-1", monitorLabels["monitor-1"]!),
      makeMonitor("monitor-2", monitorLabels["monitor-2"]!),
    ]);

    await selectLabel("team:SharedServices-Prod");
    fireEvent.click(screen.getByRole("button", { name: /^Remove Labels$/ }));

    await waitFor(() => {
      expect(progressUpdates[progressUpdates.length - 1]?.failed).toHaveLength(
        1,
      );
    });

    const lastUpdate: ProgressInfo<Monitor> =
      progressUpdates[progressUpdates.length - 1]!;

    expect(lastUpdate.successItems).toHaveLength(1);
    expect(lastUpdate.failed[0]?.item._id).toBe("monitor-2");
  });

  test("tells the user when the selection has no labels at all", async () => {
    monitorLabels = { "monitor-1": [] };

    render(<Harness items={[makeMonitor("monitor-1", [])]} />);
    fireEvent.click(screen.getByTestId("open-remove"));

    await waitFor(() => {
      expect(screen.queryByText("No Labels to Remove")).toBeTruthy();
    });

    expect(ModelAPI.updateById).not.toHaveBeenCalled();
  });
});
