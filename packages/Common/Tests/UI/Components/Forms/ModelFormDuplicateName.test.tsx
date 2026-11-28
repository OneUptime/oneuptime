import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A MODEL FORM'S NAME FIELD WARNS OF A NAME ANOTHER RECORD HAS, AND SAYS
 * THE SERVER'S REFUSAL OF ONE UNDER IT (#10761).
 *
 * ModelForm does it for every kind with a name of its own in a project, so
 * no page writes a line for it. Drawn here with a probe's real create and
 * edit forms (ModelFormModal), the network stubbed: the warning as a name
 * is typed, an edit's own name, the record left out of the question, the
 * server's refusal said under the field (and in the reader's language), a
 * form outside a project, and a kind whose names repeat.
 */

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: (): { permissions: Array<UserPermission> } => {
        return {
          permissions: OWNER_PERMISSIONS.map(
            (permission: Permission): UserPermission => {
              return {
                permission,
                labelIds: [],
                _type: "UserPermission",
              } as UserPermission;
            },
          ),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
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

import ModelFormModal from "../../../../UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "../../../../UI/Components/Forms/ModelForm";
import { DUPLICATE_NAME_NOTICE_TEST_ID } from "../../../../UI/Components/Forms/DuplicateNameNotice";
import FieldError from "../../../../UI/Components/Forms/Fields/FieldError";
import RecordPageContext from "../../../../UI/Components/RecordPage/RecordPageContext";
import ProjectUtil from "../../../../UI/Utils/Project";
import UniqueNamesApi from "../../../../UI/Utils/UniqueNamesApi";
import Probe from "../../../../Models/DatabaseModels/Probe";
import TableView from "../../../../Models/DatabaseModels/TableView";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import Route from "../../../../Types/API/Route";
import { UniqueNameCheckAnswer } from "../../../../Types/Database/RequiredUniqueNames";
import {
  getRequiredUniqueNameTakenRefusal,
  REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL,
} from "../../../../Types/Database/UniqueName";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import { getJestSpyOn } from "../../../Spy";

const WAIT: { timeout: number } = { timeout: 10000 };

const PROJECT_ID: string = "eeeeeeee-0000-4000-8000-000000010761";
const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111110761");
const OTHER_PROBE_ID: string = "22222222-2222-4222-8222-222222210761";

const OTHER_PROBE_PAGE: string = `/dashboard/${PROJECT_ID}/settings/probes/${OTHER_PROBE_ID}`;

const TAKEN: UniqueNameCheckAnswer = {
  isRequired: true,
  takenBy: { id: OTHER_PROBE_ID, name: "WBHQ", isArchived: false },
  isTakenByUnreadable: false,
};

let checkMock: jest.SpyInstance<any, any>;

function storedProbe(): Probe {
  const probe: Probe = new Probe();
  probe.id = PROBE_ID;
  probe.name = "Frankfurt";
  probe.description = "Stored description";
  return probe;
}

function renderProbeForm(options: {
  formType: FormType;
  modelIdToEdit?: ObjectID;
}): void {
  render(
    <RecordPageContext.Provider
      value={{
        getRoute: (data: {
          tableName: string;
          modelId: ObjectID;
        }): Route | null => {
          return data.tableName === "Probe"
            ? new Route(
                `/dashboard/${PROJECT_ID}/settings/probes/${data.modelId.toString()}`,
              )
            : null;
        },
      }}
    >
      <ModelFormModal<Probe>
        title="Probe"
        submitButtonText="Save Probe"
        modelType={Probe}
        modelIdToEdit={options.modelIdToEdit}
        onClose={() => {}}
        onSuccess={() => {}}
        formProps={{
          id: "probe-name-form",
          name: "Probe name",
          modelType: Probe,
          formType: options.formType,
          fields: [
            {
              field: { name: true },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              dataTestId: "probe-name",
            },
            {
              field: { description: true },
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: false,
            },
          ],
        }}
      />
    </RecordPageContext.Provider>,
  );
}

async function typeName(value: string): Promise<void> {
  fireEvent.change(await screen.findByTestId("probe-name", {}, WAIT), {
    target: { value: value },
  });
}

async function waitAWhile(ms: number = 700): Promise<void> {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, ms);
    });
  });
}

function readText(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<Probe> => {
    return storedProbe();
  });
  createOrUpdateMock.mockResolvedValue({ data: {} });

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  checkMock = getJestSpyOn(UniqueNamesApi, "check").mockResolvedValue({
    isRequired: false,
    takenBy: null,
    isTakenByUnreadable: false,
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a probe's create form", () => {
  test("warns as the name field takes another probe's name, with a link to it", async () => {
    checkMock.mockResolvedValue(TAKEN);

    renderProbeForm({ formType: FormType.Create });

    await typeName("wbhq");

    const notice: HTMLElement = await screen.findByTestId(
      DUPLICATE_NAME_NOTICE_TEST_ID,
      {},
      WAIT,
    );

    expect(readText(notice)).toBe(
      "Another probe is already called WBHQ. Pick another name: names are unique in this project.",
    );
    expect(screen.getByTestId("duplicate-name-notice-link")).toHaveAttribute(
      "href",
      OTHER_PROBE_PAGE,
    );
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(checkMock.mock.calls[0]![0]).toEqual({
      tableName: "Probe",
      name: "wbhq",
      exceptId: null,
    });
  });

  test("the warning never blocks: the form still sends, and the server decides", async () => {
    checkMock.mockResolvedValue({ ...TAKEN, isRequired: false });

    renderProbeForm({ formType: FormType.Create });

    await typeName("WBHQ");
    await screen.findByTestId(DUPLICATE_NAME_NOTICE_TEST_ID, {}, WAIT);

    fireEvent.click(screen.getByText("Save Probe"));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    }, WAIT);
  });

  test("the server's refusal of a taken name is said under the name field, in place of the warning", async () => {
    checkMock.mockResolvedValue(TAKEN);

    const refusal: string = getRequiredUniqueNameTakenRefusal({
      kindLabel: "Probe",
      name: "WBHQ",
      isArchived: false,
    });

    createOrUpdateMock.mockRejectedValue(
      new HTTPErrorResponse(400, { message: refusal }, {}),
    );

    renderProbeForm({ formType: FormType.Create });

    await typeName("WBHQ");
    await screen.findByTestId(DUPLICATE_NAME_NOTICE_TEST_ID, {}, WAIT);

    fireEvent.click(screen.getByText("Save Probe"));

    const input: HTMLElement = screen.getByTestId("probe-name");

    await waitFor(() => {
      expect(input).toHaveAttribute("aria-invalid", "true");
    }, WAIT);

    expect(refusal).toBe(
      "Another probe in this project is already called WBHQ, and the project requires unique names. Pick another name.",
    );
    expect(input).toHaveAccessibleDescription(refusal);
    // Said once: under the field, not above the form as well.
    expect(screen.getAllByText(refusal)).toHaveLength(1);
    // One message under the field: the warning is put away.
    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();
  });
});

describe("a probe's edit form", () => {
  test("its own name, in any case, is no rename: nothing is asked", async () => {
    checkMock.mockResolvedValue(TAKEN);

    renderProbeForm({ formType: FormType.Update, modelIdToEdit: PROBE_ID });

    expect(
      await screen.findByDisplayValue("Frankfurt", {}, WAIT),
    ).toBeInTheDocument();
    await waitAWhile();

    await typeName("  FRANKFURT ");
    await waitAWhile();

    expect(checkMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();
  });

  test("a rename asks about the new name, leaving the probe itself out", async () => {
    checkMock.mockResolvedValue(TAKEN);

    renderProbeForm({ formType: FormType.Update, modelIdToEdit: PROBE_ID });

    await screen.findByDisplayValue("Frankfurt", {}, WAIT);

    await typeName("WBHQ");

    await screen.findByTestId(DUPLICATE_NAME_NOTICE_TEST_ID, {}, WAIT);

    const asked: { tableName: string; name: string; exceptId: ObjectID } =
      checkMock.mock.calls[0]![0] as {
        tableName: string;
        name: string;
        exceptId: ObjectID;
      };

    expect(asked.tableName).toBe("Probe");
    expect(asked.name).toBe("WBHQ");
    expect(asked.exceptId.toString()).toBe(PROBE_ID.toString());
  });
});

describe("forms that ask nothing", () => {
  test("outside a project - the Admin Dashboard's forms - nothing is asked", async () => {
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
    checkMock.mockResolvedValue(TAKEN);

    renderProbeForm({ formType: FormType.Create });

    await typeName("WBHQ");
    await waitAWhile();

    expect(checkMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();
  });

  test("a kind whose names repeat - a table's saved view - asks nothing", async () => {
    checkMock.mockResolvedValue(TAKEN);

    render(
      <ModelFormModal<TableView>
        title="Save View"
        submitButtonText="Save View"
        modelType={TableView}
        onClose={() => {}}
        onSuccess={() => {}}
        formProps={{
          id: "table-view-form",
          name: "Table view",
          modelType: TableView,
          formType: FormType.Create,
          fields: [
            {
              field: { name: true },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              dataTestId: "view-name",
            },
          ],
        }}
      />,
    );

    fireEvent.change(await screen.findByTestId("view-name", {}, WAIT), {
      target: { value: "Errors" },
    });
    await waitAWhile();

    expect(checkMock).not.toHaveBeenCalled();
  });
});

describe("the refusal under a field, in the reader's language", () => {
  const DE: Record<string, string> = readDashboardLocale("de");
  const AR: Record<string, string> = readDashboardLocale("ar");

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        de: { translation: DE },
        ar: { translation: AR },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });
  });

  const REFUSAL: string = getRequiredUniqueNameTakenRefusal({
    kindLabel: "Monitor Group",
    name: "Edge Routers",
    isArchived: false,
  });

  test("English: the server's words as they came", async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });

    render(<FieldError message={REFUSAL} />);

    expect(readText(screen.getByRole("alert"))).toBe(
      "Another monitor group in this project is already called Edge Routers, and the project requires unique names. Pick another name.",
    );
  });

  test("German: read back and said in German, with the kind in German and the name as written", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    render(<FieldError message={REFUSAL} />);

    const expected: string = DE[
      REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL.template
    ]!.replace("{{kind}}", DE["Monitor Group"]!).replace(
      "{{name}}",
      "Edge Routers",
    );

    expect(DE[REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL.template]).not.toBe(
      REQUIRED_UNIQUE_NAME_TAKEN_REFUSAL.template,
    );
    expect(readText(screen.getByRole("alert"))).toBe(expected);
  });

  test("Arabic: read back and said in Arabic, the Latin name kept as written", async () => {
    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    render(<FieldError message={REFUSAL} />);

    const text: string = readText(screen.getByRole("alert"));

    expect(text).toContain("Edge Routers");
    expect(text).toContain(AR["Monitor Group"]!);
    expect(text).not.toContain("already called");
  });
});
