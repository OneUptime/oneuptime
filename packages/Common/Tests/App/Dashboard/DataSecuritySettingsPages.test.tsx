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
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityDataTypes, {
  BUILT_IN_DATA_TYPES_TEST_ID,
  CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID,
  CustomDataTypeTestPanel,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/DataTypes";
import DataSecurityChecks, {
  DATA_SECURITY_CHECKS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/Checks";
import DataSecurityResidency, {
  RESIDENCY_EXAMPLES_TEST_ID,
  getResidencyRegionsError,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/Residency";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityCheckSetting from "../../../Models/DatabaseModels/DataSecurityCheckSetting";
import DataSecuritySetting from "../../../Models/DatabaseModels/DataSecuritySetting";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { DATA_SECURITY_CHECKS } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataCategory, {
  ALL_DATA_CATEGORIES,
} from "../../../Types/DataSecurity/DataCategory";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../Types/DataSecurity/DataTypeCatalog";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

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

/*
 * Data Security > Settings > Data Types, Checks and Residency
 * (Pages/DataSecurity/Settings), rendered for real with only the network and
 * the permission snapshot stubbed:
 *
 *   - Data Types lists every built-in type by category, folded, each
 *     category saying how many of its types are on; a search opens every
 *     category with a match; a switch saves the project's list of types
 *     turned off, and locks for someone who may not change it;
 *   - Test It runs what the form holds on pasted text and lists what it
 *     finds, masked, or why the pattern cannot be used;
 *   - Checks lists every check by group with its severity for each level of
 *     sensitivity; a check that runs as it ships has no row, and a change
 *     makes, changes or removes one;
 *   - Residency lists the rules with two worked examples, and holds regions
 *     to what the server takes.
 */

configure({ asyncUtilTimeout: 15000 });

const SETTING_ID: string = "7a7a7a7a-0000-4000-8000-000000000007";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: true,
};

const OWNER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.ProjectOwner,
];

const VIEWER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.SecurityViewer,
];

// May change a check's row, not delete one.
const MEMBER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.SecurityMember,
];

let disabledDataTypeIds: Array<string> = [];
let checkRows: Array<DataSecurityCheckSetting> = [];
let updates: Array<{ modelType: unknown; id: string; data: JSONObject }> = [];
let creates: Array<BaseModel> = [];
let deletes: Array<{ modelType: unknown; id: string }> = [];

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

function checkRow(
  checkId: string,
  values: { isEnabled: boolean; severityOverride?: string },
): DataSecurityCheckSetting {
  const row: DataSecurityCheckSetting = new DataSecurityCheckSetting();

  row._id = `8b8b8b8b-0000-4000-8000-${String(checkRows.length + 1).padStart(12, "0")}`;
  row.checkId = checkId;
  row.isEnabled = values.isEnabled;

  if (values.severityOverride) {
    (row as unknown as Record<string, unknown>)["severityOverride"] =
      values.severityOverride;
  }

  return row;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  PermissionGate.clearPermissionPropsCache();
  grant(OWNER);
  disabledDataTypeIds = [];
  checkRows = [];
  updates = [];
  creates = [];
  deletes = [];

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (data: unknown): Promise<ListResult<BaseModel>> => {
        const modelType: { new (): BaseModel } = (
          data as { modelType: { new (): BaseModel } }
        ).modelType;

        if (modelType === DataSecuritySetting) {
          const setting: DataSecuritySetting = new DataSecuritySetting();
          setting._id = SETTING_ID;
          setting.projectId = new ObjectID(PROJECT_ID);
          setting.disabledDataTypeIds = [...disabledDataTypeIds];

          return { data: [setting], count: 1, skip: 0, limit: 1 };
        }

        if (modelType === DataSecurityCheckSetting) {
          return {
            data: [...checkRows],
            count: checkRows.length,
            skip: 0,
            limit: 50,
          };
        }

        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    );

  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (): Promise<number> => {
      return 0;
    });

  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const update: { modelType: unknown; id: ObjectID; data: JSONObject } =
        data as { modelType: unknown; id: ObjectID; data: JSONObject };

      updates.push({
        modelType: update.modelType,
        id: update.id.toString(),
        data: update.data,
      });

      return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
    });

  jest
    .spyOn(ModelAPI, "create")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const model: BaseModel = (data as { model: BaseModel }).model;

      creates.push(model);

      return new HTTPResponse<JSONObject>(
        200,
        { _id: "9c9c9c9c-0000-4000-8000-000000000009" },
        {},
      ) as unknown as never;
    });

  jest
    .spyOn(ModelAPI, "deleteItem")
    .mockImplementation(async (data: unknown): Promise<void> => {
      const item: { modelType: unknown; id: ObjectID } = data as {
        modelType: unknown;
        id: ObjectID;
      };

      deletes.push({ modelType: item.modelType, id: item.id.toString() });
    });

  jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
  jest.spyOn(API, "get").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 6; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function renderPage(path: string, element: ReactElement): Promise<void> {
  goTo(`/dashboard/${PROJECT_ID}/data-security/settings/${path}`);

  render(
    <MemoryRouter
      initialEntries={[
        `/dashboard/${PROJECT_ID}/data-security/settings/${path}`,
      ]}
    >
      {element}
    </MemoryRouter>,
  );

  await settle();
}

function categoryId(category: DataCategory): string {
  return `data-types-${category.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}

function categoryHeader(category: DataCategory): HTMLElement {
  return screen.getByTestId(`${categoryId(category)}-header`);
}

function typesOf(category: DataCategory): Array<DataTypeInfo> {
  return DATA_TYPE_CATALOG.filter((info: DataTypeInfo): boolean => {
    return info.category === category;
  });
}

describe("Data Types: the built-in data types", () => {
  test("every category is listed, folded, saying how many of its types are on", async () => {
    disabledDataTypeIds = ["email-address"];

    await renderPage("data-types", <DataSecurityDataTypes {...PAGE_PROPS} />);

    await screen.findByTestId(`${categoryId(ALL_DATA_CATEGORIES[0]!)}-header`);

    for (const category of ALL_DATA_CATEGORIES) {
      const header: HTMLElement = categoryHeader(category);
      const total: number = typesOf(category).length;
      const on: number =
        category === DataCategory.ContactAndIdentity ? total - 1 : total;

      expect(header).toHaveAttribute("aria-expanded", "false");
      expect(header).toHaveTextContent(`${on} of ${total} on`);
    }

    // Folded: no type is drawn until its category is opened.
    expect(screen.queryByTestId("data-type-email-address")).toBeNull();
    expect(DATA_TYPE_CATALOG.length).toBeGreaterThanOrEqual(143);
  });

  test("opened, a category lists each of its types with its switch and sensitivity", async () => {
    disabledDataTypeIds = ["email-address"];

    await renderPage("data-types", <DataSecurityDataTypes {...PAGE_PROPS} />);

    const header: HTMLElement = await screen.findByTestId(
      `${categoryId(DataCategory.ContactAndIdentity)}-header`,
    );

    await act(async () => {
      fireEvent.click(header);
    });

    expect(header).toHaveAttribute("aria-expanded", "true");

    for (const info of typesOf(DataCategory.ContactAndIdentity)) {
      const row: HTMLElement = screen.getByTestId(`data-type-${info.id}`);

      expect(row).toHaveTextContent(info.name);
      expect(row).toHaveTextContent(info.sensitivity);
      expect(screen.getByTestId(`data-type-${info.id}-switch`)).toHaveAttribute(
        "aria-checked",
        info.id === "email-address" ? "false" : "true",
      );
    }
  });

  test("a search opens every category with a match, and only its matches", async () => {
    await renderPage("data-types", <DataSecurityDataTypes {...PAGE_PROPS} />);

    const search: HTMLElement = await screen.findByTestId(
      `${BUILT_IN_DATA_TYPES_TEST_ID}-search`,
    );

    await act(async () => {
      fireEvent.change(search, { target: { value: "aadhaar" } });
    });
    await settle();

    const matches: Array<DataTypeInfo> = DATA_TYPE_CATALOG.filter(
      (info: DataTypeInfo): boolean => {
        return [info.id, info.name, info.description]
          .join(" ")
          .toLowerCase()
          .includes("aadhaar");
      },
    );

    expect(matches.length).toBeGreaterThan(0);

    for (const info of matches) {
      expect(screen.getByTestId(`data-type-${info.id}`)).toBeInTheDocument();
    }

    expect(screen.queryByTestId("data-type-email-address")).toBeNull();
    expect(categoryHeader(DataCategory.GovernmentId)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.queryByTestId(`${categoryId(DataCategory.Financial)}-header`),
    ).toBeNull();

    await act(async () => {
      fireEvent.change(search, { target: { value: "no such type anywhere" } });
    });
    await settle();

    expect(
      screen.getByTestId(`${BUILT_IN_DATA_TYPES_TEST_ID}-no-match`),
    ).toHaveTextContent("No built-in data type matches no such type anywhere.");
  });

  test("a switch saves the project's list of types turned off, and back on", async () => {
    await renderPage("data-types", <DataSecurityDataTypes {...PAGE_PROPS} />);

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId(
          `${categoryId(DataCategory.ContactAndIdentity)}-header`,
        ),
      );
    });

    const emailSwitch: HTMLElement = screen.getByTestId(
      "data-type-email-address-switch",
    );

    await act(async () => {
      fireEvent.click(emailSwitch);
    });
    await settle();

    expect(updates).toEqual([
      {
        modelType: DataSecuritySetting,
        id: SETTING_ID,
        data: { disabledDataTypeIds: ["email-address"] },
      },
    ]);
    expect(emailSwitch).toHaveAttribute("aria-checked", "false");
    expect(categoryHeader(DataCategory.ContactAndIdentity)).toHaveTextContent(
      `${typesOf(DataCategory.ContactAndIdentity).length - 1} of`,
    );

    await act(async () => {
      fireEvent.click(emailSwitch);
    });
    await settle();

    expect(updates[1]?.data).toEqual({ disabledDataTypeIds: [] });
    expect(emailSwitch).toHaveAttribute("aria-checked", "true");
  });

  test("someone who may not change the settings sees the switches locked", async () => {
    grant(VIEWER);
    PermissionGate.clearPermissionPropsCache();

    await renderPage("data-types", <DataSecurityDataTypes {...PAGE_PROPS} />);

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId(
          `${categoryId(DataCategory.ContactAndIdentity)}-header`,
        ),
      );
    });

    const emailSwitch: HTMLElement = screen.getByTestId(
      "data-type-email-address-switch",
    );

    expect(emailSwitch).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(emailSwitch);
    });
    await settle();

    expect(updates).toEqual([]);
  });
});

describe("Data Types: Test It", () => {
  async function renderPanel(values: Record<string, unknown>): Promise<void> {
    render(<CustomDataTypeTestPanel values={values} />);
    await settle();
  }

  function paste(text: string): void {
    fireEvent.change(
      screen.getByTestId(`${CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID}-input`),
      { target: { value: text } },
    );
  }

  test("lists what the pattern finds in pasted text, every value masked", async () => {
    await renderPanel({ pattern: "EMP-\\d{6}", keywords: ["employee"] });

    expect(
      screen.getByTestId(CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID),
    ).toHaveTextContent("Paste some text above");

    await act(async () => {
      paste("employee EMP-123456 and EMP-654321");
    });
    await settle();

    expect(
      screen.getByTestId(`${CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID}-summary`),
    ).toHaveTextContent("Found 2 values.");

    const matches: HTMLElement = screen.getByTestId(
      `${CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID}-matches`,
    );

    expect(matches).toHaveTextContent("***-**3456");
    expect(matches).toHaveTextContent("***-**4321");
    expect(matches).not.toHaveTextContent("EMP-123456");
    expect(matches).toHaveTextContent("Medium");
  });

  test("a pattern that cannot be used says why, in place of what it finds", async () => {
    await renderPanel({ pattern: "(a)\\1" });

    await act(async () => {
      paste("aa");
    });
    await settle();

    expect(
      screen.getByTestId(`${CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID}-problem`),
    ).toHaveTextContent("refers back to what an earlier group matched");
  });

  test("text the type does not find says so", async () => {
    await renderPanel({ pattern: "EMP-\\d{6}" });

    await act(async () => {
      paste("nothing to see here");
    });
    await settle();

    expect(
      screen.getByTestId(`${CUSTOM_DATA_TYPE_TEST_PANEL_TEST_ID}-summary`),
    ).toHaveTextContent("Nothing in this text is this data type.");
  });
});

describe("Checks", () => {
  function row(checkId: string): HTMLElement {
    return screen.getByTestId(`data-security-check-${checkId}`);
  }

  function toggle(checkId: string): HTMLElement {
    return screen.getByTestId(`data-security-check-${checkId}-switch`);
  }

  test("every check is listed, by group, with its severity for each sensitivity", async () => {
    await renderPage("checks", <DataSecurityChecks {...PAGE_PROPS} />);

    const page: HTMLElement = await screen.findByTestId(
      DATA_SECURITY_CHECKS_TEST_ID,
    );

    expect(DATA_SECURITY_CHECKS.length).toBeGreaterThanOrEqual(32);

    for (const check of DATA_SECURITY_CHECKS) {
      expect(page).toContainElement(row(check.id));
      expect(toggle(check.id)).toHaveAttribute("aria-checked", "true");

      const severities: HTMLElement = screen.getByTestId(
        `data-security-check-${check.id}-severities`,
      );

      expect(severities).toHaveTextContent("Restricted");
      expect(severities).toHaveTextContent("Public");
    }

    // A public bucket of nothing sensitive is only Low.
    expect(
      screen.getByTestId("data-security-check-public-read-severities"),
    ).toHaveTextContent(
      "RestrictedCriticalConfidentialCriticalInternalHighPublicLow",
    );

    for (const title of [
      "Exposure",
      "Encryption",
      "Recovery",
      "Visibility",
      "Access",
      "Data hygiene",
      "Telemetry",
      "Residency",
      "AI",
    ]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
  });

  test("turning a check off makes its row; turning it back on removes it", async () => {
    await renderPage("checks", <DataSecurityChecks {...PAGE_PROPS} />);
    await screen.findByTestId(DATA_SECURITY_CHECKS_TEST_ID);

    await act(async () => {
      fireEvent.click(toggle("public-read"));
    });
    await settle();

    expect(creates).toHaveLength(1);

    const created: DataSecurityCheckSetting =
      creates[0] as DataSecurityCheckSetting;

    expect(created.checkId).toBe("public-read");
    expect(created.isEnabled).toBe(false);
    expect(created.projectId?.toString()).toBe(PROJECT_ID);
    expect(toggle("public-read")).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      fireEvent.click(toggle("public-read"));
    });
    await settle();

    expect(deletes).toEqual([
      {
        modelType: DataSecurityCheckSetting,
        id: "9c9c9c9c-0000-4000-8000-000000000009",
      },
    ]);
    expect(toggle("public-read")).toHaveAttribute("aria-checked", "true");
  });

  test("a check that is off reads as off, and someone who may not delete puts it back as shipped", async () => {
    checkRows = [checkRow("no-backups", { isEnabled: false })];
    grant(MEMBER);
    PermissionGate.clearPermissionPropsCache();

    await renderPage("checks", <DataSecurityChecks {...PAGE_PROPS} />);
    await screen.findByTestId(DATA_SECURITY_CHECKS_TEST_ID);

    expect(toggle("no-backups")).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      fireEvent.click(toggle("no-backups"));
    });
    await settle();

    expect(deletes).toEqual([]);
    expect(updates).toEqual([
      {
        modelType: DataSecurityCheckSetting,
        id: checkRows[0]!._id,
        data: { isEnabled: true, severityOverride: null },
      },
    ]);
  });

  test("a severity of the project's own is every failure's, whatever the sensitivity", async () => {
    const user: UserEvent = userEvent.setup();

    await renderPage("checks", <DataSecurityChecks {...PAGE_PROPS} />);
    await screen.findByTestId(DATA_SECURITY_CHECKS_TEST_ID);

    await user.click(
      screen.getByRole("combobox", {
        name: "Severity of Anyone on the internet can read it",
      }),
    );

    const options: Array<HTMLElement> = await screen.findAllByText("Medium", {
      exact: true,
    });

    await user.click(options[options.length - 1]!);
    await settle();

    expect(creates).toHaveLength(1);
    expect((creates[0] as DataSecurityCheckSetting).severityOverride).toBe(
      "Medium",
    );
    expect((creates[0] as DataSecurityCheckSetting).isEnabled).toBe(true);

    await waitFor(() => {
      expect(
        screen.getByTestId("data-security-check-public-read-severities"),
      ).toHaveTextContent(
        "RestrictedMediumConfidentialMediumInternalMediumPublicMedium",
      );
    });
  });

  test("someone who may only read the checks sees every control locked", async () => {
    grant(VIEWER);
    PermissionGate.clearPermissionPropsCache();

    await renderPage("checks", <DataSecurityChecks {...PAGE_PROPS} />);
    await screen.findByTestId(DATA_SECURITY_CHECKS_TEST_ID);

    expect(toggle("public-read")).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByTestId(`${DATA_SECURITY_CHECKS_TEST_ID}-locked`),
    ).toHaveTextContent("You do not have permission to create this");
  });
});

describe("Residency", () => {
  test("lists the rules, with two worked examples under them", async () => {
    await renderPage("residency", <DataSecurityResidency {...PAGE_PROPS} />);

    const examples: HTMLElement = await screen.findByTestId(
      RESIDENCY_EXAMPLES_TEST_ID,
    );

    expect(examples).toHaveTextContent("EU personal data stays in the EU");
    expect(examples).toHaveTextContent("Indian health data stays in India");
    expect(within(examples).getByText("eu-*")).toBeInTheDocument();
    expect(within(examples).getByText("westeurope")).toBeInTheDocument();
    // The table, with its way to add a rule (in its header and its empty state).
    expect(
      screen.getAllByRole("button", { name: "Create Residency Rule" }).length,
    ).toBeGreaterThan(0);
  });

  test("regions are held to what the server takes", () => {
    expect(getResidencyRegionsError([])).toBe(
      "Name at least one region the data may live in.",
    );
    expect(
      getResidencyRegionsError(["eu-*", "Europe-West4", "westeurope"]),
    ).toBe(null);
    expect(getResidencyRegionsError(["eu west"])).toBe(
      "eu west is not a region. Write regions as your cloud names them, such as eu-west-1, europe-west4 or westeurope; * matches any characters.",
    );

    const tooMany: Array<string> = [];

    for (let index: number = 0; index < 101; index++) {
      tooMany.push(`region-${index}`);
    }

    expect(getResidencyRegionsError(tooMany)).toBe(
      "A rule names at most 100 regions.",
    );
  });
});
