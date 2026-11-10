import "@testing-library/jest-dom";
/*
 * The global jest, whose jest.Mock the mocks below are typed with: a jest.fn()
 * from @jest/globals is jest-mock's Mock, which compile-tests refuses as a
 * jest.Mock (TS2322, issue #6660).
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { ComponentProps as ModalProps } from "../../../UI/Components/Modal/Modal";
import {
  DeviceNamingApplyResult,
  DeviceNamingOutcome,
  DeviceNamingPlan,
  DeviceNamingPreview,
  DeviceNamingPreviewItem,
  DeviceNamingRename,
  NamingLookupEntry,
  NamingLookupKey,
} from "../../../Types/NetworkDevice/DeviceNaming";
import NamePatternInput, {
  COUNTER_TOKEN,
  OFFERED_PLACEHOLDERS,
  getPlaceholderToken,
  insertToken,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/NamePatternInput";
import NamingLookupTableEditor, {
  LOOKUP_ROWS_PER_PAGE,
  getExampleLookupValue,
  mergePastedRows,
  readLookupRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/NamingLookupTableEditor";
import ApplyNamingRulesModal, {
  groupPlanItems,
  NamingPlanGroups,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/ApplyNamingRulesModal";
import NamingPreviewSummary, {
  NamingPreviewList,
  countNamingPreview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/NamingPreviewSummary";
import { DiscoveredHostNamingLine } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveredHostTable";
import { indexNamingPreview } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/useNamingPreview";
import getNamingRuleFormFields, {
  getLookupKeyOptions,
  getLookupTableFieldError,
  getNamePatternFieldError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/NamingRuleFormFields";
import { getSelectedDeviceIds } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/useBulkApplyNamingRules";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";

/*
 * The naming rules' screens, RENDERED (OneUptime issue #6619): the name
 * pattern field that offers each placeholder as a button and names an
 * example device as it is typed, the lookup table a convention kept in a
 * spreadsheet is pasted into, the Apply Naming Rules dialog that previews
 * every rename before it is made, and the line each import row gains with
 * the name the device will get. The server's answers are faked; everything
 * the person sees and does is the real component's.
 */

const planMock: jest.Mock = jest.fn();
const applyMock: jest.Mock = jest.fn();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/DeviceNamingApi",
  () => {
    return {
      __esModule: true,
      DEVICE_NAMING_ROUTES: {},
      planDeviceNaming: (...args: Array<unknown>) => {
        return planMock(...args);
      },
      applyDeviceNaming: (...args: Array<unknown>) => {
        return applyMock(...args);
      },
      previewScanNames: jest.fn(),
      previewDiscoveredDeviceNames: jest.fn(),
    };
  },
);

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    ModalWidth: { Medium: 1, Large: 2 },
    default: (props: ModalProps) => {
      return (
        <div role="dialog" aria-label={props.title}>
          <p>{props.description}</p>
          {props.error && <p role="alert">{props.error}</p>}
          {props.isBodyLoading ? <p>Loading plan</p> : props.children}
          <button onClick={props.onClose}>{props.closeButtonText}</button>
          {props.onSubmit && (
            <button
              disabled={props.disableSubmitButton}
              onClick={() => {
                props.onSubmit?.();
              }}
            >
              {props.submitButtonText}
            </button>
          )}
        </div>
      );
    },
  };
});

beforeEach(() => {
  planMock.mockReset();
  applyMock.mockReset();
});

afterEach(() => {
  cleanup();
});

/*
 * The pattern field as a form holds it: a controlled value the field's
 * onChange writes.
 */
const PatternHarness: (props: {
  initial: string;
  lookupValue?: string;
}) => ReactElement = (props: {
  initial: string;
  lookupValue?: string;
}): ReactElement => {
  const [value, setValue] = useState<string>(props.initial);

  return (
    <div>
      <NamePatternInput
        value={value}
        exampleLookupValue={props.lookupValue}
        onChange={setValue}
      />
      <output data-testid="pattern-value">{value}</output>
    </div>
  );
};

describe("the name pattern field", () => {
  test("names the example device as it is typed", () => {
    render(<PatternHarness initial="UN{site.code}{lookup}" />);

    expect(screen.getByTestId("name-pattern-example")).toHaveTextContent(
      "UN1216MNUPLR01",
    );
    expect(screen.queryByTestId("name-pattern-problem")).toBeNull();
  });

  test("the example uses the lookup table's first value", () => {
    render(
      <PatternHarness initial="UN{site.code}{lookup}" lookupValue="DRTSCR04" />,
    );

    expect(screen.getByTestId("name-pattern-example")).toHaveTextContent(
      "UN1216DRTSCR04",
    );
  });

  test("says what is wrong with a pattern, in place of the example", () => {
    render(<PatternHarness initial="UN{unit}" />);

    expect(screen.getByTestId("name-pattern-problem")).toHaveTextContent(
      '"{unit}" is not a placeholder.',
    );
    expect(screen.queryByTestId("name-pattern-example")).toBeNull();
    expect(screen.getByTestId("name-pattern-text")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  test("an empty pattern shows neither an example nor a problem", () => {
    render(<PatternHarness initial="" />);

    expect(screen.queryByTestId("name-pattern-example")).toBeNull();
    expect(screen.queryByTestId("name-pattern-problem")).toBeNull();
  });

  test("offers a button for each common placeholder and the number", () => {
    render(<PatternHarness initial="" />);

    for (const placeholder of OFFERED_PLACEHOLDERS) {
      expect(
        screen.getByTestId(
          `name-pattern-chip-${getPlaceholderToken(placeholder)}`,
        ),
      ).toBeInTheDocument();
    }

    expect(
      screen.getByTestId(`name-pattern-chip-${COUNTER_TOKEN}`),
    ).toBeInTheDocument();
  });

  test("a button puts its placeholder where the cursor is", () => {
    render(<PatternHarness initial="UNMNUPLR01" />);

    const input: HTMLInputElement = screen.getByTestId(
      "name-pattern-text",
    ) as HTMLInputElement;

    input.focus();
    input.setSelectionRange(2, 2);
    fireEvent.click(screen.getByTestId("name-pattern-chip-{site.code}"));

    expect(screen.getByTestId("pattern-value")).toHaveTextContent(
      "UN{site.code}MNUPLR01",
    );
  });

  test("insertToken: at the cursor, over a selection, or at the end", () => {
    expect(
      insertToken({ value: "UN", token: "{nn}", selectionStart: 2 }),
    ).toEqual({ value: "UN{nn}", cursor: 6 });
    expect(
      insertToken({
        value: "UN1216X",
        token: "{site.code}",
        selectionStart: 2,
        selectionEnd: 6,
      }),
    ).toEqual({ value: "UN{site.code}X", cursor: 13 });
    expect(insertToken({ value: "SW-", token: "{nn}" })).toEqual({
      value: "SW-{nn}",
      cursor: 7,
    });
    // A cursor past the end is the end.
    expect(
      insertToken({ value: "a", token: "{n}", selectionStart: 99 }),
    ).toEqual({ value: "a{n}", cursor: 4 });
  });
});

const TableHarness: (props: {
  initial: Array<NamingLookupEntry>;
  kind?: NamingLookupKey;
}) => ReactElement = (props: {
  initial: Array<NamingLookupEntry>;
  kind?: NamingLookupKey;
}): ReactElement => {
  const [rows, setRows] = useState<Array<NamingLookupEntry>>(props.initial);

  return (
    <div>
      <NamingLookupTableEditor
        kind={props.kind || NamingLookupKey.LastIpOctet}
        entries={rows}
        onChange={setRows}
      />
      <output data-testid="table-value">{JSON.stringify(rows)}</output>
    </div>
  );
};

function tableValue(): Array<NamingLookupEntry> {
  return JSON.parse(
    screen.getByTestId("table-value").textContent || "[]",
  ) as Array<NamingLookupEntry>;
}

describe("the lookup table", () => {
  test("an empty table says how to fill it", () => {
    render(<TableHarness initial={[]} />);

    expect(screen.getByTestId("naming-lookup-empty")).toHaveTextContent(
      "paste two columns from a spreadsheet",
    );
  });

  test("rows are added, typed into and removed", () => {
    render(<TableHarness initial={[]} />);

    fireEvent.click(screen.getByTestId("naming-lookup-add-row"));

    const row: HTMLElement = screen.getAllByTestId("naming-lookup-row")[0]!;
    const [keyInput, valueInput] = within(row).getAllByRole(
      "textbox",
    ) as Array<HTMLInputElement>;

    fireEvent.change(keyInput!, { target: { value: "51" } });
    fireEvent.change(valueInput!, { target: { value: "MNUPLR01" } });

    expect(tableValue()).toEqual([{ key: "51", value: "MNUPLR01" }]);

    fireEvent.click(screen.getByTestId("naming-lookup-remove-row"));

    expect(tableValue()).toEqual([]);
  });

  test("two columns pasted from a spreadsheet are added, and a key pasted again updates its row", () => {
    render(<TableHarness initial={[{ key: "51", value: "OLDVALUE" }]} />);

    fireEvent.click(screen.getByTestId("naming-lookup-paste"));
    fireEvent.change(screen.getByTestId("naming-lookup-paste-text"), {
      target: { value: "51\tMNUPLR01\n151\tMNUSCR01\n152\n" },
    });
    fireEvent.click(screen.getByTestId("naming-lookup-paste-apply"));

    expect(tableValue()).toEqual([
      { key: "51", value: "MNUPLR01" },
      { key: "151", value: "MNUSCR01" },
    ]);
    expect(screen.getByTestId("naming-lookup-notice")).toHaveTextContent(
      "2 rows read. 1 line had no value and was skipped.",
    );
  });

  test("a CSV file replaces the table", async () => {
    render(<TableHarness initial={[{ key: "9", value: "OLD" }]} />);

    const file: File = new File(
      ["Last part of the IP address,Value\n51,MNUPLR01\n159,DRTSCR06\n"],
      "table.csv",
      { type: "text/csv" },
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId("naming-lookup-file"), {
        target: { files: [file] },
      });
    });

    await waitFor(() => {
      expect(tableValue()).toEqual([
        { key: "51", value: "MNUPLR01" },
        { key: "159", value: "DRTSCR06" },
      ]);
    });
  });

  test("Export CSV saves the table as a file", () => {
    const createObjectURL: jest.Mock = jest.fn(() => {
      return "blob:table";
    });
    const revokeObjectURL: jest.Mock = jest.fn();

    Object.assign(window.URL, {
      createObjectURL: createObjectURL,
      revokeObjectURL: revokeObjectURL,
    });

    render(<TableHarness initial={[{ key: "51", value: "MNUPLR01" }]} />);

    fireEvent.click(screen.getByTestId("naming-lookup-export"));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:table");
  });

  test("a long table shows its first rows and grows on request", () => {
    const rows: Array<NamingLookupEntry> = Array.from(
      { length: LOOKUP_ROWS_PER_PAGE + 5 },
      (_value: unknown, index: number) => {
        return { key: String(index), value: `V${index}` };
      },
    );

    render(<TableHarness initial={rows} />);

    expect(screen.getAllByTestId("naming-lookup-row")).toHaveLength(
      LOOKUP_ROWS_PER_PAGE,
    );

    fireEvent.click(screen.getByTestId("naming-lookup-show-more"));

    expect(screen.getAllByTestId("naming-lookup-row")).toHaveLength(
      LOOKUP_ROWS_PER_PAGE + 5,
    );
  });

  test("the helpers: merging a paste, reading a form value, the example's value", () => {
    expect(
      mergePastedRows(
        [{ key: "DMB-5", value: "A" }],
        [
          { key: "dmb-5", value: "B" },
          { key: "dmb-6", value: "C" },
        ],
      ),
    ).toEqual([
      { key: "DMB-5", value: "B" },
      { key: "dmb-6", value: "C" },
    ]);
    expect(readLookupRows([{ key: 51, value: "X" }, null, "row"])).toEqual([
      { key: "51", value: "X" },
    ]);
    expect(readLookupRows("rows")).toEqual([]);
    expect(
      getExampleLookupValue({
        lookupEntries: [
          { key: "1", value: " " },
          { key: "2", value: "DRTSCR04" },
        ],
      }),
    ).toBe("DRTSCR04");
    expect(getExampleLookupValue({})).toBeUndefined();
  });
});

describe("the rule form's own checks", () => {
  test("the pattern's problem, in words, and nothing for a good or empty pattern", () => {
    expect(
      getNamePatternFieldError({ namePattern: "UN{site.code" } as never),
    ).toContain('Close the "{"');
    expect(
      getNamePatternFieldError({ namePattern: "UN{site.code}" } as never),
    ).toBeNull();
    expect(getNamePatternFieldError({} as never)).toBeNull();
  });

  test("the table's problems, and the table and pattern held to each other", () => {
    expect(
      getLookupTableFieldError({
        namePattern: "UN{site.code}{lookup}",
        lookupKey: NamingLookupKey.LastIpOctet,
        lookupEntries: [{ key: "51", value: "MNUPLR01" }],
      } as never),
    ).toBeNull();
    expect(
      getLookupTableFieldError({
        namePattern: "UN{site.code}{lookup}",
        lookupEntries: [],
      } as never),
    ).toContain("add a row to the lookup table");
    expect(
      getLookupTableFieldError({
        namePattern: "UN{site.code}",
        lookupKey: NamingLookupKey.LastIpOctet,
        lookupEntries: [{ key: "51", value: "MNUPLR01" }],
      } as never),
    ).toContain("Put {lookup} in the name pattern");
    expect(
      getLookupTableFieldError({
        namePattern: "{lookup}",
        lookupKey: NamingLookupKey.LastIpOctet,
        lookupEntries: [{ key: "999", value: "X" }],
      } as never),
    ).toContain('Row 1: "999"');
    // Blank rows the table editor left are not rows.
    expect(
      getLookupTableFieldError({
        namePattern: "UN{site.code}",
        lookupEntries: [{ key: "", value: "" }],
      } as never),
    ).toBeNull();
  });

  test("the form's fields: the five match criteria on their step, the pattern required", () => {
    const fields: Array<{
      field?: Record<string, unknown> | undefined;
      stepId?: string | undefined;
      required?: boolean | undefined;
    }> = getNamingRuleFormFields() as never;
    const matchFields: Array<string> = fields
      .filter((field: { stepId?: string | undefined }) => {
        return field.stepId === "match-criteria";
      })
      .map((field: { field?: Record<string, unknown> | undefined }) => {
        return Object.keys(field.field || {})[0]!;
      });

    expect(matchFields).toEqual([
      "ipMatchTarget",
      "discoveredNamePattern",
      "macAddressPattern",
      "vendorPattern",
      "sites",
    ]);
    expect(
      fields.find((field: { field?: Record<string, unknown> | undefined }) => {
        return Boolean(field.field?.["namePattern"]);
      })?.required,
    ).toBe(true);
    expect(
      getLookupKeyOptions().map((option: { value: unknown }) => {
        return option.value;
      }),
    ).toEqual(Object.values(NamingLookupKey));
  });
});

const PLAN: DeviceNamingPlan = {
  hasRules: true,
  devicesChecked: 6,
  followingCount: 2,
  isTruncated: false,
  items: [
    {
      deviceId: "device-1",
      currentName: "dmb-5",
      isNamedByPerson: false,
      outcome: DeviceNamingOutcome.Named,
      name: "UN1216DRTPLR02",
      ruleId: "rule-1",
      ruleName: "Menu boards",
    },
    {
      deviceId: "device-2",
      currentName: "Drive-thru screen 6",
      isNamedByPerson: true,
      outcome: DeviceNamingOutcome.Named,
      name: "UN1216DRTSCR06",
      ruleId: "rule-1",
      ruleName: "Menu boards",
    },
    {
      deviceId: "device-3",
      currentName: "10.99.0.51",
      isNamedByPerson: false,
      outcome: DeviceNamingOutcome.MissingValue,
      missing: "site.code",
      ruleId: "rule-1",
      ruleName: "Menu boards",
    },
    {
      deviceId: "device-4",
      currentName: "core-router",
      isNamedByPerson: true,
      outcome: DeviceNamingOutcome.NoMatchingRule,
    },
  ],
};

function renderApply(
  props: { deviceIds?: Array<string>; onRenamed?: () => void } = {},
): void {
  render(
    <MemoryRouter>
      <ApplyNamingRulesModal
        onClose={() => {}}
        deviceIds={props.deviceIds}
        onRenamed={props.onRenamed}
      />
    </MemoryRouter>,
  );
}

describe("the Apply Naming Rules dialog", () => {
  test("groups the plan: to rename (ticked), named by a person (unticked), need attention, not covered", async () => {
    planMock.mockResolvedValue(PLAN);

    renderApply();

    await screen.findByTestId("naming-plan");

    expect(screen.getByTestId("naming-plan-summary")).toHaveTextContent(
      "6 devices checked: 2 to rename, 2 already follow your rules, 1 need attention.",
    );

    const toRename: HTMLElement = screen.getByTestId("naming-plan-to-rename");
    const byPerson: HTMLElement = screen.getByTestId(
      "naming-plan-named-by-person",
    );

    expect(within(toRename).getByText("UN1216DRTPLR02")).toBeInTheDocument();
    expect(within(toRename).getByRole("checkbox")).toBeChecked();
    expect(within(byPerson).getByText("UN1216DRTSCR06")).toBeInTheDocument();
    expect(within(byPerson).getByRole("checkbox")).not.toBeChecked();
    expect(
      within(screen.getByTestId("naming-plan-need-attention")).getByText(
        /Its site has no site code/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("naming-plan-not-covered")).toHaveTextContent(
      "1 device is not covered by any naming rule",
    );
    expect(
      screen.getByRole("button", { name: "Rename 1 device" }),
    ).toBeEnabled();
  });

  test("ticking a person's device adds it; confirming renames exactly the ticked ones", async () => {
    planMock.mockResolvedValue(PLAN);
    applyMock.mockResolvedValue({
      renamed: 2,
      skipped: [],
    } as DeviceNamingApplyResult);
    const onRenamed: jest.Mock = jest.fn();

    renderApply({ onRenamed: onRenamed as unknown as () => void });

    await screen.findByTestId("naming-plan");

    fireEvent.click(
      within(screen.getByTestId("naming-plan-named-by-person")).getByRole(
        "checkbox",
      ),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rename 2 devices" }));
    });

    expect(applyMock).toHaveBeenCalledWith([
      { deviceId: "device-1", fromName: "dmb-5", toName: "UN1216DRTPLR02" },
      {
        deviceId: "device-2",
        fromName: "Drive-thru screen 6",
        toName: "UN1216DRTSCR06",
      },
    ] as Array<DeviceNamingRename>);

    await screen.findByTestId("naming-apply-result");

    expect(screen.getByTestId("naming-apply-result")).toHaveTextContent(
      "2 devices were renamed.",
    );
    expect(onRenamed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  test("devices left alone are listed by name, with the reason", async () => {
    planMock.mockResolvedValue(PLAN);
    applyMock.mockResolvedValue({
      renamed: 0,
      skipped: [
        {
          deviceId: "device-1",
          reason:
            "The device was renamed since the preview, so it was left alone.",
        },
      ],
    } as DeviceNamingApplyResult);

    renderApply();

    await screen.findByTestId("naming-plan");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rename 1 device" }));
    });

    const skipped: HTMLElement = await screen.findByTestId(
      "naming-apply-skipped",
    );

    expect(skipped).toHaveTextContent("dmb-5");
    expect(skipped).toHaveTextContent("renamed since the preview");
  });

  test("a selection from the Devices list is planned on its own", async () => {
    planMock.mockResolvedValue({ ...PLAN, items: [], devicesChecked: 2 });

    renderApply({ deviceIds: ["device-1", "device-2"] });

    await screen.findByTestId("naming-plan-all-good");

    expect(planMock).toHaveBeenCalledWith({
      deviceIds: ["device-1", "device-2"],
    });
    expect(
      screen.getByText(
        "Rename the 2 selected devices to follow your naming rules. Nothing changes until you confirm.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rename 0 devices" }),
    ).toBeDisabled();
  });

  test("a project with no rules is told where to add one", async () => {
    planMock.mockResolvedValue({
      hasRules: false,
      devicesChecked: 0,
      items: [],
      followingCount: 0,
      isTruncated: false,
    });

    renderApply();

    expect(await screen.findByTestId("naming-plan-no-rules")).toHaveTextContent(
      "No naming rules are enabled yet",
    );
  });

  test("a plan that cannot be read says why", async () => {
    planMock.mockRejectedValue(new Error("refused"));

    renderApply();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  test("groupPlanItems", () => {
    const groups: NamingPlanGroups = groupPlanItems(PLAN.items);

    expect(
      groups.toRename.map((item: { deviceId: string }) => {
        return item.deviceId;
      }),
    ).toEqual(["device-1"]);
    expect(
      groups.namedByPerson.map((item: { deviceId: string }) => {
        return item.deviceId;
      }),
    ).toEqual(["device-2"]);
    expect(
      groups.needAttention.map((item: { deviceId: string }) => {
        return item.deviceId;
      }),
    ).toEqual(["device-3"]);
    expect(
      groups.notCovered.map((item: { deviceId: string }) => {
        return item.deviceId;
      }),
    ).toEqual(["device-4"]);
  });
});

describe("the import's naming preview", () => {
  const named: DeviceNamingPreviewItem = {
    key: "10.48.145.55",
    discoveredName: "dmb-5",
    outcome: DeviceNamingOutcome.Named,
    name: "UN1216DRTPLR02",
    ruleId: "rule-1",
    ruleName: "Menu boards",
  };
  const missing: DeviceNamingPreviewItem = {
    key: "10.48.145.40",
    discoveredName: "printer-1",
    outcome: DeviceNamingOutcome.MissingValue,
    missing: "lookup",
    ruleId: "rule-1",
    ruleName: "Menu boards",
  };
  const notCovered: DeviceNamingPreviewItem = {
    key: "192.168.1.1",
    discoveredName: "core",
    outcome: DeviceNamingOutcome.NoMatchingRule,
  };

  test("a host row says the name it will be created under, with the rule", () => {
    render(
      <DiscoveredHostNamingLine naming={named} ipAddress="10.48.145.55" />,
    );

    const line: HTMLElement = screen.getByTestId(
      "discovered-host-rule-name-10.48.145.55",
    );

    expect(line).toHaveTextContent("Will be named");
    expect(line).toHaveTextContent("UN1216DRTPLR02");
    expect(line).toHaveTextContent("Menu boards");
  });

  test("a host a rule cannot name keeps its discovered name, and says why", () => {
    render(
      <DiscoveredHostNamingLine naming={missing} ipAddress="10.48.145.40" />,
    );

    expect(
      screen.getByTestId("discovered-host-rule-problem-10.48.145.40"),
    ).toHaveTextContent(
      "Keeps the name discovery found. The rule's lookup table has no row for it.",
    );
  });

  test("a host no rule covers, or no preview at all, gains nothing", () => {
    const { container } = render(
      <div>
        <DiscoveredHostNamingLine naming={notCovered} ipAddress="192.168.1.1" />
        <DiscoveredHostNamingLine ipAddress="10.0.0.1" />
      </div>,
    );

    expect(container.textContent).toBe("");
  });

  test("the summary counts what the rules name and what needs attention", () => {
    const preview: DeviceNamingPreview = {
      hasRules: true,
      items: [named, missing, notCovered],
    };

    expect(countNamingPreview(preview)).toEqual({ named: 1, problems: 1 });

    render(
      <MemoryRouter>
        <NamingPreviewSummary preview={preview} hostCount={3} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("naming-preview-summary")).toHaveTextContent(
      "Your naming rules name 1 of the 3 selected hosts.",
    );
    expect(screen.getByTestId("naming-preview-summary")).toHaveTextContent(
      "1 cannot be named yet",
    );
  });

  test("no rules, no summary", () => {
    const { container } = render(
      <MemoryRouter>
        <NamingPreviewSummary
          preview={{ hasRules: false, items: [] }}
          hostCount={3}
        />
        <NamingPreviewList preview={{ hasRules: false, items: [] }} />
      </MemoryRouter>,
    );

    expect(container.textContent).toBe("");
  });

  test("the compact list shows the first renames, and how many more", () => {
    const items: Array<DeviceNamingPreviewItem> = Array.from(
      { length: 8 },
      (_value: unknown, index: number) => {
        return {
          ...named,
          key: `endpoint:${index}`,
          name: `UN1216X${index}`,
        };
      },
    );

    render(<NamingPreviewList preview={{ hasRules: true, items: items }} />);

    expect(screen.getByTestId("naming-preview-list")).toHaveTextContent(
      "and 2 more",
    );
    expect(screen.getByText("UN1216X0")).toBeInTheDocument();
    expect(screen.queryByText("UN1216X7")).toBeNull();
  });

  test("indexNamingPreview keys the items like the import's results", () => {
    expect(indexNamingPreview(null)).toBeUndefined();
    expect(
      indexNamingPreview({ hasRules: false, items: [named] }),
    ).toBeUndefined();
    expect(
      indexNamingPreview({ hasRules: true, items: [named] })?.get(
        "10.48.145.55",
      ),
    ).toBe(named);
  });
});

describe("Apply Naming Rules from the Devices list", () => {
  test("the selected devices' ids, and nothing for a row without one", () => {
    expect(
      getSelectedDeviceIds([
        { _id: "device-1" },
        { _id: undefined },
        { _id: "device-2" },
      ] as unknown as Array<NetworkDevice>),
    ).toEqual(["device-1", "device-2"]);
  });
});
