import DuplicateModel from "../../../UI/Components/DuplicateModel/DuplicateModel";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";
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
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import Search from "../../../Types/BaseDatabase/Search";
import Select from "../../../Types/BaseDatabase/Select";
import TableAccessControl from "../../../Types/Database/AccessControl/TableAccessControl";
import CrudApiEndpoint from "../../../Types/Database/CrudApiEndpoint";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import TableMetaData from "../../../Types/Database/TableMetadata";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import React from "react";

/*
 * Duplicate: a copy, named and opened.
 *
 * "Duplicate could prefill '<name> 2' the way dashboard templates now do" -
 * the 14.0.14 follow-ups. Pressing Duplicate <X> looks up the name the copy
 * starts with (the original's, numbered past the project's names) and opens
 * the dialog with it filled in; Duplicate in the dialog makes the copy and
 * opens it. A refused copy keeps the dialog open with the reason and what
 * was typed. Nothing is looked up before Duplicate is pressed.
 */

/*
 * The button is gated on the viewer's permissions, so the tests say who is
 * looking: a project owner, who may create every model used here.
 */
jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

const mockNavigate: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>): unknown => {
        return mockNavigate(...args);
      },
    },
  };
});

const mockGetItem: MockFunction = getJestMockFunction();
const mockGetList: MockFunction = getJestMockFunction();
const mockCreate: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return mockCreate(...args);
      },
    },
  };
});

/*
 * A model with no name column: its dialog asks for something else, so
 * nothing is looked up or filled in.
 */
@TableAccessControl({
  create: [Permission.ProjectOwner],
  read: [Permission.ProjectOwner],
  update: [Permission.ProjectOwner],
  delete: [Permission.ProjectOwner],
})
@TableMetaData({
  tableName: "Foo",
  singularName: "Foo",
  pluralName: "Foos",
  icon: IconProp.Wrench,
  tableDescription: "A test model",
})
@CrudApiEndpoint(new Route("/testModel"))
class TestModel extends BaseModel {
  public changeThis?: string = "original";
}

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194161002",
);
const COPY_ID: ObjectID = new ObjectID("0198c8ec-2a1d-7f0c-9e75-38419416ffff");
const LIST_ROUTE: Route = new Route("/dashboard/project-1/workflows");

const WORKFLOW_FIELDS_TO_DUPLICATE: Select<Workflow> = {
  description: true,
  graph: true,
  labels: true,
};

const WORKFLOW_FIELDS_TO_CHANGE: Array<ModelField<Workflow>> = [
  {
    field: {
      name: true,
    },
    title: "New Workflow Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "New Workflow Name",
    validation: {
      minLength: 2,
    },
  },
];

function workflowNamed(name: string): Workflow {
  const workflow: Workflow = new Workflow();
  workflow.name = name;
  return workflow;
}

function listOf<T extends BaseModel>(
  items: Array<T>,
): { data: Array<T>; count: number; skip: number; limit: number } {
  return {
    data: items,
    count: items.length,
    skip: 0,
    limit: LIMIT_PER_PROJECT,
  };
}

interface GetItemArgs {
  select: JSONObject;
  id: ObjectID;
}

interface CreateArgs {
  model: BaseModel;
}

/*
 * The API as Duplicate meets it: the original is called `originalName` and
 * its description is "Runs at night"; the project's names that contain the
 * looked-up text are `projectNames`; a create answers with the copy, whose
 * id is COPY_ID.
 */
function serveWorkflow(data: {
  originalName: string;
  projectNames: Array<string>;
}): void {
  mockGetItem.mockImplementation(async (args: unknown): Promise<Workflow> => {
    const { select } = args as GetItemArgs;

    if (select["name"]) {
      return workflowNamed(data.originalName);
    }

    const original: Workflow = new Workflow();
    original.id = WORKFLOW_ID;
    original.description = "Runs at night";
    return original;
  });

  mockGetList.mockImplementation(async (): Promise<unknown> => {
    return listOf(data.projectNames.map(workflowNamed));
  });

  mockCreate.mockImplementation(async (args: unknown): Promise<unknown> => {
    const copy: Workflow = new Workflow();
    copy.id = COPY_ID;

    const sentName: string | undefined = (
      (args as CreateArgs).model as Workflow
    ).name;

    if (sentName) {
      copy.name = sentName;
    }

    return { data: copy };
  });
}

function renderWorkflowDuplicate(
  overrides: {
    onDuplicateSuccess?: ((item: Workflow) => Promise<void> | void) | undefined;
    navigateToOnSuccess?: Route | undefined;
  } = {},
): void {
  render(
    <DuplicateModel<Workflow>
      modelType={Workflow}
      modelId={WORKFLOW_ID}
      fieldsToDuplicate={WORKFLOW_FIELDS_TO_DUPLICATE}
      fieldsToChange={WORKFLOW_FIELDS_TO_CHANGE}
      navigateToOnSuccess={
        "navigateToOnSuccess" in overrides
          ? overrides.navigateToOnSuccess
          : LIST_ROUTE
      }
      {...(overrides.onDuplicateSuccess
        ? { onDuplicateSuccess: overrides.onDuplicateSuccess }
        : {})}
    />,
  );
}

// The card's Duplicate <X> button.
function duplicateButton(): HTMLElement {
  return screen.getByTestId("card-button");
}

async function pressDuplicate(): Promise<void> {
  await act(async () => {
    fireEvent.click(duplicateButton());
  });
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

async function openDialog(): Promise<HTMLElement> {
  await pressDuplicate();
  const opened: HTMLElement = await screen.findByRole("dialog");
  // Let the form take in what it starts with before anything is typed.
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
  return opened;
}

function nameInput(title: string = "New Workflow Name"): HTMLInputElement {
  return within(dialog()).getByRole("textbox", {
    name: title,
  }) as HTMLInputElement;
}

async function pressDuplicateInDialog(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

function sentModel<T extends BaseModel>(call: number = 0): T {
  return (mockCreate.mock.calls[call]![0] as CreateArgs).model as T;
}

describe("DuplicateModel", () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockGetList.mockReset();
    mockCreate.mockReset();
    mockNavigate.mockReset();
    PermissionGate.clearPermissionPropsCache();
  });

  afterEach(() => {
    cleanup();
  });

  describe("the card", () => {
    test("says what Duplicate does, on a card and its button", () => {
      render(
        <DuplicateModel
          modelType={TestModel}
          modelId={new ObjectID("foo")}
          fieldsToDuplicate={{}}
          fieldsToChange={[]}
        />,
      );

      expect(screen.getByTestId("card-details-heading")?.textContent).toBe(
        "Duplicate Foo",
      );
      expect(screen.getByTestId("card-description")?.textContent).toBe(
        "Duplicating this foo will create another foo exactly like this one.",
      );
      expect(screen.getByTestId("card-button")?.textContent).toBe(
        "Duplicate Foo",
      );
    });

    test("looks nothing up until Duplicate is pressed: a page someone only reads makes no request", () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });

      renderWorkflowDuplicate();

      expect(screen.getByTestId("card-button")).toHaveTextContent(
        "Duplicate Workflow",
      );
      expect(mockGetItem).not.toHaveBeenCalled();
      expect(mockGetList).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("the name the copy starts with", () => {
    test("is the original's name, numbered past the project's names", async () => {
      serveWorkflow({
        originalName: "Nightly Sync",
        projectNames: ["Nightly Sync", "Nightly Sync 2", "Nightly Sync Old"],
      });

      renderWorkflowDuplicate();
      await openDialog();

      expect(nameInput()).toHaveValue("Nightly Sync 3");
    });

    test("a copy of the first copy is the next number, not '<name> 2 2'", async () => {
      serveWorkflow({
        originalName: "Nightly Sync 2",
        projectNames: ["Nightly Sync", "Nightly Sync 2"],
      });

      renderWorkflowDuplicate();
      await openDialog();

      expect(nameInput()).toHaveValue("Nightly Sync 3");
    });

    test("is looked up by reading the original's name, then the project's names that contain it", async () => {
      serveWorkflow({
        originalName: "Nightly Sync 2",
        projectNames: ["Nightly Sync", "Nightly Sync 2"],
      });

      renderWorkflowDuplicate();
      await openDialog();

      expect(mockGetItem).toHaveBeenCalledTimes(1);
      const read: GetItemArgs = mockGetItem.mock.calls[0]![0] as GetItemArgs;
      expect(read.id).toBe(WORKFLOW_ID);
      expect(read.select).toEqual({ name: true });

      expect(mockGetList).toHaveBeenCalledTimes(1);
      const lookup: {
        query: JSONObject;
        select: JSONObject;
        limit: number;
        skip: number;
      } = mockGetList.mock.calls[0]![0] as {
        query: JSONObject;
        select: JSONObject;
        limit: number;
        skip: number;
      };

      // The series' first name: every name that could clash contains it.
      expect(lookup.query["name"]).toBeInstanceOf(Search);
      expect((lookup.query["name"] as unknown as Search<string>).value).toBe(
        "Nightly Sync",
      );
      // Archived records too, as the server's unique check counts them.
      expect(Object.keys(lookup.query)).toEqual(["name"]);
      expect(lookup.select).toEqual({ name: true });
      expect(lookup.limit).toBe(LIMIT_PER_PROJECT);
      expect(lookup.skip).toBe(0);

      // Nothing is saved by opening the dialog.
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("is still '<name> 2' when the project's names cannot be looked up", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });
      mockGetList.mockImplementation(async (): Promise<never> => {
        throw new Error("Network error");
      });

      renderWorkflowDuplicate();
      await openDialog();

      expect(nameInput()).toHaveValue("Nightly Sync 2");
    });

    test("is left empty when the original's name cannot be read: the dialog asks for one, as it always did", async () => {
      mockGetItem.mockImplementation(async (): Promise<never> => {
        throw new Error("Network error");
      });

      renderWorkflowDuplicate();
      await openDialog();

      expect(nameInput()).toHaveValue("");
      expect(mockGetList).not.toHaveBeenCalled();
    });

    test("the button is busy while the name is looked up, and a second press looks nothing up twice", async () => {
      let answerName: (workflow: Workflow) => void = () => {};

      mockGetItem.mockImplementationOnce((): Promise<Workflow> => {
        return new Promise<Workflow>(
          (resolve: (workflow: Workflow) => void) => {
            answerName = resolve;
          },
        );
      });
      mockGetList.mockImplementation(async (): Promise<unknown> => {
        return listOf([workflowNamed("Nightly Sync")]);
      });

      renderWorkflowDuplicate();

      await act(async () => {
        fireEvent.click(duplicateButton());
        fireEvent.click(duplicateButton());
      });

      expect(mockGetItem).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("card-button")).toBeDisabled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await act(async () => {
        answerName(workflowNamed("Nightly Sync"));
      });

      await screen.findByRole("dialog");
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(nameInput()).toHaveValue("Nightly Sync 2");
      expect(screen.getByTestId("card-button")).not.toBeDisabled();
    });

    test("is looked up afresh every time the dialog opens", async () => {
      serveWorkflow({
        originalName: "Nightly Sync",
        projectNames: ["Nightly Sync"],
      });

      renderWorkflowDuplicate();
      await openDialog();
      expect(nameInput()).toHaveValue("Nightly Sync 2");

      await act(async () => {
        fireEvent.click(
          within(dialog()).getByTestId("modal-footer-close-button"),
        );
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Someone made "Nightly Sync 2" meanwhile.
      mockGetList.mockImplementation(async (): Promise<unknown> => {
        return listOf([
          workflowNamed("Nightly Sync"),
          workflowNamed("Nightly Sync 2"),
        ]);
      });

      await openDialog();

      expect(mockGetList).toHaveBeenCalledTimes(2);
      expect(nameInput()).toHaveValue("Nightly Sync 3");
    });

    test("is not looked up when the dialog asks for no name", async () => {
      render(
        <DuplicateModel
          modelType={TestModel}
          modelId={new ObjectID("foo")}
          fieldsToDuplicate={{}}
          fieldsToChange={[
            {
              field: {
                changeThis: true,
              },
              title: "Change This",
              required: false,
              placeholder: "You can change this",
            },
          ]}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Duplicate Foo" }));
      });

      await screen.findByRole("dialog");
      expect(mockGetItem).not.toHaveBeenCalled();
      expect(mockGetList).not.toHaveBeenCalled();
    });

    test("leaves the dialog's other fields to their own defaults", async () => {
      const MONITOR_ID: ObjectID = new ObjectID(
        "11111111-1111-4111-8111-111111111111",
      );

      mockGetItem.mockImplementation(
        async (args: unknown): Promise<Monitor> => {
          const monitor: Monitor = new Monitor();

          if ((args as GetItemArgs).select["name"]) {
            monitor.name = "API Monitor";
          } else {
            monitor.id = MONITOR_ID;
            monitor.description = "Checks the API";
          }

          return monitor;
        },
      );
      mockGetList.mockImplementation(async (): Promise<unknown> => {
        const monitor: Monitor = new Monitor();
        monitor.name = "API Monitor";
        return listOf([monitor]);
      });
      mockCreate.mockImplementation(async (): Promise<unknown> => {
        const copy: Monitor = new Monitor();
        copy.id = COPY_ID;
        return { data: copy };
      });

      render(
        <DuplicateModel<Monitor>
          modelType={Monitor}
          modelId={MONITOR_ID}
          fieldsToDuplicate={{ description: true }}
          navigateToOnSuccess={new Route("/dashboard/project-1/monitors")}
          fieldsToChange={[
            {
              field: {
                name: true,
              },
              title: "New Monitor Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "New Monitor Name",
              validation: {
                minLength: 2,
              },
            },
            {
              field: {
                disableActiveMonitoring: true,
              },
              title: "Disable Monitor",
              description:
                "Should the new monitor be disabled when it is duplicated?",
              fieldType: FormFieldSchemaType.Toggle,
              defaultValue: true,
              required: false,
            },
          ]}
        />,
      );

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Duplicate Monitor" }),
        );
      });
      await screen.findByRole("dialog");
      await act(async () => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      });

      expect(nameInput("New Monitor Name")).toHaveValue("API Monitor 2");
      expect(within(dialog()).getByRole("switch")).toHaveAttribute(
        "aria-checked",
        "true",
      );

      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });
      const sent: Monitor = sentModel<Monitor>();
      expect(sent.name).toBe("API Monitor 2");
      expect(sent.disableActiveMonitoring).toBe(true);
      expect(sent.description).toBe("Checks the API");
    });
  });

  describe("Duplicate in the dialog", () => {
    test("saves the copy under the name in the dialog and opens it", async () => {
      serveWorkflow({
        originalName: "Nightly Sync",
        projectNames: ["Nightly Sync"],
      });

      renderWorkflowDuplicate();
      await openDialog();
      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledTimes(1);
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const sent: Workflow = sentModel<Workflow>();
      expect(sent.name).toBe("Nightly Sync 2");
      // The original read as fieldsToDuplicate asks.
      expect((mockGetItem.mock.calls[1]![0] as GetItemArgs).select).toEqual(
        WORKFLOW_FIELDS_TO_DUPLICATE,
      );
      expect(sent.description).toBe("Runs at night");

      // The copy opens: its own page under the list's route.
      expect(mockNavigate).toHaveBeenCalledWith(
        new Route(`/dashboard/project-1/workflows/${COPY_ID.toString()}`),
        { forceNavigate: true },
      );
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    test("never sends the original's id: the copy is a new record", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });

      renderWorkflowDuplicate();
      await openDialog();
      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      const sent: Workflow = sentModel<Workflow>();
      expect(sent._id).toBeUndefined();
      expect(sent.id).toBeFalsy();
    });

    test("saves a name typed over the one filled in", async () => {
      serveWorkflow({
        originalName: "Nightly Sync",
        projectNames: ["Nightly Sync"],
      });

      renderWorkflowDuplicate();
      await openDialog();

      await act(async () => {
        fireEvent.change(nameInput(), { target: { value: "Weekly Sync" } });
      });
      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });
      expect(sentModel<Workflow>().name).toBe("Weekly Sync");
    });

    test("still asks for a name: an emptied field is refused before anything is sent", async () => {
      serveWorkflow({
        originalName: "Nightly Sync",
        projectNames: ["Nightly Sync"],
      });

      renderWorkflowDuplicate();
      await openDialog();

      await act(async () => {
        fireEvent.change(nameInput(), { target: { value: "" } });
      });
      await pressDuplicateInDialog();

      expect(
        await within(dialog()).findByText("New Workflow Name is required."),
      ).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("hands the copy to onDuplicateSuccess before opening it", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });
      const order: Array<string> = [];
      const onDuplicateSuccess: MockFunction = getJestMockFunction();
      onDuplicateSuccess.mockImplementation(async () => {
        order.push("onDuplicateSuccess");
      });
      mockNavigate.mockImplementation(() => {
        order.push("navigate");
      });

      renderWorkflowDuplicate({ onDuplicateSuccess });
      await openDialog();
      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledTimes(1);
      });

      expect(onDuplicateSuccess).toHaveBeenCalledTimes(1);
      expect(
        (onDuplicateSuccess.mock.calls[0]![0] as Workflow).id?.toString(),
      ).toBe(COPY_ID.toString());
      expect(order).toEqual(["onDuplicateSuccess", "navigate"]);
    });

    test("opens nothing, and reports nothing, when the copy comes back without an id", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });
      mockCreate.mockImplementation(async (): Promise<unknown> => {
        return { data: new Workflow() };
      });

      renderWorkflowDuplicate();
      await openDialog();
      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.queryByText("Duplicate Error")).not.toBeInTheDocument();
    });

    test("opens nothing when the card is given nowhere to go", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });

      renderWorkflowDuplicate({ navigateToOnSuccess: undefined });
      await openDialog();
      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe("a refused copy", () => {
    test("keeps the dialog open with the server's reason and the name as typed", async () => {
      serveWorkflow({
        originalName: "Nightly Sync",
        projectNames: ["Nightly Sync"],
      });
      mockCreate.mockImplementationOnce(async (): Promise<never> => {
        throw new Error("Workflow with the same name already exists.");
      });

      renderWorkflowDuplicate();
      await openDialog();

      await act(async () => {
        fireEvent.change(nameInput(), { target: { value: "Weekly Sync" } });
      });
      await pressDuplicateInDialog();

      expect(
        await within(dialog()).findByText(
          "Workflow with the same name already exists.",
        ),
      ).toBeInTheDocument();
      expect(nameInput()).toHaveValue("Weekly Sync");
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.queryByText("Duplicate Error")).not.toBeInTheDocument();
    });

    test("can be named again and duplicated from the same dialog", async () => {
      serveWorkflow({
        originalName: "Nightly Sync",
        projectNames: ["Nightly Sync"],
      });
      mockCreate.mockImplementationOnce(async (): Promise<never> => {
        throw new Error("Workflow with the same name already exists.");
      });

      renderWorkflowDuplicate();
      await openDialog();
      await pressDuplicateInDialog();

      await within(dialog()).findByText(
        "Workflow with the same name already exists.",
      );

      await act(async () => {
        fireEvent.change(nameInput(), {
          target: { value: "Nightly Sync (EU)" },
        });
      });
      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledTimes(1);
      });
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(sentModel<Workflow>(0).name).toBe("Nightly Sync 2");
      expect(sentModel<Workflow>(1).name).toBe("Nightly Sync (EU)");
    });

    test("an original that cannot be found is reported in the dialog", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });
      mockGetItem.mockImplementation(
        async (args: unknown): Promise<Workflow | null> => {
          return (args as GetItemArgs).select["name"]
            ? workflowNamed("Nightly Sync")
            : null;
        },
      );

      renderWorkflowDuplicate();
      await openDialog();
      await pressDuplicateInDialog();

      expect(
        await within(dialog()).findByText(
          `Could not find Workflow with id ${WORKFLOW_ID.toString()}`,
        ),
      ).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    test("a create that answers nothing is reported in the dialog", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });
      mockCreate.mockImplementation(async (): Promise<undefined> => {
        return undefined;
      });

      renderWorkflowDuplicate();
      await openDialog();
      await pressDuplicateInDialog();

      expect(
        await within(dialog()).findByText("Could not create Workflow"),
      ).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    test("is still reported when the dialog was closed while the copy was being saved", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });
      let refuse: (error: Error) => void = () => {};
      mockCreate.mockImplementationOnce((): Promise<never> => {
        return new Promise<never>(
          (_resolve: unknown, reject: (error: Error) => void) => {
            refuse = reject;
          },
        );
      });

      renderWorkflowDuplicate();
      await openDialog();
      await pressDuplicateInDialog();

      await act(async () => {
        fireEvent.click(
          within(dialog()).getByTestId("modal-footer-close-button"),
        );
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await act(async () => {
        refuse(new Error("Workflow with the same name already exists."));
      });

      expect(await screen.findByText("Duplicate Error")).toBeInTheDocument();
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "Workflow with the same name already exists.",
      );
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    test("a copy made after the dialog was closed still opens", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });
      let answer: (value: unknown) => void = () => {};
      mockCreate.mockImplementationOnce((): Promise<unknown> => {
        return new Promise<unknown>((resolve: (value: unknown) => void) => {
          answer = resolve;
        });
      });

      renderWorkflowDuplicate();
      await openDialog();
      await pressDuplicateInDialog();

      await act(async () => {
        fireEvent.click(
          within(dialog()).getByTestId("modal-footer-close-button"),
        );
      });

      const copy: Workflow = new Workflow();
      copy.id = COPY_ID;

      await act(async () => {
        answer({ data: copy });
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          new Route(`/dashboard/project-1/workflows/${COPY_ID.toString()}`),
          { forceNavigate: true },
        );
      });
    });
  });

  describe("after the copy exists", () => {
    test("a failure of what follows is reported on its own and never retried from the dialog", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });
      const onDuplicateSuccess: MockFunction = getJestMockFunction();
      onDuplicateSuccess.mockImplementation(async (): Promise<never> => {
        throw new Error("Failed to duplicate schedule layers: Server Error");
      });

      renderWorkflowDuplicate({ onDuplicateSuccess });
      await openDialog();
      await pressDuplicateInDialog();

      expect(await screen.findByText("Duplicate Error")).toBeInTheDocument();
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "Failed to duplicate schedule layers: Server Error",
      );

      // The dialog that made the copy is gone: pressing it again would make another.
      expect(
        screen.queryByRole("textbox", { name: "New Workflow Name" }),
      ).not.toBeInTheDocument();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    test("the error dialog closes with Close", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });
      const onDuplicateSuccess: MockFunction = getJestMockFunction();
      onDuplicateSuccess.mockImplementation(async (): Promise<never> => {
        throw new Error("Failed to duplicate schedule layers: Server Error");
      });

      renderWorkflowDuplicate({ onDuplicateSuccess });
      await openDialog();
      await pressDuplicateInDialog();

      await screen.findByText("Duplicate Error");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
      });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("the dialog", () => {
    test("asks to confirm, with Duplicate and Cancel", async () => {
      render(
        <DuplicateModel
          modelType={TestModel}
          modelId={new ObjectID("foo")}
          fieldsToDuplicate={{}}
          fieldsToChange={[
            {
              field: {
                changeThis: true,
              },
              title: "Change This",
              required: false,
              placeholder: "You can change this",
            },
          ]}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Duplicate Foo" }));
      });

      const confirmDialog: HTMLElement = await screen.findByRole("dialog");
      expect(
        within(confirmDialog).getByTestId("modal-title")?.textContent,
      ).toBe("Duplicate Foo");
      expect(
        within(confirmDialog).getByTestId("modal-description")?.textContent,
      ).toBe("Are you sure you want to duplicate this foo?");
      expect(
        within(confirmDialog).getByTestId("modal-footer-submit-button")
          ?.textContent,
      ).toBe("Duplicate Foo");
      expect(
        within(confirmDialog).getByTestId("modal-footer-close-button")
          ?.textContent,
      ).toBe("Cancel");
    });

    test("Cancel closes it without saving anything", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });

      renderWorkflowDuplicate();
      await openDialog();

      await act(async () => {
        fireEvent.click(
          within(dialog()).getByRole("button", { name: "Cancel" }),
        );
      });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    test("a reason shown once is gone when the dialog is opened again", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });
      mockCreate.mockImplementationOnce(async (): Promise<never> => {
        throw new Error("Workflow with the same name already exists.");
      });

      renderWorkflowDuplicate();
      await openDialog();
      await pressDuplicateInDialog();
      await within(dialog()).findByText(
        "Workflow with the same name already exists.",
      );

      await act(async () => {
        fireEvent.click(
          within(dialog()).getByTestId("modal-footer-close-button"),
        );
      });

      await openDialog();

      expect(
        within(dialog()).queryByText(
          "Workflow with the same name already exists.",
        ),
      ).not.toBeInTheDocument();
      // And the name is the one looked up afresh, not the one typed before.
      expect(nameInput()).toHaveValue("Nightly Sync 2");
    });
  });
  describe("a copy that is not exactly like its original", () => {
    test("the card says what the page tells it to, in place of 'exactly like this one'", () => {
      render(
        <DuplicateModel
          modelType={TestModel}
          modelId={new ObjectID("foo")}
          fieldsToDuplicate={{}}
          fieldsToChange={[]}
          description="The copy starts turned off."
        />,
      );

      expect(screen.getByTestId("card-description")?.textContent).toBe(
        "The copy starts turned off.",
      );
      expect(screen.getByTestId("card-button")?.textContent).toBe(
        "Duplicate Foo",
      );
    });

    test("prepareCopy adjusts the copy last, after the original's values and the dialog's", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });

      const prepared: Array<Workflow> = [];

      render(
        <DuplicateModel<Workflow>
          modelType={Workflow}
          modelId={WORKFLOW_ID}
          fieldsToDuplicate={WORKFLOW_FIELDS_TO_DUPLICATE}
          fieldsToChange={WORKFLOW_FIELDS_TO_CHANGE}
          navigateToOnSuccess={LIST_ROUTE}
          prepareCopy={(copy: Workflow): void => {
            prepared.push(copy);
            // Sees what the dialog asked, and has the last word.
            copy.description = `${copy.name} (copy)`;
            copy.isEnabled = false;
          }}
        />,
      );

      await openDialog();
      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      expect(prepared).toHaveLength(1);

      const sent: Workflow = sentModel<Workflow>();

      expect(sent.name).toBe("Nightly Sync 2");
      expect(sent.description).toBe("Nightly Sync 2 (copy)");
      expect(sent.isEnabled).toBe(false);
      // Still a new record.
      expect(sent._id).toBeUndefined();
    });

    test("a prepareCopy that reads first is waited for: the copy is saved as it leaves it", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });

      let release: () => void = (): void => {};
      const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
        release = resolve;
      });

      render(
        <DuplicateModel<Workflow>
          modelType={Workflow}
          modelId={WORKFLOW_ID}
          fieldsToDuplicate={WORKFLOW_FIELDS_TO_DUPLICATE}
          fieldsToChange={WORKFLOW_FIELDS_TO_CHANGE}
          navigateToOnSuccess={LIST_ROUTE}
          prepareCopy={async (copy: Workflow): Promise<void> => {
            await gate;
            copy.description = "Prepared after a read";
          }}
        />,
      );

      await openDialog();
      await pressDuplicateInDialog();

      // Nothing is saved while it still reads.
      expect(mockCreate).not.toHaveBeenCalled();

      await act(async () => {
        release();
      });

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      expect(sentModel<Workflow>().description).toBe("Prepared after a read");
    });

    test("a prepareCopy that fails saves nothing", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });

      render(
        <DuplicateModel<Workflow>
          modelType={Workflow}
          modelId={WORKFLOW_ID}
          fieldsToDuplicate={WORKFLOW_FIELDS_TO_DUPLICATE}
          fieldsToChange={WORKFLOW_FIELDS_TO_CHANGE}
          navigateToOnSuccess={LIST_ROUTE}
          prepareCopy={async (): Promise<void> => {
            throw new Error("Could not read what the copy needs.");
          }}
        />,
      );

      await openDialog();
      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(
          screen.getByText("Could not read what the copy needs."),
        ).toBeInTheDocument();
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("without prepareCopy the copy is saved as it was read", async () => {
      serveWorkflow({ originalName: "Nightly Sync", projectNames: [] });

      renderWorkflowDuplicate();
      await openDialog();
      await pressDuplicateInDialog();

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      expect(sentModel<Workflow>().description).toBe("Runs at night");
    });
  });
});
