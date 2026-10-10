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
 *   - The provider is offered as "Azure OpenAI / Microsoft Foundry", the one
 *     type every Foundry deployment goes through.
 *   - API Key, Model Name and Base URL say what to paste for Foundry, and
 *     every Base URL the help suggests reaches the endpoint the docs say it
 *     does (LlmProviderEndpoint).
 *   - Base URL holds 100 characters, as the column does, and says so at the
 *     field: a deployment's whole Target URI with its api-version is refused
 *     before the save, while the resource's endpoint is taken.
 *
 * The tables and the detail card are captured instead of drawn: only the
 * fields they are handed are under test. The Base URL field is then handed
 * to the real BasicForm, to show what a person sees.
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
import BasicForm from "../../../UI/Components/Forms/BasicForm";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import Validation from "../../../UI/Components/Forms/Validation";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
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
  fields: () => Array<Field>;
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

function tableFields(id: string): Array<Field> {
  const table: Record<string, unknown> | undefined = mockTables.find(
    (props: Record<string, unknown>) => {
      return props["id"] === id;
    },
  );

  if (!table) {
    throw new Error(`The ${id} table was not drawn.`);
  }

  return table["formFields"] as Array<Field>;
}

const FORMS: Array<ProviderForm> = [
  {
    name: "Project Settings > AI > LLM Providers (create)",
    fields: (): Array<Field> => {
      render(<LlmProvidersPage {...({} as unknown as PageComponentProps)} />);

      return tableFields("project-llms-table");
    },
  },
  {
    name: "an LLM provider's page (edit)",
    fields: (): Array<Field> => {
      render(
        <LlmProviderViewPage {...({} as unknown as PageComponentProps)} />,
      );

      const detail: Record<string, unknown> | undefined =
        mockDetails[mockDetails.length - 1];

      if (!detail) {
        throw new Error("The provider's detail card was not drawn.");
      }

      return detail["formFields"] as Array<Field>;
    },
  },
  {
    name: "Admin Dashboard > Settings > Global LLM Providers",
    fields: (): Array<Field> => {
      render(<AdminLlmProvidersPage />);

      return tableFields("llms-table");
    },
  },
];

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
  test("offers every Foundry deployment as Azure OpenAI / Microsoft Foundry, each provider type once", () => {
    const options: Array<DropdownOption> = fieldOf(form.fields(), "llmType")
      .dropdownOptions as Array<DropdownOption>;

    expect(
      options.find((option: DropdownOption) => {
        return option.value === LlmType.AzureOpenAI;
      })?.label,
    ).toBe(FOUNDRY_LABEL);
    expect(
      options
        .map((option: DropdownOption) => {
          return option.value;
        })
        .sort(),
    ).toEqual([...Object.values(LlmType)].sort());
  });

  test("the API Key asks for one of the resource's keys", () => {
    expect(fieldOf(form.fields(), "apiKey").description).toContain(
      `${FOUNDRY_LABEL} (one of your resource's keys)`,
    );
  });

  test("the Model Name asks for the deployment's name", () => {
    expect(fieldOf(form.fields(), "modelName").description).toContain(
      `your deployment's name for ${FOUNDRY_LABEL}`,
    );
  });

  test("the Base URL asks for the resource's endpoint, not a deployment URL with an api-version", () => {
    const description: string =
      (fieldOf(form.fields(), "baseUrl").description as string) || "";

    expect(description).toContain(
      `For ${FOUNDRY_LABEL} use your resource's endpoint, e.g. https://<resource>.openai.azure.com/openai/v1, or https://<resource>.services.ai.azure.com/anthropic for Claude.`,
    );
    expect(description).not.toContain("/openai/deployments/");
    expect(description).not.toContain("api-version");
  });

  test("every Azure endpoint the Base URL help suggests reaches the API it is suggested for", () => {
    const description: string =
      (fieldOf(form.fields(), "baseUrl").description as string) || "";
    const suggested: Array<string> = (
      description.match(/https:\/\/<resource>[^\s,]+/g) || []
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

    expect(fieldOf(form.fields(), "baseUrl").validation?.maxLength).toBe(
      getMaxLengthFromTableColumnType(metadata.type),
    );
    expect(fieldOf(form.fields(), "baseUrl").validation?.maxLength).toBe(
      ColumnLength.ShortURL,
    );
  });

  test("a deployment's whole Target URI is refused at the field, the resource's endpoint is taken", () => {
    const baseUrl: Field = fieldOf(form.fields(), "baseUrl");

    expect(TARGET_URI.length).toBeGreaterThan(ColumnLength.ShortURL);
    expect(Validation.validateLength(TARGET_URI, baseUrl)).toBe(
      "Base URL cannot be more than 100 characters.",
    );
    expect(Validation.validateLength(V1_ENDPOINT, baseUrl)).toBeNull();
  });
});

describe("the three forms say the same thing about Azure", () => {
  test("their API Key, Model Name and the Azure sentence of the Base URL help match", () => {
    const helps: Array<Record<string, string>> = FORMS.map(
      (form: ProviderForm) => {
        const fields: Array<Field> = form.fields();
        cleanup();

        const baseUrl: string =
          (fieldOf(fields, "baseUrl").description as string) || "";
        const start: number = baseUrl.indexOf(`For ${FOUNDRY_LABEL}`);
        const end: number = baseUrl.indexOf("for Claude.");

        return {
          apiKey: (fieldOf(fields, "apiKey").description as string) || "",
          modelName: (fieldOf(fields, "modelName").description as string) || "",
          azure:
            start === -1 || end === -1
              ? ""
              : baseUrl.slice(start, end + "for Claude.".length),
        };
      },
    );

    expect(helps[0]!["azure"]).not.toBe("");
    expect(helps[1]).toEqual(helps[0]);
    expect(helps[2]).toEqual(helps[0]);
  });
});

describe("what a person sees at the Base URL field", () => {
  async function submitBaseUrl(value: string): Promise<MockFunction> {
    const fields: Array<Field> = FORMS[0]!.fields();
    cleanup();

    const baseUrl: Field = {
      ...fieldOf(fields, "baseUrl"),
      stepId: undefined,
    };
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        id="base-url"
        fields={[baseUrl] as unknown as Fields<JSONObject>}
        initialValues={{}}
        onSubmit={onSubmit}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    const input: HTMLElement = await screen.findByRole("textbox", {
      name: /Base URL/,
    });

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
});
