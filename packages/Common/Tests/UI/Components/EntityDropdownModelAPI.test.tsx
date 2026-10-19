import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import Dictionary from "../../../Types/Dictionary";
import EntityDropdown from "../../../UI/Components/EntityDropdown/EntityDropdown";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Mock } from "jest-mock";
import React from "react";

/*
 * EntityDropdown's modelAPI: the API every list the dropdown asks for goes
 * through - the search as the menu opens and as the reader types, the label
 * of an entry already picked, and the Labels tab's labels and their entries.
 *
 * A form hands it its own (ModelForm's modelAPI, which ModelForm already reads
 * the field's first list of options through, or BasicForm's). The Admin
 * Dashboard's is AdminModelAPI, which names no project. The shared ModelAPI
 * names the project the browser last opened in the Dashboard, and the server
 * then lists that project's rows only - so an admin's project picker offered
 * that one project, whichever the admin searched for. Without a modelAPI the
 * dropdown reads through the shared ModelAPI, as the Dashboard's pickers
 * always have.
 */

// An API of a form's own, as the Admin Dashboard's: it names no project.
class FormModelAPI extends ModelAPI {
  public static override getCommonHeaders(): Dictionary<string> {
    return {};
  }
}

const ACME_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166001";
const OKTA_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166002";
const LABEL_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166011";
const MONITOR_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166021";

const PROJECTS: Array<{ _id: string; name: string }> = [
  { _id: ACME_PROJECT_ID, name: "Acme Demo (MCP Review)" },
  { _id: OKTA_PROJECT_ID, name: "Okta OIN Review" },
];

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
}

interface ListAnswer {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
}

type AnswerListFunction = (request: ListRequest) => Promise<ListAnswer>;

// The rows a list asks for: projects by name or by id, a label, its monitor.
const answerList: AnswerListFunction = async (
  request: ListRequest,
): Promise<ListAnswer> => {
  let rows: Array<unknown> = [];

  if (request.modelType === Label) {
    const label: Label = new Label();
    label._id = LABEL_ID;
    label.name = "Production";
    rows = [label];
  } else if (request.modelType === Monitor) {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    monitor.name = "Checkout API";
    rows = [monitor];
  } else if (request.modelType === Project) {
    const name: unknown = request.query["name"];
    const ids: unknown = request.query["_id"];

    rows = PROJECTS.filter((fixture: { _id: string; name: string }) => {
      if (
        name instanceof Search &&
        !fixture.name.toLowerCase().includes(name.toString().toLowerCase())
      ) {
        return false;
      }

      if (
        ids instanceof Includes &&
        !ids.values
          .map((value: unknown) => {
            return String(value);
          })
          .includes(fixture._id)
      ) {
        return false;
      }

      return true;
    }).map((fixture: { _id: string; name: string }): Project => {
      const project: Project = new Project();
      project._id = fixture._id;
      project.name = fixture.name;
      return project;
    });
  }

  return { data: rows, count: rows.length, skip: 0, limit: request.limit };
};

interface StaticSpy {
  mockImplementation: (
    implementation: (request: ListRequest) => Promise<ListAnswer>,
  ) => StaticSpy;
  mock: { calls: Array<Array<unknown>> };
}

let formGetList: StaticSpy;
let sharedGetList: StaticSpy;

type RequestsFunction = (spy: StaticSpy) => Array<ListRequest>;

const requests: RequestsFunction = (spy: StaticSpy): Array<ListRequest> => {
  return spy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ListRequest;
  });
};

beforeEach(() => {
  /*
   * The form's API first: jest then installs a spy of its own on it, and the
   * shared ModelAPI's spy below stays independent of it.
   */
  formGetList = (
    jest.spyOn(FormModelAPI, "getList") as unknown as StaticSpy
  ).mockImplementation(answerList);
  sharedGetList = (
    jest.spyOn(ModelAPI, "getList") as unknown as StaticSpy
  ).mockImplementation(answerList);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("EntityDropdown without a modelAPI (the Dashboard's pickers)", () => {
  test("searches and looks up a picked entry's label through the shared ModelAPI", async () => {
    render(
      <EntityDropdown
        ariaLabel="Project"
        modelType={Project}
        labelField="name"
        valueField="_id"
        value={OKTA_PROJECT_ID}
      />,
    );

    // The picked entry's label, looked up by its id.
    expect(await screen.findByText("Okta OIN Review")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Okta OIN Review/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
      target: { value: "Acme" },
    });

    expect(
      await screen.findByRole("option", { name: "Acme Demo (MCP Review)" }),
    ).toBeTruthy();

    expect(
      requests(sharedGetList).map((request: ListRequest) => {
        return request.modelType;
      }),
    ).toContain(Project);
    expect(
      requests(sharedGetList).some((request: ListRequest) => {
        return request.query["_id"] instanceof Includes;
      }),
    ).toBe(true);
    expect(
      requests(sharedGetList).some((request: ListRequest) => {
        return request.query["name"] instanceof Search;
      }),
    ).toBe(true);
    expect(requests(formGetList)).toEqual([]);
  });
});

describe("EntityDropdown with a modelAPI (a form's own)", () => {
  test("searches through it as the menu opens and as the reader types", async () => {
    render(
      <EntityDropdown
        ariaLabel="Project"
        modelType={Project}
        labelField="name"
        valueField="_id"
        modelAPI={FormModelAPI}
      />,
    );

    const input: HTMLElement = screen.getByRole("combobox", {
      name: "Project",
    });

    fireEvent.focus(input);

    expect(
      await screen.findByRole("option", { name: "Acme Demo (MCP Review)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Okta OIN Review" }),
    ).toBeTruthy();

    fireEvent.change(input, { target: { value: "Okta OIN" } });

    await waitFor(
      () => {
        expect(
          requests(formGetList).some((request: ListRequest) => {
            return (
              request.query["name"] instanceof Search &&
              request.query["name"].toString() === "Okta OIN"
            );
          }),
        ).toBe(true);
      },
      { timeout: 5000 },
    );

    await waitFor(() => {
      expect(screen.queryAllByRole("option")).toHaveLength(1);
    });

    expect(
      screen.getByRole("option", { name: "Okta OIN Review" }),
    ).toBeTruthy();
    expect(requests(sharedGetList)).toEqual([]);
  });

  test("looks up a picked entry's label through it", async () => {
    render(
      <EntityDropdown
        ariaLabel="Project"
        modelType={Project}
        labelField="name"
        valueField="_id"
        value={OKTA_PROJECT_ID}
        modelAPI={FormModelAPI}
      />,
    );

    expect(await screen.findByText("Okta OIN Review")).toBeTruthy();

    expect(
      requests(formGetList).map((request: ListRequest) => {
        return (request.query["_id"] as Includes).values.map(
          (value: unknown) => {
            return String(value);
          },
        );
      }),
    ).toEqual([[OKTA_PROJECT_ID]]);
    expect(requests(sharedGetList)).toEqual([]);
  });

  test("reads the Labels tab's labels, a label's entries and the entries it adds through it", async () => {
    type OnChangeFunction = (value: unknown) => void;

    const onChange: Mock<OnChangeFunction> = jest.fn<OnChangeFunction>();

    render(
      <EntityDropdown
        ariaLabel="Monitors"
        isMultiSelect={true}
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        enableLabelsTab={true}
        onChange={onChange as never}
        modelAPI={FormModelAPI}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox", { name: "Monitors" }));
    fireEvent.click(screen.getByRole("tab", { name: /Labels/ }));

    const labelRow: HTMLElement = await screen.findByRole("option", {
      name: /^Production$/,
    });

    // A label's entries, shown under it.
    fireEvent.click(screen.getByRole("button", { name: "Expand entries" }));

    expect(await screen.findByText("Checkout API")).toBeTruthy();

    // And added to the selection.
    fireEvent.click(labelRow);
    fireEvent.click(screen.getByRole("button", { name: /Add entries from/ }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.calls[0]![0]).toEqual([MONITOR_ID]);

    const modelTypes: Array<unknown> = requests(formGetList).map(
      (request: ListRequest) => {
        return request.modelType;
      },
    );

    expect(modelTypes).toContain(Label);
    expect(
      requests(formGetList).filter((request: ListRequest) => {
        return (
          request.modelType === Monitor && Boolean(request.query["labels"])
        );
      }),
    ).toHaveLength(2);
    expect(requests(sharedGetList)).toEqual([]);
  });
});
