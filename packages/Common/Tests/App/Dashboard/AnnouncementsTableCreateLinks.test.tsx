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
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A status page's Announcements tab opens the create page with that page
 * already picked.
 *
 * The tab handed the table the page as create initial values, but the
 * table never draws a create form of its own: Create Announcement and
 * Create from Template open the dedicated create page, and they opened it
 * without the page. Now the table takes the status page it belongs to and
 * puts it in the create page's address (?statusPageId=), beside the
 * template picked; from the project's list the address carries no page.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  const actualPermission: Record<string, unknown> = jest.requireActual(
    "../../../Types/Permission",
  ) as Record<string, unknown>;
  const PermissionEnum: Record<string, string> = actualPermission[
    "default"
  ] as Record<string, string>;
  const granted: Array<string> = [
    PermissionEnum["ProjectOwner"]!,
    PermissionEnum["User"]!,
    PermissionEnum["Public"]!,
  ];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return granted;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: granted };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
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

const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "00000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import AnnouncementsTable from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementsTable";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID: string = "11111111-1111-4111-8111-111111111111";

const CREATE_PAGE: string = `/dashboard/${PROJECT_ID}/status-pages/announcements/create`;

function makeTemplate(): StatusPageAnnouncementTemplate {
  const template: StatusPageAnnouncementTemplate =
    new StatusPageAnnouncementTemplate();
  template._id = TEMPLATE_ID;
  template.templateName = "Database upgrade";
  return template;
}

// The card's own button: an empty table may repeat it under its message.
async function cardButton(name: string): Promise<HTMLElement> {
  let found: HTMLElement | undefined;

  await waitFor(() => {
    found = screen
      .getAllByRole("button", { name })
      .find((button: HTMLElement): boolean => {
        return button.getAttribute("data-testid") === "card-button";
      });

    expect(found).toBeDefined();
  });

  return found!;
}

function navigatedTo(): string {
  const navigate: MockFunction = Navigation.navigate as unknown as MockFunction;

  expect(navigate).toHaveBeenCalledTimes(1);

  return (navigate.mock.calls[0]![0] as Route).toString();
}

function renderTable(statusPageId?: ObjectID): void {
  render(
    <MemoryRouter>
      <AnnouncementsTable
        {...(statusPageId ? { statusPageId: statusPageId } : {})}
      />
    </MemoryRouter>,
  );
}

// Create from Template sits in the card's More (...) menu, beside Create.
async function pickTemplate(): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

  fireEvent.click(await screen.findByRole("button", { name: "More options" }));
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Create from Template" }),
  );

  const dialog: HTMLElement = await screen.findByTestId("modal");

  // The dialog's one field, once the templates have loaded.
  await user.click(await within(dialog).findByRole("combobox"));
  await user.click(
    await screen.findByRole("option", { name: /Database upgrade/ }),
  );

  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

  await waitFor(() => {
    expect(Navigation.navigate).toHaveBeenCalled();
  });
}

beforeEach(() => {
  getListMock.mockReset();
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

  getListMock.mockImplementation(async (args: unknown) => {
    const modelType: DatabaseBaseModelType = (
      args as { modelType: DatabaseBaseModelType }
    ).modelType;

    const data: Array<StatusPageAnnouncementTemplate> =
      modelType === StatusPageAnnouncementTemplate ? [makeTemplate()] : [];

    return { data, count: data.length, skip: 0, limit: 100 };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a status page's Announcements tab", () => {
  test("Create Announcement opens the create page with that page picked", async () => {
    renderTable(new ObjectID(STATUS_PAGE_ID));

    fireEvent.click(await cardButton("Create Announcement"));

    expect(navigatedTo()).toBe(`${CREATE_PAGE}?statusPageId=${STATUS_PAGE_ID}`);
  });

  test("Create from Template opens it with that page and the template", async () => {
    renderTable(new ObjectID(STATUS_PAGE_ID));

    await pickTemplate();

    expect(navigatedTo()).toBe(
      `${CREATE_PAGE}?statusPageId=${STATUS_PAGE_ID}&announcementTemplateId=${TEMPLATE_ID}`,
    );
  });
});

describe("the project's Announcements list", () => {
  test("Create Announcement opens the create page with nothing picked", async () => {
    renderTable();

    fireEvent.click(await cardButton("Create Announcement"));

    expect(navigatedTo()).toBe(CREATE_PAGE);
  });

  test("Create from Template opens it with the template only", async () => {
    renderTable();

    await pickTemplate();

    expect(navigatedTo()).toBe(
      `${CREATE_PAGE}?announcementTemplateId=${TEMPLATE_ID}`,
    );
  });
});
