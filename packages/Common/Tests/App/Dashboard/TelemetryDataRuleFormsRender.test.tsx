import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SpyInstance } from "jest-mock";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { FunctionComponent, ReactElement } from "react";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import Navigation from "../../../UI/Utils/Navigation";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Logs > Settings and Traces > Settings: the create forms of drop filters,
 * scrub rules and pipelines, drawn for real - the pages' own fields in the
 * ModelFormModal, ModelForm and BasicForm their tables open, with only the
 * table around them, the network and the permissions stubbed.
 *
 * "Log and trace drop filters, scrub rules and pipelines start from what the
 * rule does, with server defaults shown and no empty custom regex."
 *
 *   - A drop filter walks Match (name and filter query), then Action (Drop
 *     picked; the description and Enabled folded under Advanced, Enabled on).
 *   - A scrub rule is one page that starts from its pattern type: the name
 *     follows the type, a Custom Regex rule asks for its pattern and is
 *     refused one that would scrub nothing, and the action, fields and
 *     Enabled wait folded at the server's defaults.
 *   - A pipeline is a name (the description folded), and creating one opens
 *     its page.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NEW_ID: string = "55555555-5555-4555-8555-555555555555";
const RULE_ID: string = "66666666-6666-4666-8666-666666666666";

interface MockTable {
  mode: "create" | "edit";
}

const mockTable: MockTable = { mode: "create" };

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      const singularName: string =
        props.singularName || new props.modelType().singularName || "";
      const fields: Array<ModelField<TBaseModel>> = props.formFields || [];

      if (mockTable.mode === "edit") {
        // What the real table opens from a row's Edit.
        return (
          <ModelFormModal<TBaseModel>
            title={`Edit ${singularName}`}
            modelType={props.modelType}
            modalWidth={props.createEditModalWidth}
            submitButtonText="Save Changes"
            onClose={() => {}}
            onSuccess={() => {}}
            modelIdToEdit={new ObjectID(RULE_ID)}
            formProps={{
              id: `create-${props.modelType.name}-from`,
              name: `create-${props.modelType.name}-from`,
              modelType: props.modelType,
              fields: fields.filter(
                (field: ModelField<TBaseModel>): boolean => {
                  return !field.doNotShowWhenEditing;
                },
              ),
              steps: props.formSteps || [],
              formType: FormType.Update,
            }}
          />
        );
      }

      // What the real table opens from its Create button.
      return (
        <ModelFormModal<TBaseModel>
          title={`Create New ${singularName}`}
          modelType={props.modelType}
          modalWidth={props.createEditModalWidth}
          initialValues={props.createInitialValues}
          submitButtonText={`Create ${singularName}`}
          onClose={() => {}}
          onBeforeCreate={props.onBeforeCreate}
          onSuccess={(item: TBaseModel) => {
            void props.onCreateSuccess?.(item, ModalType.Create);
          }}
          formProps={{
            id: `create-${props.modelType.name}-from`,
            name: `create-${props.modelType.name}-from`,
            modelType: props.modelType,
            fields: fields.filter((field: ModelField<TBaseModel>): boolean => {
              return !field.doNotShowWhenCreating;
            }),
            steps: props.formSteps || [],
            summary: props.formSummary,
            formType: FormType.Create,
          }}
        />
      );
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

import LogDropFilters from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Settings/DropFilters";
import LogPipelines from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Settings/Pipelines";
import LogScrubRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Settings/ScrubRules";
import TraceDropFilters from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/DropFilters";
import TracePipelines from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/Pipelines";
import TraceScrubRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/ScrubRules";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ScrubRulePatternPill from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRulePatternPill";
import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import { Blue500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import {
  LOG_SCRUB_FIELDS,
  LOG_SCRUB_PATTERN_TYPES,
  TRACE_SCRUB_FIELDS,
  TRACE_SCRUB_PATTERN_TYPES,
} from "../../../Types/Telemetry/ScrubRule";
import {
  hasSetChip,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

// BasicForm opens a stepped form's first step in an effect: let it run.
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

async function renderPage(
  Page: FunctionComponent<PageComponentProps>,
  mode: MockTable["mode"] = "create",
): Promise<UserEvent> {
  mockTable.mode = mode;

  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/logs/settings"),
  } as unknown as PageComponentProps;

  await act(async (): Promise<void> => {
    render(<Page {...props} />);
  });

  await settle();

  return userEvent.setup({ delay: null });
}

// react-select opens on a click; its options are portalled to the body.
async function pickOption(
  user: UserEvent,
  combobox: HTMLElement,
  optionText: string,
): Promise<void> {
  await user.click(combobox);
  const options: Array<HTMLElement> = await screen.findAllByText(optionText, {
    exact: true,
  });
  await user.click(options[options.length - 1]!);
}

// What ModelForm handed the API: the model, read by its columns.
function sentModel(): JSONObject {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: unknown })
    .model as JSONObject;
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

function advancedHeader(): HTMLElement {
  return within(dialog()).getByRole("button", { name: "More fields" });
}

// The line the folded Advanced header says what its defaults do with.
function advancedSummary(): string | null {
  const summary: HTMLElement | null = within(dialog()).queryByTestId(
    "collapsible-section-summary",
  );

  return summary ? summary.textContent : null;
}

beforeEach(() => {
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    const saved: BaseModel = data.model;
    saved._id = NEW_ID;
    return Promise.resolve({ data: saved });
  }) as never);
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

interface ScrubRulePage {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  modelType: { new (): BaseModel };
  singularName: string;
  defaultFieldsToScrub: string;
  defaultsSummary: string;
}

const SCRUB_RULE_PAGES: Array<ScrubRulePage> = [
  {
    name: "Logs > Settings > Scrub Rules",
    Page: LogScrubRules,
    modelType: LogScrubRule,
    singularName: "Log Scrub Rule",
    defaultFieldsToScrub: "both",
    defaultsSummary:
      "Matches are replaced with [REDACTED] in the log body and attributes.",
  },
  {
    name: "Traces > Settings > Scrub Rules",
    Page: TraceScrubRules,
    modelType: TraceScrubRule,
    singularName: "Trace Scrub Rule",
    defaultFieldsToScrub: "all",
    defaultsSummary:
      "Matches are replaced with [REDACTED] in span names, attributes and event attributes.",
  },
];

describe.each(SCRUB_RULE_PAGES)("$name", (page: ScrubRulePage) => {
  function patternTypePicker(): HTMLElement {
    return within(dialog()).getByRole("combobox", { name: "Pattern Type" });
  }

  function nameBox(): HTMLElement {
    return within(dialog()).getByRole("textbox", { name: "Name" });
  }

  test("opens on one page that starts from the pattern type", async () => {
    await renderPage(page.Page);

    expect(
      await screen.findByText(`Create New ${page.singularName}`),
    ).toBeInTheDocument();

    // One page: no step list, no Next, and the one button creates.
    expect(
      within(dialog()).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent(`Create ${page.singularName}`);

    for (const oldStep of [
      "Basic Info",
      "Pattern Configuration",
      "Scrub Settings",
    ]) {
      expect(within(dialog()).queryByText(oldStep)).toBeNull();
    }

    // The pattern type first, then the name.
    const picker: HTMLElement = patternTypePicker();
    const name: HTMLElement = nameBox();
    expect(
      picker.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // No pattern box before Custom Regex is picked.
    expect(
      within(dialog()).queryByRole("textbox", { name: "Custom Regex Pattern" }),
    ).toBeNull();
  });

  test("folds the rest under Advanced, which says what its defaults do", async () => {
    await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(advancedSummary()).toBe(page.defaultsSummary);
    });
    expect(setChips(dialog())).toEqual([]);
  });

  test("names the rule after the pattern type, until somebody types a name", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    await pickOption(user, patternTypePicker(), "Email Address");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Scrub email addresses");
    });

    await pickOption(user, patternTypePicker(), "Phone Number");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Scrub phone numbers");
    });

    fireEvent.change(nameBox(), { target: { value: "Customer phones" } });
    await pickOption(user, patternTypePicker(), "IP Address");
    await settle();

    expect(nameBox()).toHaveValue("Customer phones");
  });

  test("creates a rule from the one page, with the server's defaults", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    await pickOption(user, patternTypePicker(), "Email Address");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Scrub email addresses");
    });

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["patternType"]).toBe("email");
    expect(model["name"]).toBe("Scrub email addresses");
    expect(model["scrubAction"]).toBe("redact");
    expect(model["fieldsToScrub"]).toBe(page.defaultFieldsToScrub);
    expect(model["isEnabled"]).toBe(true);
  });

  test("asks for the pattern right under Custom Regex, and refuses none", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    await pickOption(user, patternTypePicker(), "Custom Regex");

    const pattern: HTMLElement = await within(dialog()).findByRole("textbox", {
      name: "Custom Regex Pattern",
    });
    expect(
      patternTypePicker().compareDocumentPosition(pattern) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      pattern.compareDocumentPosition(nameBox()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Scrub custom pattern");
    });

    await submit();

    expect(
      await within(dialog()).findByText(/Custom Regex Pattern is required/i),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("REGRESSION: refuses a pattern that does not compile, in the form", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    await pickOption(user, patternTypePicker(), "Custom Regex");
    fireEvent.change(
      await within(dialog()).findByRole("textbox", {
        name: "Custom Regex Pattern",
      }),
      { target: { value: "([unclosed" } },
    );

    await submit();

    expect(
      await within(dialog()).findByText(
        /^This is not a valid regular expression: /,
      ),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("refuses a pattern that matches empty text, in the form", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    await pickOption(user, patternTypePicker(), "Custom Regex");
    fireEvent.change(
      await within(dialog()).findByRole("textbox", {
        name: "Custom Regex Pattern",
      }),
      { target: { value: "\\d*" } },
    );

    await submit();

    expect(
      await within(dialog()).findByText(
        /^This pattern matches empty text, so it would put its replacement between every character\./,
      ),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("creates a custom rule with its pattern", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    await pickOption(user, patternTypePicker(), "Custom Regex");
    fireEvent.change(
      await within(dialog()).findByRole("textbox", {
        name: "Custom Regex Pattern",
      }),
      { target: { value: "\\bSECRET-[A-Z0-9]+\\b" } },
    );

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["patternType"]).toBe("custom");
    expect(model["customRegex"]).toBe("\\bSECRET-[A-Z0-9]+\\b");
    expect(model["name"]).toBe("Scrub custom pattern");
  });

  test("does not ask a sensitive-keys rule which fields to scrub", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    await pickOption(user, patternTypePicker(), "Sensitive Attribute Keys");
    await waitFor(() => {
      expect(advancedSummary()).toBe(
        "The values of attributes whose key looks sensitive are replaced with [REDACTED].",
      );
    });

    await user.click(advancedHeader());

    expect(
      within(dialog()).getByRole("combobox", { name: "Scrub Action" }),
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole("combobox", { name: "Fields to Scrub" }),
    ).toBeNull();
  });

  test("says Configured once a folded default is changed, and sends it", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    await pickOption(user, patternTypePicker(), "Email Address");
    await user.click(advancedHeader());
    await pickOption(
      user,
      within(dialog()).getByRole("combobox", { name: "Scrub Action" }),
      "Mask",
    );
    // Folded again: the summary gives way to the badge.
    await user.click(advancedHeader());

    await waitFor(() => {
      expect(hasSetChip(dialog())).toBe(true);
    });
    expect(advancedSummary()).toBeNull();

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentModel()["scrubAction"]).toBe("mask");
  });

  describe("edited", () => {
    function storedRule(data: Record<string, unknown>): BaseModel {
      return Object.assign(new page.modelType(), {
        _id: RULE_ID,
        name: "Card numbers",
        patternType: "creditCard",
        scrubAction: "redact",
        fieldsToScrub: page.defaultFieldsToScrub,
        isEnabled: true,
        ...data,
      });
    }

    test("keeps Advanced folded, and not Configured, for a rule at its defaults", async () => {
      getItemMock.mockImplementation((() => {
        return Promise.resolve(storedRule({}));
      }) as never);

      await renderPage(page.Page, "edit");

      expect(await within(dialog()).findByDisplayValue("Card numbers")).toBe(
        nameBox(),
      );
      await settle();

      expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
      expect(setChips(dialog())).toEqual([]);
    });

    test("says Configured for a rule whose folded settings were changed", async () => {
      getItemMock.mockImplementation((() => {
        return Promise.resolve(storedRule({ scrubAction: "hash" }));
      }) as never);

      await renderPage(page.Page, "edit");

      await within(dialog()).findByDisplayValue("Card numbers");

      await waitFor(() => {
        expect(hasSetChip(dialog())).toBe(true);
      });
    });

    /*
     * A custom rule saved before the check, with no pattern: it is left as
     * it is, and the first save asks for the pattern it never had.
     */
    test("asks a custom rule saved without a pattern for one before saving", async () => {
      getItemMock.mockImplementation((() => {
        return Promise.resolve(
          storedRule({
            name: "Internal tokens",
            patternType: "custom",
            customRegex: "",
          }),
        );
      }) as never);

      await renderPage(page.Page, "edit");

      await within(dialog()).findByDisplayValue("Internal tokens");

      // The pattern box is there, under its type, empty as it was saved.
      expect(
        within(dialog()).getByRole("textbox", { name: "Custom Regex Pattern" }),
      ).toHaveValue("");

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(dialog()).getByTestId("modal-footer-submit-button"),
        );
      });

      expect(
        await within(dialog()).findByText(
          "Enter the regular expression to match. Without one, this rule would scrub nothing.",
        ),
      ).toBeInTheDocument();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });
  });
});

interface DropFilterPage {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  singularName: string;
  // The value picked in the filter query's first condition, and the query.
  conditionValue: string;
  query: string;
  defaultsSummary: string;
}

const DROP_FILTER_PAGES: Array<DropFilterPage> = [
  {
    name: "Logs > Settings > Drop Filters",
    Page: LogDropFilters,
    singularName: "Log Drop Filter",
    conditionValue: "Debug",
    query: "severityText = 'Debug'",
    defaultsSummary:
      "The filter applies to new logs within a minute of being created.",
  },
  {
    name: "Traces > Settings > Drop Filters",
    Page: TraceDropFilters,
    singularName: "Trace Drop Filter",
    conditionValue: "Server",
    query: "kind = 'SPAN_KIND_SERVER'",
    defaultsSummary:
      "The filter applies to new spans within a minute of being created.",
  },
];

describe.each(DROP_FILTER_PAGES)("$name", (page: DropFilterPage) => {
  function stepList(): HTMLElement {
    return within(dialog()).getByRole("navigation", { name: "Progress" });
  }

  async function fillMatch(user: UserEvent, name: string): Promise<void> {
    fireEvent.change(
      await within(dialog()).findByRole("textbox", { name: "Name" }),
      { target: { value: name } },
    );

    // The condition row's Field, Operator and Value: Value is the third.
    const comboboxes: Array<HTMLElement> =
      within(dialog()).getAllByRole("combobox");
    await pickOption(user, comboboxes[2]!, page.conditionValue);
  }

  test("walks Match, then Action, with the old Basic Info step gone", async () => {
    await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    const steps: HTMLElement = await within(dialog()).findByRole("navigation", {
      name: "Progress",
    });
    expect(within(steps).getByText("Match")).toBeInTheDocument();
    expect(within(steps).getByText("Action")).toBeInTheDocument();
    expect(within(steps).queryByText("Basic Info")).toBeNull();
    expect(within(steps).queryByText("Filter Conditions")).toBeNull();
  });

  test("asks for the name and the filter query on Match", async () => {
    await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);
    await within(dialog()).findByRole("navigation", { name: "Progress" });

    expect(
      within(dialog()).getByRole("textbox", { name: "Name" }),
    ).toBeVisible();
    expect(within(dialog()).getByText("Filter Query")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("switch")).toBeNull();
    expect(
      within(dialog()).queryByRole("button", { name: "More fields" }),
    ).toBeNull();

    // Drop is already picked, so the filter can be created from here.
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent(`Create ${page.singularName}`);
    expect(
      within(dialog()).getByTestId("modal-footer-next-button"),
    ).toBeInTheDocument();
  });

  test("shows Drop picked on Action, and Enabled folded under Advanced", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);
    await fillMatch(user, "Noisy records");

    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog()).getByTestId("modal-footer-next-button"));
    });

    expect(
      await within(dialog()).findByRole("combobox", { name: "Action" }),
    ).toBeInTheDocument();
    expect(within(dialog()).getByText("Drop")).toBeInTheDocument();
    expect(within(stepList()).getByText("Action")).toBeInTheDocument();
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(advancedSummary()).toBe(page.defaultsSummary);
    });
    expect(
      within(dialog()).queryByRole("spinbutton", { name: "Sample Percentage" }),
    ).toBeNull();
  });

  test("creates a drop filter from Match, on, with Drop", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);
    await fillMatch(user, "Noisy records");

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe("Noisy records");
    expect(model["filterQuery"]).toBe(page.query);
    expect(model["action"]).toBe("drop");
    expect(model["isEnabled"]).toBe(true);
  });

  test("stages a filter switched off, saying Configured", async () => {
    const user: UserEvent = await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);
    await fillMatch(user, "Staged");

    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog()).getByTestId("modal-footer-next-button"));
    });
    await within(dialog()).findByRole("combobox", { name: "Action" });

    await user.click(advancedHeader());
    await user.click(within(dialog()).getByRole("switch", { name: "Enabled" }));
    await user.click(advancedHeader());

    await waitFor(() => {
      expect(hasSetChip(dialog())).toBe(true);
    });
    expect(advancedSummary()).toBeNull();

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentModel()["isEnabled"]).toBe(false);
  });
});

interface PipelinePage {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  singularName: string;
  route: string;
}

const PIPELINE_PAGES: Array<PipelinePage> = [
  {
    name: "Logs > Settings > Pipelines",
    Page: LogPipelines,
    singularName: "Log Pipeline",
    route: `/dashboard/${PROJECT_ID.toString()}/logs/settings/pipelines/${NEW_ID}`,
  },
  {
    name: "Traces > Settings > Pipelines",
    Page: TracePipelines,
    singularName: "Trace Pipeline",
    route: `/dashboard/${PROJECT_ID.toString()}/traces/settings/pipelines/${NEW_ID}`,
  },
];

describe.each(PIPELINE_PAGES)("$name", (page: PipelinePage) => {
  test("asks for a name, with the description folded and no Enabled", async () => {
    await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    expect(
      within(dialog()).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(
      within(dialog()).getByRole("textbox", { name: "Name" }),
    ).toBeVisible();
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog()).queryByRole("switch")).toBeNull();
    expect(within(dialog()).queryByText("Enabled")).toBeNull();
  });

  test("creates the pipeline without asking whether it is on, and opens its page", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    await renderPage(page.Page);
    await screen.findByText(`Create New ${page.singularName}`);

    fireEvent.change(within(dialog()).getByRole("textbox", { name: "Name" }), {
      target: { value: "Parse nginx" },
    });

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe("Parse nginx");
    // Left out: the server stores its column default, on.
    expect(model["isEnabled"]).toBeUndefined();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledTimes(1);
    });
    expect((navigate.mock.calls[0]![0] as Route).toString()).toBe(page.route);
  });
});

describe("the rules table's pattern type", () => {
  const LOG_PATTERN_PILLS: Record<
    string,
    { label: string; color: typeof Blue500; icon: IconProp; tooltip: string }
  > = {
    email: {
      label: "Email Address",
      color: Blue500,
      icon: IconProp.Email,
      tooltip: "Matches email addresses",
    },
    custom: {
      label: "Custom Regex",
      color: Blue500,
      icon: IconProp.Code,
      tooltip: "Uses a custom regular expression pattern",
    },
  };

  function renderPill(
    patternType: string | undefined,
    customRegex: string | undefined,
    fieldsToScrub: string | undefined = "both",
    trace: boolean = false,
  ): void {
    render(
      <ScrubRulePatternPill
        patternType={patternType}
        customRegex={customRegex}
        fieldsToScrub={fieldsToScrub}
        patternTypes={LOG_PATTERN_PILLS}
        knownPatternTypes={
          trace ? TRACE_SCRUB_PATTERN_TYPES : LOG_SCRUB_PATTERN_TYPES
        }
        knownFieldsToScrub={trace ? TRACE_SCRUB_FIELDS : LOG_SCRUB_FIELDS}
      />,
    );
  }

  test.each([
    ["custom", ""],
    ["custom", undefined],
    ["custom", "([unclosed"],
    ["Email", undefined],
  ])(
    "flags a %s rule with pattern %p as scrubbing nothing",
    (patternType: string, customRegex: string | undefined) => {
      renderPill(patternType, customRegex);

      expect(screen.getByTestId("scrub-rule-scrubs-nothing")).toHaveTextContent(
        "Scrubs nothing",
      );
    },
  );

  test.each([
    ["email", undefined],
    ["custom", "SECRET-[0-9]+"],
  ])(
    "does not flag a %s rule with pattern %p",
    (patternType: string, customRegex: string | undefined) => {
      renderPill(patternType, customRegex);

      expect(screen.queryByTestId("scrub-rule-scrubs-nothing")).toBeNull();
    },
  );

  test("flags a rule whose fields to scrub ingest does not know", () => {
    renderPill("email", undefined, "Body");

    expect(screen.getByTestId("scrub-rule-scrubs-nothing")).toHaveTextContent(
      "Scrubs nothing",
    );
  });

  test("does not flag a sensitive-keys rule's fields, which ingest ignores", () => {
    renderPill("sensitiveKeys", undefined, "Body");

    expect(screen.queryByTestId("scrub-rule-scrubs-nothing")).toBeNull();
  });

  test("reads a trace rule's fields as a trace rule's", () => {
    renderPill("email", undefined, "all", true);

    expect(screen.queryByTestId("scrub-rule-scrubs-nothing")).toBeNull();
  });

  test("draws the pattern type's own pill beside the flag", () => {
    renderPill("custom", "", "all", true);

    expect(screen.getByText("Custom Regex")).toBeInTheDocument();
    expect(screen.getByText("Scrubs nothing")).toBeInTheDocument();
  });
});
