import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * Status Page > Resources > Add Multiple Monitor Groups (issue #6544).
 *
 * A monitor group could only reach a status page one dialog at a time:
 * Add Monitor, then "Add a Monitor Group instead.", then save. The bulk add
 * dialog now has a monitor group picker too - opened from the resource
 * menu's "Add multiple monitor groups", or swapped to with the link under
 * its picker - which adds every picked monitor group in one action, named
 * and described as its group, skipping the ones already on the page.
 *
 * Through the real dialog, form and fields, with the pickers reduced to
 * buttons and the network and the two runners stubbed.
 */

const MONITOR_ONE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194167010";
const MONITOR_TWO_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194167011";
const PAYMENTS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194167020";
const SEARCH_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194167021";
const LABEL_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194167030";

interface PickerProps {
  isMultiSelect?: boolean;
  placeholder?: string;
  error?: string;
  onChange?: (value: Array<string>) => void;
  onLabelsBulkAdded?: (labels: Array<{ id: string; name: string }>) => void;
}

// What each picker was drawn with, last first.
const pickerProps: Array<PickerProps> = [];

/*
 * A picker, reduced to its two ways of filling the selection, named by its
 * placeholder so a test can tell the monitor picker from the monitor group
 * one. Each picks two, in the opposite order to the one the list is fetched
 * in.
 */
jest.mock("Common/UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (props: PickerProps) => {
      pickerProps.unshift(props);

      const ids: Array<string> =
        props.placeholder === "Select Monitor Groups"
          ? [SEARCH_ID, PAYMENTS_ID]
          : [MONITOR_TWO_ID, MONITOR_ONE_ID];

      return (
        <div>
          <button
            type="button"
            onClick={() => {
              props.onChange?.(ids);
            }}
          >
            {`Pick from ${props.placeholder}`}
          </button>
          <button
            type="button"
            onClick={() => {
              props.onChange?.(ids);
              props.onLabelsBulkAdded?.([{ id: LABEL_ID, name: "EU" }]);
            }}
          >
            {`Pick by label from ${props.placeholder}`}
          </button>
          {props.error ? <p>{props.error}</p> : null}
        </div>
      );
    },
  };
});

jest.mock("Common/UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 1,
    default: (props: {
      placeholder?: string;
      error?: string;
      options: Array<{ value: string }>;
      onChange?: (value: string) => void;
    }) => {
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              props.onChange?.(props.options[0]!.value);
            }}
          >
            Choose {props.placeholder}
          </button>
          {props.error ? <p>{props.error}</p> : null}
        </div>
      );
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitors",
  () => {
    return {
      __esModule: true,
      default: jest.fn(),
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitorGroups",
  () => {
    return {
      __esModule: true,
      default: jest.fn(),
    };
  },
);

import bulkAddStatusPageMonitorGroups, {
  BulkAddStatusPageMonitorGroupsOptions,
  BulkAddStatusPageMonitorGroupsResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitorGroups";
import bulkAddStatusPageMonitors, {
  BulkAddStatusPageMonitorsOptions,
  BulkAddStatusPageMonitorsResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitors";
import BulkAddStatusPageMonitorsModal, {
  BulkAddStatusPageResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitorsModal";
import { StatusPageResourceTargetType } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourceFormFields";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  getByTextOutsideFoldedHeaders,
  listedNames,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const PROJECT_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194167001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194167002",
);
const GROUP_ID: ObjectID = new ObjectID("0198c8ec-2a1d-7f0c-9e75-384194167003");

const mockBulkAddGroups: jest.MockedFunction<
  typeof bulkAddStatusPageMonitorGroups
> = bulkAddStatusPageMonitorGroups as jest.MockedFunction<
  typeof bulkAddStatusPageMonitorGroups
>;

const mockBulkAddMonitors: jest.MockedFunction<
  typeof bulkAddStatusPageMonitors
> = bulkAddStatusPageMonitors as jest.MockedFunction<
  typeof bulkAddStatusPageMonitors
>;

const mockGetList: jest.MockedFunction<any> =
  ModelAPI.getList as unknown as jest.MockedFunction<any>;

const mockCreate: jest.MockedFunction<any> =
  ModelAPI.create as unknown as jest.MockedFunction<any>;

type OnCompleteFunction = (result: BulkAddStatusPageResult) => void;

type MakeMonitorGroupFunction = (
  id: string,
  name: string,
  description?: string,
) => MonitorGroup;

const makeMonitorGroup: MakeMonitorGroupFunction = (
  id: string,
  name: string,
  description?: string,
): MonitorGroup => {
  const monitorGroup: MonitorGroup = new MonitorGroup();
  monitorGroup._id = id;
  monitorGroup.name = name;

  if (description !== undefined) {
    monitorGroup.description = description;
  }

  return monitorGroup;
};

type MakeMonitorFunction = (id: string, name: string) => Monitor;

const makeMonitor: MakeMonitorFunction = (
  id: string,
  name: string,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.name = name;
  return monitor;
};

type MakeResourceFunction = (target: {
  monitorId?: string;
  monitorGroupId?: string;
}) => StatusPageResource;

const makeResource: MakeResourceFunction = (target: {
  monitorId?: string;
  monitorGroupId?: string;
}): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = `resource-for-${target.monitorId || target.monitorGroupId}`;

  if (target.monitorId) {
    resource.monitorId = new ObjectID(target.monitorId);
  }

  if (target.monitorGroupId) {
    resource.monitorGroupId = new ObjectID(target.monitorGroupId);
  }

  return resource;
};

const PAYMENTS: MonitorGroup = makeMonitorGroup(
  PAYMENTS_ID,
  "Payments Stack",
  "Checkout, billing and refunds",
);
const SEARCH: MonitorGroup = makeMonitorGroup(
  SEARCH_ID,
  "Search Stack",
  "Indexing and queries",
);

/*
 * The dialog reads the picked monitor groups (or monitors) and, apart, the
 * resources the status page already has - so the list mock answers by model,
 * in name order, as the API sorts them.
 */
type MockListsFunction = (
  existingResources?: Array<StatusPageResource>,
) => void;

const mockLists: MockListsFunction = (
  existingResources: Array<StatusPageResource> = [],
): void => {
  mockGetList.mockImplementation(async (data: any): Promise<any> => {
    if (data.modelType === StatusPageResource) {
      return { data: existingResources, count: existingResources.length };
    }

    if (data.modelType === MonitorGroup) {
      return { data: [PAYMENTS, SEARCH], count: 2 };
    }

    return {
      data: [
        makeMonitor(MONITOR_TWO_ID, "Billing Worker"),
        makeMonitor(MONITOR_ONE_ID, "Checkout API"),
      ],
      count: 2,
    };
  });
};

type RenderModalFunction = (
  overrides?: Partial<
    React.ComponentProps<typeof BulkAddStatusPageMonitorsModal>
  >,
) => ReturnType<typeof render>;

const renderModal: RenderModalFunction = (
  overrides: Partial<
    React.ComponentProps<typeof BulkAddStatusPageMonitorsModal>
  > = {},
): ReturnType<typeof render> => {
  return render(
    <BulkAddStatusPageMonitorsModal
      projectId={PROJECT_ID}
      statusPageId={STATUS_PAGE_ID}
      statusPageGroupId={GROUP_ID}
      targetType={StatusPageResourceTargetType.MonitorGroup}
      canSwitchTarget={true}
      onClose={jest.fn()}
      onComplete={jest.fn()}
      {...overrides}
    />,
  );
};

type SubmitFunction = (
  view: ReturnType<typeof render>,
  buttonText?: string,
) => Promise<void>;

const submit: SubmitFunction = async (
  view: ReturnType<typeof render>,
  buttonText: string = "Add Monitor Groups",
): Promise<void> => {
  await waitFor(() => {
    expect(view.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      buttonText,
    );
  });
  fireEvent.click(view.getByTestId("modal-footer-submit-button"));
};

type PickGroupsFunction = (view: ReturnType<typeof render>) => void;

const pickGroups: PickGroupsFunction = (
  view: ReturnType<typeof render>,
): void => {
  fireEvent.click(
    view.getByRole("button", { name: "Pick from Select Monitor Groups" }),
  );
};

type AddedOptionsFunction = () => BulkAddStatusPageMonitorGroupsOptions;

const addedOptions: AddedOptionsFunction =
  (): BulkAddStatusPageMonitorGroupsOptions => {
    return mockBulkAddGroups.mock.calls[0]![0];
  };

type NamesFunction = (
  targets: Array<{ name?: string | undefined }>,
) => Array<string | undefined>;

const names: NamesFunction = (
  targets: Array<{ name?: string | undefined }>,
): Array<string | undefined> => {
  return targets.map((target: { name?: string | undefined }) => {
    return target.name;
  });
};

type ListCallForFunction = (modelType: unknown) => any;

const listCallFor: ListCallForFunction = (modelType: unknown): any => {
  const call: Array<any> | undefined = mockGetList.mock.calls.find(
    (candidate: Array<any>): boolean => {
      return candidate[0].modelType === modelType;
    },
  );

  return call ? call[0] : undefined;
};

describe("Add Multiple Monitor Groups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pickerProps.length = 0;

    mockLists();

    mockBulkAddGroups.mockImplementation(
      async (
        options: BulkAddStatusPageMonitorGroupsOptions,
      ): Promise<BulkAddStatusPageMonitorGroupsResult> => {
        return { succeeded: options.monitorGroups, failed: [], skipped: [] };
      },
    );

    mockBulkAddMonitors.mockImplementation(
      async (
        options: BulkAddStatusPageMonitorsOptions,
      ): Promise<BulkAddStatusPageMonitorsResult> => {
        return { succeeded: options.monitors, failed: [], skipped: [] };
      },
    );
  });

  describe("the dialog", () => {
    test("asks for the monitor groups only: no display name, the options folded", async () => {
      const view: ReturnType<typeof render> = renderModal();

      expect(view.getByText("Add Multiple Monitor Groups")).toBeVisible();
      expect(
        view.getByText(
          "Add monitor groups to this status page. Each resource gets its display name and description from its monitor group.",
        ),
      ).toBeVisible();
      expect(view.getByText("Monitor Groups")).toBeVisible();
      expect(
        view.getByText(
          "The monitor groups to show on the status page, with their names and descriptions. Ones already on the page are skipped.",
        ),
      ).toBeVisible();

      // One picker: never the monitors beside the monitor groups.
      expect(view.queryByText("Monitors")).not.toBeInTheDocument();
      expect(
        view.queryByRole("button", { name: "Pick from Select Monitors" }),
      ).toBeNull();

      // Named after each monitor group, so never asked for.
      expect(view.queryByText("Display Name")).not.toBeInTheDocument();
      expect(view.queryByText("Description")).not.toBeInTheDocument();

      // The display options, folded at their defaults, as for monitors.
      const header: HTMLElement = await view.findByRole("button", {
        name: "More fields",
      });
      expect(header).toHaveAttribute("aria-expanded", "false");
      expect(listedNames(header)).toContain("Tooltip");
      expect(
        getByTextOutsideFoldedHeaders(view.container, "Show Uptime %"),
      ).not.toBeVisible();
    });

    test("picks monitor groups, from the multi-select's monitor group list", () => {
      renderModal();

      const picker: PickerProps | undefined = pickerProps.find(
        (props: PickerProps): boolean => {
          return props.placeholder === "Select Monitor Groups";
        },
      );

      expect(picker).toBeDefined();
      expect(picker!.isMultiSelect).toBe(true);
    });

    test("has one button, Add Monitor Groups, and no Next", async () => {
      const view: ReturnType<typeof render> = renderModal();

      await waitFor(() => {
        expect(
          view.getByTestId("modal-footer-submit-button"),
        ).toHaveTextContent("Add Monitor Groups");
      });
      expect(view.queryByTestId("modal-footer-next-button")).toBeNull();
    });

    test("requires at least one monitor group", async () => {
      const view: ReturnType<typeof render> = renderModal();

      fireEvent.click(view.getByTestId("modal-footer-submit-button"));

      await waitFor(() => {
        expect(view.getByText("Monitor Groups is required.")).toBeVisible();
      });
      expect(mockBulkAddGroups).not.toHaveBeenCalled();
      expect(mockGetList).not.toHaveBeenCalled();
    });
  });

  describe("adding", () => {
    test("adds the picked monitor groups in the order picked, the options at their defaults", async () => {
      const onComplete: Mock<OnCompleteFunction> =
        jest.fn<OnCompleteFunction>();
      const view: ReturnType<typeof render> = renderModal({ onComplete });

      pickGroups(view);
      await submit(view);

      await waitFor(() => {
        expect(mockBulkAddGroups).toHaveBeenCalledTimes(1);
      });

      const options: BulkAddStatusPageMonitorGroupsOptions = addedOptions();

      expect(options.projectId).toBe(PROJECT_ID);
      expect(options.statusPageId).toBe(STATUS_PAGE_ID);
      expect(options.statusPageGroupId).toBe(GROUP_ID);
      // Picked Search, then Payments: fetched in name order, added as picked.
      expect(names(options.monitorGroups)).toEqual([
        "Search Stack",
        "Payments Stack",
      ]);
      // Each carries the description its resource is given.
      expect(options.monitorGroups[0]!.description).toBe(
        "Indexing and queries",
      );
      expect(options.rowAxisValue).toBeUndefined();
      expect(options.columnAxisValue).toBeUndefined();
      expect(options.resourceOptions).toEqual({
        displayTooltip: undefined,
        showCurrentStatus: true,
        showUptimePercent: false,
        uptimePercentPrecision: undefined,
        showStatusHistoryChart: true,
      });

      // Monitor groups only: no monitors, and no monitor rule.
      expect(mockBulkAddMonitors).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledTimes(1);
      });
      expect(onComplete.mock.calls[0]![0]).toEqual({
        succeeded: [SEARCH, PAYMENTS],
        failed: [],
        skipped: [],
      });
    });

    test("reads the picked monitor groups' names and descriptions from the project", async () => {
      const view: ReturnType<typeof render> = renderModal();

      pickGroups(view);
      await submit(view);

      await waitFor(() => {
        expect(mockBulkAddGroups).toHaveBeenCalledTimes(1);
      });

      const request: any = listCallFor(MonitorGroup);

      expect(request).toBeDefined();
      expect(request.query.projectId).toBe(PROJECT_ID);
      expect(request.query._id).toBeInstanceOf(Includes);
      expect(
        (request.query._id as Includes).values.map((id: unknown): string => {
          return String(id);
        }),
      ).toEqual([SEARCH_ID, PAYMENTS_ID]);
      expect(request.select).toEqual({
        _id: true,
        name: true,
        description: true,
      });
      expect(listCallFor(Monitor)).toBeUndefined();
    });

    // "Skip a group that is already on the status page."
    test("hands the monitor groups already on the page, anywhere on it, to the bulk add", async () => {
      mockLists([
        makeResource({ monitorGroupId: SEARCH_ID }),
        // A monitor's row says nothing about the monitor groups.
        makeResource({ monitorId: PAYMENTS_ID }),
      ]);

      const view: ReturnType<typeof render> = renderModal();

      pickGroups(view);
      await submit(view);

      await waitFor(() => {
        expect(mockBulkAddGroups).toHaveBeenCalledTimes(1);
      });

      expect(addedOptions().existingMonitorGroupIds).toEqual([SEARCH_ID]);

      // The whole status page, not only the group being added to.
      const request: any = listCallFor(StatusPageResource);

      expect(request.query).toEqual({
        statusPageId: STATUS_PAGE_ID,
        projectId: PROJECT_ID,
      });
      expect(request.select).toEqual({ _id: true, monitorGroupId: true });
    });

    test("puts every monitor group in the grid cell picked, and asks for it first", async () => {
      const view: ReturnType<typeof render> = renderModal({
        gridPlacement: {
          rowLabel: "Service",
          rowValues: ["Core", "Edge"],
          columnLabel: "Region",
          columnValues: ["EU", "US"],
        },
      });

      pickGroups(view);
      fireEvent.click(view.getByTestId("modal-footer-submit-button"));

      await waitFor(() => {
        expect(view.getByText("Service (Row) is required.")).toBeVisible();
      });
      expect(view.getByText("Region (Column) is required.")).toBeVisible();
      expect(mockBulkAddGroups).not.toHaveBeenCalled();

      fireEvent.click(
        view.getByRole("button", { name: "Choose Select service" }),
      );
      fireEvent.click(
        view.getByRole("button", { name: "Choose Select region" }),
      );

      await submit(view);

      await waitFor(() => {
        expect(mockBulkAddGroups).toHaveBeenCalledTimes(1);
      });

      expect(addedOptions().rowAxisValue).toBe("Core");
      expect(addedOptions().columnAxisValue).toBe("EU");
    });

    test("gives every monitor group the display options changed under More fields", async () => {
      const view: ReturnType<typeof render> = renderModal();

      pickGroups(view);

      const header: HTMLElement = await view.findByRole("button", {
        name: "More fields",
      });
      fireEvent.click(header);
      fireEvent.click(view.getByRole("switch", { name: /Show Uptime %/ }));
      fireEvent.click(
        view.getByRole("switch", { name: /Show Current Resource Status/ }),
      );

      await submit(view);

      await waitFor(() => {
        expect(mockBulkAddGroups).toHaveBeenCalledTimes(1);
      });

      expect(addedOptions().resourceOptions).toEqual({
        displayTooltip: undefined,
        showCurrentStatus: false,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.ONE_DECIMAL,
        showStatusHistoryChart: true,
      });
    });

    test("says why when the monitor groups cannot be read, and stays open", async () => {
      mockGetList.mockImplementation(async (data: any): Promise<any> => {
        if (data.modelType === MonitorGroup) {
          throw new Error("You do not have permission to read monitor groups.");
        }

        return { data: [], count: 0 };
      });

      const view: ReturnType<typeof render> = renderModal();

      pickGroups(view);
      await submit(view);

      await waitFor(() => {
        expect(
          view.getByText("You do not have permission to read monitor groups."),
        ).toBeVisible();
      });
      expect(mockBulkAddGroups).not.toHaveBeenCalled();
      expect(view.getByText("Add Multiple Monitor Groups")).toBeVisible();
    });
  });

  /*
   * A monitor rule adds the monitors that carry a label, so keeping a group
   * in sync with labels is a promise only monitors can keep. The Labels tab
   * still picks every monitor group carrying a label, once.
   */
  describe("labels", () => {
    test("picks monitor groups by label once, and never offers to keep the group in sync", async () => {
      const view: ReturnType<typeof render> = renderModal();

      const picker: PickerProps | undefined = pickerProps.find(
        (props: PickerProps): boolean => {
          return props.placeholder === "Select Monitor Groups";
        },
      );
      expect(picker!.onLabelsBulkAdded).toBeUndefined();

      fireEvent.click(
        view.getByRole("button", {
          name: "Pick by label from Select Monitor Groups",
        }),
      );

      expect(
        view.queryByText("Keep This Group In Sync With These Labels"),
      ).toBeNull();

      await submit(view);

      await waitFor(() => {
        expect(mockBulkAddGroups).toHaveBeenCalledTimes(1);
      });

      // No StatusPageMonitorRule is written.
      expect(mockCreate).not.toHaveBeenCalled();
      expect(view.queryByText(/stays in sync/)).toBeNull();
    });
  });

  describe("the summary", () => {
    test("says how many were added, in the monitor groups' own words", async () => {
      const view: ReturnType<typeof render> = renderModal();

      pickGroups(view);
      await submit(view);

      expect(await view.findByText("Monitor Groups Added")).toBeVisible();
      expect(
        view.getByText("Added 2 of 2 selected monitor groups."),
      ).toBeVisible();
      expect(view.getByText("Added (2)")).toBeVisible();
      expect(view.getByText("Search Stack")).toBeVisible();
      expect(view.getByText("Payments Stack")).toBeVisible();
      expect(view.queryByTestId("bulk-add-result-skipped")).toBeNull();
      expect(view.queryByTestId("bulk-add-result-failed")).toBeNull();
      expect(view.getByRole("button", { name: "Done" })).toBeVisible();
    });

    test("lists the monitor groups already on the page apart, not as failures", async () => {
      mockBulkAddGroups.mockResolvedValue({
        succeeded: [PAYMENTS],
        failed: [],
        skipped: [SEARCH],
      });

      const view: ReturnType<typeof render> = renderModal();

      pickGroups(view);
      await submit(view);

      expect(await view.findByText("Monitor Groups Added")).toBeVisible();
      expect(
        view.getByText(
          "Added 1 of 2 selected monitor groups. 1 monitor group was already on this status page and was skipped.",
        ),
      ).toBeVisible();
      expect(view.getByText("Already Added (1)")).toBeVisible();
      expect(
        view.getByText(
          "These monitor groups are already on this status page, so they were left as they are.",
        ),
      ).toBeVisible();
    });

    test("says nothing was added when every monitor group was already there", async () => {
      mockBulkAddGroups.mockResolvedValue({
        succeeded: [],
        failed: [],
        skipped: [SEARCH, PAYMENTS],
      });

      const view: ReturnType<typeof render> = renderModal();

      pickGroups(view);
      await submit(view);

      expect(
        await view.findByText(
          "Added 0 of 2 selected monitor groups. 2 monitor groups were already on this status page and were skipped.",
        ),
      ).toBeVisible();
      expect(view.getByText("Already Added (2)")).toBeVisible();
      expect(view.queryByTestId("bulk-add-result-added")).toBeNull();
    });

    test("counts one picked monitor group as one", async () => {
      mockBulkAddGroups.mockResolvedValue({
        succeeded: [PAYMENTS],
        failed: [],
        skipped: [],
      });

      const view: ReturnType<typeof render> = renderModal();

      pickGroups(view);
      await submit(view);

      expect(
        await view.findByText("Added 1 of 1 selected monitor group."),
      ).toBeVisible();
    });

    test("names each monitor group that failed, with the reason, and calls the dialog results", async () => {
      const email: MonitorGroup = makeMonitorGroup(
        "0198c8ec-2a1d-7f0c-9e75-384194167022",
        "Email Stack",
      );
      const unnamed: MonitorGroup = new MonitorGroup();

      mockBulkAddGroups.mockResolvedValue({
        succeeded: [PAYMENTS],
        failed: [
          {
            monitorGroup: email,
            error: new Error(
              "This monitor group is already added to this status page.",
            ),
          },
          {
            monitorGroup: unnamed,
            error: new Error("Monitor group name is required."),
          },
        ],
        skipped: [SEARCH],
      });

      const view: ReturnType<typeof render> = renderModal();

      pickGroups(view);
      await submit(view);

      expect(await view.findByText("Monitor Group Add Results")).toBeVisible();
      expect(
        view.getByText(
          "Added 1 of 4 selected monitor groups. 1 monitor group was already on this status page and was skipped.",
        ),
      ).toBeVisible();
      expect(view.getByText("Failed (2)")).toBeVisible();
      expect(view.getByText("Email Stack:")).toBeVisible();
      expect(
        view.getByText(
          "This monitor group is already added to this status page.",
        ),
      ).toBeVisible();
      expect(view.getByText("Unknown monitor group:")).toBeVisible();
    });
  });

  /*
   * The link under the picker, as under Add Monitor's: on projects with
   * monitor groups it swaps the monitor group picker for the monitor one
   * and back, and what is added is what the picker on screen holds.
   */
  describe("the link under the picker", () => {
    test("offers monitors instead on the monitor group picker", () => {
      const view: ReturnType<typeof render> = renderModal();

      expect(
        view.getByTestId("status-page-resource-target-switch"),
      ).toHaveTextContent("Add Monitors instead.");
    });

    test("is not there on a project without monitor groups", () => {
      const view: ReturnType<typeof render> = renderModal({
        canSwitchTarget: false,
        targetType: StatusPageResourceTargetType.Monitor,
      });

      expect(view.getByText("Add Multiple Monitors")).toBeVisible();
      expect(
        view.queryByTestId("status-page-resource-target-switch"),
      ).toBeNull();
    });

    test("swaps to monitors, and adds the monitors picked there", async () => {
      const view: ReturnType<typeof render> = renderModal();

      // Monitor groups picked first, then left behind by the swap.
      pickGroups(view);
      fireEvent.click(view.getByTestId("status-page-resource-target-switch"));

      expect(await view.findByText("Add Multiple Monitors")).toBeVisible();
      expect(view.getByText("Monitors")).toBeVisible();
      expect(view.queryByText("Monitor Groups")).toBeNull();
      expect(
        view.getByTestId("status-page-resource-target-switch"),
      ).toHaveTextContent("Add Monitor Groups instead.");

      fireEvent.click(
        view.getByRole("button", { name: "Pick from Select Monitors" }),
      );
      await submit(view, "Add Monitors");

      await waitFor(() => {
        expect(mockBulkAddMonitors).toHaveBeenCalledTimes(1);
      });

      expect(mockBulkAddGroups).not.toHaveBeenCalled();
      expect(names(mockBulkAddMonitors.mock.calls[0]![0].monitors)).toEqual([
        "Billing Worker",
        "Checkout API",
      ]);
      expect(
        await view.findByText("Added 2 of 2 selected monitors."),
      ).toBeVisible();
    });

    test("swaps from monitors to monitor groups, and adds only the monitor groups", async () => {
      const view: ReturnType<typeof render> = renderModal({
        targetType: StatusPageResourceTargetType.Monitor,
      });

      expect(view.getByText("Add Multiple Monitors")).toBeVisible();
      fireEvent.click(
        view.getByRole("button", { name: "Pick from Select Monitors" }),
      );

      fireEvent.click(view.getByTestId("status-page-resource-target-switch"));

      expect(
        await view.findByText("Add Multiple Monitor Groups"),
      ).toBeVisible();

      pickGroups(view);
      await submit(view);

      await waitFor(() => {
        expect(mockBulkAddGroups).toHaveBeenCalledTimes(1);
      });

      expect(mockBulkAddMonitors).not.toHaveBeenCalled();
      expect(names(addedOptions().monitorGroups)).toEqual([
        "Search Stack",
        "Payments Stack",
      ]);
      expect(listCallFor(Monitor)).toBeUndefined();
    });

    test("asks for monitor groups after a swap, though monitors were picked before it", async () => {
      const view: ReturnType<typeof render> = renderModal({
        targetType: StatusPageResourceTargetType.Monitor,
      });

      fireEvent.click(
        view.getByRole("button", { name: "Pick from Select Monitors" }),
      );
      fireEvent.click(view.getByTestId("status-page-resource-target-switch"));

      await view.findByText("Add Multiple Monitor Groups");

      fireEvent.click(view.getByTestId("modal-footer-submit-button"));

      await waitFor(() => {
        expect(view.getByText("Monitor Groups is required.")).toBeVisible();
      });
      expect(mockBulkAddGroups).not.toHaveBeenCalled();
      expect(mockBulkAddMonitors).not.toHaveBeenCalled();
    });

    test("keeps the display options changed before the swap", async () => {
      const view: ReturnType<typeof render> = renderModal({
        targetType: StatusPageResourceTargetType.Monitor,
      });

      const header: HTMLElement = await view.findByRole("button", {
        name: "More fields",
      });
      fireEvent.click(header);
      fireEvent.click(view.getByRole("switch", { name: /Show Uptime %/ }));

      fireEvent.click(view.getByTestId("status-page-resource-target-switch"));
      await view.findByText("Add Multiple Monitor Groups");

      pickGroups(view);
      await submit(view);

      await waitFor(() => {
        expect(mockBulkAddGroups).toHaveBeenCalledTimes(1);
      });

      expect(addedOptions().resourceOptions?.showUptimePercent).toBe(true);
    });

    /*
     * A label used on the monitor picker is still the monitors': back on
     * it, the dialog offers to keep the group in sync again, and the
     * monitor group picker never does.
     */
    test("offers the label sync on the monitor picker only", async () => {
      const view: ReturnType<typeof render> = renderModal({
        targetType: StatusPageResourceTargetType.Monitor,
      });

      fireEvent.click(
        view.getByRole("button", {
          name: "Pick by label from Select Monitors",
        }),
      );
      expect(
        await view.findByText("Keep This Group In Sync With These Labels"),
      ).toBeVisible();

      fireEvent.click(view.getByTestId("status-page-resource-target-switch"));
      await view.findByText("Add Multiple Monitor Groups");

      expect(
        view.queryByText("Keep This Group In Sync With These Labels"),
      ).toBeNull();

      fireEvent.click(view.getByTestId("status-page-resource-target-switch"));
      await view.findByText("Add Multiple Monitors");

      expect(
        view.getByText("Keep This Group In Sync With These Labels"),
      ).toBeVisible();
    });
  });
});
