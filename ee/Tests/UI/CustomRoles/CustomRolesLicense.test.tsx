import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * The Enterprise custom role screens under a lapsed license
 * (ee/Dashboard/CustomRoles): the server refuses creating and changing
 * custom roles then, and still lets them be taken from teams and deleted.
 * The screens say so up front and offer only what works:
 *
 *   - Teams > Settings > Roles: a notice, and no Create; Delete stays;
 *   - a role's page: a notice, its details not editable, and its permission
 *     and team tables read-only (they keep Remove);
 *   - with a valid license, all of it as before, and no notice.
 *
 * The tables and cards are recorded rather than drawn (they have suites of
 * their own): what matters is what the screens hand them.
 */

type Recorded = Record<string, unknown>;

interface RecorderStore {
  byKind: Map<string, Array<Recorded>>;
  licenseMode: string;
}

const store: RecorderStore = {
  byKind: new Map<string, Array<Recorded>>(),
  licenseMode: "editable",
};

(
  globalThis as unknown as { __customRolesLicense: RecorderStore }
).__customRolesLicense = store;

const mockRecorder: (kind: string) => (props: Recorded) => ReactElement = (
  kind: string,
) => {
  return (props: Recorded): ReactElement => {
    const recorder: RecorderStore = (
      globalThis as unknown as { __customRolesLicense: RecorderStore }
    ).__customRolesLicense;
    const list: Array<Recorded> = recorder.byKind.get(kind) || [];

    list.push(props);
    recorder.byKind.set(kind, list);

    const react: typeof React = jest.requireActual("react") as typeof React;

    return react.createElement("div", { "data-testid": `recorded-${kind}` });
  };
};

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return { __esModule: true, default: mockRecorder("model-table") };
});

jest.mock("Common/UI/Components/ModelDetail/CardModelDetail", () => {
  return { __esModule: true, default: mockRecorder("card-model-detail") };
});

jest.mock("Common/UI/Components/ModelDelete/ModelDelete", () => {
  return { __esModule: true, default: mockRecorder("model-delete") };
});

jest.mock("../../../Dashboard/CustomRoles/CustomRolePermissionTable", () => {
  return { __esModule: true, default: mockRecorder("permission-table") };
});

jest.mock("../../../Dashboard/CustomRoles/CustomRoleTeamsTable", () => {
  return { __esModule: true, default: mockRecorder("teams-table") };
});

jest.mock("@oneuptime/dashboard/Components/CustomRole/CustomRoleReach", () => {
  return {
    __esModule: true,
    loadCustomRoleReach: (): Promise<unknown> => {
      return Promise.resolve({ teamCount: 0, peopleCount: 0 });
    },
  };
});

// The trail a role's page draws needs a router; it is not what is tested here.
jest.mock("@oneuptime/dashboard/Utils/Breadcrumbs/TeamsBreadcrumbs", () => {
  return {
    __esModule: true,
    getTeamsBreadcrumbs: (): Array<unknown> => {
      return [];
    },
  };
});

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return (
          globalThis as unknown as { __customRolesLicense: RecorderStore }
        ).__customRolesLicense.licenseMode;
      },
    };
  },
);

import RolesPage from "../../../Dashboard/CustomRoles/RolesPage";
import RoleViewPage from "../../../Dashboard/CustomRoles/RoleViewPage";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ROLE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/teams/roles"),
} as unknown as PageComponentProps;

const recorded: (kind: string) => Array<Recorded> = (
  kind: string,
): Array<Recorded> => {
  return store.byKind.get(kind) || [];
};

const lastOf: (kind: string) => Recorded = (kind: string): Recorded => {
  const list: Array<Recorded> = recorded(kind);

  expect(list.length).toBeGreaterThan(0);

  return list[list.length - 1]!;
};

beforeEach(() => {
  store.byKind.clear();
  store.licenseMode = "editable";
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(ROLE_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const renderInAct: (element: ReactElement) => Promise<void> = async (
  element: ReactElement,
): Promise<void> => {
  await act(async () => {
    render(element);
  });
};

describe("Teams > Settings > Roles", () => {
  test("with a valid license: Create and Delete, and no notice", async () => {
    await renderInAct(<RolesPage {...PAGE_PROPS} />);

    const table: Recorded = lastOf("model-table");

    expect(table["isCreateable"]).toBe(true);
    expect(table["isDeleteable"]).toBe(true);
    expect(
      screen.queryByTestId(
        "enterprise-setting-license-read-only-notice-custom-roles",
      ),
    ).not.toBeInTheDocument();
  });

  test.each([
    [
      "lapsed",
      "read-only",
      "enterprise-setting-license-read-only-notice-custom-roles",
    ],
    [
      "leaving custom roles out",
      "not-included",
      "enterprise-setting-license-not-included-notice-custom-roles",
    ],
  ])(
    "with a license %s: a notice, no Create, and Delete still there",
    async (_label: string, mode: string, noticeTestId: string) => {
      store.licenseMode = mode;

      await renderInAct(<RolesPage {...PAGE_PROPS} />);

      const table: Recorded = lastOf("model-table");

      expect(table["isCreateable"]).toBe(false);
      expect(table["isDeleteable"]).toBe(true);
      expect(screen.getByTestId(noticeTestId)).toBeInTheDocument();
    },
  );

  test("in the trial or grace period: a warning, and Create still there", async () => {
    store.licenseMode = "grace";

    await renderInAct(<RolesPage {...PAGE_PROPS} />);

    expect(lastOf("model-table")["isCreateable"]).toBe(true);
    expect(
      screen.getByTestId(
        "enterprise-setting-license-grace-notice-custom-roles",
      ),
    ).toBeInTheDocument();
  });

  test("the built-in roles are not drawn here: core's shell draws them under this page", async () => {
    await renderInAct(<RolesPage {...PAGE_PROPS} />);

    expect(screen.queryByText("Built-in Roles")).not.toBeInTheDocument();
  });
});

describe("a custom role's page", () => {
  test("with a valid license: its details editable, its tables not read-only", async () => {
    await renderInAct(<RoleViewPage {...PAGE_PROPS} />);

    expect(lastOf("card-model-detail")["isEditable"]).toBe(true);
    expect(lastOf("permission-table")["isReadOnly"]).toBe(false);
    expect(lastOf("teams-table")["isReadOnly"]).toBe(false);
    expect(recorded("model-delete").length).toBeGreaterThan(0);
  });

  test("with a lapsed license: a notice, its details not editable, its tables read-only, Delete still there", async () => {
    store.licenseMode = "read-only";

    await renderInAct(<RoleViewPage {...PAGE_PROPS} />);

    expect(lastOf("card-model-detail")["isEditable"]).toBe(false);
    expect(lastOf("permission-table")["isReadOnly"]).toBe(true);
    expect(lastOf("teams-table")["isReadOnly"]).toBe(true);
    expect(recorded("model-delete").length).toBeGreaterThan(0);
    expect(
      screen.getByTestId(
        "enterprise-setting-license-read-only-notice-custom-roles",
      ),
    ).toBeInTheDocument();
  });

  test("its tables are for this role", async () => {
    await renderInAct(<RoleViewPage {...PAGE_PROPS} />);

    expect(lastOf("permission-table")["customRoleId"]).toEqual(ROLE_ID);
    expect(lastOf("teams-table")["customRoleId"]).toEqual(ROLE_ID);
  });
});
