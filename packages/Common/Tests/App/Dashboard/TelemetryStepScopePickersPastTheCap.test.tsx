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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import {
  INFRASTRUCTURE_ENTITY_PICKER,
  TELEMETRY_SCOPE_NOT_FOUND_LABEL,
  TELEMETRY_SERVICE_PICKER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/TelemetryScopePickers";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import BasicForm from "../../../UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A TELEMETRY MONITOR STEP'S SERVICES AND INFRASTRUCTURE ENTITIES, PAST A
 * PROJECT'S FIRST 10,000 (#10646).
 *
 * The step forms of the Logs, Traces, Exceptions, Profiles, LLM and Security
 * Events monitors offered the project's first 10,000 services and inventory
 * items by name, read when the step opened. A pod past them could not be
 * picked; one the monitor filtered on already showed as nothing, and was
 * dropped the next time the field changed.
 *
 * The two fields are the step forms' own (TelemetryScopePickers), drawn in
 * a form as the steps draw them; ModelAPI answers from a project faked
 * whole (CappedListServer): 10,050 of each named before "WB".
 */

const LATE_SERVICE_ID: string = "d0000000-0000-4000-8000-0000000000aa";
const LATE_POD_KEY: string = "k8s.pod/WB1500KSK02-7d9f";
const OTHER_LATE_POD_KEY: string = "k8s.pod/WB1500KSK03-1a2b";
const GONE_POD_KEY: string = "k8s.pod/gone-0000";

const BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;
let onChange: MockFunction;

beforeEach(() => {
  server = new CappedListServer();

  server.add(
    Service,
    namesSortingFirst(BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [{ _id: LATE_SERVICE_ID, name: "WB-checkout" }]);
  server.add(
    InventoryItem,
    namesSortingFirst(BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          entityKey: `k8s.pod/${name}`,
          entityType: "Pod",
          displayName: name,
        };
      },
    ),
  );
  server.add(InventoryItem, [
    {
      _id: ObjectID.generate().toString(),
      entityKey: LATE_POD_KEY,
      entityType: "Pod",
      displayName: "WB1500KSK02-7d9f",
    },
    {
      _id: ObjectID.generate().toString(),
      entityKey: OTHER_LATE_POD_KEY,
      entityType: "Pod",
      displayName: "WB1500KSK03-1a2b",
    },
  ]);
  server.install();

  onChange = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderStepFields(initialValues: JSONObject): Promise<void> {
  await act(async () => {
    render(
      <BasicForm<JSONObject>
        id="telemetry-scope"
        hideSubmitButton={true}
        disableAutofocus={true}
        initialValues={initialValues as FormValues<JSONObject>}
        onChange={(values: FormValues<JSONObject>) => {
          onChange(values);
        }}
        onSubmit={() => {}}
        fields={[
          {
            field: { telemetryServiceIds: true },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: TELEMETRY_SERVICE_PICKER,
            title: "Filter by Service",
            required: false,
          },
          {
            field: { entityKeys: true },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: INFRASTRUCTURE_ENTITY_PICKER,
            title: "Filter by Infrastructure Entity",
            required: false,
          },
        ]}
      />,
    );
  });
}

function chipsOf(title: string): Array<string> {
  const combobox: HTMLElement = screen.getByRole("combobox", {
    name: new RegExp(`^${title}`),
  });
  const container: HTMLElement = combobox.closest(
    "[data-testid='entity-dropdown-box']",
  )!.parentElement!.parentElement!;

  return within(container)
    .queryAllByTestId("entity-dropdown-chip-label")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

function lastValues(): JSONObject {
  return onChange.mock.calls[onChange.mock.calls.length - 1]![0] as JSONObject;
}

describe("Filter by Infrastructure Entity", () => {
  test("names a pod past the 10,000th the step holds, read by its key", async () => {
    await renderStepFields({ entityKeys: [LATE_POD_KEY] });

    await waitFor(() => {
      expect(chipsOf("Filter by Infrastructure Entity")).toEqual([
        "WB1500KSK02-7d9f",
      ]);
    });

    for (const call of server.callsFor(InventoryItem)) {
      expect(call.query["entityKey"]).toBeInstanceOf(Includes);
    }
  });

  test("finds a pod past the 10,000th by its key, and keeps the one held when it is picked", async () => {
    await renderStepFields({ entityKeys: [LATE_POD_KEY] });

    await waitFor(() => {
      expect(chipsOf("Filter by Infrastructure Entity")).toHaveLength(1);
    });

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: /^Filter by Infrastructure Entity/,
    });

    await act(async () => {
      fireEvent.focus(combobox);
      fireEvent.change(combobox, { target: { value: "KSK03" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB1500KSK03-1a2b/,
    });

    // Its type beside its name.
    expect(option).toHaveTextContent("Pod");

    await act(async () => {
      fireEvent.click(option);
    });

    expect(lastValues()["entityKeys"]).toEqual([
      LATE_POD_KEY,
      OTHER_LATE_POD_KEY,
    ]);
  });

  test("a pod no longer there reads No longer available, and is kept until it is taken out", async () => {
    await renderStepFields({ entityKeys: [GONE_POD_KEY, LATE_POD_KEY] });

    await waitFor(() => {
      expect(chipsOf("Filter by Infrastructure Entity")).toEqual([
        TELEMETRY_SCOPE_NOT_FOUND_LABEL,
        "WB1500KSK02-7d9f",
      ]);
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: `Remove ${TELEMETRY_SCOPE_NOT_FOUND_LABEL}`,
        }),
      );
    });

    expect(lastValues()["entityKeys"]).toEqual([LATE_POD_KEY]);
  });
});

describe("Filter by Service", () => {
  test("names a service past the 10,000th the step holds, and finds it by name", async () => {
    await renderStepFields({ telemetryServiceIds: [LATE_SERVICE_ID] });

    await waitFor(() => {
      expect(chipsOf("Filter by Service")).toEqual(["WB-checkout"]);
    });

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: /^Filter by Service/,
    });

    await act(async () => {
      fireEvent.focus(combobox);
      fireEvent.change(combobox, { target: { value: "AP010049" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /AP010049/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    expect((lastValues()["telemetryServiceIds"] as Array<string>)[0]).toBe(
      LATE_SERVICE_ID,
    );
    expect(lastValues()["telemetryServiceIds"]).toHaveLength(2);
  });
});

/*
 * Every step form draws the two fields from TelemetryScopePickers, never a
 * list the page read: one written with dropdownOptions from a prop would be
 * capped again.
 */
describe("every telemetry step form", () => {
  const STEP_FORMS: Array<string> = [
    "LogMonitor/LogMonitorStepFrom.tsx",
    "TraceMonitor/TraceMonitorStepForm.tsx",
    "ExceptionMonitor/ExceptionMonitorStepForm.tsx",
    "ProfileMonitor/ProfileMonitorStepForm.tsx",
    "LlmMonitor/LlmMonitorStepForm.tsx",
    "SecurityEventsMonitor/SecurityEventsMonitorStepForm.tsx",
  ];

  test.each(STEP_FORMS)(
    "%s searches the server for its services",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor",
          file,
        ),
        "utf8",
      );

      expect(source).toContain("dropdownModal: TELEMETRY_SERVICE_PICKER");
      expect(source).not.toContain("props.telemetryServices");
      expect(source).not.toContain("props.telemetryEntities");
    },
  );
});
