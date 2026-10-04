import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import type { Mock } from "jest-mock";

/*
 * Status Page > Resources > Add Monitor, and Edit resource.
 *
 * "The idea is to make software as simple as possible to use and reduce
 * decision paralysis." Adding a monitor to a status page used to walk two
 * steps and ask for a display name although a monitor had just been picked.
 * Now it asks only for the monitor:
 *
 *   - the display name follows the picked monitor's (or monitor group's)
 *     name until somebody types a name of their own - the rule a monitor's
 *     criteria names follow;
 *   - the description, the tooltip and what is shown beside the resource
 *     are folded under Advanced, at the resource's own defaults, on Create
 *     and on Edit;
 *   - a grid group's row and column sit above that fold.
 *
 * The rule is pinned on its own first, then through the real ModelForm,
 * BasicForm and EntityDropdown with only the network stubbed.
 */

const MONITOR_A_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165001";
const MONITOR_B_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165002";
const MONITOR_C_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165003";
const RESOURCE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165101";

interface CapturedSave {
  model: JSONObject;
  miscDataProps: JSONObject | undefined;
}

let capturedSaves: Array<CapturedSave> = [];
let recordToEdit: JSONObject = {};

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<JSONObject> => {
        return { ...recordToEdit };
      },
      /*
       * Every list a resource form reads is the monitors: the picker's own
       * options (ModelForm), and anything the picker searches for.
       */
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        const MonitorModel: typeof Monitor = (
          jest.requireActual("../../../Models/DatabaseModels/Monitor") as {
            default: typeof Monitor;
          }
        ).default;

        const monitors: Array<Monitor> = [
          [MONITOR_A_ID, "Checkout API"],
          [MONITOR_B_ID, "Billing Worker"],
          [MONITOR_C_ID, "Search Service"],
        ].map(([id, name]: Array<string>): Monitor => {
          const monitor: Monitor = new MonitorModel();
          monitor._id = id!;
          monitor.name = name!;
          return monitor;
        });

        return { data: monitors, count: monitors.length, skip: 0, limit: 50 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
        miscDataProps?: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        capturedSaves.push({
          model: data.model,
          miscDataProps: data.miscDataProps,
        });
        return { data: data.model };
      },
    },
  };
});

import {
  FILLED_IN_DISPLAY_NAME_KEY,
  followPickWithDisplayName,
  getDisplayNameAfterPick,
  getStatusPageResourceFormFields,
  insertBeforeFoldedFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourceFormFields";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import { DropdownChange } from "../../../UI/Components/Dropdown/DropdownChange";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  getByTextOutsideFoldedHeaders,
  hasSetChip,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

type PickFunction = (
  picked: Array<string>,
  previous?: Array<string>,
) => DropdownChange;

// A pick as the monitor list reports it: labels, by name.
const pick: PickFunction = (
  picked: Array<string>,
  previous: Array<string> = [],
): DropdownChange => {
  return {
    selectedOptions: picked.map((label: string) => {
      return { value: `id-of-${label}`, label: label };
    }),
    previousOptions: previous.map((label: string) => {
      return { value: `id-of-${label}`, label: label };
    }),
  };
};

describe("the display name after a monitor is picked", () => {
  test("is the picked monitor's name while the form has no name yet", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: undefined,
        filledInDisplayName: undefined,
        change: pick(["Checkout API"]),
      }),
    ).toBe("Checkout API");

    expect(
      getDisplayNameAfterPick({
        displayName: "",
        filledInDisplayName: undefined,
        change: pick(["Checkout API"]),
      }),
    ).toBe("Checkout API");
  });

  test("treats a name of nothing but spaces as no name", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "   ",
        filledInDisplayName: undefined,
        change: pick(["Checkout API"]),
      }),
    ).toBe("Checkout API");
  });

  test("follows the next pick while the name is still the one the form filled in", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "Checkout API",
        filledInDisplayName: "Checkout API",
        change: pick(["Billing Worker"], ["Checkout API"]),
      }),
    ).toBe("Billing Worker");
  });

  test("keeps a name somebody typed, whatever is picked next", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "Payments",
        filledInDisplayName: "Checkout API",
        change: pick(["Billing Worker"], ["Checkout API"]),
      }),
    ).toBeNull();
  });

  test("follows again once the typed name is cleared", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "",
        filledInDisplayName: "Checkout API",
        change: pick(["Search Service"], ["Billing Worker"]),
      }),
    ).toBe("Search Service");
  });

  /*
   * An Edit form never filled the name in, but a display name that is still
   * its monitor's name was never changed by anybody either.
   */
  test("follows on an Edit form whose name is still the monitor's", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "Checkout API",
        filledInDisplayName: undefined,
        change: pick(["Billing Worker"], ["Checkout API"]),
      }),
    ).toBe("Billing Worker");
  });

  test("keeps an Edit form's own display name", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "Payments",
        filledInDisplayName: undefined,
        change: pick(["Billing Worker"], ["Checkout API"]),
      }),
    ).toBeNull();
  });

  /*
   * Swapping the monitor picker for the monitor group one ("Add a Monitor
   * Group instead.") starts a new picker with nothing picked before, but the
   * name the form filled in is still the form's.
   */
  test("follows a monitor group picked after the form named it after a monitor", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "Checkout API",
        filledInDisplayName: "Checkout API",
        change: pick(["Payments Stack"]),
      }),
    ).toBe("Payments Stack");
  });

  test("leaves the name alone when the pick is cleared", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "Checkout API",
        filledInDisplayName: "Checkout API",
        change: pick([], ["Checkout API"]),
      }),
    ).toBeNull();
  });

  test("leaves the name alone when the list cannot say what was picked", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "",
        filledInDisplayName: undefined,
        change: undefined,
      }),
    ).toBeNull();

    expect(
      getDisplayNameAfterPick({
        displayName: "",
        filledInDisplayName: undefined,
        change: { selectedOptions: [], previousOptions: [] },
      }),
    ).toBeNull();
  });

  test("is never a name of more than one pick", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "",
        filledInDisplayName: undefined,
        change: pick(["Checkout API", "Billing Worker"]),
      }),
    ).toBeNull();
  });

  test("is never a label of nothing but spaces", () => {
    expect(
      getDisplayNameAfterPick({
        displayName: "",
        filledInDisplayName: undefined,
        change: {
          selectedOptions: [{ value: MONITOR_A_ID, label: "  " }],
          previousOptions: [],
        },
      }),
    ).toBeNull();
  });
});

type SetNewFormValuesFunction = (
  values: FormValues<StatusPageResource>,
) => void;

describe("the monitor picker's onChange", () => {
  test("writes the name and remembers it as the form's own", () => {
    const setNewFormValues: Mock<SetNewFormValuesFunction> =
      jest.fn<SetNewFormValuesFunction>();

    followPickWithDisplayName(
      MONITOR_A_ID,
      { displayTooltip: "US only" } as FormValues<StatusPageResource>,
      setNewFormValues,
      pick(["Checkout API"]),
    );

    expect(setNewFormValues).toHaveBeenCalledWith({
      displayTooltip: "US only",
      displayName: "Checkout API",
      [FILLED_IN_DISPLAY_NAME_KEY]: "Checkout API",
    });
  });

  test("writes nothing over a name somebody typed", () => {
    const setNewFormValues: Mock<SetNewFormValuesFunction> =
      jest.fn<SetNewFormValuesFunction>();

    followPickWithDisplayName(
      MONITOR_B_ID,
      {
        displayName: "Payments",
        [FILLED_IN_DISPLAY_NAME_KEY]: "Checkout API",
      } as FormValues<StatusPageResource>,
      setNewFormValues,
      pick(["Billing Worker"], ["Checkout API"]),
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("writes nothing when the form is handed no change at all", () => {
    const setNewFormValues: Mock<SetNewFormValuesFunction> =
      jest.fn<SetNewFormValuesFunction>();

    followPickWithDisplayName(
      MONITOR_B_ID,
      {} as FormValues<StatusPageResource>,
      setNewFormValues,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });
});

type FieldKeyFunction = (field: ModelField<StatusPageResource>) => string;

const fieldKey: FieldKeyFunction = (
  field: ModelField<StatusPageResource>,
): string => {
  return Object.keys(field.field || {})[0] || "";
};

describe("the resource form's fields", () => {
  const fields: Array<ModelField<StatusPageResource>> =
    getStatusPageResourceFormFields({ addMonitorGroup: false });

  test("are the monitor, its display name, and an Advanced section holding the rest", () => {
    expect(fields.map(fieldKey)).toEqual([
      "monitor",
      "displayName",
      "displayDescription",
      "displayTooltip",
      "showCurrentStatus",
      "showUptimePercent",
      "uptimePercentPrecision",
      "showStatusHistoryChart",
    ]);
  });

  test("put nothing on a step: the form is one page", () => {
    for (const field of fields) {
      expect(field.stepId).toBeUndefined();
    }
  });

  test("ask for the monitor and its name open, and fold everything else into one section", () => {
    expect(fields[0]!.collapsibleSection).toBeUndefined();
    expect(fields[1]!.collapsibleSection).toBeUndefined();

    const section: FormFieldCollapsibleSection<StatusPageResource> =
      fields[2]!.collapsibleSection!;

    expect(section.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(section.title).toBe(MORE_FIELDS_SECTION_TITLE);
    // Folded on Edit too, saying "Configured" instead of opening.
    expect(section.openWhenConfigured).toBe(false);

    for (const field of fields.slice(2)) {
      expect(field.collapsibleSection).toBe(section);
    }
  });

  test("require only the monitor and its display name", () => {
    expect(
      fields
        .filter((field: ModelField<StatusPageResource>): boolean => {
          return field.required === true && !field.showIf;
        })
        .map(fieldKey),
    ).toEqual(["monitor", "displayName"]);
  });

  test("let the display name follow the picked monitor", () => {
    expect(fields[0]!.onChange).toBe(followPickWithDisplayName);
    expect(fields[0]!.dropdownModal?.type).toBe(Monitor);
    expect(fields[1]!.description).toBe(
      "The name visitors see on the status page. It follows what you pick above until you type a name of your own.",
    );
  });

  test("swap in a monitor group picker that names the resource the same way", () => {
    const footer: React.ReactElement = <span>Add a Monitor instead.</span>;

    const groupFields: Array<ModelField<StatusPageResource>> =
      getStatusPageResourceFormFields({
        addMonitorGroup: true,
        targetFooterElement: footer,
      });

    expect(groupFields.map(fieldKey).slice(0, 2)).toEqual([
      "monitorGroup",
      "displayName",
    ]);
    expect(groupFields[0]!.dropdownModal?.type).toBe(MonitorGroup);
    expect(groupFields[0]!.onChange).toBe(followPickWithDisplayName);
    expect(groupFields[0]!.footerElement).toBe(footer);
  });

  /*
   * Same columns and the same defaults: a monitor added from the form is
   * stored exactly as one added before the options were folded, and as one
   * created through the API with them left out.
   */
  test("start from the resource's own column defaults", () => {
    const resource: StatusPageResource = new StatusPageResource();

    for (const key of [
      "showCurrentStatus",
      "showUptimePercent",
      "showStatusHistoryChart",
    ]) {
      const field: ModelField<StatusPageResource> | undefined = fields.find(
        (candidate: ModelField<StatusPageResource>): boolean => {
          return fieldKey(candidate) === key;
        },
      );

      expect(field?.fieldType).toBe(FormFieldSchemaType.Toggle);
      expect(field?.defaultValue).toBe(
        resource.getTableColumnMetadata(key).defaultValue,
      );
    }

    expect(
      fields.find((candidate: ModelField<StatusPageResource>): boolean => {
        return fieldKey(candidate) === "uptimePercentPrecision";
      })?.defaultValue,
    ).toBe(UptimePrecision.ONE_DECIMAL);
  });

  test("build their Advanced section afresh for every form", () => {
    const again: Array<ModelField<StatusPageResource>> =
      getStatusPageResourceFormFields({ addMonitorGroup: false });

    expect(again[2]!.collapsibleSection).not.toBe(
      fields[2]!.collapsibleSection,
    );
  });
});

describe("a grid group's cell", () => {
  type TestField = { key: string; collapsibleSection?: unknown };

  const advanced: { id: string } = { id: "advanced" };

  const base: Array<TestField> = [
    { key: "monitor" },
    { key: "displayName" },
    { key: "displayDescription", collapsibleSection: advanced },
    { key: "showCurrentStatus", collapsibleSection: advanced },
  ];

  const cell: Array<TestField> = [
    { key: "rowAxisValue" },
    { key: "columnAxisValue" },
  ];

  test("goes in above the folded section, never behind it", () => {
    expect(
      insertBeforeFoldedFields<TestField>(base, cell).map(
        (field: TestField): string => {
          return field.key;
        },
      ),
    ).toEqual([
      "monitor",
      "displayName",
      "rowAxisValue",
      "columnAxisValue",
      "displayDescription",
      "showCurrentStatus",
    ]);
  });

  test("goes at the end of a form that folds nothing", () => {
    expect(
      insertBeforeFoldedFields<TestField>(base.slice(0, 2), cell).map(
        (field: TestField): string => {
          return field.key;
        },
      ),
    ).toEqual(["monitor", "displayName", "rowAxisValue", "columnAxisValue"]);
  });

  test("leaves the form it was handed as it was", () => {
    const copy: Array<TestField> = [...base];

    insertBeforeFoldedFields<TestField>(base, cell);

    expect(base).toEqual(copy);
  });
});

const MONITOR_NAMES: Array<string> = [
  "Checkout API",
  "Billing Worker",
  "Search Service",
];

type PickMonitorFunction = (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) => Promise<void>;

/*
 * Opens the picker - from its input, or from the value it shows once
 * something is picked - and picks a monitor by its name.
 */
const pickMonitor: PickMonitorFunction = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> => {
  const combobox: HTMLElement | null = screen.queryByRole("combobox", {
    name: "Monitor",
  });

  if (combobox) {
    await user.click(combobox);
  } else {
    // A single-select showing its value opens from the value.
    const valueButton: HTMLElement | undefined = screen
      .getAllByRole("button")
      .find((button: HTMLElement): boolean => {
        return MONITOR_NAMES.includes((button.textContent || "").trim());
      });

    if (!valueButton) {
      throw new Error("The monitor picker shows no monitor to open it from");
    }

    await user.click(valueButton);
  }

  await user.click(await screen.findByRole("option", { name: name }));
};

type DisplayNameInputFunction = () => HTMLInputElement;

const displayNameInput: DisplayNameInputFunction = (): HTMLInputElement => {
  return screen.getByPlaceholderText("Display Name") as HTMLInputElement;
};

/*
 * Through the real form: ModelForm fetches the monitors for the picker,
 * EntityDropdown says what was picked, and the display name input shows it.
 */
describe("Add Monitor, as somebody fills it in", () => {
  afterEach(() => {
    cleanup();
    capturedSaves = [];
    recordToEdit = {};
  });

  type RenderFormFunction = (data?: {
    formType?: FormType | undefined;
    fields?: Array<ModelField<StatusPageResource>> | undefined;
  }) => Promise<ReturnType<typeof userEvent.setup>>;

  const renderForm: RenderFormFunction = async (data?: {
    formType?: FormType | undefined;
    fields?: Array<ModelField<StatusPageResource>> | undefined;
  }): Promise<ReturnType<typeof userEvent.setup>> => {
    const formType: FormType = data?.formType ?? FormType.Create;
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await act(async (): Promise<void> => {
      render(
        <ModelForm<StatusPageResource>
          modelType={StatusPageResource}
          id="create-status-page-resource-test"
          name="Status Page > Resources"
          fields={
            data?.fields ||
            getStatusPageResourceFormFields({ addMonitorGroup: false })
          }
          formType={formType}
          modelIdToEdit={
            formType === FormType.Update ? new ObjectID(RESOURCE_ID) : undefined
          }
          onSuccess={(): void => {
            // Not asserted on.
          }}
          submitButtonText="Add Monitor"
        />,
      );
    });

    await screen.findByRole("button", { name: "Add Monitor" });

    return user;
  };

  test("asks for the monitor and its name, with the rest folded under Advanced", async () => {
    await renderForm();

    expect(screen.getByRole("combobox", { name: "Monitor" })).toBeVisible();
    expect(displayNameInput()).toBeVisible();

    // One page: no step list.
    expect(screen.queryByRole("navigation", { name: "Progress" })).toBeNull();

    const advanced: HTMLElement = screen.getByRole("button", {
      name: "More fields",
    });

    expect(advanced).toHaveAttribute("aria-expanded", "false");
    // Folded, its header names what it holds; the fields are hidden.
    expect(listedNames(advanced)).toContain("Tooltip");
    expect(
      getByTextOutsideFoldedHeaders(document.body, "Tooltip"),
    ).not.toBeVisible();
    expect(
      getByTextOutsideFoldedHeaders(document.body, "Show Uptime %"),
    ).not.toBeVisible();
    // Untouched, nothing in it is set.
    expect(setChips()).toEqual([]);
  });

  test("names the resource after the picked monitor, and follows the next pick", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderForm();

    expect(displayNameInput().value).toBe("");

    await pickMonitor(user, "Checkout API");

    await waitFor(() => {
      expect(displayNameInput().value).toBe("Checkout API");
    });

    await pickMonitor(user, "Billing Worker");

    await waitFor(() => {
      expect(displayNameInput().value).toBe("Billing Worker");
    });
  });

  test("stops following once a name of your own is typed", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderForm();

    await pickMonitor(user, "Checkout API");

    await waitFor(() => {
      expect(displayNameInput().value).toBe("Checkout API");
    });

    fireEvent.change(displayNameInput(), { target: { value: "Payments" } });

    await pickMonitor(user, "Billing Worker");

    // Given a moment to follow, it does not.
    await act(async (): Promise<void> => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(displayNameInput().value).toBe("Payments");
  });

  test("saves the display name it filled in, and nothing of how it knew", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderForm();

    await pickMonitor(user, "Search Service");

    await waitFor(() => {
      expect(displayNameInput().value).toBe("Search Service");
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Add Monitor" }));
    });

    await waitFor(() => {
      expect(capturedSaves).toHaveLength(1);
    });

    const saved: StatusPageResource = capturedSaves[0]!
      .model as unknown as StatusPageResource;

    expect(saved.displayName).toBe("Search Service");
    expect(saved.monitor?._id?.toString()).toBe(MONITOR_C_ID);

    // The defaults folded under Advanced, as the columns have them.
    expect(saved.showCurrentStatus).toBe(true);
    expect(saved.showUptimePercent).toBe(false);
    expect(saved.showStatusHistoryChart).toBe(true);

    // How the form knew the name was its own is not a column, nor misc data.
    expect(
      (saved as unknown as Record<string, unknown>)[FILLED_IN_DISPLAY_NAME_KEY],
    ).toBeUndefined();
    expect(
      Object.keys(capturedSaves[0]!.miscDataProps || {}).includes(
        FILLED_IN_DISPLAY_NAME_KEY,
      ),
    ).toBe(false);
  });

  /*
   * Opening Advanced and changing one option is all it takes to save it; the
   * header says Configured once it is folded again.
   */
  test("sends what is changed under Advanced", async () => {
    const user: ReturnType<typeof userEvent.setup> = await renderForm();

    await pickMonitor(user, "Checkout API");

    const advanced: HTMLElement = screen.getByRole("button", {
      name: "More fields",
    });

    await user.click(advanced);
    await user.click(screen.getByRole("switch", { name: /Show Uptime %/ }));
    await user.click(advanced);

    expect(hasSetChip()).toBe(true);

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Add Monitor" }));
    });

    await waitFor(() => {
      expect(capturedSaves).toHaveLength(1);
    });

    const saved: StatusPageResource = capturedSaves[0]!
      .model as unknown as StatusPageResource;

    expect(saved.showUptimePercent).toBe(true);
    expect(saved.uptimePercentPrecision).toBe(UptimePrecision.ONE_DECIMAL);
  });
});

describe("Edit resource", () => {
  afterEach(() => {
    cleanup();
    capturedSaves = [];
    recordToEdit = {};
  });

  type RenderEditFunction = () => Promise<void>;

  const renderEdit: RenderEditFunction = async (): Promise<void> => {
    await act(async (): Promise<void> => {
      render(
        <ModelForm<StatusPageResource>
          modelType={StatusPageResource}
          id="edit-status-page-resource-test"
          name="Status Page > Resources"
          fields={getStatusPageResourceFormFields({ addMonitorGroup: false })}
          formType={FormType.Update}
          modelIdToEdit={new ObjectID(RESOURCE_ID)}
          onSuccess={(): void => {
            // Not asserted on.
          }}
          submitButtonText="Save Changes"
        />,
      );
    });

    await screen.findByRole("button", { name: "Save Changes" });
  };

  test("shows its options folded, saying Configured when one is set", async () => {
    recordToEdit = {
      _id: RESOURCE_ID,
      displayName: "Checkout API",
      monitor: { _id: MONITOR_A_ID, name: "Checkout API" },
      displayTooltip: "US and EU customers",
      showCurrentStatus: true,
      showUptimePercent: false,
      showStatusHistoryChart: true,
    };

    await renderEdit();

    const advanced: HTMLElement = await screen.findByRole("button", {
      name: "More fields",
    });

    await waitFor(() => {
      expect(hasSetChip()).toBe(true);
    });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
  });

  /*
   * A resource whose display name is still its monitor's was never renamed:
   * pointing it at another monitor takes that monitor's name. The picker
   * knew the old monitor's name to show it, and says so with the pick.
   */
  test("takes the new monitor's name when the old one's was never changed", async () => {
    recordToEdit = {
      _id: RESOURCE_ID,
      displayName: "Checkout API",
      monitor: { _id: MONITOR_A_ID, name: "Checkout API" },
    };

    await renderEdit();

    await waitFor(() => {
      expect(displayNameInput().value).toBe("Checkout API");
    });

    await pickMonitor(userEvent.setup(), "Billing Worker");

    await waitFor(() => {
      expect(displayNameInput().value).toBe("Billing Worker");
    });
  });

  test("keeps a renamed resource's name when its monitor changes", async () => {
    recordToEdit = {
      _id: RESOURCE_ID,
      displayName: "Payments",
      monitor: { _id: MONITOR_A_ID, name: "Checkout API" },
    };

    await renderEdit();

    await waitFor(() => {
      expect(displayNameInput().value).toBe("Payments");
    });

    await pickMonitor(userEvent.setup(), "Billing Worker");

    await act(async (): Promise<void> => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(displayNameInput().value).toBe("Payments");
  });

  test("says nothing on the folded header when every option is as it was made", async () => {
    recordToEdit = {
      _id: RESOURCE_ID,
      displayName: "Checkout API",
      monitor: { _id: MONITOR_A_ID, name: "Checkout API" },
      showCurrentStatus: true,
      showUptimePercent: false,
      showStatusHistoryChart: true,
    };

    await renderEdit();

    await screen.findByRole("button", { name: "More fields" });
    expect(setChips()).toEqual([]);
  });
});
