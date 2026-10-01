/*
 * Every Delete page's card is a ModelDelete, and the maintainer's screenshot
 * was its dialog: "Delete Workflow - Are you sure you want to delete this
 * workflow?", with no name anywhere. These pin what it says now: the record's
 * name on the card and in the dialog, read with one column of one record (or
 * taken from the page when it has it), the fallbacks when there is none, and
 * the typed confirmation for a project.
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

import ModelDelete from "../../../UI/Components/ModelDelete/ModelDelete";
import { MAX_DISPLAY_NAME_LENGTH } from "../../../UI/Utils/ModelDisplayName";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_WORKFLOW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

type MakeModelFunction = <T extends BaseModel>(
  modelType: { new (): T },
  values: JSONObject,
) => T;

const makeModel: MakeModelFunction = <T extends BaseModel>(
  modelType: { new (): T },
  values: JSONObject,
): T => {
  const model: T = new modelType();

  for (const [key, value] of Object.entries(values)) {
    (model as unknown as JSONObject)[key] = value;
  }

  return model;
};

type MockGetItemFunction = (
  answer: (data: { id: ObjectID; select: JSONObject }) => unknown,
) => jest.SpyInstance;

const mockGetItem: MockGetItemFunction = (
  answer: (data: { id: ObjectID; select: JSONObject }) => unknown,
): jest.SpyInstance => {
  return getJestSpyOn(ModelAPI, "getItem").mockImplementation(
    (data: any): any => {
      return Promise.resolve(answer({ id: data.id, select: data.select }));
    },
  );
};

type OpenDialogFunction = (buttonName: string) => void;

const openDialog: OpenDialogFunction = (buttonName: string): void => {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
};

type TextOfFunction = (testId: string) => string;

const textOf: TextOfFunction = (testId: string): string => {
  return screen.getByTestId(testId).textContent || "";
};

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("ModelDelete names the record", () => {
  it("reads one column of the record: the model's name column", async () => {
    const getItem: jest.SpyInstance = mockGetItem(() => {
      return makeModel(Workflow, { name: "Notify on-call" });
    });

    render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(getItem).toHaveBeenCalledTimes(1);
    });

    const request: any = getItem.mock.calls[0]![0];

    expect(request.modelType).toBe(Workflow);
    expect(request.id.toString()).toBe(WORKFLOW_ID.toString());
    expect(request.select).toEqual({ name: true });
  });

  it("says it on the card, before anything is clicked", async () => {
    mockGetItem(() => {
      return makeModel(Workflow, { name: "Notify on-call" });
    });

    render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(textOf("model-delete-card-message")).toBe(
        "Permanently delete Notify on-call. This action cannot be undone.",
      );
    });
  });

  // The maintainer's screenshot, as it reads now.
  it("asks about it by name in the dialog, under the kind of thing it is", async () => {
    mockGetItem(() => {
      return makeModel(Workflow, { name: "Notify on-call" });
    });

    render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("delete-confirmation-name"),
      ).toBeInTheDocument();
    });

    openDialog("Delete Workflow");

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Delete Workflow",
    });

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Are you sure you want to delete Notify on-call? This action cannot be undone.",
    );
    expect(dialog).not.toHaveTextContent("this workflow");
    // Still one red Delete, named for the kind of thing it deletes.
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Delete Workflow",
    );
  });

  it("names a template by its own name, not the title it gives incidents", async () => {
    const getItem: jest.SpyInstance = mockGetItem(() => {
      return makeModel(IncidentTemplate, {
        templateName: "Database outage",
        title: "Database is down",
      });
    });

    render(
      <ModelDelete
        modelType={IncidentTemplate}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
        /^Database outage$/,
      );
    });

    expect((getItem.mock.calls[0]![0] as any).select).toEqual({
      templateName: true,
    });
  });

  it("reads the column the page goes by when told to", async () => {
    const getItem: jest.SpyInstance = mockGetItem(() => {
      return makeModel(User, { email: "jane@example.com" });
    });

    render(
      <ModelDelete
        modelType={User}
        modelId={WORKFLOW_ID}
        modelNameField="email"
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
        /^jane@example.com$/,
      );
    });

    expect((getItem.mock.calls[0]![0] as any).select).toEqual({ email: true });
  });

  it("reads through the page's own API when it has one", async () => {
    class AdminModelAPI extends ModelAPI {}

    /*
     * The page's API first: spying on an inherited static that is already a
     * spy hands back that same spy.
     */
    const adminGetItem: jest.SpyInstance = getJestSpyOn(
      AdminModelAPI,
      "getItem",
    ).mockImplementation((): any => {
      return Promise.resolve(makeModel(Project, { name: "Acme Production" }));
    });

    const globalGetItem: jest.SpyInstance = getJestSpyOn(ModelAPI, "getItem");

    render(
      <ModelDelete
        modelType={Project}
        modelId={WORKFLOW_ID}
        modelAPI={AdminModelAPI}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
        /^Acme Production$/,
      );
    });

    expect(adminGetItem).toHaveBeenCalledTimes(1);
    expect(globalGetItem).not.toHaveBeenCalled();
  });

  it("reads nothing when the page passes the name in", async () => {
    const getItem: jest.SpyInstance = mockGetItem(() => {
      return null;
    });

    render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        itemName="Notify on-call"
        onDeleteSuccess={(): void => {}}
      />,
    );

    expect(textOf("model-delete-card-message")).toBe(
      "Permanently delete Notify on-call. This action cannot be undone.",
    );

    openDialog("Delete Workflow");

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Are you sure you want to delete Notify on-call?",
    );

    // Give an effect every chance to fire a request it should not.
    await act(async () => {
      await Promise.resolve();
    });

    expect(getItem).not.toHaveBeenCalled();
  });

  it("reads nothing for a passed-in empty name, and asks about the kind", async () => {
    const getItem: jest.SpyInstance = mockGetItem(() => {
      return null;
    });

    render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        itemName=""
        onDeleteSuccess={(): void => {}}
      />,
    );

    openDialog("Delete Workflow");

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Are you sure you want to delete this workflow? This action cannot be undone.",
    );
    expect(getItem).not.toHaveBeenCalled();
  });

  // A relationship has no name of its own to read.
  it("reads nothing for a model with no name column", async () => {
    const getItem: jest.SpyInstance = mockGetItem(() => {
      return null;
    });

    render(
      <ModelDelete
        modelType={MonitorProbe}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    expect(textOf("model-delete-card-message")).toBe(
      "This action cannot be undone.",
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getItem).not.toHaveBeenCalled();
  });

  it("falls back to the kind of thing, and still deletes, when the name cannot be read", async () => {
    getJestSpyOn(ModelAPI, "getItem").mockImplementation((): any => {
      return Promise.reject(new Error("You cannot read this column."));
    });
    const deleteItem: jest.SpyInstance = getJestSpyOn(
      ModelAPI,
      "deleteItem",
    ).mockResolvedValue(undefined as never);
    let deleted: boolean = false;

    render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {
          deleted = true;
        }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    openDialog("Delete Workflow");

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Are you sure you want to delete this workflow? This action cannot be undone.",
    );
    expect(screen.getByTestId("modal-footer-submit-button")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(deleted).toBe(true);
    });
    expect(deleteItem).toHaveBeenCalledTimes(1);
  });

  it("asks about the kind of thing for a record whose name is blank", async () => {
    mockGetItem(() => {
      return makeModel(Workflow, { name: "   " });
    });

    render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    openDialog("Delete Workflow");

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Are you sure you want to delete this workflow?",
    );
  });

  it("shortens a very long name, and shows the whole of it on hover", async () => {
    const longName: string = `Checkout ${"very ".repeat(60)}long name`;

    mockGetItem(() => {
      return makeModel(Workflow, { name: longName });
    });

    render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("delete-confirmation-name"),
      ).toBeInTheDocument();
    });

    const name: HTMLElement = screen.getByTestId("delete-confirmation-name");

    // Cut at the limit; a space it lands on is dropped before the ellipsis.
    const shownLength: number = Array.from(name.textContent || "").length;

    expect(shownLength).toBeLessThanOrEqual(MAX_DISPLAY_NAME_LENGTH);
    expect(shownLength).toBeGreaterThan(MAX_DISPLAY_NAME_LENGTH - 3);
    expect(name.textContent?.endsWith("…")).toBe(true);
    expect(name).toHaveAttribute("title", longName.replace(/\s+/g, " "));
  });

  it("draws a name with markup in it as text", async () => {
    mockGetItem(() => {
      return makeModel(Workflow, { name: "<img src=x onerror=alert(1)>" });
    });

    const { container } = render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
        "<img src=x onerror=alert(1)>",
      );
    });

    expect(container.querySelector("img")).toBeNull();
  });

  /*
   * The page builds a new ObjectID from the route on every render, and moves
   * from one record to the next without unmounting the card. A slow answer
   * about the record it has left must never name the one it is on.
   */
  it("never shows one record's name on another's card", async () => {
    let answerFirst: (value: unknown) => void = (): void => {};

    getJestSpyOn(ModelAPI, "getItem").mockImplementation((data: any): any => {
      if (data.id.toString() === WORKFLOW_ID.toString()) {
        return new Promise((resolve: (value: unknown) => void) => {
          answerFirst = resolve;
        });
      }

      return Promise.resolve(makeModel(Workflow, { name: "Second workflow" }));
    });

    const { rerender } = render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    rerender(
      <ModelDelete
        modelType={Workflow}
        modelId={OTHER_WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
        /^Second workflow$/,
      );
    });

    await act(async () => {
      answerFirst(makeModel(Workflow, { name: "First workflow" }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
      /^Second workflow$/,
    );
  });

  it("reads again for the record it is now on", async () => {
    const getItem: jest.SpyInstance = mockGetItem(
      (data: { id: ObjectID }): Workflow => {
        return makeModel(Workflow, {
          name:
            data.id.toString() === WORKFLOW_ID.toString() ? "First" : "Second",
        });
      },
    );

    const { rerender } = render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
        /^First$/,
      );
    });

    // A new ObjectID for the same record, as a re-render builds: no new read.
    rerender(
      <ModelDelete
        modelType={Workflow}
        modelId={new ObjectID(WORKFLOW_ID.toString())}
        onDeleteSuccess={(): void => {}}
      />,
    );

    expect(getItem).toHaveBeenCalledTimes(1);

    rerender(
      <ModelDelete
        modelType={Workflow}
        modelId={OTHER_WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-confirmation-name")).toHaveTextContent(
        /^Second$/,
      );
    });
    expect(getItem).toHaveBeenCalledTimes(2);
  });
});

describe("ModelDelete with a typed confirmation", () => {
  type RenderProjectDeleteFunction = (options?: {
    itemName?: string | undefined;
  }) => { deletes: () => number };

  const renderProjectDelete: RenderProjectDeleteFunction = (options?: {
    itemName?: string | undefined;
  }): { deletes: () => number } => {
    let deleteCount: number = 0;

    render(
      <ModelDelete
        modelType={Project}
        modelId={WORKFLOW_ID}
        requireTypedName={true}
        {...(options && "itemName" in options
          ? { itemName: options.itemName }
          : {})}
        onDelete={async (): Promise<void> => {
          deleteCount = deleteCount + 1;
        }}
        onDeleteSuccess={(): void => {}}
      />,
    );

    return {
      deletes: (): number => {
        return deleteCount;
      },
    };
  };

  type TypeNameFunction = (value: string) => void;

  const typeName: TypeNameFunction = (value: string): void => {
    fireEvent.change(
      screen.getByTestId("delete-confirmation-type-to-confirm-input"),
      { target: { value: value } },
    );
  };

  it("keeps Delete locked until the name is typed", async () => {
    const calls: { deletes: () => number } = renderProjectDelete({
      itemName: "Acme Production",
    });

    openDialog("Delete Project");

    const submit: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );

    expect(
      screen.getByTestId("delete-confirmation-type-to-confirm"),
    ).toHaveTextContent("Type Acme Production to confirm.");
    expect(submit).toBeDisabled();

    fireEvent.click(submit);
    expect(calls.deletes()).toBe(0);

    typeName("acme production");
    expect(submit).toBeDisabled();

    typeName("Acme Production");
    expect(submit).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(calls.deletes()).toBe(1);
    });
  });

  it("confirms with Enter in the box once the name matches", async () => {
    const calls: { deletes: () => number } = renderProjectDelete({
      itemName: "Acme Production",
    });

    openDialog("Delete Project");

    const input: HTMLElement = screen.getByTestId(
      "delete-confirmation-type-to-confirm-input",
    );

    fireEvent.change(input, { target: { value: "Acme" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls.deletes()).toBe(0);

    fireEvent.change(input, { target: { value: "Acme Production" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(calls.deletes()).toBe(1);
    });
  });

  it("starts empty again after the dialog is cancelled", () => {
    renderProjectDelete({ itemName: "Acme Production" });

    openDialog("Delete Project");
    typeName("Acme Production");
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    openDialog("Delete Project");

    expect(
      screen.getByTestId("delete-confirmation-type-to-confirm-input"),
    ).toHaveValue("");
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
  });

  it("asks for the whole name, even when the dialog shows it shortened", async () => {
    const longName: string = `Acme ${"Production ".repeat(20)}Europe`;

    renderProjectDelete({ itemName: longName });

    openDialog("Delete Project");

    expect(
      screen.getByTestId("delete-confirmation-type-to-confirm-name"),
    ).toHaveTextContent(longName.trim());

    typeName(longName.slice(0, MAX_DISPLAY_NAME_LENGTH - 1) + "…");
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();

    typeName(longName);
    expect(screen.getByTestId("modal-footer-submit-button")).not.toBeDisabled();
  });

  /*
   * Without a name there is nothing to type, and a box nobody can fill would
   * leave the project impossible to delete.
   */
  it("asks as usual when the name cannot be read", () => {
    getJestSpyOn(ModelAPI, "getItem").mockImplementation((): any => {
      return Promise.reject(new Error("Not allowed"));
    });

    renderProjectDelete();

    openDialog("Delete Project");

    expect(
      screen.queryByTestId("delete-confirmation-type-to-confirm"),
    ).toBeNull();
    expect(screen.getByTestId("modal-footer-submit-button")).not.toBeDisabled();
  });

  it("is not asked for by an ordinary delete", async () => {
    mockGetItem(() => {
      return makeModel(Workflow, { name: "Notify on-call" });
    });

    render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("delete-confirmation-name"),
      ).toBeInTheDocument();
    });

    openDialog("Delete Workflow");

    expect(
      screen.queryByTestId("delete-confirmation-type-to-confirm"),
    ).toBeNull();
    expect(screen.getByTestId("modal-footer-submit-button")).not.toBeDisabled();
  });

  it("keeps the page's own content above the typed name", () => {
    render(
      <ModelDelete
        modelType={Project}
        modelId={WORKFLOW_ID}
        itemName="Acme Production"
        requireTypedName={true}
        confirmationContent={<div data-testid="reason-field">Why?</div>}
        onDeleteSuccess={(): void => {}}
      />,
    );

    openDialog("Delete Project");

    const reason: HTMLElement = screen.getByTestId("reason-field");
    const typed: HTMLElement = screen.getByTestId(
      "delete-confirmation-type-to-confirm",
    );

    expect(
      reason.compareDocumentPosition(typed) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
