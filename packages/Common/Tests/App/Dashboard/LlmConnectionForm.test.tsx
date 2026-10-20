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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import {
  LlmConnectionDefinition,
  getLlmConnectionDefinition,
} from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID } from "./SideMenuHarness";
import LlmConnectionFormModal from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionFormModal";

/*
 * The connection form, drawn for real (BasicFormModal and its steps):
 *
 *   - it opens on Credentials - no step that only reads aloud - with where
 *     the credential comes from said where it is pasted, and the
 *     provider's step-by-step guide one click away;
 *   - the dialog's description says what arrives once it is connected;
 *   - a provider account's form says OneUptime only reads usage and cost;
 *   - a company tool asks who may read its conversations as two answers in
 *     view, owners and admins picked, and says to tell your people;
 *   - an edit asks for what changes: no "Before you start".
 */

const OPENAI_GUIDE: RegExp = /\/telemetry\/ai-provider-accounts#openai$/;

let createSpy: jest.SpyInstance<any, any>;

beforeEach(() => {
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  createSpy = getJestSpyOn(ModelAPI, "create").mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function definitionOf(
  provider: LlmConnectionProvider,
): LlmConnectionDefinition {
  return getLlmConnectionDefinition(provider)!;
}

function modal(): HTMLElement {
  return screen.getByTestId("modal");
}

async function openForm(data: {
  provider: LlmConnectionProvider;
  connection?: LlmObservabilityConnection;
  onSaved?: MockFunction;
}): Promise<void> {
  await act(async () => {
    render(
      <LlmConnectionFormModal
        provider={data.provider}
        connection={data.connection}
        onClose={getJestMockFunction()}
        onSaved={data.onSaved || getJestMockFunction()}
      />,
    );
  });
}

async function stepTitles(): Promise<Array<string>> {
  const progress: HTMLElement = await within(modal()).findByRole(
    "navigation",
    { name: "Progress" },
  );

  return within(progress)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

async function next(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(modal()).getByTestId("modal-footer-next-button"));
  });
}

describe("connecting a provider account", () => {
  test("opens on Credentials: two steps, no step that only reads aloud", async () => {
    await openForm({ provider: LlmConnectionProvider.OpenAI });

    expect(await stepTitles()).toEqual(["Credentials", "Test"]);
    expect(within(modal()).getByText("Connect OpenAI")).toBeInTheDocument();
  });

  test("the description says what arrives; the top of Credentials, where the key comes from", async () => {
    const openAi: LlmConnectionDefinition = definitionOf(
      LlmConnectionProvider.OpenAI,
    );

    await openForm({ provider: LlmConnectionProvider.OpenAI });

    expect(within(modal()).getByTestId("modal-description")).toHaveTextContent(
      openAi.summary,
    );

    const hint: HTMLElement = await within(modal()).findByTestId(
      "llm-connection-credentials-hint",
    );

    expect(hint).toHaveTextContent("Before you start");
    expect(hint).toHaveTextContent(openAi.hint);
    expect(
      within(hint).getByTestId("llm-connection-guide-link"),
    ).toHaveAttribute("target", "_blank");
    expect(
      within(hint)
        .getByTestId("llm-connection-guide-link")
        .getAttribute("href"),
    ).toMatch(OPENAI_GUIDE);
    expect(within(hint).getByTestId("llm-connection-reads-only")).toHaveTextContent(
      "OneUptime only reads usage and cost.",
    );

    // The key is asked for right under it.
    expect(within(modal()).getByPlaceholderText("sk-admin-...")).toBeVisible();
  });

  test("the key is needed before the test", async () => {
    await openForm({ provider: LlmConnectionProvider.OpenAI });
    await stepTitles();

    await next();

    expect(
      within(modal()).queryByTestId("llm-connection-test-panel"),
    ).not.toBeInTheDocument();

    fireEvent.change(within(modal()).getByPlaceholderText("sk-admin-..."), {
      target: { value: "sk-admin-0123456789" },
    });

    await next();

    await waitFor(() => {
      expect(
        within(modal()).getByTestId("llm-connection-test-panel"),
      ).toBeInTheDocument();
    });
    expect(
      within(modal()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Connect");
  });
});

describe("connecting a company AI tool", () => {
  test("Credentials, Privacy, Test - and no word about usage and cost", async () => {
    await openForm({ provider: LlmConnectionProvider.ClaudeEnterprise });

    expect(await stepTitles()).toEqual(["Credentials", "Privacy", "Test"]);

    const hint: HTMLElement = await within(modal()).findByTestId(
      "llm-connection-credentials-hint",
    );

    expect(hint).toHaveTextContent(
      definitionOf(LlmConnectionProvider.ClaudeEnterprise).hint,
    );
    expect(
      within(hint).queryByTestId("llm-connection-reads-only"),
    ).not.toBeInTheDocument();
  });

  test("who may read: two answers in view, owners and admins picked; telling your people", async () => {
    await openForm({ provider: LlmConnectionProvider.ClaudeEnterprise });
    await stepTitles();

    fireEvent.change(within(modal()).getByPlaceholderText("sk-ant-api01-..."), {
      target: { value: "sk-ant-api01-0123456789" },
    });

    await next();

    const readers: HTMLElement = await within(modal()).findByTestId(
      "llm-connection-readers",
    );
    const admins: HTMLElement = within(readers).getByRole("radio", {
      name: "Project owners and admins",
    });
    const everyone: HTMLElement = within(readers).getByRole("radio", {
      name: "Everyone who can read AI calls",
    });

    expect(admins).toBeChecked();
    expect(everyone).not.toBeChecked();
    expect(readers).toHaveTextContent(
      "Everyone else in the project sees none of these conversations, anywhere in OneUptime.",
    );
    expect(readers).toHaveTextContent(
      "Everyone who may read the project's traces.",
    );
    expect(
      within(modal()).getByTestId("llm-tell-your-people"),
    ).toBeInTheDocument();
  });

  test("the answer picked is what is saved", async () => {
    const onSaved: MockFunction = getJestMockFunction();

    await openForm({
      provider: LlmConnectionProvider.ClaudeEnterprise,
      onSaved,
    });
    await stepTitles();

    fireEvent.change(within(modal()).getByPlaceholderText("sk-ant-api01-..."), {
      target: { value: "sk-ant-api01-0123456789" },
    });

    await next();

    fireEvent.click(
      within(await within(modal()).findByTestId("llm-connection-readers"))
        .getByRole("radio", { name: "Everyone who can read AI calls" }),
    );

    await next();

    await act(async () => {
      fireEvent.click(within(modal()).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    const model: LlmObservabilityConnection = createSpy.mock.calls[0]![0]
      .model as LlmObservabilityConnection;

    expect(model.provider).toBe(LlmConnectionProvider.ClaudeEnterprise);
    expect(model.conversationReaders).toBe("everyone");
    expect(model.storeConversationText).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe("editing a connection", () => {
  test("asks for what changes: no 'Before you start', the key left as it is", async () => {
    const connection: LlmObservabilityConnection =
      new LlmObservabilityConnection();
    connection._id = "20000000-0000-4000-8000-000000000001";
    connection.name = "OpenAI production";
    connection.provider = LlmConnectionProvider.OpenAI;
    connection.config = {};

    await openForm({ provider: LlmConnectionProvider.OpenAI, connection });

    expect(await stepTitles()).toEqual(["Credentials", "Test"]);
    expect(
      within(modal()).getByText("Edit OpenAI production"),
    ).toBeInTheDocument();
    expect(
      within(modal()).queryByTestId("llm-connection-credentials-hint"),
    ).not.toBeInTheDocument();
    expect(
      within(modal()).getByPlaceholderText("Unchanged"),
    ).toBeInTheDocument();
  });
});

