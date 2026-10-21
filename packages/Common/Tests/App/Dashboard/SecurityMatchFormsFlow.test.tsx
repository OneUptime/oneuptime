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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A detection rule and a threat intel feed, created on the real form: the
 * fields, steps and starting values the pages hand their table, drawn by
 * the real ModelFormModal (the table itself is captured, not drawn).
 *
 *   - A rule asks for its Sigma rule first, and is named after its title;
 *     then what a match does - a case, and one choice of alert, incident,
 *     both or neither - which is saved as the rule's two columns.
 *   - A feed asks where its indicators come from - a list of indicators,
 *     a TAXII collection or Google SecOps - then only that source's own
 *     question: a list's address and how sure it is; where the TAXII
 *     server is, then how to sign in to it (one choice that shows only its
 *     own secrets); or which Google SecOps connection reads it. Then what a
 *     match does.
 *   - Neither choice is ever sent: only the columns it writes.
 */

jest.setTimeout(60000);

const WAIT: { timeout: number } = { timeout: 20000 };

const mockCreateOrUpdate: MockFunction = getJestMockFunction();
// What a list read answers: no rows, unless a test hands its dropdown some.
const mockGetList: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return mockCreateOrUpdate(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getItem: async (): Promise<unknown> => {
        return null;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

type TableProps = Record<string, unknown>;

const mockTables: Array<TableProps> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: TableProps): null => {
      mockTables.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import DetectionRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/DetectionRules";
import ThreatIntelPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/ThreatIntel";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const SIGMA_YAML: string = [
  "title: Failed logon burst",
  "detection:",
  "  selection:",
  "    className: Authentication",
  "  condition: selection",
].join("\n");

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// The page's table, as its Create dialog: what ModelTable hands ModelFormModal.
async function openCreate<T extends BaseModel>(
  page: ReactElement,
  modelType: { new (): T },
): Promise<HTMLElement> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  const drawn: ReturnType<typeof render> = render(
    <MemoryRouter>{page}</MemoryRouter>,
  );
  const table: TableProps = mockTables[0]!;

  drawn.unmount();

  const fields: Array<ModelField<T>> = (
    table["formFields"] as Array<ModelField<T>>
  ).filter((field: ModelField<T>): boolean => {
    return !field.doNotShowWhenCreating;
  });

  render(
    <MemoryRouter>
      <ModelFormModal<T>
        modelType={modelType}
        title="Create"
        submitButtonText="Create"
        // As ModelTable hands a Create dialog its createInitialValues.
        initialValues={table["createInitialValues"] as never}
        formProps={{
          name: "security-form",
          id: "security-form",
          modelType: modelType,
          fields: fields,
          steps: table["formSteps"] as Array<FormStep<T>>,
          formType: FormType.Create,
        }}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  }, WAIT);
  await settle();

  return screen.getByTestId("modal");
}

function pageProps(): PageComponentProps {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  return {
    pageRoute: new Route("/dashboard/security-events"),
    currentProject: project,
    hasPaymentMethod: true,
  } as unknown as PageComponentProps;
}

async function next(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
  await settle();
}

function radio(dialog: HTMLElement, title: string): HTMLElement {
  return within(dialog).getByRole("radio", { name: new RegExp(`^${title}`) });
}

function savedModel(): Record<string, unknown> {
  expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);

  return (mockCreateOrUpdate.mock.calls[0]![0] as { model: unknown })
    .model as Record<string, unknown>;
}

beforeEach(() => {
  mockTables.length = 0;
  mockGetList.mockReset();
  mockGetList.mockImplementation(async (): Promise<unknown> => {
    return { data: [], count: 0, skip: 0, limit: 10 };
  });
  mockCreateOrUpdate.mockReset();
  mockCreateOrUpdate.mockImplementation(
    async (request: unknown): Promise<unknown> => {
      return { data: (request as { model: unknown }).model };
    },
  );
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  // Every field is offered: who may write which column is not under test.
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("creating a detection rule", () => {
  test("the Sigma rule names the rule; On Match saves the choice as its two columns", async () => {
    const dialog: HTMLElement = await openCreate(
      <DetectionRulesPage {...pageProps()} />,
      DetectionRule,
    );

    // No Enabled switch on a new rule: it runs.
    expect(within(dialog).queryByText("Enabled")).toBeNull();

    const yaml: HTMLElement = within(dialog).getByRole("textbox", {
      name: /^Sigma Rule \(YAML\)/,
    });

    fireEvent.change(yaml, { target: { value: SIGMA_YAML } });
    await settle();

    expect(
      within(dialog).getByPlaceholderText("e.g. Failed logon burst"),
    ).toHaveValue("Failed logon burst");

    await next(dialog);

    await waitFor(() => {
      expect(radio(dialog, "Create an alert")).toBeChecked();
    }, WAIT);
    expect(within(dialog).getByText("Alert Severity")).toBeVisible();
    expect(within(dialog).queryByText("Incident Severity")).toBeNull();

    fireEvent.click(radio(dialog, "Neither"));
    await settle();

    expect(radio(dialog, "Neither")).toBeChecked();
    expect(within(dialog).queryByText("Alert Severity")).toBeNull();

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    }, WAIT);

    const saved: Record<string, unknown> = savedModel();

    expect(saved["name"]).toBe("Failed logon burst");
    expect(saved["sigmaRuleYaml"]).toBe(SIGMA_YAML);
    // Not asked of a new rule: the column's default, on, is what is stored.
    expect(saved["isEnabled"]).toBeUndefined();
    expect(
      new DetectionRule().getTableColumnMetadata("isEnabled").defaultValue,
    ).toBe(true);
    expect(saved["shouldCreateCase"]).toBe(true);
    expect(saved["shouldCreateAlert"]).toBe(false);
    expect(saved["shouldCreateIncident"]).toBe(false);
    expect(saved["shouldWriteDetectionFinding"]).toBe(true);
    expect(saved["evaluationIntervalInMinutes"]).toBe(5);
    expect(saved["matchCountThreshold"]).toBe(1);
    // The choice drives the form; it is not a column.
    expect(saved["securityMatchRaises"]).toBeUndefined();
  });
});

describe("creating a threat intel feed", () => {
  test("a TAXII collection: where the server is, then Sign-in shows only the chosen secret; On Match saves Both as both columns", async () => {
    const dialog: HTMLElement = await openCreate(
      <ThreatIntelPage {...pageProps()} />,
      ThreatIntelFeed,
    );

    // A list of indicators is the first answer; this feed reads a collection.
    expect(radio(dialog, "List of indicators")).toBeChecked();
    fireEvent.click(radio(dialog, "TAXII collection"));
    fireEvent.change(
      within(dialog).getByPlaceholderText("e.g. Corporate MISP"),
      {
        target: { value: "Corporate MISP" },
      },
    );
    await settle();

    await next(dialog);

    fireEvent.change(
      within(dialog).getByPlaceholderText("https://taxii.example.com/api1/"),
      { target: { value: "https://taxii.example.com/api1/" } },
    );
    fireEvent.change(
      within(dialog).getByPlaceholderText(
        "e.g. 91a7b528-80eb-42ed-a74d-c6fbd5a26116",
      ),
      { target: { value: "91a7b528-80eb-42ed-a74d-c6fbd5a26116" } },
    );
    await settle();

    await next(dialog);

    await waitFor(() => {
      expect(radio(dialog, "No sign-in")).toBeChecked();
    }, WAIT);
    // No secret is asked of a public collection.
    expect(within(dialog).queryByText("API Token")).toBeNull();
    expect(within(dialog).queryByText("Basic Auth Password")).toBeNull();

    fireEvent.click(radio(dialog, "Bearer token"));
    await settle();

    expect(within(dialog).getByText("API Token")).toBeVisible();
    expect(within(dialog).queryByText("Basic Auth Password")).toBeNull();

    // The token is required now: Next stops on the step until it is given.
    await next(dialog);
    expect(within(dialog).getByText("API Token")).toBeVisible();

    const token: HTMLElement = dialog.querySelector(
      'input[type="password"]',
    ) as HTMLElement;

    fireEvent.change(token, { target: { value: "taxii-secret" } });
    await settle();
    await next(dialog);

    await waitFor(() => {
      expect(radio(dialog, "Create an alert")).toBeChecked();
    }, WAIT);

    fireEvent.click(radio(dialog, "Both"));
    await settle();

    expect(within(dialog).getByText("Alert Severity")).toBeVisible();
    expect(within(dialog).getByText("Incident Severity")).toBeVisible();

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    }, WAIT);

    const saved: Record<string, unknown> = savedModel();

    expect(saved["name"]).toBe("Corporate MISP");
    expect(saved["feedType"]).toBe("taxii");
    expect(saved["apiRootUrl"]).toBe("https://taxii.example.com/api1/");
    // A password field's value, as ModelForm hands it to the API.
    expect(JSON.stringify(saved["apiToken"])).toContain("taxii-secret");
    expect(saved["basicAuthPassword"]).toBeUndefined();
    expect(saved["listUrl"]).toBeUndefined();
    expect(saved["isEnabled"]).toBeUndefined();
    expect(
      new ThreatIntelFeed().getTableColumnMetadata("isEnabled").defaultValue,
    ).toBe(true);
    expect(saved["shouldCreateAlert"]).toBe(true);
    expect(saved["shouldCreateIncident"]).toBe(true);
    expect(saved["taxiiSignIn"]).toBeUndefined();
    expect(saved["securityMatchRaises"]).toBeUndefined();
  });

  test("a list of indicators: its address and how sure it is, and never a sign-in", async () => {
    const dialog: HTMLElement = await openCreate(
      <ThreatIntelPage {...pageProps()} />,
      ThreatIntelFeed,
    );

    fireEvent.change(
      within(dialog).getByPlaceholderText("e.g. Corporate MISP"),
      {
        target: { value: "Our blocklist" },
      },
    );
    await settle();

    await next(dialog);

    // The List step: no TAXII field, no connection.
    expect(
      within(dialog).queryByPlaceholderText("https://taxii.example.com/api1/"),
    ).toBeNull();

    // Its address is required: Next stops on the step until it is given.
    await next(dialog);
    expect(
      within(dialog).getByPlaceholderText(
        "https://lists.example.com/blocklist.txt",
      ),
    ).toBeVisible();

    fireEvent.change(
      within(dialog).getByPlaceholderText(
        "https://lists.example.com/blocklist.txt",
      ),
      { target: { value: "https://lists.example.com/blocklist.txt" } },
    );
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. 70"), {
      target: { value: "70" },
    });
    await settle();

    await next(dialog);

    // Straight to On Match: a list signs in to nothing.
    await waitFor(() => {
      expect(radio(dialog, "Create an alert")).toBeChecked();
    }, WAIT);
    expect(within(dialog).queryByText("No sign-in")).toBeNull();

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    }, WAIT);

    const saved: Record<string, unknown> = savedModel();

    expect(saved["name"]).toBe("Our blocklist");
    expect(saved["feedType"]).toBe("list");
    expect(saved["listUrl"]).toBe("https://lists.example.com/blocklist.txt");
    expect(saved["indicatorConfidence"]).toBe(70);
    expect(saved["apiRootUrl"]).toBeUndefined();
    expect(saved["collectionId"]).toBeUndefined();
    expect(saved["apiToken"]).toBeUndefined();
    expect(saved["taxiiSignIn"]).toBeUndefined();
  });

  test("Google SecOps: one of the project's Google SecOps connections", async () => {
    const connectionId: string = "44444444-4444-4444-8444-444444444444";

    mockGetList.mockImplementation(
      async (...args: Array<unknown>): Promise<unknown> => {
        const request: { modelType: { new (): BaseModel }; query?: unknown } =
          args[0] as { modelType: { new (): BaseModel }; query?: unknown };

        if (new request.modelType().tableName === "SecurityEventConnection") {
          return {
            data: [{ _id: connectionId, name: "Google SecOps (prod)" }],
            count: 1,
            skip: 0,
            limit: 10,
          };
        }

        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    );

    const dialog: HTMLElement = await openCreate(
      <ThreatIntelPage {...pageProps()} />,
      ThreatIntelFeed,
    );

    fireEvent.click(radio(dialog, "Google SecOps"));
    fireEvent.change(
      within(dialog).getByPlaceholderText("e.g. Corporate MISP"),
      {
        target: { value: "Google SecOps IOCs" },
      },
    );
    await settle();

    await next(dialog);

    expect(within(dialog).getByText("Connect Google SecOps")).toBeVisible();

    // Only Google SecOps connections were asked for.
    const asked: Array<unknown> = mockGetList.mock.calls
      .map((call: Array<unknown>): unknown => {
        return call[0];
      })
      .filter((request: unknown): boolean => {
        return (
          new (request as { modelType: { new (): BaseModel } }).modelType()
            .tableName === "SecurityEventConnection"
        );
      });

    expect(asked.length).toBeGreaterThan(0);
    expect(
      (asked[0] as { query: Record<string, unknown> }).query,
    ).toMatchObject({ provider: "google-secops" });

    // The search box opens its menu when it takes focus.
    fireEvent.focus(
      within(dialog).getByRole("combobox", {
        name: /Google SecOps Connection/,
      }),
    );
    await settle();
    fireEvent.click(
      within(screen.getByTestId("entity-dropdown-menu")).getByRole("option", {
        name: "Google SecOps (prod)",
      }),
    );
    await settle();

    await next(dialog);

    await waitFor(() => {
      expect(radio(dialog, "Create an alert")).toBeChecked();
    }, WAIT);

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    }, WAIT);

    const saved: Record<string, unknown> = savedModel();

    expect(saved["feedType"]).toBe("google-secops");
    expect(JSON.stringify(saved["securityEventConnection"])).toContain(
      connectionId,
    );
    expect(saved["listUrl"]).toBeUndefined();
    expect(saved["apiRootUrl"]).toBeUndefined();
  });
});
