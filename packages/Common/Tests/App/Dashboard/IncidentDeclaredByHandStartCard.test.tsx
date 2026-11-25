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
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import fs from "fs";
import path from "path";
import IncidentDeclaredByHandStartCard from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentDeclaredByHandStartCard";
import {
  DECLARED_BY_HAND_START_SWITCH_TEST_ID,
  INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentDeclaredByHandStartCopy";
import {
  getProjectColumnsPermissionMessage,
  getProjectColumnsUpdatePermissions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectColumnEditGate";
import {
  getPageSearchAreas,
  PageSearchArea,
  PageSearchPage,
  PageSearchSection,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "../../../Models/DatabaseModels/Project";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { START_INCIDENTS_DECLARED_BY_HAND_ACKNOWLEDGED_COLUMN } from "../../../Types/Incident/IncidentDeclaredByHandStart";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
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
 * "Incidents Declared by Hand", under the list of states on Incidents ->
 * Settings -> Incident State (#11137).
 *
 * The request: "Default the initial state to Acknowledged for newly created
 * incidents when manually declared", with "a workspace-level toggle". This
 * is that toggle: one switch, "Start incidents declared by hand
 * acknowledged", that saves its Project column the moment it is flipped.
 * Off for every project (the column defaults to false, existing projects
 * included): an upgrade must never stop paging anyone. Each state says what
 * it means for paging, on-call rules included. Only a project owner or admin
 * may flip it, and for anyone else it is locked and says why. Rendered for
 * real, with the model API and the permission snapshot stubbed.
 */

const WAIT_TIMEOUT: number = 20000;

const PATH: string = `/dashboard/${PROJECT_ID}/incidents/settings/state`;
const COLUMN: string = START_INCIDENTS_DECLARED_BY_HAND_ACKNOWLEDGED_COLUMN;
const CARD_TITLE: string = "Incidents Declared by Hand";
const CARD_DESCRIPTION: string =
  "Choose whether an incident someone declares in OneUptime, Slack or Microsoft Teams starts acknowledged, as whoever declares it is already on it.";
const SWITCH_TITLE: string = "Start incidents declared by hand acknowledged";
const ON_DESCRIPTION: string =
  "They start acknowledged and page no one, on-call rules included, unless whoever declares one picks an on-call policy to page.";
const OFF_DESCRIPTION: string =
  "They start in the created state and page their on-call policies, as every new incident does.";

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

let project: Project;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let updateByIdSpy: ReturnType<typeof jest.spyOn>;

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

function openCard(): void {
  goTo(PATH);

  render(
    <MemoryRouter initialEntries={[PATH]}>
      <IncidentDeclaredByHandStartCard />
    </MemoryRouter>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function theSwitch(): Promise<HTMLElement> {
  return await screen.findByTestId(
    DECLARED_BY_HAND_START_SWITCH_TEST_ID,
    {},
    { timeout: WAIT_TIMEOUT },
  );
}

function theRow(): HTMLElement {
  return screen.getByTestId(`${DECLARED_BY_HAND_START_SWITCH_TEST_ID}-row`);
}

async function press(control: HTMLElement): Promise<void> {
  fireEvent.click(control);
  await flush();
}

// Every update a flip sent, as the columns and values it wrote.
function updates(): Array<Record<string, unknown>> {
  return updateByIdSpy.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);

  // A project that never changed it: off, as the column default makes it.
  project = Object.assign(new Project(), { _id: PROJECT_ID });

  getItemSpy = jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      return project;
    });
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<Project>> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    });
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (): Promise<number> => {
      return 0;
    });
  updateByIdSpy = jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (): Promise<never> => {
      return {} as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Incidents → Settings → Incident State: Incidents Declared by Hand", () => {
  test("is one card, saying what it decides, holding one switch", async () => {
    openCard();

    expect(
      await screen.findByText(CARD_TITLE, {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();
    expect(screen.getByText(CARD_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(1);

    await theSwitch();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  test("the switch is off for a project that never changed it, and says what off means", async () => {
    openCard();

    const control: HTMLElement = await theSwitch();

    expect(control).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: SWITCH_TITLE })).toBe(control);
    expect(theRow()).toHaveTextContent(OFF_DESCRIPTION);
    expect(theRow()).not.toHaveTextContent(ON_DESCRIPTION);
  });

  test("a project that turned it on shows it on, and says what on means - on-call rules included", async () => {
    (project as unknown as Record<string, unknown>)[COLUMN] = true;
    openCard();

    expect(await theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(theRow()).toHaveTextContent(ON_DESCRIPTION);
    expect(theRow()).toHaveTextContent("on-call rules included");
    expect(theRow()).not.toHaveTextContent(OFF_DESCRIPTION);
  });

  test("reads the project it is on, and only its own column", async () => {
    openCard();
    await theSwitch();

    await waitFor(
      () => {
        expect(getItemSpy.mock.calls.length).toBeGreaterThan(0);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const call: {
      id?: unknown;
      modelType?: unknown;
      select?: Record<string, unknown>;
    } = getItemSpy.mock.calls[0]![0] as never;

    expect(String(call.id)).toBe(PROJECT_ID);
    expect(call.modelType).toBe(Project);
    expect(call.select).toHaveProperty(COLUMN);
    for (const column of Object.keys(call.select || {})) {
      expect(["_id", COLUMN]).toContain(column);
    }
  });

  test("a Project Owner turns it on: exactly its column is saved, at once, with no dialog", async () => {
    openCard();

    const control: HTMLElement = await theSwitch();
    await press(control);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updates()).toEqual([{ [COLUMN]: true }]);
    expect(
      String((updateByIdSpy.mock.calls[0]![0] as { id: unknown }).id),
    ).toBe(PROJECT_ID);
    expect(
      (updateByIdSpy.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(Project);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId(`${DECLARED_BY_HAND_START_SWITCH_TEST_ID}-status`),
    ).toHaveTextContent("Saved");
    expect(theRow()).toHaveTextContent(ON_DESCRIPTION);
  });

  test("and back off, the same way", async () => {
    (project as unknown as Record<string, unknown>)[COLUMN] = true;
    openCard();

    const control: HTMLElement = await theSwitch();
    await press(control);

    expect(updates()).toEqual([{ [COLUMN]: false }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(theRow()).toHaveTextContent(OFF_DESCRIPTION);
  });

  test("a flip the server refuses moves the switch back, with why", async () => {
    updateByIdSpy.mockImplementation(async (): Promise<never> => {
      throw new Error("You do not have permission to update this Project.");
    });
    openCard();

    const control: HTMLElement = await theSwitch();
    await press(control);

    expect(control).toHaveAttribute("aria-checked", "false");
    expect(theRow()).toHaveTextContent(
      "You do not have permission to update this Project.",
    );
  });

  test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
    "%s may flip it",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openCard();

      const control: HTMLElement = await theSwitch();
      expect(control).not.toHaveAttribute("aria-disabled");

      await press(control);
      expect(updates()).toEqual([{ [COLUMN]: true }]);
    },
  );

  test.each([
    [Permission.ProjectMember],
    [Permission.Viewer],
    [Permission.EditProject],
    [Permission.CreateProjectIncident],
  ])(
    "%s sees it, locked, with the permissions it needs, and a press saves nothing",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      openCard();

      const control: HTMLElement = await theSwitch();

      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("aria-checked", "false");
      expect(theRow()).toHaveTextContent("Project Owner, Project Admin");

      await press(control);
      expect(updateByIdSpy).not.toHaveBeenCalled();
      expect(control).toHaveAttribute("aria-checked", "false");
    },
  );

  test("the switch writes the column the server reads, and needs a Project Owner or Project Admin", () => {
    expect(INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY.column).toBe(
      "startIncidentsDeclaredByHandAcknowledged",
    );
    expect(
      getProjectColumnsUpdatePermissions([COLUMN as keyof Project & string]),
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
    expect(
      getProjectColumnsPermissionMessage([COLUMN as keyof Project & string]),
    ).toBe(
      "You do not have permission to change these settings. You need one of these roles: Project Owner, Project Admin.",
    );
  });

  test("its words are the card's own, each one short sentence", () => {
    expect(INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY).toEqual({
      column: COLUMN,
      cardTitle: CARD_TITLE,
      cardDescription: CARD_DESCRIPTION,
      switchTitle: SWITCH_TITLE,
      switchOnDescription: ON_DESCRIPTION,
      switchOffDescription: OFF_DESCRIPTION,
      dataTestId: DECLARED_BY_HAND_START_SWITCH_TEST_ID,
    });
    // A card's description fits 210 characters, a switch's 150.
    expect(CARD_DESCRIPTION.length).toBeLessThanOrEqual(210);
    expect(ON_DESCRIPTION.length).toBeLessThanOrEqual(150);
    expect(OFF_DESCRIPTION.length).toBeLessThanOrEqual(150);
  });
});

describe("where it is found", () => {
  test("the Incident State page draws it, under the list of states", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentState.tsx",
      ),
      "utf8",
    );

    const table: number = source.indexOf("<ModelTable<IncidentState>");
    const card: number = source.indexOf("<IncidentDeclaredByHandStartCard />");

    expect(table).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(table);
  });

  test("search finds it by the switch's name and the words people use for it, on the Incident State page", () => {
    const pages: Array<PageSearchPage> = getPageSearchAreas().flatMap(
      (area: PageSearchArea): Array<PageSearchPage> => {
        return area.sections.flatMap(
          (section: PageSearchSection): Array<PageSearchPage> => {
            return section.pages;
          },
        );
      },
    );
    const statePage: PageSearchPage | undefined = pages.find(
      (page: PageSearchPage): boolean => {
        return page.page === PageMap.INCIDENTS_SETTINGS_STATE;
      },
    );

    expect(statePage).toBeDefined();
    expect(statePage!.settings).toContain(SWITCH_TITLE);
    for (const keyword of [
      "initial state",
      "incidents declared by hand",
      "manually declared incidents",
    ]) {
      expect(statePage!.keywords).toContain(keyword);
    }
  });
});
