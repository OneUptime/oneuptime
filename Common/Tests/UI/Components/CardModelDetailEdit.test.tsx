import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import FieldType from "../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The "Probe Details" card - and every other CardModelDetail - used to derive
 * the id its edit modal updates from the record the card had finished loading:
 *
 *   modelIdToEdit={item?.id || undefined}
 *
 * The Edit button is rendered by Card, outside ModelDetail, in a mount-only
 * effect - so it is clickable while the card is still on its spinner. Opening
 * the modal then gave ModelForm an Update form with no id, and ModelForm's
 * fetch effect (guarded on the id, deps []) skipped the prefill with no loader
 * and no error. The form rendered defaults, BasicForm coerced every untouched
 * Toggle to false, and pressing Save wrote that over the real probe - which is
 * how "Enable monitoring automatically on new monitors" silently went back to
 * off, and why the page looked unchanged after a refresh.
 *
 * These tests drive the real components: they open the modal before the detail
 * fetch resolves and assert on what actually reaches the API.
 */

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const showToastMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/Toast/ToastInit", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
    ShowToastNotification: (...args: Array<any>) => {
      return showToastMock(...args);
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

import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import Probe from "../../../Models/DatabaseModels/Probe";

/*
 * These render real components that fetch, so give the waits enough room to
 * survive a loaded CI box - the testing-library default of 1s flakes there.
 */
const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

type RenderProbeCardFunction = () => void;

const renderProbeCard: RenderProbeCardFunction = (): void => {
  render(
    <CardModelDetail<Probe>
      name="Probe Details"
      cardProps={{
        title: "Probe Details",
        description: "Here are more details for this probe.",
      }}
      isEditable={true}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
        {
          field: { shouldAutoEnableProbeOnNewMonitors: true },
          title: "Enable monitoring automatically on new monitors",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          dataTestId: "auto-enable-toggle",
        },
      ]}
      modelDetailProps={{
        modelType: Probe,
        id: "probe-detail",
        modelId: PROBE_ID,
        fields: [
          {
            field: { name: true },
            title: "Name",
          },
          {
            field: { shouldAutoEnableProbeOnNewMonitors: true },
            title: "Enable Monitoring on New Monitors",
            fieldType: FieldType.Boolean,
          },
        ],
      }}
    />,
  );
};

type LoadedProbeFunction = () => Probe;

const loadedProbe: LoadedProbeFunction = (): Probe => {
  const probe: Probe = new Probe();
  probe.id = PROBE_ID;
  probe.name = "WBHQ";
  probe.shouldAutoEnableProbeOnNewMonitors = true;
  return probe;
};

describe("CardModelDetail edit modal", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    showToastMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
  });

  it("edits the record the card was told to show, even while the card is still loading", async () => {
    /*
     * The card's own detail fetch never settles, so the card stays on its
     * spinner and never reports a loaded item - which is what used to leave
     * the edit modal with no id. ModelDetail's request is the one that asks
     * for _id; ModelForm's is built from the form fields only.
     */
    getItemMock.mockImplementation((data: any) => {
      if (data?.select?.["_id"]) {
        return new Promise(() => {});
      }
      return Promise.resolve(loadedProbe());
    });

    renderProbeCard();

    await userEvent.click(
      await screen.findByText("Edit Probe", {}, { timeout: WAIT_TIMEOUT }),
    );

    // Prefilled, rather than a blank form or a "still loading" error.
    await waitFor(
      () => {
        expect(screen.getByDisplayValue("WBHQ")).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    await userEvent.click(screen.getByText("Save Changes"));

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalled();
      },
      { timeout: WAIT_TIMEOUT },
    );

    const submitted: any = (createOrUpdateMock.mock.calls[0] as Array<any>)[0];

    expect(submitted.model._id).toEqual(PROBE_ID.toString());
    expect(submitted.model.shouldAutoEnableProbeOnNewMonitors).toBe(true);
  });

  it("prefills the form from the record instead of blanking untouched toggles", async () => {
    getItemMock.mockResolvedValue(loadedProbe());

    renderProbeCard();

    await userEvent.click(
      await screen.findByText("Edit Probe", {}, { timeout: WAIT_TIMEOUT }),
    );

    await waitFor(
      () => {
        expect(screen.getByDisplayValue("WBHQ")).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    await userEvent.click(screen.getByText("Save Changes"));

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalled();
      },
      { timeout: WAIT_TIMEOUT },
    );

    const submitted: any = (createOrUpdateMock.mock.calls[0] as Array<any>)[0];

    expect(submitted.model.name).toEqual("WBHQ");
    // The regression: this used to be submitted as false.
    expect(submitted.model.shouldAutoEnableProbeOnNewMonitors).toBe(true);
    expect(submitted.model._id).toEqual(PROBE_ID.toString());
  });

  it("submits a toggle the user actually turned off", async () => {
    getItemMock.mockResolvedValue(loadedProbe());

    renderProbeCard();

    await userEvent.click(
      await screen.findByText("Edit Probe", {}, { timeout: WAIT_TIMEOUT }),
    );

    await waitFor(
      () => {
        expect(screen.getByDisplayValue("WBHQ")).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    await userEvent.click(screen.getByTestId("auto-enable-toggle"));

    await userEvent.click(screen.getByText("Save Changes"));

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalled();
      },
      { timeout: WAIT_TIMEOUT },
    );

    const submitted: any = (createOrUpdateMock.mock.calls[0] as Array<any>)[0];

    expect(submitted.model.shouldAutoEnableProbeOnNewMonitors).toBe(false);
  });

  it("closes the editor without showing a toast after a successful edit", async () => {
    getItemMock.mockResolvedValue(loadedProbe());

    renderProbeCard();

    await userEvent.click(
      await screen.findByText("Edit Probe", {}, { timeout: WAIT_TIMEOUT }),
    );

    await waitFor(
      () => {
        expect(screen.getByDisplayValue("WBHQ")).toBeDefined();
      },
      { timeout: WAIT_TIMEOUT },
    );

    await userEvent.click(screen.getByText("Save Changes"));

    await waitFor(
      () => {
        expect(screen.queryByText("Save Changes")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(showToastMock).not.toHaveBeenCalled();
  });
});
