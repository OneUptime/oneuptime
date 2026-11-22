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
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import {
  getOpenStackProjectPicker,
  OPENSTACK_PROJECT_NOT_FOUND_LABEL,
  OpenStackProjectNames,
  useOpenStackProjectNames,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackProjectPicker";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import BasicForm from "../../../UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN OPENSTACK CLOUD'S PROJECTS, PAST THE CARDS' OLD READS (#10646).
 *
 * A budget's project, a notice's project and the projects whose instances
 * keep series of their own were picked from the cloud's first 500 to 1,000
 * projects. A project past them could not be picked, one a budget was for
 * showed as its raw id, and one the instance metrics held vanished the next
 * time the choice was saved.
 *
 * The cards pick from the server now (OpenStackProjectPicker), within the
 * cloud, by name or by the cloud's own id for a project (externalId); what
 * a setting holds is read by that id. ModelAPI answers from a cloud faked
 * whole (CappedListServer): 1,050 projects named before "WB", another
 * cloud's project with the same name, and a hypervisor.
 */

const CLOUD_ID: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000001");
const OTHER_CLOUD_ID: ObjectID = new ObjectID(
  "f1000000-0000-4000-8000-000000000002",
);
const LATE_PROJECT: string = "6b0c3e7fd9a14c1c8b1e2f3a4b5c6d7e";
const OTHER_LATE_PROJECT: string = "7c1d4f80ea25d2d9c2f3a4b5c6d7e8f9";

let server: CappedListServer;
let onChange: MockFunction;

beforeEach(() => {
  server = new CappedListServer();

  server.add(
    OpenStackResource,
    namesSortingFirst(1050).map((name: string): Record<string, unknown> => {
      return {
        _id: ObjectID.generate().toString(),
        openStackCloudId: CLOUD_ID,
        kind: OpenStackResourceKind.Project,
        externalId: `ext-${name}`,
        name: name,
      };
    }),
  );
  server.add(OpenStackResource, [
    {
      _id: ObjectID.generate().toString(),
      openStackCloudId: CLOUD_ID,
      kind: OpenStackResourceKind.Project,
      externalId: LATE_PROJECT,
      name: "WB-payments",
    },
    {
      _id: ObjectID.generate().toString(),
      openStackCloudId: CLOUD_ID,
      kind: OpenStackResourceKind.Project,
      externalId: OTHER_LATE_PROJECT,
      name: "WB-search",
    },
    // Another cloud's project: never offered here.
    {
      _id: ObjectID.generate().toString(),
      openStackCloudId: OTHER_CLOUD_ID,
      kind: OpenStackResourceKind.Project,
      externalId: "other-cloud-project",
      name: "WB-payments",
    },
    // Not a project.
    {
      _id: ObjectID.generate().toString(),
      openStackCloudId: CLOUD_ID,
      kind: OpenStackResourceKind.Hypervisor,
      externalId: "hv-1",
      name: "WB-hypervisor",
    },
  ]);
  server.install();

  onChange = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderProjectField(data: {
  isMultiSelect: boolean;
  value: string | Array<string> | undefined;
}): Promise<void> {
  await act(async () => {
    render(
      <BasicForm<JSONObject>
        id="openstack-project"
        hideSubmitButton={true}
        disableAutofocus={true}
        initialValues={
          { openStackProjectId: data.value } as FormValues<JSONObject>
        }
        onChange={(values: FormValues<JSONObject>) => {
          onChange(values);
        }}
        onSubmit={() => {}}
        fields={[
          {
            field: { openStackProjectId: true },
            title: "Project",
            fieldType: data.isMultiSelect
              ? FormFieldSchemaType.MultiSelectDropdown
              : FormFieldSchemaType.Dropdown,
            dropdownModal: getOpenStackProjectPicker(CLOUD_ID),
            required: false,
          },
        ]}
      />,
    );
  });
}

function lastValue(): unknown {
  return (
    onChange.mock.calls[onChange.mock.calls.length - 1]![0] as JSONObject
  )["openStackProjectId"];
}

describe("the picker", () => {
  test("names the project a budget holds past the cloud's 1,000th, read by its id within the cloud", async () => {
    await renderProjectField({ isMultiSelect: false, value: LATE_PROJECT });

    await waitFor(() => {
      expect(screen.getByTestId("entity-dropdown-value")).toHaveTextContent(
        "WB-payments",
      );
    });

    const read: Record<string, unknown> =
      server.callsFor(OpenStackResource)[0]!.query;

    expect(read["externalId"]).toBeInstanceOf(Includes);
    expect(String(read["openStackCloudId"])).toBe(CLOUD_ID.toString());
    expect(read["kind"]).toBe(OpenStackResourceKind.Project);
  });

  test("finds a project past the 1,000th by its name - never another cloud's, never a hypervisor - and picks it by its id", async () => {
    await renderProjectField({ isMultiSelect: true, value: [LATE_PROJECT] });

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: /^Project/,
    });

    await act(async () => {
      fireEvent.focus(combobox);
      fireEvent.change(combobox, { target: { value: "WB-" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB-search/,
    });

    expect(screen.queryByRole("option", { name: /WB-hypervisor/ })).toBeNull();
    // The held one is picked already; the other cloud's never offered.
    expect(
      screen.queryAllByRole("option", { name: /WB-payments/ }),
    ).toHaveLength(0);

    await act(async () => {
      fireEvent.click(option);
    });

    expect(lastValue()).toEqual([LATE_PROJECT, OTHER_LATE_PROJECT]);
  });

  test("a project gone from the cloud reads No longer available, and stays until it is changed", async () => {
    await renderProjectField({
      isMultiSelect: true,
      value: ["gone-project", LATE_PROJECT],
    });

    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("entity-dropdown-chip-label")
          .map((chip: HTMLElement): string => {
            return chip.textContent || "";
          }),
      ).toEqual([OPENSTACK_PROJECT_NOT_FOUND_LABEL, "WB-payments"]);
    });
  });
});

describe("the cards' names for the projects their rows hold", () => {
  test("read by the cloud's ids for them, only the ones not read yet", async () => {
    const hook: { result: { current: OpenStackProjectNames } } = renderHook(
      () => {
        return useOpenStackProjectNames(CLOUD_ID);
      },
    );

    await act(async () => {
      await hook.result.current.readNamesOf([LATE_PROJECT, undefined]);
    });

    expect(hook.result.current.nameOf(LATE_PROJECT)).toBe("WB-payments");
    expect(hook.result.current.nameOf("gone-project")).toBeUndefined();

    await act(async () => {
      await hook.result.current.readNamesOf([LATE_PROJECT]);
    });

    // Read once.
    expect(server.callsFor(OpenStackResource)).toHaveLength(1);
  });
});

describe("every OpenStack project picker", () => {
  test.each([
    "OpenStackBudgetsCard.tsx",
    "OpenStackProjectNoticesCard.tsx",
    "OpenStackInstanceMetricsCard.tsx",
  ])("%s picks from the server, never a list it read", (file: string) => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack",
        file,
      ),
      "utf8",
    );

    expect(source).toMatch(
      /getOpenStackProjectPicker|getOpenStackProjectsQuery/,
    );
    expect(source).not.toContain("projects.data");
    expect(source).not.toContain("read.data.projects");
  });
});
