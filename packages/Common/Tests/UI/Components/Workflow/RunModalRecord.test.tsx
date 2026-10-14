/*
 * The Run Workflow panel, end to end in the component: a record trigger asks
 * for its record by number or name, the confirmation says what the run will
 * do with it, and what is sent is what the trigger reads. Other triggers keep
 * their fields, now sent as their trigger receives them for real.
 */

import { ComponentProps as CodeEditorProps } from "../../../../UI/Components/CodeEditor/CodeEditor";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import type { Mock } from "jest-mock";

/*
 * The code editor does not run under jsdom; the field only has to hold text,
 * and say it is invalid the way the real editor's text box does.
 */
jest.mock("../../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      const raw: unknown = props.value ?? props.initialValue ?? "";

      return (
        <textarea
          aria-labelledby={props.ariaLabelledby}
          aria-invalid={props.ariaInvalid || props.error ? true : undefined}
          data-testid="code-editor"
          value={typeof raw === "string" ? raw : JSON.stringify(raw)}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

import RunModal from "../../../../UI/Components/Workflow/RunModal";
import { LoadRunRecordsFunction } from "../../../../UI/Components/Workflow/RunRecordSource";
import Incident from "../../../../Models/DatabaseModels/Incident";
import BuiltInComponents from "../../../../Types/Workflow/Components";
import BaseModelComponent from "../../../../Types/Workflow/Components/BaseModel";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ObjectID from "../../../../Types/ObjectID";
import {
  RunRecordMatch,
  RunRecordOption,
} from "../../../../Types/Workflow/RunRecord";
import { resetPageScrollLockForTesting } from "../../../../UI/Utils/PageScrollLock";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

const EIGHT: RunRecordOption = {
  id: "11111111-1111-4111-8111-111111111111",
  number: "INC-8",
  name: "Database is down",
  createdAt: new Date().toISOString(),
  matchedBy: RunRecordMatch.Recent,
};

type NodeOfFunction = (metadata: ComponentMetadata) => NodeDataProp;

const nodeOf: NodeOfFunction = (metadata: ComponentMetadata): NodeDataProp => {
  return {
    id: `${metadata.id}-1`,
    internalId: `runner-${metadata.id}-1`,
    nodeType: NodeType.Node,
    componentType: metadata.componentType,
    metadataId: metadata.id,
    metadata: { ...metadata },
    error: "",
    arguments: {},
    returnValues: {},
  };
};

type IncidentTriggerFunction = (suffix: string) => NodeDataProp;

const incidentTrigger: IncidentTriggerFunction = (
  suffix: string,
): NodeDataProp => {
  return nodeOf(
    BaseModelComponent.getComponents(new Incident()).find(
      (component: ComponentMetadata): boolean => {
        return component.id === `incident-${suffix}`;
      },
    )!,
  );
};

type BuiltInFunction = (id: string) => NodeDataProp;

const builtIn: BuiltInFunction = (id: string): NodeDataProp => {
  return nodeOf(
    BuiltInComponents.find((component: ComponentMetadata): boolean => {
      return component.id === id;
    })!,
  );
};

interface Harness {
  onRun: Mock<(trigger: NodeDataProp) => void>;
  load: Mock<LoadRunRecordsFunction>;
}

interface RenderPanelOptions {
  withWorkflowId?: boolean;
  // What a search finds; the one newest record unless a test says otherwise.
  records?: (search: string) => Array<RunRecordOption>;
}

type RenderPanelFunction = (
  trigger: NodeDataProp,
  options?: RenderPanelOptions,
) => Harness;

const renderPanel: RenderPanelFunction = (
  trigger: NodeDataProp,
  options?: RenderPanelOptions,
): Harness => {
  const onRun: Mock<(trigger: NodeDataProp) => void> = jest.fn();
  const load: Mock<LoadRunRecordsFunction> = jest.fn(
    async (data: {
      workflowId: ObjectID;
      search: string;
    }): Promise<Array<RunRecordOption>> => {
      return options?.records ? options.records(data.search) : [EIGHT];
    },
  );

  render(
    <RunModal
      trigger={trigger}
      onClose={jest.fn()}
      onRun={onRun}
      workflowId={options?.withWorkflowId === false ? undefined : WORKFLOW_ID}
      loadRunRecords={load}
    />,
  );

  return { onRun: onRun, load: load };
};

type PressRunFunction = () => void;

const pressRun: PressRunFunction = (): void => {
  fireEvent.click(
    within(screen.getByTestId("side-over-footer")).getByRole("button", {
      name: "Run Workflow Manually",
    }),
  );
};

type ConfirmDialogFunction = () => HTMLElement;

const confirmDialog: ConfirmDialogFunction = (): HTMLElement => {
  const title: HTMLElement = screen.getByText("Run this workflow now?");

  return title.closest('[role="dialog"]') as HTMLElement;
};

/*
 * What the confirmation says, as one sentence: the record in it is drawn in
 * bold, an element of its own, so the words are read off the whole of it.
 */
const confirmWords: ConfirmDialogFunction = (): HTMLElement => {
  return within(confirmDialog()).getByTestId("confirm-modal-description");
};

beforeEach(() => {
  resetPageScrollLockForTesting();
});

afterEach(() => {
  resetPageScrollLockForTesting();
  document.body.style.overflow = "";
});

describe("running an incident trigger", () => {
  test("asks for the incident, by number or name, and says what the run does with it", () => {
    renderPanel(incidentTrigger("on-create"));

    expect(screen.getByText("Incident")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The run starts as if this incident had just been created.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("run-record-field-search")).toHaveAttribute(
      "placeholder",
      "Search by number or name",
    );
    // The old ID box and its wording are gone.
    expect(screen.queryByText("Incident ID")).toBeNull();
    expect(screen.queryByPlaceholderText("ID of the Incident")).toBeNull();
  });

  test("picking INC-8 runs with its ID, after a confirmation that names it", async () => {
    const harness: Harness = renderPanel(incidentTrigger("on-create"));

    await act(async () => {
      fireEvent.focus(screen.getByTestId("run-record-field-search"));
    });

    const option: HTMLElement = await screen.findByTestId(
      "run-record-field-option",
    );

    fireEvent.click(option);
    pressRun();

    expect(confirmWords()).toHaveTextContent(
      /^It runs as if INC-8 · Database is down had just been created\. Every step runs for real: anything it sends, writes or deletes actually happens\.$/,
    );

    fireEvent.click(
      within(confirmDialog()).getByTestId("modal-footer-submit-button"),
    );

    expect(harness.onRun).toHaveBeenCalledTimes(1);
    expect(harness.onRun.mock.calls[0]![0].arguments).toEqual({
      _id: EIGHT.id,
    });
  });

  test("a number typed without picking is sent as typed, and the confirmation names it", async () => {
    const harness: Harness = renderPanel(incidentTrigger("on-update"));

    fireEvent.change(screen.getByTestId("run-record-field-search"), {
      target: { value: " INC-8 " },
    });

    pressRun();

    expect(confirmWords()).toHaveTextContent(
      /^It runs as if INC-8 had just been updated\. Every step runs for real: anything it sends, writes or deletes actually happens\.$/,
    );
    // What was typed is what the run acts on, and stands out as a pick does.
    expect(
      within(confirmWords()).getByTestId("run-confirm-record"),
    ).toHaveTextContent(/^INC-8$/);

    fireEvent.click(
      within(confirmDialog()).getByTestId("modal-footer-submit-button"),
    );

    expect(harness.onRun.mock.calls[0]![0].arguments).toEqual({
      _id: "INC-8",
    });
  });

  test("INC-8 typed out and the box left: the field shows the incident, the confirmation names it, and the run gets its ID", async () => {
    const found: RunRecordOption = {
      ...EIGHT,
      matchedBy: RunRecordMatch.Number,
    };
    const harness: Harness = renderPanel(incidentTrigger("on-update"), {
      records: (search: string): Array<RunRecordOption> => {
        return search === "INC-8" ? [found] : [];
      },
    });

    const search: HTMLElement = screen.getByTestId("run-record-field-search");

    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "INC-8" } });

    await screen.findByTestId("run-record-field-option");

    // Pressing the panel's button takes the focus out of the box first.
    fireEvent.blur(search, { relatedTarget: document.body });

    expect(screen.getByTestId("run-record-field-picked")).toHaveTextContent(
      "Database is down",
    );

    pressRun();

    expect(confirmWords()).toHaveTextContent(
      /^It runs as if INC-8 · Database is down had just been updated\. Every step runs for real: anything it sends, writes or deletes actually happens\.$/,
    );

    fireEvent.click(
      within(confirmDialog()).getByTestId("modal-footer-submit-button"),
    );

    expect(harness.onRun.mock.calls[0]![0].arguments).toEqual({
      _id: EIGHT.id,
    });
  });

  test("a delete trigger's confirmation says nothing is deleted", async () => {
    renderPanel(incidentTrigger("on-delete"));

    fireEvent.change(screen.getByTestId("run-record-field-search"), {
      target: { value: "INC-8" },
    });
    pressRun();

    expect(confirmWords()).toHaveTextContent(
      /^It runs as if INC-8 had just been deleted, but nothing is deleted\. Every step runs for real: anything it sends, writes or deletes actually happens\.$/,
    );
  });

  /*
   * A record's name is a sentence of its own. In the weight of the words
   * around it, "It runs as if INC-8 · Database is down had just been
   * created." read as though the database had been created.
   */
  test("the confirmation sets the record apart from the sentence it is named in", async () => {
    renderPanel(incidentTrigger("on-create"));

    await act(async () => {
      fireEvent.focus(screen.getByTestId("run-record-field-search"));
    });

    fireEvent.click(await screen.findByTestId("run-record-field-option"));
    pressRun();

    const record: HTMLElement =
      within(confirmWords()).getByTestId("run-confirm-record");

    // The whole of the record, and nothing but the record.
    expect(record).toHaveTextContent(/^INC-8 · Database is down$/);
    expect(record.tagName).toBe("STRONG");
    expect(record).toHaveClass("font-semibold", "text-gray-900");
    // The sentence around it is the dialog's own quieter grey.
    expect(confirmWords()).toHaveClass("text-gray-600");
    expect(confirmWords()).not.toHaveClass("font-semibold");
    // One bold thing in the sentence: the record.
    expect(confirmWords().querySelectorAll("strong")).toHaveLength(1);
  });

  test("a very long title is all in bold, however many lines it takes", async () => {
    const long: RunRecordOption = {
      ...EIGHT,
      name: "Database connection pool exhausted on the primary cluster in eu-west-1 after the 14:00 deploy",
    };

    renderPanel(incidentTrigger("on-update"), {
      records: (): Array<RunRecordOption> => {
        return [long];
      },
    });

    await act(async () => {
      fireEvent.focus(screen.getByTestId("run-record-field-search"));
    });

    fireEvent.click(await screen.findByTestId("run-record-field-option"));
    pressRun();

    expect(
      within(confirmWords()).getByTestId("run-confirm-record"),
    ).toHaveTextContent(`INC-8 · ${long.name}`);
    expect(confirmWords()).toHaveTextContent(
      `It runs as if INC-8 · ${long.name} had just been updated. Every step runs for real: anything it sends, writes or deletes actually happens.`,
    );
  });

  test("part of a title is not enough to run with: the field says to pick one", async () => {
    const harness: Harness = renderPanel(incidentTrigger("on-create"));

    const search: HTMLElement = screen.getByTestId("run-record-field-search");

    fireEvent.change(search, { target: { value: "database" } });
    fireEvent.blur(search, { relatedTarget: document.body });

    expect(
      await screen.findByText(
        "Pick one from the list, or type its number or ID.",
      ),
    ).toBeInTheDocument();

    pressRun();

    // Nothing runs, and nothing asks whether to run.
    expect(screen.queryByText("Run this workflow now?")).toBeNull();
    expect(harness.onRun).not.toHaveBeenCalled();
    // The field still says what it needs; no dialog says it for it.
    expect(screen.getByTestId("run-record-field-error")).toHaveTextContent(
      "Pick one from the list, or type its number or ID.",
    );
    expect(screen.queryByText("Please fix errors")).toBeNull();
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  /*
   * Run pressed with nothing picked. A dialog used to say "Please fix
   * errors - There are some validation errors on the form", over a form that
   * showed none: a field says what it needs once it has been left, and
   * nobody had been in it yet. Closing the dialog left the panel as it was.
   */
  test("Run with nothing picked says so at the field, and puts the typing there", async () => {
    const harness: Harness = renderPanel(incidentTrigger("on-update"));
    const search: HTMLElement = screen.getByTestId("run-record-field-search");

    /*
     * Somewhere else first, as after a look around the panel. The box was
     * given the focus, not chosen: leaving it empty says nothing yet.
     */
    await act(async () => {
      search.blur();
    });
    expect(search).not.toHaveFocus();
    expect(screen.queryByTestId("run-record-field-error")).toBeNull();
    expect(screen.queryByTestId("run-record-field-option")).toBeNull();

    pressRun();

    expect(
      await screen.findByTestId("run-record-field-error"),
    ).toHaveTextContent(/^Pick one from the list, or type its number or ID\.$/);
    // In the field's words, not the form's.
    expect(screen.queryByText("Incident is required.")).toBeNull();
    // No dialog, of either kind.
    expect(screen.queryByText("Please fix errors")).toBeNull();
    expect(screen.queryByText("Run this workflow now?")).toBeNull();
    expect(screen.queryByTestId("modal")).toBeNull();
    expect(harness.onRun).not.toHaveBeenCalled();

    // The focus is in the box, which lists the records to pick from.
    await waitFor(() => {
      expect(search).toHaveFocus();
    });
    expect(await screen.findByTestId("run-record-field-option")).toBeVisible();
    expect(search).toHaveAttribute("aria-invalid", "true");
  });

  test("a pick after that clears the message, and Run goes on to ask", async () => {
    const harness: Harness = renderPanel(incidentTrigger("on-update"));

    pressRun();
    await screen.findByTestId("run-record-field-error");

    fireEvent.click(await screen.findByTestId("run-record-field-option"));

    expect(screen.queryByTestId("run-record-field-error")).toBeNull();

    pressRun();

    expect(confirmWords()).toHaveTextContent(
      "It runs as if INC-8 · Database is down had just been updated.",
    );

    fireEvent.click(
      within(confirmDialog()).getByTestId("modal-footer-submit-button"),
    );

    expect(harness.onRun.mock.calls[0]![0].arguments).toEqual({
      _id: EIGHT.id,
    });
  });

  /*
   * As the panel opens the box is where the typing goes, and the newest
   * incidents are listed at once: the one just made is one click away, and
   * "INC-8" can be typed without a click on the box first.
   */
  test("the panel opens on the search, with the newest incidents listed", async () => {
    const harness: Harness = renderPanel(incidentTrigger("on-create"));

    expect(screen.getByTestId("run-record-field-search")).toHaveFocus();
    expect(await screen.findByTestId("run-record-field-option")).toBeVisible();
    expect(screen.getByText("Most recent")).toBeInTheDocument();
    expect(
      harness.load.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { search: string }).search;
      }),
    ).toEqual([""]);
    // Opening the panel says nothing is wrong with it.
    expect(screen.queryByTestId("run-record-field-error")).toBeNull();
  });

  test("without a workflow to look records up in, the ID is typed as before", () => {
    renderPanel(incidentTrigger("on-create"), { withWorkflowId: false });

    expect(screen.queryByTestId("run-record-field")).toBeNull();
    expect(screen.getByText("Incident ID")).toBeInTheDocument();
  });
});

describe("running any other trigger", () => {
  test("the panel says what it does in a sentence", () => {
    renderPanel(builtIn(ComponentID.Manual));

    expect(
      screen.getByText(
        "Start a run now, from the trigger, with the values you choose.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "You can run this workflow manually. This can be helpful to test the workflow.",
      ),
    ).toBeNull();
  });

  test("the Manual trigger's JSON is sent as JSON", () => {
    const harness: Harness = renderPanel(builtIn(ComponentID.Manual));

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: '{"name": "Ada"}' },
    });
    pressRun();

    expect(confirmWords()).toHaveTextContent(
      /^Every step runs for real: anything it sends, writes or deletes actually happens\.$/,
    );
    // No record to name, so nothing in the sentence is set apart.
    expect(
      within(confirmWords()).queryByTestId("run-confirm-record"),
    ).toBeNull();
    expect(confirmWords().querySelector("strong")).toBeNull();

    fireEvent.click(
      within(confirmDialog()).getByTestId("modal-footer-submit-button"),
    );

    expect(harness.onRun.mock.calls[0]![0].arguments).toEqual({
      value: { name: "Ada" },
    });
    expect(harness.load).not.toHaveBeenCalled();
  });

  /*
   * Any trigger's panel says what is wrong where it is wrong. A Webhook's
   * Request Body that is not JSON is the editor's to say; Run pressed over
   * it used to open "Please fix errors" as well.
   */
  test("Run over a value that cannot be sent opens no dialog about errors, and puts the focus in the editor", async () => {
    const harness: Harness = renderPanel(builtIn(ComponentID.Manual));
    const editor: HTMLElement = screen.getByTestId("code-editor");

    fireEvent.change(editor, {
      target: { value: "{ not json" },
    });
    pressRun();

    await waitFor(() => {
      expect(editor).toHaveFocus();
    });
    expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Please fix errors")).toBeNull();
    expect(screen.queryByText("Run this workflow now?")).toBeNull();
    expect(harness.onRun).not.toHaveBeenCalled();
  });

  test("a trigger that needs no values says so, naming the button to press", () => {
    renderPanel(builtIn(ComponentID.Schedule));

    const sentence: HTMLElement = screen.getByTestId("run-form-no-values");

    expect(sentence).toHaveTextContent(
      "This trigger needs no values. Click Run Workflow Manually to start the run.",
    );

    expect(within(sentence).getByText("Run Workflow Manually").tagName).toBe(
      "STRONG",
    );
  });
});
