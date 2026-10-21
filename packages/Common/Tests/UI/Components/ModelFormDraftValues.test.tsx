import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ModelForm's draftValues: an Update form that opens on a draft of some of
 * its fields - a postmortem template, or what AI wrote - fetches the record
 * as usual and lays the draft over it.
 *
 * The postmortem page used to open such a draft with doNotFetchExistingModel
 * and the draft as the initial values. Every other field then started empty,
 * and BasicForm sends an untouched switch as off: applying a template to a
 * postmortem that was on the status page took it off the status page.
 */

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
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
      getAllPermissions: (): Array<Permission> => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: (): { permissions: Array<UserPermission> } => {
        return {
          permissions: OWNER_PERMISSIONS.map(
            (permission: Permission): UserPermission => {
              return {
                permission,
                labelIds: [],
                _type: "UserPermission",
              } as UserPermission;
            },
          ),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: OWNER_PERMISSIONS };
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

import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Probe from "../../../Models/DatabaseModels/Probe";

const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

function storedProbe(): Probe {
  const probe: Probe = new Probe();
  probe.id = PROBE_ID;
  probe.name = "WBHQ";
  probe.description = "Stored description";
  probe.shouldAutoEnableProbeOnNewMonitors = true;
  return probe;
}

function renderEditor(options: {
  draftValues?: FormValues<Probe>;
  initialValues?: FormValues<Probe>;
  doNotFetchExistingModel?: boolean;
}): void {
  render(
    <ModelFormModal<Probe>
      title="Edit Probe"
      submitButtonText="Save Changes"
      modelType={Probe}
      modelIdToEdit={PROBE_ID}
      onClose={() => {}}
      onSuccess={() => {}}
      initialValues={options.initialValues}
      formProps={{
        id: "probe-draft-form",
        name: "Probe draft",
        modelType: Probe,
        formType: FormType.Update,
        fields: [
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
          {
            field: { shouldAutoEnableProbeOnNewMonitors: true },
            title: "Enable monitoring automatically on new monitors",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            dataTestId: "auto-enable-toggle",
          },
        ],
        ...(options.draftValues ? { draftValues: options.draftValues } : {}),
        ...(options.doNotFetchExistingModel
          ? { doNotFetchExistingModel: true }
          : {}),
      }}
    />,
  );
}

async function save(): Promise<Record<string, unknown>> {
  await userEvent.click(screen.getByText("Save Changes"));

  await waitFor(
    () => {
      expect(createOrUpdateMock).toHaveBeenCalled();
    },
    { timeout: WAIT_TIMEOUT },
  );

  return (createOrUpdateMock.mock.calls[0] as Array<{ model: Probe }>)[0]!
    .model as unknown as Record<string, unknown>;
}

describe("ModelForm draftValues", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    getItemMock.mockImplementation(async (): Promise<Probe> => {
      return storedProbe();
    });
    createOrUpdateMock.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    cleanup();
  });

  test("the drafted field shows the draft, every other field what is stored", async () => {
    renderEditor({ draftValues: { name: "Drafted name" } });

    expect(
      await screen.findByDisplayValue(
        "Drafted name",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Stored description")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("WBHQ")).not.toBeInTheDocument();
    expect(screen.getByTestId("auto-enable-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // The record is still read: that is where the other fields come from.
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("saving sends the draft and keeps what the draft did not touch", async () => {
    renderEditor({ draftValues: { name: "Drafted name" } });

    await screen.findByDisplayValue(
      "Drafted name",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    const saved: Record<string, unknown> = await save();

    expect(saved["_id"]).toEqual(PROBE_ID.toString());
    expect(saved["name"]).toBe("Drafted name");
    expect(saved["description"]).toBe("Stored description");
    expect(saved["shouldAutoEnableProbeOnNewMonitors"]).toBe(true);
  });

  test("without a draft the form is the record, as before", async () => {
    renderEditor({});

    await screen.findByDisplayValue("WBHQ", {}, { timeout: WAIT_TIMEOUT });

    const saved: Record<string, unknown> = await save();

    expect(saved["name"]).toBe("WBHQ");
    expect(saved["shouldAutoEnableProbeOnNewMonitors"]).toBe(true);
  });

  test("why: a draft opened without the record saves an untouched switch as off", async () => {
    renderEditor({
      initialValues: { name: "Drafted name" },
      doNotFetchExistingModel: true,
    });

    await screen.findByDisplayValue(
      "Drafted name",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    const saved: Record<string, unknown> = await save();

    expect(getItemMock).not.toHaveBeenCalled();
    expect(saved["shouldAutoEnableProbeOnNewMonitors"]).toBe(false);
  });
});
