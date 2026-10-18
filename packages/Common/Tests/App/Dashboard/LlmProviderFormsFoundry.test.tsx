import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4476: Microsoft Foundry (Azure AI Foundry) as OneUptime's LLM
 * provider. What the provider forms tell someone setting one up, on the
 * three forms that create or edit a provider: Project Settings > AI > LLM
 * Providers (create), a provider's own page (edit), and the Admin
 * Dashboard's Global LLM Providers.
 *
 * The three draw one form now (Common/UI/Components/AI/
 * LlmProviderFormFields): the provider first, as a card each, then only
 * what that provider needs, with its own help under each field.
 *
 *   - The provider is offered as "Azure OpenAI / Microsoft Foundry", the one
 *     type every Foundry deployment goes through.
 *   - Picked, API Key, Model Name and Base URL say what to paste for
 *     Foundry, and every Base URL the help suggests reaches the endpoint the
 *     docs say it does (LlmProviderEndpoint).
 *   - Base URL holds 100 characters, as the column does, and says so at the
 *     field: a deployment's whole Target URI with its api-version is refused
 *     before the save, while the resource's endpoint is taken.
 *
 * The tables and the detail card are captured instead of drawn: only the
 * fields they are handed are under test. The help under a field is drawn
 * from the field itself, for the provider picked; the Base URL field is
 * then handed to the real BasicForm, to show what a person sees.
 */

const mockTables: Array<Record<string, unknown>> = [];
const mockDetails: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockTables.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockDetails.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode | undefined }): ReactElement => {
      return <main>{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import LlmProvidersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders";
import LlmProviderViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviderView";
import AdminLlmProvidersPage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/LlmProviders/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { JSONObject } from "../../../Types/JSON";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { getLlmProviderFormSteps } from "../../../UI/Components/AI/LlmProviderFormFields";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import BasicForm from "../../../UI/Components/Forms/BasicForm";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Validation from "../../../UI/Components/Forms/Validation";
import Navigation from "../../../UI/Utils/Navigation";
import LlmProviderEndpoint from "../../../Utils/LLM/LlmProviderEndpoint";

const FOUNDRY_LABEL: string = "Azure OpenAI / Microsoft Foundry";

// A Foundry deployment's Target URI, as the portal shows it: 126 characters.
const TARGET_URI: string =
  "https://contoso-ai.cognitiveservices.azure.com/openai/deployments/gpt-4.1-mini/chat/completions?api-version=2025-01-01-preview";

const V1_ENDPOINT: string = "https://contoso-ai.openai.azure.com/openai/v1";

type Field = ModelField<LlmProvider>;

interface ProviderForm {
  name: string;
  form: () => { fields: Array<Field>; steps: Array<FormStep<LlmProvider>> };
}

function fieldOf(fields: Array<Field>, column: keyof LlmProvider): Field {
  const found: Field | undefined = fields.find((field: Field) => {
    return Object.keys(field.field || {})[0] === column;
  });

  if (!found) {
    throw new Error(`The form has no ${String(column)} field.`);
  }

  return found;
}

function columnsOf(fields: Array<Field>): Array<string> {
  return fields.map((field: Field): string => {
    return Object.keys(field.field || {})[0] || "";
  });
}

function tableForm(id: string): {
  fields: Array<Field>;
  steps: Array<FormStep<LlmProvider>>;
} {
  const table: Record<string, unknown> | undefined = mockTables.find(
    (props: Record<string, unknown>) => {
      return props["id"] === id;
    },
  );

  if (!table) {
    throw new Error(`The ${id} table was not drawn.`);
  }

  return {
    fields: table["formFields"] as Array<Field>,
    steps: table["formSteps"] as Array<FormStep<LlmProvider>>,
  };
}

const FORMS: Array<ProviderForm> = [
  {
    name: "Project Settings > AI > LLM Providers (create)",
    form: () => {
      render(<LlmProvidersPage {...({} as unknown as PageComponentProps)} />);

      return tableForm("project-llms-table");
    },
  },
  {
    name: "an LLM provider's page (edit)",
    form: () => {
      render(
        <LlmProviderViewPage {...({} as unknown as PageComponentProps)} />,
      );

      const detail: Record<string, unknown> | undefined =
        mockDetails[mockDetails.length - 1];

      if (!detail) {
        throw new Error("The provider's detail card was not drawn.");
      }

      return {
        fields: detail["formFields"] as Array<Field>,
        steps: detail["formSteps"] as Array<FormStep<LlmProvider>>,
      };
    },
  },
  {
    name: "Admin Dashboard > Settings > Global LLM Providers",
    form: () => {
      render(<AdminLlmProvidersPage />);

      return tableForm("llms-table");
    },
  },
];

// The help a field draws under it, for a provider picked, as text.
function helpUnder(field: Field, values: JSONObject): string {
  const footer: ReactElement | undefined = field.getFooterElement?.(
    values as FormValues<LlmProvider>,
  );

  if (!footer) {
    return "";
  }

  const drawn: ReturnType<typeof render> = render(footer);
  const text: string = (drawn.container.textContent || "").trim();

  drawn.unmount();

  return text;
}

const AZURE: JSONObject = { llmType: LlmType.AzureOpenAI };

beforeEach(() => {
  mockTables.length = 0;
  mockDetails.length = 0;
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID("dddddddd-0000-4000-8000-000000000004"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(FORMS)("$name", (form: ProviderForm) => {
  test("asks which provider first, then how to reach it", () => {
    const { fields, steps } = form.form();

    expect(steps).toEqual(getLlmProviderFormSteps());
    expect(
      steps.map((step: FormStep<LlmProvider>) => {
        return step.title;
      }),
    ).toEqual(["Provider", "Connection"]);
    // The provider alone on the first step, the rest on the second.
    expect(
      fields
        .filter((field: Field) => {
          return field.stepId === "provider";
        })
        .map((field: Field) => {
          return Object.keys(field.field || {})[0];
        }),
    ).toEqual(["llmType"]);
    expect(columnsOf(fields).slice(0, 5)).toEqual([
      "llmType",
      "apiKey",
      "baseUrl",
      "modelName",
      "name",
    ]);
  });

  test("offers every Foundry deployment as Azure OpenAI / Microsoft Foundry, each provider type once", () => {
    const options: Array<CardSelectOption> = fieldOf(
      form.form().fields,
      "llmType",
    ).cardSelectOptions as Array<CardSelectOption>;

    expect(
      options.find((option: CardSelectOption) => {
        return option.value === LlmType.AzureOpenAI;
      })?.title,
    ).toBe(FOUNDRY_LABEL);
    expect(
      options.find((option: CardSelectOption) => {
        return option.value === LlmType.AzureOpenAI;
      })?.description,
    ).toBe(
      "Models you deploy in Azure: OpenAI models, Foundry Models and Claude.",
    );
    expect(
      options
        .map((option: CardSelectOption) => {
          return option.value;
        })
        .sort(),
    ).toEqual([...Object.values(LlmType)].sort());
  });

  test("the API Key asks for one of the resource's keys, as the server's refusal does", () => {
    expect(helpUnder(fieldOf(form.form().fields, "apiKey"), AZURE)).toBe(
      "KEY 1 or KEY 2, from your resource's Keys and Endpoint page.",
    );
  });

  test("the Model Name asks for the deployment's name", () => {
    expect(helpUnder(fieldOf(form.form().fields, "modelName"), AZURE)).toBe(
      "Your deployment's name, exactly as Foundry shows it.",
    );
  });

  test("the Base URL asks for the resource's endpoint, not a deployment URL with an api-version", () => {
    const help: string = helpUnder(
      fieldOf(form.form().fields, "baseUrl"),
      AZURE,
    );

    expect(help).toBe(
      "Your resource's endpoint, such as https://<resource>.openai.azure.com/openai/v1, or https://<resource>.services.ai.azure.com/anthropic for Claude. Never put keys here.",
    );
    expect(help).not.toContain("/openai/deployments/");
    expect(help).not.toContain("api-version");
  });

  test("Azure needs its API Key and Base URL, and not a Model Name", () => {
    const fields: Array<Field> = form.form().fields;
    const azure: FormValues<LlmProvider> = AZURE as FormValues<LlmProvider>;

    for (const column of ["apiKey", "baseUrl"] as Array<keyof LlmProvider>) {
      const required: Field["required"] = fieldOf(fields, column).required;

      expect({
        column,
        required: typeof required === "function" ? required(azure) : required,
      }).toEqual({ column, required: true });
    }

    const modelName: Field["required"] = fieldOf(fields, "modelName").required;

    expect(typeof modelName === "function" ? modelName(azure) : modelName).toBe(
      false,
    );
  });

  test("every Azure endpoint the Base URL help suggests reaches the API it is suggested for", () => {
    const help: string = helpUnder(
      fieldOf(form.form().fields, "baseUrl"),
      AZURE,
    );
    const suggested: Array<string> = (
      help.match(/https:\/\/<resource>[^\s,]+/g) || []
    ).map((url: string) => {
      return url.replace("<resource>", "contoso-ai");
    });

    expect(suggested).toEqual([
      "https://contoso-ai.openai.azure.com/openai/v1",
      "https://contoso-ai.services.ai.azure.com/anthropic",
    ]);

    // The first goes to the v1 API, the second to Claude's Messages API.
    expect(LlmProviderEndpoint.resolveAzureOpenAI(suggested[0]!)).toEqual({
      requestUrl:
        "https://contoso-ai.openai.azure.com/openai/v1/chat/completions",
      usesV1Api: true,
    });
    expect(LlmProviderEndpoint.isAnthropicApiBaseUrl(suggested[1]!)).toBe(true);
    expect(LlmProviderEndpoint.resolveAnthropicMessagesUrl(suggested[1]!)).toBe(
      "https://contoso-ai.services.ai.azure.com/anthropic/v1/messages",
    );
  });

  test("the Base URL holds as many characters as its column", () => {
    const metadata: TableColumnMetadata =
      new LlmProvider().getTableColumnMetadata("baseUrl");
    const baseUrl: Field = fieldOf(form.form().fields, "baseUrl");

    expect(baseUrl.validation?.maxLength).toBe(
      getMaxLengthFromTableColumnType(metadata.type),
    );
    expect(baseUrl.validation?.maxLength).toBe(ColumnLength.ShortURL);
  });

  test("a deployment's whole Target URI is refused at the field, the resource's endpoint is taken", () => {
    const baseUrl: Field = fieldOf(form.form().fields, "baseUrl");

    expect(TARGET_URI.length).toBeGreaterThan(ColumnLength.ShortURL);
    expect(Validation.validateLength(TARGET_URI, baseUrl)).toBe(
      "Base URL cannot be more than 100 characters.",
    );
    expect(Validation.validateLength(V1_ENDPOINT, baseUrl)).toBeNull();
  });
});

describe("the three forms say the same thing about Azure", () => {
  test("their API Key, Model Name and Base URL help match", () => {
    const helps: Array<Record<string, string>> = FORMS.map(
      (form: ProviderForm) => {
        const fields: Array<Field> = form.form().fields;
        cleanup();

        return {
          apiKey: helpUnder(fieldOf(fields, "apiKey"), AZURE),
          modelName: helpUnder(fieldOf(fields, "modelName"), AZURE),
          baseUrl: helpUnder(fieldOf(fields, "baseUrl"), AZURE),
        };
      },
    );

    expect(helps[0]!["baseUrl"]).not.toBe("");
    expect(helps[1]).toEqual(helps[0]);
    expect(helps[2]).toEqual(helps[0]);
  });
});

describe("what a person sees at the Base URL field", () => {
  // The Base URL field alone, on the real form, with Azure picked.
  async function drawBaseUrl(onSubmit: MockFunction): Promise<HTMLElement> {
    const fields: Array<Field> = FORMS[0]!.form().fields;
    cleanup();

    const baseUrl: Field = {
      ...fieldOf(fields, "baseUrl"),
      stepId: undefined,
    };

    render(
      <BasicForm
        id="base-url"
        fields={[baseUrl] as unknown as Fields<JSONObject>}
        initialValues={{ llmType: LlmType.AzureOpenAI }}
        onSubmit={onSubmit}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    return await screen.findByRole("textbox", {
      name: /Base URL/,
    });
  }

  async function submitBaseUrl(value: string): Promise<MockFunction> {
    const onSubmit: MockFunction = getJestMockFunction();
    const input: HTMLElement = await drawBaseUrl(onSubmit);

    await userEvent.setup({ delay: null }).type(input, value);
    await userEvent
      .setup({ delay: null })
      .click(screen.getByRole("button", { name: "Save" }));

    return onSubmit;
  }

  test("a Target URI pasted whole is refused before the save, in words", async () => {
    const onSubmit: MockFunction = await submitBaseUrl(TARGET_URI);

    expect(
      await screen.findByText("Base URL cannot be more than 100 characters."),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("the resource's endpoint is saved", async () => {
    const onSubmit: MockFunction = await submitBaseUrl(V1_ENDPOINT);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByText("Base URL cannot be more than 100 characters."),
    ).not.toBeInTheDocument();
  });

  test("the help under it is Azure's while Azure is picked", async () => {
    await drawBaseUrl(getJestMockFunction());

    expect(
      screen.getByTestId("llm-provider-base-url-hint").textContent,
    ).toContain("https://<resource>.openai.azure.com/openai/v1");
  });
});
