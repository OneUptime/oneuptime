import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import EntityDropdown from "../../../UI/Components/EntityDropdown/EntityDropdown";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * Contract under test - what the Labels tab ("Bulk-add by tag") tells its
 * caller.
 *
 * Bulk-add by tag is a ONE-TIME expansion: the label is turned into a list of
 * entries and then discarded, which is exactly why a status page group
 * populated from a label stopped tracking that label (#3418). onLabelsBulkAdded
 * is the only record that a selection came from a label at all, so what it
 * reports, and when, is the whole basis of keeping that group in sync.
 *
 * Two properties, both easy to lose:
 *
 *   - it reports the label NAMES, not just ids. The caller has no cheap way
 *     back from an id to a name, and the name is what the rule is titled with.
 *
 *   - it reports a label whose entries were ALL already selected. That adds
 *     nothing to the picker, but it is still a label the user asked this
 *     selection to be built from, and dropping it there would silently leave
 *     it out of the sync.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

type MakeLabelFunction = (id: string, name: string) => Label;

const makeLabel: MakeLabelFunction = (id: string, name: string): Label => {
  return { _id: id, name: name } as unknown as Label;
};

type MakeMonitorFunction = (id: string, name: string) => Monitor;

const makeMonitor: MakeMonitorFunction = (
  id: string,
  name: string,
): Monitor => {
  return { _id: id, name: name } as unknown as Monitor;
};

const LABEL_A: Label = makeLabel(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "WB Digital",
);
const LABEL_B: Label = makeLabel(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "WB Digital Service",
);
const MONITOR_A: Monitor = makeMonitor(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "Mobile App - Payment",
);

describe("EntityDropdown Labels tab - what it tells the caller", () => {
  let onLabelsBulkAdded: MockFunction;
  let onChange: MockFunction;

  /**
   * One mock for every list the dropdown makes: the option search, the label
   * list, and the by-label expansion. `monitorsForLabels` is what the
   * expansion finds.
   */
  type SetUpFunction = (options?: {
    monitorsForLabels?: Array<Monitor> | undefined;
    labels?: Array<Label> | undefined;
    failLabelExpansion?: boolean | undefined;
  }) => void;

  const setUp: SetUpFunction = (options?: {
    monitorsForLabels?: Array<Monitor> | undefined;
    labels?: Array<Label> | undefined;
    failLabelExpansion?: boolean | undefined;
  }): void => {
    getListMock.mockImplementation((request: any) => {
      if (request?.modelType === Label) {
        return Promise.resolve({
          data:
            options?.labels === undefined ? [LABEL_A, LABEL_B] : options.labels,
          count: 0,
        });
      }

      // The by-label expansion is the only monitor list that queries labels.
      if (request?.query?.labels) {
        if (options?.failLabelExpansion) {
          return Promise.reject(new Error("no read access"));
        }

        return Promise.resolve({
          data:
            options?.monitorsForLabels === undefined
              ? [MONITOR_A]
              : options.monitorsForLabels,
          count: 0,
        });
      }

      // The plain option search behind the Results tab.
      return Promise.resolve({ data: [], count: 0 });
    });
  };

  type OpenLabelsTabFunction = (value?: Array<string> | undefined) => void;

  const openLabelsTab: OpenLabelsTabFunction = (
    value?: Array<string> | undefined,
  ): void => {
    render(
      <EntityDropdown
        isMultiSelect={true}
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        enableLabelsTab={true}
        value={value}
        placeholder="Select Monitors"
        onChange={onChange as never}
        onLabelsBulkAdded={onLabelsBulkAdded as never}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("tab", { name: /Labels/ }));
  };

  type ApplyLabelFunction = (labelName: string) => Promise<void>;

  const applyLabel: ApplyLabelFunction = async (
    labelName: string,
  ): Promise<void> => {
    const labelRow: HTMLElement = await screen.findByRole("option", {
      name: new RegExp(`^${labelName}$`),
    });

    fireEvent.click(labelRow);
    fireEvent.click(screen.getByRole("button", { name: /Add entries from/ }));
  };

  beforeEach(() => {
    onLabelsBulkAdded = getJestMockFunction();
    onChange = getJestMockFunction();
    getListMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("reports the label that produced the entries, with its name", async () => {
    setUp();
    openLabelsTab();
    await applyLabel("WB Digital");

    await waitFor(() => {
      expect(onLabelsBulkAdded).toHaveBeenCalled();
    });

    expect(onLabelsBulkAdded.mock.calls[0]![0]).toEqual([
      { id: LABEL_A._id, name: "WB Digital" },
    ]);
  });

  /*
   * #3418's durable half. Two labels can sit on the same monitors, and the
   * second one adds nothing to the picker - but the user picked it, and a
   * monitor given only that label later is exactly what should still arrive.
   */
  test("reports a label whose entries were all already selected", async () => {
    setUp({ monitorsForLabels: [MONITOR_A] });
    openLabelsTab([MONITOR_A._id!]);
    await applyLabel("WB Digital");

    await waitFor(() => {
      expect(onLabelsBulkAdded).toHaveBeenCalled();
    });

    expect(onLabelsBulkAdded.mock.calls[0]![0]).toEqual([
      { id: LABEL_A._id, name: "WB Digital" },
    ]);

    // And the user is still told nothing new landed in the picker.
    expect(await screen.findByText(/No new entries matched/)).toBeTruthy();
  });

  test("reports a label that matches nothing at all yet", async () => {
    setUp({ monitorsForLabels: [] });
    openLabelsTab();
    await applyLabel("WB Digital");

    await waitFor(() => {
      expect(onLabelsBulkAdded).toHaveBeenCalled();
    });

    expect(onLabelsBulkAdded.mock.calls[0]![0]).toEqual([
      { id: LABEL_A._id, name: "WB Digital" },
    ]);
  });

  /*
   * A failed expansion means the picker does not know what the label covers.
   * Reporting it would keep a group in sync with a label the user never got
   * to see the contents of.
   */
  test("reports nothing when the expansion itself failed", async () => {
    setUp({ failLabelExpansion: true });
    openLabelsTab();
    await applyLabel("WB Digital");

    expect(await screen.findByText(/Failed to fetch entries/)).toBeTruthy();
    expect(onLabelsBulkAdded).not.toHaveBeenCalled();
  });

  test("reports every label when more than one was applied at once", async () => {
    setUp();
    openLabelsTab();

    fireEvent.click(
      await screen.findByRole("option", { name: /^WB Digital$/ }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: /^WB Digital Service$/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Add entries from/ }));

    await waitFor(() => {
      expect(onLabelsBulkAdded).toHaveBeenCalled();
    });

    expect(onLabelsBulkAdded.mock.calls[0]![0]).toEqual([
      { id: LABEL_A._id, name: "WB Digital" },
      { id: LABEL_B._id, name: "WB Digital Service" },
    ]);
  });

  /*
   * The prop is optional and every other caller of this component leaves it
   * off. Bulk-add by tag has to keep working there exactly as it did.
   */
  test("still adds the entries when nobody is listening for the labels", async () => {
    setUp();

    render(
      <EntityDropdown
        isMultiSelect={true}
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        enableLabelsTab={true}
        placeholder="Select Monitors"
        onChange={onChange as never}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("tab", { name: /Labels/ }));
    await applyLabel("WB Digital");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.calls[0]![0]).toEqual([MONITOR_A._id]);
  });

  /*
   * The names come off the label list the tab already loaded. A label the list
   * does not carry must still be reported - a rule with a duller title is far
   * better than a group that silently stops tracking the label.
   */
  test("reports a label it has no name for rather than dropping it", async () => {
    const namelessLabel: Label = makeLabel(LABEL_A._id!, "");

    setUp({ labels: [namelessLabel] });
    openLabelsTab();

    fireEvent.click(
      await screen.findByRole("option", { name: /^Unnamed Label$/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Add entries from/ }));

    await waitFor(() => {
      expect(onLabelsBulkAdded).toHaveBeenCalled();
    });

    expect(onLabelsBulkAdded.mock.calls[0]![0]).toEqual([
      { id: LABEL_A._id, name: "" },
    ]);
  });
});
