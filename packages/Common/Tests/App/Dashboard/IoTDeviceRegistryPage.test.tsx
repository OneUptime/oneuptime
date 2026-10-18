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
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A fleet's Device Registry, as the page hands it to ModelTable: the
 * register form and the columns. Registering asks only for the Device ID
 * and an optional name: a device is registered to connect, so it starts
 * on, and the Enabled switch that revokes it is on its edit form only. The
 * switch says in plain words what turning it off does - the device cannot
 * connect with its credentials, and raises no offline alerts - where it
 * used to say "pause silent-death detection".
 */

interface CapturedField {
  field: Record<string, unknown>;
  title: string;
  description?: string | undefined;
  required?: boolean | undefined;
  defaultValue?: unknown;
  doNotShowWhenCreating?: boolean | undefined;
  doNotShowWhenEditing?: boolean | undefined;
}

interface CapturedColumn {
  field: Record<string, unknown>;
  title: string;
  getElement?: ((item: unknown) => ReactElement) | undefined;
}

interface CapturedTable {
  modelType: unknown;
  query: Record<string, unknown>;
  isCreateable: boolean;
  isEditable: boolean;
  singularName?: string | undefined;
  formFields: Array<CapturedField>;
  columns: Array<CapturedColumn>;
}

let captured: CapturedTable | null = null;

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

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable) => {
      captured = props;
      return <div data-testid="captured-model-table" />;
    },
  };
});

import IoTFleetDeviceRegistry from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/DeviceRegistry";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import IoTDeviceCredential from "../../../Models/DatabaseModels/IoTDeviceCredential";
import Route from "../../../Types/API/Route";

const FLEET_ID: string = "4f1d2c3b-5a6e-4b7c-8d9e-0f1a2b3c4d5e";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(
    `/dashboard/${PROJECT_ID}/iot/fleets/${FLEET_ID}/device-registry`,
  ),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

function field(title: string): CapturedField {
  const found: CapturedField | undefined = captured?.formFields.find(
    (candidate: CapturedField): boolean => {
      return candidate.title === title;
    },
  );
  if (!found) {
    throw new Error(`No "${title}" field.`);
  }
  return found;
}

function column(title: string): CapturedColumn {
  const found: CapturedColumn | undefined = captured?.columns.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );
  if (!found) {
    throw new Error(`No "${title}" column.`);
  }
  return found;
}

async function renderRegistry(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <IoTFleetDeviceRegistry {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  captured = null;
  goTo(`/dashboard/${PROJECT_ID}/iot/fleets/${FLEET_ID}/device-registry`);
});

afterEach(() => {
  cleanup();
});

describe("a fleet's Device Registry", () => {
  test("lists the fleet's registered devices, and registers more", async () => {
    await renderRegistry();

    expect(screen.getByTestId("captured-model-table")).toBeInTheDocument();
    expect(captured!.modelType).toBe(IoTDeviceCredential);
    expect(String(captured!.query["iotFleetId"])).toBe(FLEET_ID);
    expect(captured!.isCreateable).toBe(true);
    expect(captured!.singularName).toBe("Registered Device");
  });

  test("registering asks for the Device ID and an optional name, nothing more", async () => {
    await renderRegistry();

    // What ModelTable's create form keeps (it drops doNotShowWhenCreating).
    expect(
      captured!.formFields
        .filter((candidate: CapturedField): boolean => {
          return !candidate.doNotShowWhenCreating;
        })
        .map((candidate: CapturedField): string => {
          return candidate.title;
        }),
    ).toEqual(["Device ID", "Name"]);
    expect(field("Device ID").required).toBe(true);
    expect(field("Name").required).toBe(false);
  });

  test("the Enabled switch is on the edit form only; a new device starts on", async () => {
    await renderRegistry();

    expect(field("Enabled").doNotShowWhenCreating).toBe(true);
    expect(field("Enabled").doNotShowWhenEditing).toBeFalsy();
    // The edit form's switch reads the stored value; a stored device without one is on.
    expect(field("Enabled").defaultValue).toBe(true);
    expect(
      captured!.formFields.map((candidate: CapturedField): string => {
        return candidate.title;
      }),
    ).toEqual(["Device ID", "Name", "Enabled"]);
  });

  test("Enabled says in plain words what turning it off does", async () => {
    await renderRegistry();

    expect(field("Enabled").description).toBe(
      "When off, the device cannot connect with these credentials and raises no offline alerts.",
    );
    expect(field("Enabled").description).not.toMatch(/silent-death/);
  });

  test("a device that is off reads Revoked in the list; one that is on, Enabled", async () => {
    await renderRegistry();

    const status: CapturedColumn = column("Status");
    const off: ReturnType<typeof render> = render(
      status.getElement!({ isEnabled: false }),
    );
    expect(off.getByText("Revoked")).toBeInTheDocument();
    off.unmount();

    const on: ReturnType<typeof render> = render(
      status.getElement!({ isEnabled: true }),
    );
    expect(on.getByText("Enabled")).toBeInTheDocument();
    on.unmount();
  });
});
