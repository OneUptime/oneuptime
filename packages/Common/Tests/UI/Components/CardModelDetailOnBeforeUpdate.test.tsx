import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { JSONObject } from "../../../Types/JSON";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A card's Edit dialog can change the model it is about to save:
 * CardModelDetail hands ModelForm's onBeforeUpdate through. The incident's
 * Affected Resources card uses it to leave the monitor status out when no
 * monitor is left to put in it - "nothing stale is sent".
 *
 * Driven through the real card, dialog and form; only the API and the
 * permissions are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
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

import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import { ModelFormOnBeforeUpdate } from "../../../UI/Components/Forms/ModelForm";
import Probe from "../../../Models/DatabaseModels/Probe";

// Real components that fetch: room for a loaded CI box.
const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

function loadedProbe(): Probe {
  const probe: Probe = new Probe();
  probe.id = PROBE_ID;
  probe.name = "WBHQ";
  probe.description = "Headquarters";
  return probe;
}

function renderCard(onBeforeUpdate?: ModelFormOnBeforeUpdate<Probe>): void {
  render(
    <CardModelDetail<Probe>
      name="Probe Details"
      cardProps={{
        title: "Probe Details",
        description: "Here are more details for this probe.",
      }}
      isEditable={true}
      onBeforeUpdate={onBeforeUpdate}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
        {
          field: { description: true },
          title: "Description",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
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
        ],
      }}
    />,
  );
}

async function saveFromTheEditDialog(): Promise<Probe> {
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
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    },
    { timeout: WAIT_TIMEOUT },
  );

  return (createOrUpdateMock.mock.calls[0]![0] as { model: Probe }).model;
}

describe("CardModelDetail's Edit dialog and onBeforeUpdate", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    getItemMock.mockResolvedValue(loadedProbe() as never);
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} } as never);
  });

  it("hands the hook the model about to be saved and every value the form holds", async () => {
    const hook: MockFunction = getJestMockFunction();
    hook.mockImplementation((async (item: Probe): Promise<Probe> => {
      return item;
    }) as never);

    renderCard(hook as unknown as ModelFormOnBeforeUpdate<Probe>);

    await saveFromTheEditDialog();

    expect(hook).toHaveBeenCalledTimes(1);

    const [item, , formValues] = hook.mock.calls[0] as [
      Probe,
      JSONObject,
      JSONObject,
    ];

    expect(item.name).toBe("WBHQ");
    expect(item._id?.toString()).toBe(PROBE_ID.toString());
    expect(formValues["name"]).toBe("WBHQ");
    expect(formValues["description"]).toBe("Headquarters");
  });

  it("saves what the hook returns", async () => {
    renderCard(async (item: Probe): Promise<Probe> => {
      item.name = "WBHQ (renamed)";
      return item;
    });

    const saved: Probe = await saveFromTheEditDialog();

    expect(saved.name).toBe("WBHQ (renamed)");
  });

  it("leaves out of the request what the hook takes out of the model", async () => {
    renderCard(async (item: Probe): Promise<Probe> => {
      delete item.description;
      return item;
    });

    const saved: Probe = await saveFromTheEditDialog();

    expect(saved.name).toBe("WBHQ");
    expect("description" in saved).toBe(false);
  });

  it("without a hook, saves the model as the form built it", async () => {
    renderCard();

    const saved: Probe = await saveFromTheEditDialog();

    expect(saved.name).toBe("WBHQ");
    expect(saved.description).toBe("Headquarters");
  });
});
