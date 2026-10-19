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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

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

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

import GlobalVariablesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Variables";
import RunbookVariablesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Variables";
import { GLOBAL_RUNNERS_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import RunbookVariable from "../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * RUNBOOK VARIABLES: Runbooks -> Settings -> Global Variables, and a
 * runbook's own Variables page.
 *
 * Runbook secrets and the credentials runbook steps used were merged into
 * variables (the maintainer: "Can we have Runbook Variables instead, just
 * like we have workflow variables? Both global variables and local
 * variables ... merge [secrets] into variables as well"). So:
 *
 *   - a row says what a step writes to use the variable
 *     ({{global.variables.NAME}} or {{local.variables.NAME}}), a plain
 *     value as it is and a secret as "Secret" only - never its value - and
 *     which Runners get it;
 *   - Create starts secret: name, value, then who may use it (global
 *     Runners, and the project's own Runners); turned plain, it is one step
 *     with a readable Value, and asks nobody;
 *   - a secret no Runner may use is refused on the form;
 *   - a secret's value is replaced, never shown: Replace Value;
 *   - a runbook's own variables are read and made with its runbookId.
 *
 * The real pages and table; only the model API is stubbed.
 */

const WAIT: { timeout: number } = { timeout: 20000 };

const RUNBOOK_ID: string = "77777777-0000-4000-8000-0000000000a1";
const RUNNER_ID: string = "eeeeeeee-0000-4000-8000-000000000002";

const ADMIN_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectAdmin,
];

const GLOBAL_TOGGLE: string = "Global Runners can use it";
const OWN_RUNNERS_FIELD: string = "Your Runners that can use it";

let hasGlobalRunners: boolean = true;
let projectUsesGlobalRunners: boolean = true;
let savedModels: Array<RunbookVariable> = [];
let updates: Array<{ id: string; data: Record<string, unknown> }> = [];
let variableRows: Array<RunbookVariable> = [];
let variableQueries: Array<Record<string, unknown>> = [];

function variable(fields: Record<string, unknown>): RunbookVariable {
  return Object.assign(new RunbookVariable(), {
    description: "",
    runners: [],
    isAvailableToGlobalRunners: false,
    ...fields,
  });
}

function stub(): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(ADMIN_PERMISSIONS);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: ADMIN_PERMISSIONS.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
      const call: {
        modelType: unknown;
        query?: Record<string, unknown>;
        requestOptions?: { overrideRequestUrl?: unknown };
      } = args as {
        modelType: unknown;
        query?: Record<string, unknown>;
        requestOptions?: { overrideRequestUrl?: unknown };
      };

      let data: Array<unknown> = [];

      if (
        String(call.requestOptions?.overrideRequestUrl || "").endsWith(
          GLOBAL_RUNNERS_ROUTE,
        )
      ) {
        data = hasGlobalRunners
          ? [
              Object.assign(new Runner(), {
                _id: "eeeeeeee-0000-4000-8000-000000000001",
                name: "global-eu",
                canRunRunbooks: true,
                lastAlive: new Date(),
              }),
            ]
          : [];
      } else if (call.modelType === Runner) {
        data = [
          Object.assign(new Runner(), {
            _id: RUNNER_ID,
            name: "prod-bastion",
          }),
        ];
      } else if (call.modelType === RunbookVariable) {
        variableQueries.push(call.query || {});
        data = variableRows;
      }

      return {
        data: data as Array<never>,
        count: data.length,
        skip: 0,
        limit: 10,
      };
    });

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (args: unknown): Promise<never> => {
      if ((args as { modelType: unknown }).modelType === Project) {
        return Object.assign(new Project(), {
          _id: PROJECT_ID,
          useGlobalRunners: projectUsesGlobalRunners,
        }) as never;
      }

      return null as never;
    });

  jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const model: RunbookVariable = (args as { model: RunbookVariable })
        .model;
      savedModels.push(model);
      return { data: model } as never;
    });

  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const call: { id: ObjectID; data: Record<string, unknown> } = args as {
        id: ObjectID;
        data: Record<string, unknown>;
      };
      updates.push({ id: call.id.toString(), data: call.data });
      return {} as never;
    });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  hasGlobalRunners = true;
  projectUsesGlobalRunners = true;
  savedModels = [];
  updates = [];
  variableRows = [];
  variableQueries = [];
  stub();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function openGlobalPage(): void {
  const path: string = `/dashboard/${PROJECT_ID}/runbooks/settings/variables`;
  goTo(path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalVariablesPage
        pageRoute={RouteMap[PageMap.RUNBOOKS_VARIABLES] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

function openRunbookPage(): void {
  const path: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/variables`;
  goTo(path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <RunbookVariablesPage
        pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_VARIABLES] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function openCreate(): Promise<HTMLElement> {
  const createButtons: Array<HTMLElement> = await screen.findAllByText(
    "Create Variable",
    {},
    WAIT,
  );
  fireEvent.click(createButtons[0]!);

  return screen.findByRole("dialog", {}, WAIT);
}

async function fillSecret(dialog: HTMLElement): Promise<void> {
  fireEvent.change(
    await within(dialog).findByPlaceholderText("PROD_DB_SSH_KEY", {}, WAIT),
    { target: { value: "PROD_TOKEN" } },
  );
  fireEvent.change(
    within(dialog).getByPlaceholderText(
      "A password, a token, a private key or a kubeconfig",
    ),
    { target: { value: "ghp_example_token" } },
  );
}

async function openAccessStep(): Promise<HTMLElement> {
  openGlobalPage();

  const dialog: HTMLElement = await openCreate();
  await fillSecret(dialog);

  fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

  await within(dialog).findByText(OWN_RUNNERS_FIELD, {}, WAIT);

  return dialog;
}

describe("the Global Variables list", () => {
  beforeEach(() => {
    variableRows = [
      variable({
        _id: "ffffffff-0000-4000-8000-000000000001",
        name: "DB_HOST",
        isSecret: false,
        value: "10.0.4.21",
        description: "The primary database host.",
      }),
      variable({
        _id: "ffffffff-0000-4000-8000-000000000002",
        name: "PROD_DB_SSH_KEY",
        isSecret: true,
        runners: [
          Object.assign(new Runner(), { _id: RUNNER_ID, name: "prod-bastion" }),
        ],
      }),
      variable({
        _id: "ffffffff-0000-4000-8000-000000000003",
        name: "STATUSPAGE_TOKEN",
        isSecret: true,
        isAvailableToGlobalRunners: true,
      }),
    ];
  });

  test("reads the project's own variables only: those of no runbook", async () => {
    openGlobalPage();

    await screen.findByText("DB_HOST", {}, WAIT);

    expect(variableQueries.length).toBeGreaterThan(0);
    for (const query of variableQueries) {
      expect(query["runbookId"]).toBeInstanceOf(IsNull);
      expect(String(query["projectId"])).toBe(PROJECT_ID);
    }
  });

  test("each row says what a step writes to use it", async () => {
    openGlobalPage();

    await screen.findByText("DB_HOST", {}, WAIT);

    const references: Array<string> = screen
      .getAllByTestId("runbook-variable-reference")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });

    expect(references).toEqual([
      "{{global.variables.DB_HOST}}",
      "{{global.variables.PROD_DB_SSH_KEY}}",
      "{{global.variables.STATUSPAGE_TOKEN}}",
    ]);
  });

  test("a plain value is shown; a secret only says it is one", async () => {
    openGlobalPage();

    await screen.findByText("DB_HOST", {}, WAIT);

    expect(document.body).toHaveTextContent("10.0.4.21");
    // Two secrets, each a "Secret" pill in the Value column.
    expect(screen.getAllByText("Secret").length).toBeGreaterThanOrEqual(2);
  });

  test("Runners: every Runner for a plain value, the secret's own for a secret", async () => {
    openGlobalPage();

    await screen.findByText("DB_HOST", {}, WAIT);

    expect(screen.getByText("Every Runner")).toBeInTheDocument();
    expect(screen.getByText("prod-bastion")).toBeInTheDocument();
    expect(screen.getByText("Global Runners")).toBeInTheDocument();
  });

  test("the card says what the page holds", async () => {
    openGlobalPage();

    await screen.findByText("DB_HOST", {}, WAIT);

    expect(document.body).toHaveTextContent("Global Variables");
    expect(document.body).toHaveTextContent(
      "Values every runbook in this project can use: hosts and URLs, or secrets such as SSH keys, passwords, tokens and kubeconfigs.",
    );
  });

  test("Replace Value is offered for a secret only, and sends the new value alone", async () => {
    openGlobalPage();

    await screen.findByText("DB_HOST", {}, WAIT);

    // Two secrets, two Replace Value buttons; none for the plain value.
    const replaceButtons: Array<HTMLElement> =
      screen.getAllByText("Replace Value");
    expect(replaceButtons).toHaveLength(2);

    fireEvent.click(replaceButtons[0]!);

    const dialog: HTMLElement = await screen.findByRole("dialog", {}, WAIT);

    expect(dialog).toHaveTextContent(
      "The new value is encrypted, and the old one is gone for good.",
    );

    fireEvent.change(
      within(dialog).getByPlaceholderText(
        "A password, a token, a private key or a kubeconfig",
      ),
      { target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace Value" }),
    );

    await waitFor(() => {
      expect(updates).toHaveLength(1);
    }, WAIT);

    expect(updates[0]!.id).toBe("ffffffff-0000-4000-8000-000000000002");
    expect(updates[0]!.data).toEqual({
      secretValue: "-----BEGIN OPENSSH PRIVATE KEY-----",
    });
  });
});

describe("Create Variable", () => {
  test("starts as a secret, with its Secret Value, and walks to who may use it", async () => {
    const dialog: HTMLElement = await openAccessStep();

    expect(
      within(dialog).getByRole("switch", { name: GLOBAL_TOGGLE }),
    ).toHaveAttribute("aria-checked", "true");
    expect(dialog).toHaveTextContent(
      "Steps of this project that run on a global Runner get this secret. Steps of other projects never do.",
    );
  });

  test("a secret saves its value as Secret Value, never as Value", async () => {
    const dialog: HTMLElement = await openAccessStep();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Variable" }),
    );

    await waitFor(() => {
      expect(savedModels).toHaveLength(1);
    }, WAIT);

    const saved: RunbookVariable = savedModels[0]!;

    expect(saved.name).toBe("PROD_TOKEN");
    expect(saved.isSecret).toBe(true);
    expect(saved.secretValue).toBe("ghp_example_token");
    expect(saved.value).toBeUndefined();
    expect(saved.isAvailableToGlobalRunners).toBe(true);
    // A global variable: no runbook.
    expect(saved.runbookId).toBeUndefined();
  });

  test("turned plain, it is one step with a readable Value and asks nobody", async () => {
    openGlobalPage();

    const dialog: HTMLElement = await openCreate();

    fireEvent.change(
      await within(dialog).findByPlaceholderText("PROD_DB_SSH_KEY", {}, WAIT),
      { target: { value: "DB_HOST" } },
    );

    fireEvent.click(within(dialog).getByRole("switch", { name: "Secret" }));

    const valueField: HTMLElement = await within(dialog).findByPlaceholderText(
      "10.0.4.21",
      {},
      WAIT,
    );
    fireEvent.change(valueField, { target: { value: "10.0.4.22" } });

    // No second step: the dialog creates from here.
    expect(within(dialog).queryByText("Who can use it")).toBeNull();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Variable" }),
    );

    await waitFor(() => {
      expect(savedModels).toHaveLength(1);
    }, WAIT);

    expect(savedModels[0]!.isSecret).toBe(false);
    expect(savedModels[0]!.value).toBe("10.0.4.22");
    expect(savedModels[0]!.secretValue).toBeUndefined();
  });

  test("on a project that does not use global Runners, the switch starts off and a Runner is required", async () => {
    projectUsesGlobalRunners = false;

    const dialog: HTMLElement = await openAccessStep();

    expect(
      within(dialog).getByRole("switch", { name: GLOBAL_TOGGLE }),
    ).toHaveAttribute("aria-checked", "false");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Variable" }),
    );

    await within(dialog).findByText(`${OWN_RUNNERS_FIELD} is required.`, {}, WAIT);
    expect(savedModels).toEqual([]);
  });

  test("on a server with no global Runner, no switch, and a Runner is required", async () => {
    hasGlobalRunners = false;

    const dialog: HTMLElement = await openAccessStep();

    expect(
      within(dialog).queryByRole("switch", { name: GLOBAL_TOGGLE }),
    ).toBeNull();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Variable" }),
    );

    await within(dialog).findByText(`${OWN_RUNNERS_FIELD} is required.`, {}, WAIT);
    expect(savedModels).toEqual([]);
  });

  test("a name with a space is refused on the form, as steps could not name it", async () => {
    openGlobalPage();

    const dialog: HTMLElement = await openCreate();

    fireEvent.change(
      await within(dialog).findByPlaceholderText("PROD_DB_SSH_KEY", {}, WAIT),
      { target: { value: "prod key" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    await within(dialog).findByText("Name should not have spaces.", {}, WAIT);
  });
});

describe("a runbook's own Variables page", () => {
  beforeEach(() => {
    variableRows = [
      variable({
        _id: "ffffffff-0000-4000-8000-000000000010",
        name: "NAMESPACE",
        isSecret: false,
        value: "checkout",
        runbookId: new ObjectID(RUNBOOK_ID),
      }),
    ];
  });

  test("reads the runbook's own variables, and says how a step names one", async () => {
    openRunbookPage();

    await screen.findByText("NAMESPACE", {}, WAIT);

    for (const query of variableQueries) {
      expect(String(query["runbookId"])).toBe(RUNBOOK_ID);
    }

    expect(screen.getByTestId("runbook-variable-reference")).toHaveTextContent(
      "{{local.variables.NAMESPACE}}",
    );
    expect(document.body).toHaveTextContent(
      "Values only this runbook's steps can use, beside the project's global variables.",
    );
  });

  test("a variable made here belongs to the runbook", async () => {
    openRunbookPage();

    const dialog: HTMLElement = await openCreate();

    fireEvent.change(
      await within(dialog).findByPlaceholderText("PROD_DB_SSH_KEY", {}, WAIT),
      { target: { value: "REPLICAS" } },
    );
    fireEvent.click(within(dialog).getByRole("switch", { name: "Secret" }));
    fireEvent.change(
      await within(dialog).findByPlaceholderText("10.0.4.21", {}, WAIT),
      { target: { value: "3" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Variable" }),
    );

    await waitFor(() => {
      expect(savedModels).toHaveLength(1);
    }, WAIT);

    expect(String(savedModels[0]!.runbookId)).toBe(RUNBOOK_ID);
  });
});
