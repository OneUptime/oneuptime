import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";

/*
 * A run that did not finish because its AI provider took too long sends
 * its reader to the provider's page to raise its Response Timeout (issue
 * #6438). The page said nothing of it: the timeout was only in the edit
 * form, under More fields, so a provider left at its default showed no
 * timeout at all. It is a row of the provider's details now, after Base
 * URL: the seconds set, or - left empty - the default the server waits,
 * "120 (default)" (300 for Ollama), in the reader's language and digits.
 *
 * The detail card is captured instead of drawn: only the row it is handed
 * is under test, drawn through its own getElement.
 */

const mockDetails: Array<Record<string, unknown>> = [];

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

import LlmProviderViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviderView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { getLlmProviderShownResponseTimeout } from "../../../UI/Components/AI/LlmProviderFormCopy";
import Navigation from "../../../UI/Utils/Navigation";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  getLlmProviderDefaultResponseTimeoutInSeconds,
  LLM_PROVIDER_DEFAULT_RESPONSE_TIMEOUT_IN_SECONDS,
  OLLAMA_DEFAULT_RESPONSE_TIMEOUT_IN_SECONDS,
} from "../../../Utils/LLM/LlmProviderResponseTimeout";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

interface DetailField {
  field?: Record<string, boolean> | undefined;
  title?: string | undefined;
  getElement?: ((item: LlmProvider) => ReactElement) | undefined;
}

function detailFields(): Array<DetailField> {
  render(<LlmProviderViewPage {...({} as unknown as PageComponentProps)} />);

  const detail: Record<string, unknown> | undefined =
    mockDetails[mockDetails.length - 1];

  if (!detail) {
    throw new Error("The provider's detail card was not drawn.");
  }

  return (detail["modelDetailProps"] as { fields: Array<DetailField> }).fields;
}

function columnOf(field: DetailField): string {
  return Object.keys(field.field || {})[0] || "";
}

// The row's words for a provider, as the card draws them.
function shownFor(provider: Partial<LlmProvider>): string {
  const row: DetailField | undefined = detailFields().find(
    (field: DetailField) => {
      return columnOf(field) === "requestTimeoutInSeconds";
    },
  );

  if (!row?.getElement) {
    throw new Error("The provider's page has no Response Timeout row.");
  }

  const item: LlmProvider = Object.assign(new LlmProvider(), provider);
  const drawn: ReturnType<typeof render> = render(row.getElement(item));
  const text: string = (drawn.container.textContent || "").trim();

  drawn.unmount();

  return text;
}

beforeEach(() => {
  mockDetails.length = 0;
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID("dddddddd-0000-4000-8000-000000000004"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a provider's page says how long it waits for an answer", () => {
  test("a row of its details, right after the address it is reached at", () => {
    const fields: Array<DetailField> = detailFields();
    const columns: Array<string> = fields.map(columnOf);
    const row: DetailField =
      fields[columns.indexOf("requestTimeoutInSeconds")]!;

    expect(row.title).toBe("Response Timeout (Seconds)");
    expect(columns.indexOf("requestTimeoutInSeconds")).toBe(
      columns.indexOf("baseUrl") + 1,
    );
  });

  test("the seconds set, as set", () => {
    expect(
      shownFor({
        llmType: LlmType.OpenAICompatible,
        requestTimeoutInSeconds: 600,
      }),
    ).toBe("600");
    expect(
      shownFor({ llmType: LlmType.Ollama, requestTimeoutInSeconds: 1200 }),
    ).toBe("1,200");
  });

  test.each(
    Object.values(LlmType).filter((type: LlmType) => {
      return type !== LlmType.Ollama;
    }),
  )("%s left empty: the 120 seconds the server waits", (type: LlmType) => {
    expect(shownFor({ llmType: type })).toBe("120 (default)");
  });

  test("Ollama left empty: the 300 seconds the server waits for it", () => {
    expect(shownFor({ llmType: LlmType.Ollama })).toBe("300 (default)");
  });

  test("no number that makes sense is left empty too", () => {
    for (const requestTimeoutInSeconds of [0, -30]) {
      expect(
        shownFor({ llmType: LlmType.OpenAI, requestTimeoutInSeconds }),
      ).toBe("120 (default)");
    }
  });
});

describe("getLlmProviderShownResponseTimeout", () => {
  test("in the reader's language and digits", () => {
    expect(
      getLlmProviderShownResponseTimeout({
        requestTimeoutInSeconds: undefined,
        llmType: LlmType.OpenAI,
        translator: dashboardTranslator("de"),
      }),
    ).toBe("120 (Standard)");

    const persian: string = getLlmProviderShownResponseTimeout({
      requestTimeoutInSeconds: undefined,
      llmType: LlmType.Ollama,
      translator: dashboardTranslator("fa"),
    });
    expect(persian).toBe(
      `${new Intl.NumberFormat("fa").format(300)} (پیش‌فرض)`,
    );
    expect(persian).not.toContain("300");
  });

  test("a type this build does not know, or none, gets the common default", () => {
    for (const llmType of [undefined, null, "", "NotAProvider", 3]) {
      expect(
        getLlmProviderShownResponseTimeout({
          requestTimeoutInSeconds: null,
          llmType,
          translator: getGlobalTranslator(),
        }),
      ).toBe("120 (default)");
    }
  });
});

describe("getLlmProviderDefaultResponseTimeoutInSeconds", () => {
  test.each(Object.values(LlmType))("%s", (type: LlmType) => {
    expect(getLlmProviderDefaultResponseTimeoutInSeconds(type)).toBe(
      type === LlmType.Ollama ? 300 : 120,
    );
  });

  test("no type: the common default", () => {
    expect(getLlmProviderDefaultResponseTimeoutInSeconds(null)).toBe(
      LLM_PROVIDER_DEFAULT_RESPONSE_TIMEOUT_IN_SECONDS,
    );
    expect(getLlmProviderDefaultResponseTimeoutInSeconds(undefined)).toBe(
      LLM_PROVIDER_DEFAULT_RESPONSE_TIMEOUT_IN_SECONDS,
    );
    expect(OLLAMA_DEFAULT_RESPONSE_TIMEOUT_IN_SECONDS).toBe(300);
  });
});
