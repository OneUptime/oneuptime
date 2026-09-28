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
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import englishLocale from "../../../../App/FeatureSet/AdminDashboard/src/Locales/en.json";

/*
 * Settings > Global Probes and Settings > Global AI Agents, where every row
 * used to carry "Show ID and Key", "Edit" and "Delete" side by side.
 *
 * Rows now show one action as a button and fold the rest into a ⋯ menu, and
 * the split picks the button by style. "Show ID and Key" is styled NORMAL and
 * the table's own Edit is OUTLINE, so left to the style the utility that
 * reveals a secret key would be the button on every row and Edit would go
 * behind the ⋯. Both pages mark it MoreMenu; these tests render each page with
 * the real ModelTable and hold it to that. The dashboard's own probe table is
 * covered in App/Dashboard/RowActionPlacementOverrides.test.tsx.
 */

type LocaleValue = string | { [key: string]: LocaleValue };

/*
 * The English copy, so the assertions read what an admin reads and a renamed
 * key fails here rather than rendering its own path.
 */
const translate: (key: string) => string = (key: string): string => {
  let node: LocaleValue | undefined = englishLocale as LocaleValue;

  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return key;
    }

    node = node[segment];
  }

  return typeof node === "string" ? node : key;
};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return translate(key);
        },
      };
    },
  };
});

/*
 * The page chrome (breadcrumbs, the settings side menu) is not what is under
 * test and pulls in the whole admin shell, so it is a plain wrapper here.
 */
jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode }): ReactElement => {
      return <div data-testid="settings-page">{props.children}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <nav data-testid="settings-side-menu" />;
      },
    };
  },
);

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: () => {
        return Promise.resolve(undefined);
      },
      post: () => {
        return Promise.resolve(undefined);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

import SettingsProbes from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Probes/Index";
import SettingsAIAgents from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/AIAgents/Index";
import AIAgent from "../../../Models/DatabaseModels/AIAgent";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "../../../Models/DatabaseModels/Probe";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

interface AdminKeyTable {
  name: string;
  Page: FunctionComponent;
  buildRow: () => BaseModel;
  rowId: string;
  keyModalTitle: string;
}

const PROBE_ID: string = "11111111-1111-4111-8111-111111111111";
const AI_AGENT_ID: string = "22222222-2222-4222-8222-222222222222";

const ADMIN_KEY_TABLES: Array<AdminKeyTable> = [
  {
    name: "Global Probes",
    Page: SettingsProbes,
    buildRow: (): BaseModel => {
      const probe: Probe = new Probe();
      probe._id = PROBE_ID;
      probe.name = "Frankfurt";
      probe.key = "global-probe-key";
      return probe;
    },
    rowId: PROBE_ID,
    keyModalTitle: "Probe Key",
  },
  {
    name: "Global AI Agents",
    Page: SettingsAIAgents,
    buildRow: (): BaseModel => {
      const agent: AIAgent = new AIAgent();
      agent._id = AI_AGENT_ID;
      agent.name = "Triage agent";
      agent.key = "global-agent-key";
      return agent;
    },
    rowId: AI_AGENT_ID,
    keyModalTitle: "AI Agent Key",
  },
];

const rowButtonLabels: (rowActions: HTMLElement) => Array<string> = (
  rowActions: HTMLElement,
): Array<string> => {
  return within(rowActions)
    .getAllByRole("button")
    .map((button: HTMLElement) => {
      return (
        button.getAttribute("aria-label") || (button.textContent || "").trim()
      );
    });
};

const openMenuIn: (rowActions: HTMLElement) => HTMLElement = (
  rowActions: HTMLElement,
): HTMLElement => {
  fireEvent.click(within(rowActions).getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
};

const menuLabels: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });
};

beforeEach(() => {
  // Everyone in the admin dashboard is a master admin.
  localStorage.setItem("is_master_admin", "true");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

/*
 * Both pages read through AdminModelAPI, which inherits getList from ModelAPI,
 * so the spy on the base class is what the table actually calls.
 */
const renderAdminTable: (table: AdminKeyTable) => Promise<HTMLElement> = async (
  table: AdminKeyTable,
): Promise<HTMLElement> => {
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((): Promise<ListResult<any>> => {
      return Promise.resolve({
        data: [table.buildRow()],
        count: 1,
        skip: 0,
        limit: 10,
      });
    });

  render(<table.Page />);

  await waitFor(() => {
    expect(screen.getAllByTestId("row-actions")).toHaveLength(1);
  });

  return screen.getByTestId("row-actions");
};

describe.each(ADMIN_KEY_TABLES)(
  "Admin $name: Show ID and Key is never the row's button",
  (table: AdminKeyTable) => {
    test("the row shows Edit, with Show ID and Key and Delete in the menu", async () => {
      const rowActions: HTMLElement = await renderAdminTable(table);

      expect(rowButtonLabels(rowActions)).toEqual(["Edit", "More actions"]);
      expect(within(rowActions).queryByText("Show ID and Key")).toBeNull();

      // Authored order, with the destructive Delete sunk to the bottom.
      expect(menuLabels(openMenuIn(rowActions))).toEqual([
        "Show ID and Key",
        "Delete",
      ]);
    });

    test("Show ID and Key from the menu reveals that row's ID", async () => {
      const rowActions: HTMLElement = await renderAdminTable(table);

      fireEvent.click(
        within(openMenuIn(rowActions)).getByRole("menuitem", {
          name: "Show ID and Key",
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("modal-title")).toHaveTextContent(
          table.keyModalTitle,
        );
      });
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        table.rowId,
      );
    });

    test("Edit on the row opens the edit form, not the key", async () => {
      const rowActions: HTMLElement = await renderAdminTable(table);

      fireEvent.click(within(rowActions).getByRole("button", { name: "Edit" }));

      await waitFor(() => {
        expect(screen.getByTestId("modal-title")).toBeInTheDocument();
      });
      expect(screen.getByTestId("modal-title")).not.toHaveTextContent(
        table.keyModalTitle,
      );
      expect(screen.getByTestId("modal-title")).toHaveTextContent(/Edit/);
    });
  },
);
