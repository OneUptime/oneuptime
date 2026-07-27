import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, waitFor } from "@testing-library/react";
import * as React from "react";
import Select from "../../../Types/BaseDatabase/Select";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../MockType";
import FieldType from "../../../UI/Components/Types/FieldType";

/*
 * ModelDetail builds the get-item `select` from the fields its card declares.
 *
 * Two things were wrong with that:
 *
 *   1. It never asked for _id, even though CardModelDetail derives the id its
 *      edit modal updates from the loaded record. Nothing else in the client
 *      guarantees the id comes back.
 *   2. It did not filter by read permission, while the render path right below
 *      it does. Server-side, SelectPermission.checkSelectPermission rejects the
 *      WHOLE request when a single selected column is unreadable - so one
 *      privileged column (Probe.key is readable only by owners and admins)
 *      blanked the entire card for everyone else, instead of hiding one row.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

let currentPermissions: Array<Permission> = [];
let isMasterAdmin: boolean = false;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return currentPermissions;
      },
      getProjectPermissions: () => {
        return {
          permissions: currentPermissions.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: currentPermissions };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return isMasterAdmin;
      },
    },
  };
});

import ModelDetail from "../../../UI/Components/ModelDetail/ModelDetail";
import Probe from "../../../Models/DatabaseModels/Probe";

/*
 * These render real components that fetch, so give the waits enough room to
 * survive a loaded CI box - the testing-library default of 1s flakes there.
 */
const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

/*
 * Signed-in users always carry Public/User/CurrentUser on top of their project
 * role (AccessTokenService.refreshUserGlobalAccessPermission), and some Probe
 * columns - name, description - are readable on Public alone. Tests mirror
 * that, otherwise they would assert against a permission set no real user has.
 */
type PermissionsForRoleFunction = (role: Permission) => Array<Permission>;

const permissionsForRole: PermissionsForRoleFunction = (
  role: Permission,
): Array<Permission> => {
  return [Permission.Public, Permission.User, Permission.CurrentUser, role];
};

type RenderProbeDetailFunction = () => Promise<Select<Probe>>;

/*
 * Renders the same card shape the Probe view page uses and hands back the
 * select ModelDetail actually put on the wire.
 */
const renderProbeDetail: RenderProbeDetailFunction = async (): Promise<
  Select<Probe>
> => {
  render(
    <ModelDetail<Probe>
      modelType={Probe}
      id="probe-detail"
      modelId={PROBE_ID}
      fields={[
        {
          field: { name: true },
          title: "Name",
        },
        {
          field: { key: true },
          title: "Probe Key",
          fieldType: FieldType.HiddenText,
        },
        {
          field: { shouldAutoEnableProbeOnNewMonitors: true },
          title: "Enable Monitoring on New Monitors",
          fieldType: FieldType.Boolean,
        },
      ]}
    />,
  );

  await waitFor(
    () => {
      expect(getItemMock).toHaveBeenCalled();
    },
    { timeout: WAIT_TIMEOUT },
  );

  return (getItemMock.mock.calls[0] as Array<any>)[0].select as Select<Probe>;
};

describe("ModelDetail select", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    getItemMock.mockResolvedValue(new Probe());
    isMasterAdmin = false;
    currentPermissions = [];
  });

  it("always asks for _id so the edit modal knows which record it is updating", async () => {
    currentPermissions = permissionsForRole(Permission.ProjectOwner);

    const select: Select<Probe> = await renderProbeDetail();

    expect((select as any)["_id"]).toBe(true);
  });

  it("selects every declared column for a user who can read them all", async () => {
    currentPermissions = permissionsForRole(Permission.ProjectOwner);

    const select: Select<Probe> = await renderProbeDetail();

    expect((select as any)["name"]).toBe(true);
    expect((select as any)["key"]).toBe(true);
    expect((select as any)["shouldAutoEnableProbeOnNewMonitors"]).toBe(true);
  });

  it("drops a column the user cannot read instead of failing the whole request", async () => {
    /*
     * A SettingsMember can view probes but cannot read Probe.key. Asking for
     * it anyway is what used to blank the card.
     */
    currentPermissions = permissionsForRole(Permission.SettingsMember);

    const select: Select<Probe> = await renderProbeDetail();

    expect((select as any)["key"]).toBeUndefined();
    expect((select as any)["shouldAutoEnableProbeOnNewMonitors"]).toBe(true);
    expect((select as any)["_id"]).toBe(true);
  });

  it("selects everything for a master admin", async () => {
    isMasterAdmin = true;
    currentPermissions = [];

    const select: Select<Probe> = await renderProbeDetail();

    expect((select as any)["key"]).toBe(true);
    expect((select as any)["name"]).toBe(true);
  });

  it("drops unreadable selectMoreFields too", async () => {
    currentPermissions = permissionsForRole(Permission.SettingsMember);

    render(
      <ModelDetail<Probe>
        modelType={Probe}
        id="probe-detail-more-fields"
        modelId={PROBE_ID}
        fields={[
          {
            field: { name: true },
            title: "Name",
          },
        ]}
        selectMoreFields={{
          key: true,
          shouldAutoEnableProbeOnNewMonitors: true,
        }}
      />,
    );

    await waitFor(
      () => {
        expect(getItemMock).toHaveBeenCalled();
      },
      { timeout: WAIT_TIMEOUT },
    );

    const select: Select<Probe> = (getItemMock.mock.calls[0] as Array<any>)[0]
      .select as Select<Probe>;

    expect((select as any)["key"]).toBeUndefined();
    expect((select as any)["shouldAutoEnableProbeOnNewMonitors"]).toBe(true);
  });
});
