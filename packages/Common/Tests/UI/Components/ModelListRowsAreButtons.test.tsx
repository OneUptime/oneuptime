import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A model list's rows, and the list's frame (StaticModelList, ModelList).
 *
 * The rows are choices - a sign-in page's single sign-on providers, a
 * record a dialog picks - but they were boxes only a mouse could click: a
 * keyboard skipped every provider on a status page's SSO page, and stopped
 * on the list's scroll box instead, where Enter did nothing. A long
 * description ran out past its row's edge, which also made that scroll box.
 * And each list drew a frame of its own (padding, a margin under it, a
 * scroll box), so a page with SAML and OpenID Connect providers showed them
 * as two lists far apart.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import ModelList, {
  MODEL_LIST_FRAME_CLASS_NAME,
} from "../../../UI/Components/ModelList/ModelList";
import StaticModelList, {
  MODEL_LIST_ROW_TEST_ID,
} from "../../../UI/Components/ModelList/StaticModelList";
import Probe from "../../../Models/DatabaseModels/Probe";

const LONG_DESCRIPTION: string =
  "For agency and contractor accounts that are managed in Microsoft Entra ID, in the contractors tenant.";

const probesOf: (names: Array<string>) => Array<Probe> = (
  names: Array<string>,
): Array<Probe> => {
  return names.map((name: string, index: number) => {
    const probe: Probe = new Probe();
    probe.id = new ObjectID(`11111111-1111-4111-8111-11111111111${index}`);
    probe._id = probe.id.toString();
    probe.name = name;
    probe.description = index === 1 ? LONG_DESCRIPTION : `${name} probe`;
    return probe;
  });
};

const listOf: (names: Array<string>) => ListResult<Probe> = (
  names: Array<string>,
): ListResult<Probe> => {
  const probes: Array<Probe> = probesOf(names);

  return { data: probes, count: probes.length, skip: 0, limit: 10 };
};

const rows: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.getAllByTestId(MODEL_LIST_ROW_TEST_ID);
};

beforeEach(() => {
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("a model list's rows", () => {
  const renderRows: (props?: {
    onClick?: (probe: Probe) => void;
    onDelete?: (probe: Probe) => void;
    selected?: Array<Probe>;
  }) => Array<Probe> = (props?: {
    onClick?: (probe: Probe) => void;
    onDelete?: (probe: Probe) => void;
    selected?: Array<Probe>;
  }): Array<Probe> => {
    const probes: Array<Probe> = probesOf(["Frankfurt", "Contractors", "Ohio"]);

    render(
      <StaticModelList<Probe>
        list={probes}
        titleField="name"
        descriptionField="description"
        selectedItems={props?.selected || []}
        onClick={props?.onClick || (() => {})}
        onDelete={props?.onDelete}
      />,
    );

    return probes;
  };

  it("are buttons, each named by what it shows, in the keyboard's order", () => {
    renderRows();

    const buttons: Array<HTMLElement> = screen.getAllByRole("button");

    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveTextContent("Frankfurt");
    expect(buttons[1]).toHaveTextContent("Contractors");
    expect(buttons[2]).toHaveTextContent("Ohio");

    for (const row of rows()) {
      expect(row).toHaveAttribute("tabindex", "0");
    }
  });

  it("Enter and Space choose a row, as a click does", () => {
    const onClick: MockFunction = getJestMockFunction();
    const probes: Array<Probe> = renderRows({
      onClick: onClick as unknown as (probe: Probe) => void,
    });

    fireEvent.keyDown(rows()[1]!, { key: "Enter" });
    fireEvent.keyDown(rows()[2]!, { key: " " });
    fireEvent.click(rows()[0]!);
    // Another key chooses nothing.
    fireEvent.keyDown(rows()[0]!, { key: "a" });

    expect(onClick).toHaveBeenCalledTimes(3);
    expect(
      onClick.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as Probe).name;
      }),
    ).toEqual([probes[1]!.name, probes[2]!.name, probes[0]!.name]);
  });

  it("say which one is chosen", () => {
    const probes: Array<Probe> = probesOf(["Frankfurt", "Contractors", "Ohio"]);

    render(
      <StaticModelList<Probe>
        list={probes}
        titleField="name"
        selectedItems={[probes[2]!]}
        onClick={() => {}}
      />,
    );

    expect(
      rows().map((row: HTMLElement) => {
        return row.getAttribute("aria-pressed");
      }),
    ).toEqual(["false", "false", "true"]);
  });

  it("show the keyboard's focus in the theme's indigo, not the old pink", () => {
    renderRows();

    for (const row of rows()) {
      expect(row.className).toContain("focus-visible:ring-2");
      expect(row.className).toContain("focus-visible:ring-indigo-500");
      expect(row.className).not.toContain("pink");
    }
  });

  it("wrap a long description in the row, two lines at most, rather than run past its edge", () => {
    renderRows();

    const row: HTMLElement = rows()[1]!;
    const description: HTMLElement = within(row).getByText(LONG_DESCRIPTION);

    expect(description.className).toContain("line-clamp-2");
    expect(description.className).toContain("break-words");
    expect(description.className).not.toContain("truncate");
    // Their words take the row's room, and no more.
    expect(row.firstElementChild!.className).toContain("min-w-0");
    expect(row.firstElementChild!.className).toContain("flex-1");
  });

  it("with a Delete button of their own stay plain rows, so no control sits inside another", () => {
    renderRows({ onDelete: () => {} });

    for (const row of rows()) {
      expect(row).not.toHaveAttribute("role");
      expect(row).not.toHaveAttribute("tabindex");
    }

    expect(screen.getAllByRole("button", { name: /Delete/ })).toHaveLength(3);
  });
});

describe("a model list's frame", () => {
  const renderList: (isUnframed?: boolean) => Promise<HTMLElement> = async (
    isUnframed?: boolean,
  ): Promise<HTMLElement> => {
    getListMock.mockImplementation(async () => {
      return listOf(["Frankfurt", "Contractors"]);
    });

    render(
      <ModelList<Probe>
        id="probe-list"
        modelType={Probe}
        titleField="name"
        select={{ name: true }}
        noItemsMessage="No probes yet."
        isUnframed={isUnframed}
      />,
    );

    await screen.findByText("Contractors");

    return screen.getByTestId("probe-list-rows");
  };

  it("is padding, a margin under it and a scroll box of its own, by default", async () => {
    const frame: HTMLElement = await renderList();

    expect(frame.className).toBe(MODEL_LIST_FRAME_CLASS_NAME);
    expect(MODEL_LIST_FRAME_CLASS_NAME).toBe(
      "max-h-96 mb-5 overflow-y-auto p-2",
    );
  });

  it("is none for an unframed list: its rows sit in the page as they are", async () => {
    const frame: HTMLElement = await renderList(true);

    expect(frame.getAttribute("class")).toBeNull();
    expect(within(frame).getAllByRole("button")).toHaveLength(2);
  });
});
