import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { MemoryRouter } from "react-router-dom";

/*
 * Settings > Users, when its list comes back empty with no search or filter
 * on. It used to say "Please wait, we are refreshing the list of users for
 * this project. Please try again in sometime." - nothing was refreshing, and
 * the empty state read its first sentence as a heading. The page now leaves
 * the empty state to the table: "No users yet", the card's own description
 * (who is in this list and how they get there), and Invite User.
 *
 * The page is rendered through a stand-in ModelTable that records its props;
 * the empty state is then built by the table's own builder from them.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

type CapturedTableProps = {
  noItemsMessage?: unknown;
  emptyState?: unknown;
  pluralName?: string | undefined;
  cardProps?:
    | {
        title?: string | undefined;
        description?: string | undefined;
        buttons?: Array<CardButtonSchema> | undefined;
      }
    | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

import Users from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/Index";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import {
  ModelTableEmptyState,
  buildModelTableEmptyState,
} from "../../../UI/Components/ModelTable/ModelTableEmptyState";
import { TableEmptyStateKind } from "../../../UI/Components/Table/TableEmptyState";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-0000000000e1",
);

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

function renderUsers(): CapturedTableProps {
  render(
    <MemoryRouter>
      <Users
        pageRoute={
          new Route(`/dashboard/${PROJECT_ID.toString()}/settings/users`)
        }
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  expect(capturedTableProps).not.toBeNull();

  return capturedTableProps!;
}

// What BaseModelTable repeats in an empty state: NORMAL, with the Add icon.
function mirroredCreateButton(
  buttons: Array<CardButtonSchema>,
): CardButtonSchema | undefined {
  return buttons.find((button: CardButtonSchema): boolean => {
    return (
      button.icon === IconProp.Add &&
      (button.buttonStyle === ButtonStyleType.NORMAL ||
        button.buttonStyle === ButtonStyleType.PRIMARY)
    );
  });
}

beforeEach(() => {
  capturedTableProps = null;
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(ModelAPI, "count").mockResolvedValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Settings > Users when its list is empty", () => {
  test("the page writes no sentence of its own", () => {
    const props: CapturedTableProps = renderUsers();

    expect(props.noItemsMessage).toBeUndefined();
    expect(props.pluralName).toBe("Users");
  });

  test("the table says No users yet, what the list is for, and offers Invite User", () => {
    const props: CapturedTableProps = renderUsers();
    const buttons: Array<CardButtonSchema> = props.cardProps?.buttons || [];

    const empty: ModelTableEmptyState = buildModelTableEmptyState({
      pluralLabel: props.pluralName!,
      noItemsMessage:
        typeof props.noItemsMessage === "string"
          ? props.noItemsMessage
          : undefined,
      hasCustomElement: false,
      cardDescription: props.cardProps?.description,
      isSearchActive: false,
      isFilterActive: false,
      onClearSearchAndFilters: (): void => {},
      createButton: mirroredCreateButton(buttons),
      isCreateDeniedByPermission: false,
      translate: (value: string): string => {
        return value;
      },
    });

    expect(empty.emptyStateProps?.kind).toBe(TableEmptyStateKind.Empty);
    expect(empty.emptyStateProps?.title).toBe("No users yet");
    expect(empty.emptyStateProps?.description).toBe(
      "Everyone who can sign in to this project, and the teams they belong to. Invite someone to give them access; their teams decide what they can do.",
    );
    expect(empty.usesCardDescription).toBe(true);
    expect(
      (empty.emptyStateProps?.actions || []).map(
        (action: { title: string }): string => {
          return action.title;
        },
      ),
    ).toEqual(["Invite User"]);
  });

  test("the old sentence is gone from the page and from every locale", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "Users", "Index.tsx"),
      "utf8",
    );

    expect(source).not.toContain("noItemsMessage=");
    expect(source).not.toContain("Please try again in sometime");

    const localesDirectory: string = path.join(DASHBOARD_SRC, "Locales");

    for (const file of fs.readdirSync(localesDirectory)) {
      if (!file.endsWith(".json")) {
        continue;
      }

      expect([
        file,
        fs
          .readFileSync(path.join(localesDirectory, file), "utf8")
          .includes("we are refreshing the list of users"),
      ]).toEqual([file, false]);
    }
  });
});
