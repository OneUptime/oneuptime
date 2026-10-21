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
 * Issue #5158, from the Dashboard's form to the row: "When creating a new
 * Feed isEnabled is not provided ... Receive isEnabled missing error".
 *
 * A threat intel feed's create form - and a detection rule's - leaves the
 * Enabled switch to the edit form (a new feed is polled, a new rule runs),
 * so what it sends has no isEnabled. The server refused that: the column is
 * required with a declared default, and DatabaseService.checkRequiredFields
 * only lets a create leave such a column out when it is flagged
 * isDefaultValueColumn, which it was not. SecurityMatchFormsFlow already
 * pinned the form's half - isEnabled is not sent - and nothing held the
 * server to it.
 *
 * Here the real create dialog is filled in as a person would, with the
 * page's own fields, steps and starting values; what it hands the API is
 * sent the way ModelAPI sends it and read the way BaseAPI reads it; and the
 * real service creates it - hooks, permissions and required fields - into
 * an in-memory table, as a security admin. The row is inserted without
 * isEnabled, so Postgres writes the column's DEFAULT: on.
 */

jest.setTimeout(60000);

const WAIT: { timeout: number } = { timeout: 20000 };

const mockCreateOrUpdate: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return mockCreateOrUpdate(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
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
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import DetectionRuleService from "../../../Server/Services/DetectionRuleService";
import ThreatIntelFeedService from "../../../Server/Services/ThreatIntelFeedService";
import logger from "../../../Server/Utils/Logger";
import Route from "../../../Types/API/Route";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../Server/TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../Server/TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";

const PROJECT_ID: ObjectID = new ObjectID(
  "5158f0a1-1111-4111-8111-111111111111",
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

function pageProps(): PageComponentProps {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  return {
    pageRoute: new Route("/dashboard/security-events"),
    currentProject: project,
    hasPaymentMethod: true,
  } as unknown as PageComponentProps;
}

// The page's table, as its Create dialog: what ModelTable hands ModelFormModal.
async function openCreate<T extends BaseModel>(
  page: ReactElement,
  modelType: { new (): T },
): Promise<HTMLElement> {
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

async function next(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
  await settle();
}

async function submit(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

  await waitFor(() => {
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
  }, WAIT);
}

/*
 * What the form handed the API, as the API receives it: ModelAPI sends
 * BaseModel.toJSON as JSON, BaseAPI.createItem reads it with
 * BaseModel.fromJSON.
 */
function receivedByTheApi<T extends BaseModel>(modelType: { new (): T }): T {
  const sent: BaseModel = (
    mockCreateOrUpdate.mock.calls[0]![0] as { model: BaseModel }
  ).model;
  const body: JSONObject = JSON.parse(
    JSON.stringify(
      BaseModel.toJSON(sent, modelType as unknown as DatabaseBaseModelType),
    ),
  ) as JSONObject;

  return BaseModel.fromJSON<T>(body, modelType) as T;
}

function securityAdmin(): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.SecurityAdmin,
            labelIds: [],
            isBlockPermission: false,
          } as UserPermission,
        ],
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function inserted(table: InMemoryTable): StoredRow {
  expect(table.inserts).toHaveLength(1);
  return table.inserts[0]!;
}

let feeds: InMemoryTable;
let rules: InMemoryTable;

beforeEach(() => {
  mockTables.length = 0;
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

  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});
  feeds = useInMemoryTable(ThreatIntelFeedService, []);
  rules = useInMemoryTable(DetectionRuleService, []);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a threat intel feed created from the Dashboard (issue #5158)", () => {
  test("is created, and starts polled: the form sends no isEnabled and the row is left to the column's default", async () => {
    const dialog: HTMLElement = await openCreate(
      <ThreatIntelPage {...pageProps()} />,
      ThreatIntelFeed,
    );

    // No Enabled switch on a new feed.
    expect(within(dialog).queryByText("Enabled")).toBeNull();

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
    fireEvent.change(
      within(dialog).getByPlaceholderText("e.g. Corporate MISP"),
      { target: { value: "Corporate MISP" } },
    );
    await settle();

    // TAXII server, then Sign-in (No sign-in), then On Match as it starts.
    await next(dialog);
    await next(dialog);
    await submit(dialog);

    const received: ThreatIntelFeed = receivedByTheApi(ThreatIntelFeed);

    // What the reporter saw: the create carries no isEnabled...
    expect(received.isEnabled).toBeUndefined();

    // ...and is created all the same.
    await ThreatIntelFeedService.create({
      data: received,
      props: securityAdmin(),
    });

    const row: StoredRow = inserted(feeds);

    expect(row["name"]).toBe("Corporate MISP");
    expect(row["apiRootUrl"]).toBe("https://taxii.example.com/api1/");
    expect(Object.prototype.hasOwnProperty.call(row, "isEnabled")).toBe(false);
    expect(
      new ThreatIntelFeed().getTableColumnMetadata("isEnabled").defaultValue,
    ).toBe(true);
  });
});

describe("a detection rule created from the Dashboard (issue #5158's twin)", () => {
  test("is created, and starts running: the form sends no isEnabled and the row is left to the column's default", async () => {
    const dialog: HTMLElement = await openCreate(
      <DetectionRulesPage {...pageProps()} />,
      DetectionRule,
    );

    expect(within(dialog).queryByText("Enabled")).toBeNull();

    fireEvent.change(
      within(dialog).getByRole("textbox", { name: /^Sigma Rule \(YAML\)/ }),
      { target: { value: SIGMA_YAML } },
    );
    await settle();

    await next(dialog);
    await submit(dialog);

    const received: DetectionRule = receivedByTheApi(DetectionRule);

    expect(received.isEnabled).toBeUndefined();

    await DetectionRuleService.create({
      data: received,
      props: securityAdmin(),
    });

    const row: StoredRow = inserted(rules);

    expect(row["name"]).toBe("Failed logon burst");
    expect(row["sigmaRuleYaml"]).toBe(SIGMA_YAML);
    expect(Object.prototype.hasOwnProperty.call(row, "isEnabled")).toBe(false);
    expect(
      new DetectionRule().getTableColumnMetadata("isEnabled").defaultValue,
    ).toBe(true);
  });
});
