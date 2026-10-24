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
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import {
  RuleLlmProviderFieldHint,
  RuleLlmProviderPicker,
  getRuleLlmProviderFormField,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/RuleLlmProviderField";
import {
  RULE_LLM_PROVIDER_FIELD_COPY,
  RULE_LLM_PROVIDER_HINT_TEST_ID,
  RULE_LLM_PROVIDER_LOADING_TEST_ID,
  RULE_LLM_PROVIDER_PICKER_TEST_ID,
  RULE_LLM_PROVIDER_WARNING_TEST_ID,
  RuleLlmProviderChoices,
  UNREAD_RULE_LLM_PROVIDER_CHOICES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/RuleLlmProviderCopy";
// The AI rule, whose form lists the field (AiRulesTable).
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import API from "../../../UI/Utils/API/API";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * EVERY OneUptime AI RULE'S "LLM PROVIDER" FIELD, RENDERED - an
 * investigation rule's, an auto remediation rule's and a postmortem rule's,
 * first under each one's More fields.
 *
 * The maintainer: "If the provider is not selected, select the project LLM
 * provider by default if one is set to default, or you can select the
 * global LLM provider as well. If one is selected, use that LLM provider to
 * do everything." So:
 *
 *   - the empty box names the provider an empty field uses - "Project
 *     default (Azure GPT-4o)", else "Global provider (OneUptime AI)" - and
 *     never says "(Optional)";
 *   - it lists the project's providers, its default first and tagged, then
 *     the global ones, each with its model, read from POST
 *     /ai-chat/providers - again when the window takes the focus back, so
 *     one added in the LLM Providers tab the line under it opens can be
 *     picked at once;
 *   - a pick is stored by id, and cleared back to the default;
 *   - a pick the reader cannot see is kept, named for what it is; one the
 *     project can no longer use says OneUptime AI uses the default instead;
 *   - with nothing to pick the box is locked, says why, and looks it: a
 *     grey box that does not light up under the pointer.
 */

const PROJECT_ID: string = "dddddddd-0000-4000-8000-000000000001";
const AZURE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OPUS_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ONEUPTIME_AI_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const GONE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";

interface ProviderRow {
  id: string;
  name: string;
  modelName: string | null;
  isDefault: boolean;
  isGlobal: boolean;
}

const AZURE: ProviderRow = {
  id: AZURE_ID,
  name: "Azure GPT-4o",
  modelName: "gpt-4o",
  isDefault: true,
  isGlobal: false,
};

const OPUS: ProviderRow = {
  id: OPUS_ID,
  name: "Claude Opus",
  modelName: "claude-opus-4-5",
  isDefault: false,
  isGlobal: false,
};

const ONEUPTIME_AI: ProviderRow = {
  id: ONEUPTIME_AI_ID,
  name: "OneUptime AI",
  modelName: null,
  isDefault: false,
  isGlobal: true,
};

// What POST /ai-chat/providers answers (AIChatAPI).
function answer(
  providers: Array<ProviderRow>,
  defaultProviderId: string | null,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      isAIEnabledForProject: true,
      defaultProviderId,
      providers: providers.map((provider: ProviderRow): JSONObject => {
        return { ...provider, description: null, llmType: null };
      }),
    } as unknown as JSONObject,
    {},
  );
}

// API.post is generic: spied on, it is typed as jest.spyOn types any spy.
let postSpy: ReturnType<typeof jest.spyOn>;
let changes: Array<string | null> = [];

function answerWith(
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): void {
  postSpy.mockResolvedValue(response as never);
}

// The form holds the rule's pick and hands it back, as the field is used.
function PickerHarness(props: { initialValue: unknown }): ReactElement {
  const [value, setValue] = useState<unknown>(props.initialValue);

  return (
    <RuleLlmProviderPicker
      value={value}
      onChange={(llmProviderId: string | null) => {
        changes.push(llmProviderId);
        setValue(llmProviderId);
      }}
    />
  );
}

async function renderPicker(initialValue: unknown): Promise<void> {
  render(<PickerHarness initialValue={initialValue} />);
  await screen.findByTestId(RULE_LLM_PROVIDER_PICKER_TEST_ID);
}

function picker(): HTMLElement {
  return screen.getByTestId(RULE_LLM_PROVIDER_PICKER_TEST_ID);
}

function searchBox(): HTMLInputElement {
  return within(picker()).getByRole("combobox") as HTMLInputElement;
}

function openMenu(): Array<HTMLElement> {
  fireEvent.focus(searchBox());

  return screen.queryAllByRole("option");
}

function placeholder(): string {
  return searchBox().getAttribute("placeholder") || "";
}

// What the closed box shows as picked, or "" while nothing is.
function shown(): string {
  const value: HTMLElement | null = within(picker()).queryByTestId(
    "entity-dropdown-value",
  );

  return value
    ? (value.querySelector("span.font-medium")?.textContent || "").trim()
    : "";
}

beforeEach(() => {
  changes = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  postSpy = jest.spyOn(API, "post");
  answerWith(answer([AZURE, OPUS, ONEUPTIME_AI], AZURE_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a rule's LLM provider", () => {
  test("waits for the providers at the box's own place and height", async () => {
    let resolve: (value: HTTPResponse<JSONObject>) => void = (): void => {
      return undefined;
    };
    postSpy.mockReturnValue(
      new Promise<HTTPResponse<JSONObject>>(
        (done: (value: HTTPResponse<JSONObject>) => void) => {
          resolve = done;
        },
      ) as never,
    );

    render(<PickerHarness initialValue={undefined} />);

    const loading: HTMLElement = screen.getByTestId(
      RULE_LLM_PROVIDER_LOADING_TEST_ID,
    );
    for (const className of [
      "mt-2",
      "mb-1",
      "h-[38px]",
      "w-full",
      "rounded-lg",
    ]) {
      expect(loading.classList.contains(className)).toBe(true);
    }

    await act(async () => {
      resolve(answer([AZURE, OPUS, ONEUPTIME_AI], AZURE_ID));
    });

    expect(screen.queryByTestId(RULE_LLM_PROVIDER_LOADING_TEST_ID)).toBeNull();
    expect(placeholder()).toBe("Project default (Azure GPT-4o)");
  });

  test("reads them from the chat's providers route", async () => {
    await renderPicker(undefined);

    const call: { url: { toString: () => string }; data: unknown } = postSpy
      .mock.calls[0]![0] as never;

    expect(call.url.toString()).toMatch(/\/ai-chat\/providers$/);
    expect(call.data).toEqual({});
  });

  test("nothing picked names the project's default provider, never Optional", async () => {
    await renderPicker(undefined);

    expect(placeholder()).toBe("Project default (Azure GPT-4o)");
    expect(shown()).toBe("");
    expect(picker()).not.toHaveTextContent("Optional");
  });

  test("with no default of the project's own, it names the global provider", async () => {
    answerWith(answer([OPUS, ONEUPTIME_AI], ONEUPTIME_AI_ID));

    await renderPicker(undefined);

    expect(placeholder()).toBe("Global provider (OneUptime AI)");
  });

  test("lists the project's providers, its default first and tagged, then the global ones, each with its model", async () => {
    await renderPicker(undefined);

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Azure GPT-4o");
    expect(options[0]).toHaveTextContent("Project default · gpt-4o");
    expect(options[1]).toHaveTextContent("Claude Opus");
    expect(options[1]).toHaveTextContent("claude-opus-4-5");
    expect(options[1]).not.toHaveTextContent("Project default");
    expect(options[2]).toHaveTextContent("OneUptime AI");
    expect(options[2]).toHaveTextContent("Global");
  });

  test("picking one stores it by id; clearing it is the default again", async () => {
    await renderPicker(undefined);

    fireEvent.click(openMenu()[1]!);

    expect(changes).toEqual([OPUS_ID]);
    expect(shown()).toBe("Claude Opus");

    fireEvent.click(within(picker()).getByTestId("entity-dropdown-clear"));

    expect(changes).toEqual([OPUS_ID, null]);
    expect(shown()).toBe("");
    expect(placeholder()).toBe("Project default (Azure GPT-4o)");
  });

  test("a rule may pick the global provider while the project has a default", async () => {
    await renderPicker(undefined);

    fireEvent.click(openMenu()[2]!);

    expect(changes).toEqual([ONEUPTIME_AI_ID]);
    expect(shown()).toBe("OneUptime AI");
  });

  test("a saved rule's pick, in every shape the form holds it, is shown picked", async () => {
    for (const value of [
      OPUS_ID.toUpperCase(),
      new ObjectID(OPUS_ID),
      { _id: OPUS_ID },
    ]) {
      await renderPicker(value);

      expect(shown()).toBe("Claude Opus");
      cleanup();
    }
  });

  test("a pick the project can no longer use says so, and is cleared back to the default", async () => {
    await renderPicker(GONE_ID);

    expect(shown()).toBe("No longer available");
    expect(
      screen.getByTestId(RULE_LLM_PROVIDER_WARNING_TEST_ID),
    ).toHaveTextContent(
      "OneUptime AI can no longer use this provider, so it uses the default instead. Pick another one, or clear it.",
    );
    expect(picker()).not.toHaveTextContent(GONE_ID);

    fireEvent.click(within(picker()).getByTestId("entity-dropdown-clear"));

    expect(changes).toEqual([null]);
    expect(screen.queryByTestId(RULE_LLM_PROVIDER_WARNING_TEST_ID)).toBeNull();
  });

  test("a reader who may not read the providers keeps the rule's pick, named as one they cannot see", async () => {
    answerWith(
      new HTTPErrorResponse(
        403,
        {
          message:
            "You do not have permission to read this project's AI providers.",
        },
        {},
      ),
    );

    await renderPicker(OPUS_ID);

    expect(shown()).toBe("A provider you cannot see");
    expect(picker()).not.toHaveTextContent(OPUS_ID);
    expect(screen.queryByTestId(RULE_LLM_PROVIDER_WARNING_TEST_ID)).toBeNull();
  });

  test("with nothing to pick - no provider read, or none at all - the box is locked and says why", async () => {
    answerWith(new HTTPErrorResponse(403, {}, {}));
    await renderPicker(undefined);

    expect(searchBox()).toBeDisabled();
    expect(placeholder()).toBe("Default LLM provider");
    cleanup();

    answerWith(answer([], null));
    await renderPicker(undefined);

    expect(searchBox()).toBeDisabled();
    expect(placeholder()).toBe("No LLM provider yet");

    /*
     * It looks locked: one grey fill, not white with grey beside it (white
     * won in light mode, so a locked box looked like one to click), and no
     * border lighting up under the pointer.
     */
    const box: HTMLElement = within(picker()).getByTestId(
      "entity-dropdown-box",
    );

    expect(box).toHaveClass("bg-gray-100");
    expect(box).not.toHaveClass("bg-white");
    expect(box).not.toHaveClass("hover:border-indigo-300");
    cleanup();

    // A box with something to pick is white, and lights up under the pointer.
    answerWith(answer([AZURE, OPUS], AZURE_ID));
    await renderPicker(undefined);

    const open: HTMLElement = within(picker()).getByTestId(
      "entity-dropdown-box",
    );

    expect(searchBox()).not.toBeDisabled();
    expect(open).toHaveClass("bg-white");
    expect(open).not.toHaveClass("bg-gray-100");
    expect(open).toHaveClass("hover:border-indigo-300");
  });

  test("reads them again when the window takes the focus back: one added in another tab can be picked", async () => {
    await renderPicker(undefined);
    expect(openMenu()).toHaveLength(3);

    answerWith(
      answer(
        [
          AZURE,
          OPUS,
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
            name: "Gemini",
            modelName: "gemini-2.5-pro",
            isDefault: false,
            isGlobal: false,
          },
          ONEUPTIME_AI,
        ],
        AZURE_ID,
      ),
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(postSpy).toHaveBeenCalledTimes(2);
    const options: Array<HTMLElement> = openMenu();
    expect(options).toHaveLength(4);
    expect(options[2]).toHaveTextContent("Gemini");
  });

  test("a read that fails after one that worked keeps what the field has", async () => {
    await renderPicker(OPUS_ID);
    expect(shown()).toBe("Claude Opus");

    answerWith(new HTTPErrorResponse(500, {}, {}));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(postSpy).toHaveBeenCalledTimes(2);
    // Still listed: not "A provider you cannot see".
    expect(shown()).toBe("Claude Opus");
  });

  test("stops reading once the form is closed", async () => {
    await renderPicker(undefined);
    cleanup();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  test("under it: where providers are added, as a link that opens in a new tab", () => {
    render(<RuleLlmProviderFieldHint />);

    const hint: HTMLElement = screen.getByTestId(
      RULE_LLM_PROVIDER_HINT_TEST_ID,
    );

    expect(hint).toHaveTextContent(
      "Add and manage providers on the LLM Providers page.",
    );
    const link: HTMLElement = within(hint).getByTestId(
      "rule-llm-provider-link",
    );
    expect(link).toHaveTextContent("LLM Providers");
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/llm-providers`,
    );
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("the field, as a rule form lists it", () => {
  type Values = FormValues<AutoRemediationRule>;

  const SECTION: FormFieldCollapsibleSection<AutoRemediationRule> =
    getAdvancedFormSection<AutoRemediationRule>({});

  function fieldFor(data: {
    choices: RuleLlmProviderChoices | null;
    showIf?: (values: Values) => boolean;
  }): ModelField<AutoRemediationRule> {
    return getRuleLlmProviderFormField<AutoRemediationRule>({
      stepId: "investigation",
      collapsibleSection: SECTION,
      dataTestId: "rule-llm-provider-field",
      getChoices: (): RuleLlmProviderChoices | null => {
        return data.choices;
      },
      showIf: data.showIf,
    });
  }

  const READ: RuleLlmProviderChoices = {
    isRead: true,
    providers: [
      {
        id: AZURE_ID,
        name: "Azure GPT-4o",
        modelName: "gpt-4o",
        isDefault: true,
        isGlobal: false,
      },
      {
        id: OPUS_ID,
        name: "Claude Opus",
        modelName: "",
        isDefault: false,
        isGlobal: false,
      },
    ],
    defaultProviderId: AZURE_ID,
  };

  /*
   * One line for every kind of rule: the provider does everything the rule
   * starts - an investigation, a fix and its pull requests, a draft.
   */
  test("is the rule's llmProviderId, under its More fields, with the one line every rule has", () => {
    const field: ModelField<AutoRemediationRule> = fieldFor({
      choices: READ,
    });

    expect(field.field).toEqual({ llmProviderId: true });
    expect(field.title).toBe("LLM Provider");
    expect(field.description).toBe(RULE_LLM_PROVIDER_FIELD_COPY.description);
    expect(field.description).toBe(
      "OneUptime AI uses the default LLM provider for everything this rule starts, unless you pick another.",
    );
    expect(field.stepId).toBe("investigation");
    expect(field.collapsibleSection).toBe(SECTION);
    expect(field.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(field.required).toBe(false);
    // Empty is an answer of its own - the default - not "(Optional)".
    expect(field.hideOptionalLabel).toBe(true);
    expect(field.hideColumnDescription).toBe(true);
    expect(field.dataTestId).toBe("rule-llm-provider-field");
    expect(field.showIf).toBeUndefined();
  });

  test("folded, names the provider a rule picks - by the providers as the table last read them", () => {
    let choices: RuleLlmProviderChoices | null = null;
    const field: ModelField<AutoRemediationRule> =
      getRuleLlmProviderFormField<AutoRemediationRule>({
        stepId: "investigation",
        collapsibleSection: SECTION,
        dataTestId: "rule-llm-provider-field",
        getChoices: (): RuleLlmProviderChoices | null => {
          return choices;
        },
      });
    const picked: Values = { llmProviderId: OPUS_ID } as unknown as Values;

    // Before they are read: one the reader cannot see, for now.
    expect(field.getFoldedValue!(picked)).toBe("A provider you cannot see");

    choices = READ;

    expect(field.getFoldedValue!(picked)).toBe("Claude Opus");
    expect(field.getFoldedValue!({} as Values)).toBeNull();

    choices = UNREAD_RULE_LLM_PROVIDER_CHOICES;

    expect(field.getFoldedValue!(picked)).toBe("A provider you cannot see");
  });

  test("hands the form what the picker picks", async () => {
    const field: ModelField<AutoRemediationRule> = fieldFor({
      choices: READ,
    });
    const handed: Array<unknown> = [];
    const props: CustomElementProps = {
      onChange: (value: unknown): void => {
        handed.push(value);
      },
    } as CustomElementProps;

    render(field.getCustomElement!({} as Values, props) as ReactElement);
    await screen.findByTestId(RULE_LLM_PROVIDER_PICKER_TEST_ID);

    fireEvent.click(openMenu()[1]!);

    expect(handed).toEqual([OPUS_ID]);

    render(field.getFooterElement!({} as Values) as ReactElement);
    expect(
      screen.getByTestId(RULE_LLM_PROVIDER_HINT_TEST_ID),
    ).toBeInTheDocument();
  });

  test("shows only where the form says it may", () => {
    const showIf: (values: Values) => boolean = (values: Values): boolean => {
      return (values as { name?: string }).name !== "hidden";
    };
    const field: ModelField<AutoRemediationRule> = fieldFor({
      choices: READ,
      showIf,
    });

    expect(field.showIf).toBe(showIf);
  });
});
