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

import RunbookSecretsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Secrets";
import { GLOBAL_RUNNERS_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import RunbookSecret from "../../../Models/DatabaseModels/RunbookSecret";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * Runbooks -> Secrets, and who may use a secret.
 *
 * A JavaScript step that picks no Runner runs on a global Runner - one
 * OneUptime runs for every project. A secret reaches such a step only when
 * its "Global Runners can use this secret" switch is on (and then only the
 * steps of its own project). The switch is on the Access step, asked only on
 * a server that has global Runners, and starts on when the project uses
 * them, so the default works; with it, a secret may be the global Runners'
 * alone. On a server with none, the Access step is the project's own Runners,
 * required, as it always was.
 */

const WAIT_TIMEOUT: number = 20000;

const ADMIN_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectAdmin,
];

const GLOBAL_TOGGLE: string = "Global Runners can use this secret";
const OWN_RUNNERS_FIELD: string = "Your Runners that can use this secret";

let hasGlobalRunners: boolean = true;
let projectUsesGlobalRunners: boolean = true;
let savedModels: Array<RunbookSecret> = [];
let secretRows: Array<RunbookSecret> = [];

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
        requestOptions?: { overrideRequestUrl?: unknown };
      } = args as {
        modelType: unknown;
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
            _id: "eeeeeeee-0000-4000-8000-000000000002",
            name: "prod-bastion",
          }),
        ];
      } else if (call.modelType === RunbookSecret) {
        data = secretRows;
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
      const model: RunbookSecret = (args as { model: RunbookSecret }).model;
      savedModels.push(model);
      return { data: model } as never;
    });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  hasGlobalRunners = true;
  projectUsesGlobalRunners = true;
  savedModels = [];
  secretRows = [];
  stub();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function openSecretsPage(): void {
  const path: string = `/dashboard/${PROJECT_ID}/runbooks/secrets`;
  goTo(path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <RunbookSecretsPage
        pageRoute={RouteMap[PageMap.RUNBOOKS_SECRETS] as Route}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

// Create Runbook Secret, filled in on its first step, then on to Access.
async function openAccessStep(): Promise<HTMLElement> {
  openSecretsPage();

  const createButtons: Array<HTMLElement> = await screen.findAllByText(
    "Create Runbook Secret",
    {},
    { timeout: WAIT_TIMEOUT },
  );
  fireEvent.click(createButtons[0]!);

  const dialog: HTMLElement = await screen.findByRole(
    "dialog",
    {},
    { timeout: WAIT_TIMEOUT },
  );

  fireEvent.change(
    await within(dialog).findByPlaceholderText(
      "Secret Name",
      {},
      { timeout: WAIT_TIMEOUT },
    ),
    { target: { value: "githubtoken" } },
  );
  fireEvent.change(
    within(dialog).getByPlaceholderText(
      "Secret Value (eg: API Key, Password, etc.)",
    ),
    { target: { value: "ghp_example" } },
  );

  fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

  await within(dialog).findByText(
    OWN_RUNNERS_FIELD,
    {},
    { timeout: WAIT_TIMEOUT },
  );

  return dialog;
}

describe("Runbooks -> Secrets, on a server with global Runners", () => {
  test("the Access step asks whether global Runners can use the secret, on to start, and makes the project's Runners optional", async () => {
    const dialog: HTMLElement = await openAccessStep();

    const toggle: HTMLElement = within(dialog).getByRole("switch", {
      name: GLOBAL_TOGGLE,
    });

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(dialog).toHaveTextContent(
      "Steps of this project that run on a global Runner get this secret. Steps of other projects never do.",
    );
    expect(dialog).toHaveTextContent(
      "The Runners you installed that get this secret.",
    );

    // The switch comes before the project's own Runners.
    const ownField: HTMLElement = within(dialog).getByText(OWN_RUNNERS_FIELD);

    expect(
      toggle.compareDocumentPosition(ownField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a secret can be the global Runners' alone: it saves with no Runner of the project's own", async () => {
    const dialog: HTMLElement = await openAccessStep();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Runbook Secret" }),
    );

    await waitFor(
      () => {
        expect(savedModels).toHaveLength(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(savedModels[0]!.isAvailableToGlobalRunners).toBe(true);
    expect(savedModels[0]!.name).toBe("githubtoken");
  });

  test("on a project that does not use global Runners, the switch starts off", async () => {
    projectUsesGlobalRunners = false;

    const dialog: HTMLElement = await openAccessStep();

    expect(
      within(dialog).getByRole("switch", { name: GLOBAL_TOGGLE }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("the list says which secrets the global Runners can use", async () => {
    secretRows = [
      Object.assign(new RunbookSecret(), {
        _id: "ffffffff-0000-4000-8000-000000000001",
        name: "githubtoken",
        description: "",
        isAvailableToGlobalRunners: true,
        runners: [],
      }),
    ];

    openSecretsPage();

    await screen.findByText("githubtoken", {}, { timeout: WAIT_TIMEOUT });

    expect(
      screen.getByRole("columnheader", { name: /^Global Runners/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", {
        name: new RegExp(`^${OWN_RUNNERS_FIELD}`),
      }),
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent(
      "Passwords, tokens and API keys your runbook scripts use. A secret reaches only the Runners you let use it.",
    );
  });
});

describe("Runbooks -> Secrets, on a server with no global Runner", () => {
  beforeEach(() => {
    hasGlobalRunners = false;
  });

  test("the list has no Global Runners column", async () => {
    secretRows = [
      Object.assign(new RunbookSecret(), {
        _id: "ffffffff-0000-4000-8000-000000000001",
        name: "githubtoken",
        description: "",
        runners: [],
      }),
    ];

    openSecretsPage();

    await screen.findByText("githubtoken", {}, { timeout: WAIT_TIMEOUT });

    expect(
      screen.queryByRole("columnheader", { name: /^Global Runners/ }),
    ).toBeNull();
  });

  test("the Access step is the project's own Runners, required, and no switch", async () => {
    const dialog: HTMLElement = await openAccessStep();

    expect(
      within(dialog).queryByRole("switch", { name: GLOBAL_TOGGLE }),
    ).toBeNull();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Runbook Secret" }),
    );

    // Saving without a Runner is refused on the form.
    await within(dialog).findByText(
      `${OWN_RUNNERS_FIELD} is required.`,
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(savedModels).toEqual([]);
  });
});
