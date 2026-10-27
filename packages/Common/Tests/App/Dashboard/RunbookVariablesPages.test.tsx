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
import Clipboard from "../../../UI/Utils/Clipboard";
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
 *   - a row is the variable's name, with its description under it and a
 *     button that copies what a step writes to use it
 *     ({{global.variables.NAME}} or {{local.variables.NAME}}, which the
 *     card says once), a plain value as it is and a secret as "Secret"
 *     only - never its value - and which Runners get it;
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
      const model: RunbookVariable = (args as { model: RunbookVariable }).model;
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

  test("each row's copy button copies what a step writes to use it, and the card says it once", async () => {
    const copied: Array<string> = [];
    jest
      .spyOn(Clipboard, "copyToClipboard")
      .mockImplementation(async (text: string): Promise<boolean> => {
        copied.push(text);
        return true;
      });

    openGlobalPage();

    await screen.findByText("DB_HOST", {}, WAIT);

    // Named after what it copies: in its tooltip and for a screen reader.
    for (const name of ["DB_HOST", "PROD_DB_SSH_KEY", "STATUSPAGE_TOKEN"]) {
      fireEvent.click(
        screen.getByRole("button", {
          name: `Copy {{global.variables.${name}}}`,
        }),
      );
    }

    await waitFor(() => {
      expect(copied).toEqual([
        "{{global.variables.DB_HOST}}",
        "{{global.variables.PROD_DB_SSH_KEY}}",
        "{{global.variables.STATUSPAGE_TOKEN}}",
      ]);
    }, WAIT);

    // The syntax is said once, in the card's description, not on every row.
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Write one in a step as {{global.variables.NAME}}.",
    );
    expect(
      screen.getByTestId("runbook-variables-reference-syntax"),
    ).toHaveTextContent("{{global.variables.NAME}}");
    expect(document.body).not.toHaveTextContent(
      "{{global.variables.PROD_DB_SSH_KEY}}",
    );
  });

  test("a row's description sits under its name: the list has no Description column", async () => {
    openGlobalPage();

    await screen.findByText("DB_HOST", {}, WAIT);

    const descriptions: Array<string> = screen
      .getAllByTestId("runbook-variable-description")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });

    // Only DB_HOST has one; a row without one draws no empty line.
    expect(descriptions).toEqual(["The primary database host."]);
    expect(
      screen.queryByRole("columnheader", { name: /Description/ }),
    ).toBeNull();
    for (const header of ["Name", "Value", "Runners"]) {
      expect(
        screen.getByRole("columnheader", { name: new RegExp(header) }),
      ).toBeInTheDocument();
    }
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
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Values every runbook in this project can use: hosts and URLs, or secrets such as SSH keys, passwords, tokens and kubeconfigs. Write one in a step as {{global.variables.NAME}}.",
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

    // It names the variable it replaces: it covers the row it came from.
    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Replace the value of PROD_DB_SSH_KEY",
    );
    expect(dialog).toHaveTextContent(
      "The new value is encrypted, and the old one is gone for good.",
    );
    // One field, with no second line saying it again.
    expect(dialog).toHaveTextContent("New Value");
    expect(dialog).not.toHaveTextContent(
      "Encrypted. It can never be read back: replace it to change it.",
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

    await within(dialog).findByText(
      `${OWN_RUNNERS_FIELD} is required.`,
      {},
      WAIT,
    );
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

    await within(dialog).findByText(
      `${OWN_RUNNERS_FIELD} is required.`,
      {},
      WAIT,
    );
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

    expect(
      screen.getByRole("button", {
        name: "Copy {{local.variables.NAMESPACE}}",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Values only this runbook's steps can use, beside the project's global variables. Write one in a step as {{local.variables.NAME}}.",
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

/*
 * An empty list tells whoever may add a variable to add one, and whoever may
 * not - a Runbook Admin, who reads variables to pick them in the steps it
 * writes - who adds them. It used to tell both to add one.
 */
describe("an empty list", () => {
  function signInAs(permissions: Array<Permission>): void {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue(permissions);
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

  beforeEach(() => {
    variableRows = [];
  });

  test("Global Variables, to a project admin: add the hosts, keys, passwords and kubeconfigs", async () => {
    openGlobalPage();

    await waitFor(() => {
      // The table heads its empty state with the first sentence.
      expect(screen.getByText("No global variables yet")).toBeInTheDocument();
      expect(document.body).toHaveTextContent(
        "Add the hosts, keys, passwords and kubeconfigs your steps use.",
      );
    }, WAIT);
  });

  /*
   * A Runbook Admin reads variables, to pick them in steps, but may not add
   * one: it is told what they are for, never "Add the hosts...". The locked
   * Create Variable under it already says whom to ask, so the empty state
   * does not say it a second time.
   */
  test("Global Variables, to a Runbook Admin: what they hold, never to add one, and whom to ask said once", async () => {
    signInAs([
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.RunbookAdmin,
    ]);

    openGlobalPage();

    await waitFor(() => {
      // The table heads its empty state with the first sentence.
      expect(screen.getByText("No global variables yet")).toBeInTheDocument();
      expect(document.body).toHaveTextContent(
        "They hold the hosts, keys, passwords and kubeconfigs your steps use.",
      );
    }, WAIT);
    expect(document.body).not.toHaveTextContent(
      "Add the hosts, keys, passwords and kubeconfigs your steps use.",
    );
    expect(document.body).not.toHaveTextContent("A project owner or admin");
  });

  test("a runbook's own Variables, to a project admin: global variables work here too", async () => {
    openRunbookPage();

    await waitFor(() => {
      // The table heads its empty state with the first sentence.
      expect(
        screen.getByText("No variables of this runbook's own yet"),
      ).toBeInTheDocument();
      expect(document.body).toHaveTextContent(
        "Global variables work here too.",
      );
    }, WAIT);
  });

  /*
   * The runbook's own list asks nobody to add one, so a Runbook Admin reads
   * what a project admin reads; the locked Create Variable says whom to ask.
   */
  test("a runbook's own Variables, to a Runbook Admin: global variables work here too, as to anyone", async () => {
    signInAs([
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.RunbookAdmin,
    ]);

    openRunbookPage();

    await waitFor(() => {
      // The table heads its empty state with the first sentence.
      expect(
        screen.getByText("No variables of this runbook's own yet"),
      ).toBeInTheDocument();
      expect(document.body).toHaveTextContent(
        "Global variables work here too.",
      );
    }, WAIT);
    expect(document.body).not.toHaveTextContent("A project owner or admin");
  });

  test("Create Runbook Variable alone may add one, so it is told to", async () => {
    signInAs([
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.CreateRunbookSecret,
      Permission.ReadRunbookSecret,
    ]);

    openGlobalPage();

    await waitFor(() => {
      // The table heads its empty state with the first sentence.
      expect(screen.getByText("No global variables yet")).toBeInTheDocument();
      expect(document.body).toHaveTextContent(
        "Add the hosts, keys, passwords and kubeconfigs your steps use.",
      );
    }, WAIT);
  });
});
