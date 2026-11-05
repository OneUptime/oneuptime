/*
 * Issue #5943, as the person building the workflow meets it: a setting that
 * names one of the project's records lists them by name, keeps a way to a value
 * from an earlier step, and never takes away what could be done before.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
    getModelTypeByName: () => {
      return null;
    },
  };
});

/*
 * The value picker's menu has suites of its own. Here it is one button that
 * picks a value, as the real menu's rows do.
 */
jest.mock(
  "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerMenu",
  () => {
    const React: typeof import("react") = jest.requireActual("react");

    return {
      __esModule: true,
      default: (props: { onPick: (reference: string) => void }) => {
        return React.createElement(
          "button",
          {
            type: "button",
            "data-testid": "pick-a-value",
            onClick: () => {
              props.onPick(
                "{{local.components.find-1.returnValues.model._id}}",
              );
            },
          },
          "pick a value",
        );
      },
    };
  },
);

import { DropdownOption } from "../../../../../UI/Components/Dropdown/Dropdown";
import LinkedRecordField from "../../../../../UI/Components/Workflow/LinkedRecord/LinkedRecordField";
import LinkedRecordInput, {
  LinkedRecordCopy,
  isPastableIntoRecordList,
  optionForValue,
} from "../../../../../UI/Components/Workflow/LinkedRecord/LinkedRecordInput";
import { LinkedRecordList } from "../../../../../UI/Components/Workflow/LinkedRecord/LinkedRecordSource";
import {
  LINKED_RECORD_SEARCH_DELAY_MS,
  LinkedRecordSources,
} from "../../../../../UI/Components/Workflow/LinkedRecord/UseLinkedRecords";
import { ValuePickerProvider } from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerContext";
import { WorkflowViewOnlyContext } from "../../../../../UI/Components/Workflow/WorkflowViewOnly";
import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement, useState } from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const SEV1: string = "7c000000-0000-4000-8000-0000000000a1";
const SEV2: string = "7c000000-0000-4000-8000-0000000000a2";
const SEV9: string = "7c000000-0000-4000-8000-0000000000a9";

const SEVERITIES: Array<DropdownOption> = [
  { value: SEV1, label: "SEV1", isUserContent: true },
  { value: SEV2, label: "SEV2", isUserContent: true },
];

const COMPONENT: NodeDataProp = {
  error: "",
  id: "incident-create-one-1",
  nodeType: NodeType.Node,
  metadata: {
    id: "incident-create-one",
    title: "Create One Incident",
    category: "Incident",
    description: "",
    iconProp: "Database",
    componentType: ComponentType.Component,
    arguments: [],
    returnValues: [],
    inPorts: [],
    outPorts: [],
  } as unknown as NodeDataProp["metadata"],
  metadataId: "incident-create-one",
  internalId: "internal",
  arguments: {} as JSONObject,
  returnValues: {} as JSONObject,
  componentType: ComponentType.Component,
};

interface FakeSources extends LinkedRecordSources {
  load: jest.Mock<any>;
  loadById: jest.Mock<any>;
}

type MakeSourcesFunction = (data?: {
  list?: LinkedRecordList;
  byId?: Array<DropdownOption>;
}) => FakeSources;

const makeSources: MakeSourcesFunction = (
  data: { list?: LinkedRecordList; byId?: Array<DropdownOption> } = {},
): FakeSources => {
  const sources: FakeSources = {
    load: jest.fn<any>(),
    loadById: jest.fn<any>(),
  } as FakeSources;

  sources.load.mockResolvedValue(
    data.list || { options: SEVERITIES, isComplete: true },
  );
  sources.loadById.mockResolvedValue(data.byId || []);

  return sources;
};

type WithPickerFunction = (element: ReactElement) => ReactElement;

const withPicker: WithPickerFunction = (
  element: ReactElement,
): ReactElement => {
  return (
    <ValuePickerProvider
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      component={COMPONENT}
      graphComponents={[COMPONENT]}
      sources={[]}
    >
      {element}
    </ValuePickerProvider>
  );
};

type OpenMenuFunction = () => Promise<void>;

const openMenu: OpenMenuFunction = async (): Promise<void> => {
  const box: HTMLElement = screen.getByRole("combobox");

  await act(async () => {
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: "ArrowDown", code: "ArrowDown" });
  });
};

type PickOptionFunction = (label: string) => Promise<void>;

const pickOption: PickOptionFunction = async (label: string): Promise<void> => {
  await openMenu();

  await act(async () => {
    fireEvent.click(await screen.findByText(label));
  });
};

type TypeInMenuFunction = (text: string) => Promise<void>;

const typeInMenu: TypeInMenuFunction = async (text: string): Promise<void> => {
  const box: HTMLElement = screen.getByRole("combobox");

  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
  });
};

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("isPastableIntoRecordList", () => {
  test("takes a record's ID, and a value from an earlier step written out", () => {
    expect(isPastableIntoRecordList(SEV1)).toBe(true);
    expect(isPastableIntoRecordList("{{local.variables.severityId}}")).toBe(
      true,
    );
  });

  test("takes no other words: they would only write an ID the run refuses", () => {
    expect(isPastableIntoRecordList("SEV")).toBe(false);
    expect(isPastableIntoRecordList("critical incident")).toBe(false);
    expect(isPastableIntoRecordList("")).toBe(false);
  });
});

describe("optionForValue", () => {
  test("is the record's name once it is known, whatever the ID's case", () => {
    const known: Map<string, DropdownOption> = new Map([
      [SEV1.toLowerCase(), SEVERITIES[0] as DropdownOption],
    ]);

    expect(optionForValue(SEV1.toUpperCase(), known).label).toBe("SEV1");
  });

  test("is the ID itself until then, so what is held is on screen", () => {
    expect(optionForValue(SEV9, new Map())).toEqual({
      value: SEV9,
      label: SEV9,
      isUserContent: true,
    });
  });
});

describe("one record", () => {
  test("lists the records by name, and picking one reports its ID", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value=""
          onChange={onChange}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    await pickOption("SEV2");

    expect(onChange).toHaveBeenCalledWith(SEV2);
  });

  test("says what the box is for while nothing is picked", async () => {
    render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value=""
          onChange={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    expect(
      await screen.findByText(LinkedRecordCopy.placeholder),
    ).toBeInTheDocument();
  });

  test("shows the record a stored ID names, by its name", async () => {
    render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value={SEV1}
          onChange={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    expect(await screen.findByText("SEV1")).toBeInTheDocument();
    expect(screen.queryByText(SEV1)).not.toBeInTheDocument();
  });

  test("looks up a stored ID the list does not show, and names it", async () => {
    const sources: FakeSources = makeSources({
      byId: [{ value: SEV9, label: "Old severity", isUserContent: true }],
    });

    render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value={SEV9}
          onChange={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={sources}
        />,
      ),
    );

    expect(await screen.findByText("Old severity")).toBeInTheDocument();
    expect(sources.loadById).toHaveBeenCalledWith({
      tableName: "IncidentSeverity",
      ids: [SEV9],
    });
  });

  test("shows an ID nothing answers to as it is, asking only once", async () => {
    const sources: FakeSources = makeSources({ byId: [] });

    const { rerender } = render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value={SEV9}
          onChange={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={sources}
        />,
      ),
    );

    expect(await screen.findByText(SEV9)).toBeInTheDocument();

    rerender(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value={SEV9}
          onChange={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={sources}
        />,
      ),
    );

    await waitFor(() => {
      expect(sources.loadById).toHaveBeenCalledTimes(1);
    });
  });

  test("clearing it reports nothing held", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const { container } = render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value={SEV1}
          onChange={onChange}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    await screen.findByText("SEV1");

    const clear: Element | null = container.querySelector(
      ".ou-select__clear-indicator",
    );

    expect(clear).not.toBeNull();

    await act(async () => {
      fireEvent.mouseDown(clear as Element);
    });

    expect(onChange).toHaveBeenCalledWith("");
  });

  test("an ID pasted in is offered, and picking it reports it", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value=""
          onChange={onChange}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    await screen.findByText(LinkedRecordCopy.placeholder);
    await openMenu();
    await typeInMenu(SEV9);

    await act(async () => {
      fireEvent.click(await screen.findByText(`Use “${SEV9}”`));
    });

    expect(onChange).toHaveBeenCalledWith(SEV9);
  });

  test("words that are neither are a search, not a value", async () => {
    render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value=""
          onChange={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    await screen.findByText(LinkedRecordCopy.placeholder);
    await openMenu();
    await typeInMenu("nothing like it");

    expect(
      await screen.findByText("Nothing matches “nothing like it”."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Use “nothing like it”")).not.toBeInTheDocument();
  });

  test("a setting that takes words keeps them", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value=""
          onChange={onChange}
          allowsAnyText={true}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    await screen.findByText(LinkedRecordCopy.placeholder);
    await openMenu();
    await typeInMenu("most severe");

    await act(async () => {
      fireEvent.click(await screen.findByText("Use “most severe”"));
    });

    expect(onChange).toHaveBeenCalledWith("most severe");
  });
});

describe("a value from an earlier step", () => {
  test("is one press of { } away, and reports the reference", async () => {
    const onPickReference: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value=""
          onChange={getJestMockFunction()}
          onPickReference={onPickReference}
          dataTestId="severity"
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    await act(async () => {
      fireEvent.click(await screen.findByTestId("severity-insert-value"));
    });

    await act(async () => {
      fireEvent.click(await screen.findByTestId("pick-a-value"));
    });

    expect(onPickReference).toHaveBeenCalledWith(
      "{{local.components.find-1.returnValues.model._id}}",
    );
  });

  test("offers no { } where nothing could be picked", async () => {
    render(
      <LinkedRecordInput
        tableName="IncidentSeverity"
        value=""
        onChange={getJestMockFunction()}
        onPickReference={getJestMockFunction()}
        dataTestId="severity"
        renderFallback={() => {
          return <div>fallback</div>;
        }}
        sources={makeSources()}
      />,
    );

    await screen.findByText(LinkedRecordCopy.placeholder);

    expect(
      screen.queryByTestId("severity-insert-value"),
    ).not.toBeInTheDocument();
  });
});

describe("a person who may not list these records", () => {
  test("gets the box to type an ID into, as before", async () => {
    const sources: FakeSources = makeSources();

    sources.load.mockRejectedValue(new Error("Not allowed"));

    render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value=""
          onChange={getJestMockFunction()}
          renderFallback={() => {
            return <div>type an ID here</div>;
          }}
          sources={sources}
        />,
      ),
    );

    expect(await screen.findByText("type an ID here")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("a long list", () => {
  const FIRST_PAGE: LinkedRecordList = {
    options: [{ value: SEV1, label: "Checkout", isUserContent: true }],
    isComplete: false,
  };

  test("asks the server what matches, once typing pauses", async () => {
    const sources: FakeSources = makeSources({ list: FIRST_PAGE });

    render(
      withPicker(
        <LinkedRecordInput
          tableName="Monitor"
          value=""
          onChange={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={sources}
        />,
      ),
    );

    await screen.findByText(LinkedRecordCopy.placeholder);

    jest.useFakeTimers();

    sources.load.mockResolvedValue({
      options: [{ value: SEV2, label: "Payments", isUserContent: true }],
      isComplete: false,
    });

    await openMenu();
    await typeInMenu("pay");

    expect(sources.load).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(LINKED_RECORD_SEARCH_DELAY_MS);
    });

    expect(sources.load).toHaveBeenLastCalledWith({
      tableName: "Monitor",
      search: "pay",
    });

    jest.useRealTimers();

    expect(await screen.findByText("Payments")).toBeInTheDocument();
  });

  test("drops the answer to words typed over", async () => {
    const sources: FakeSources = makeSources({ list: FIRST_PAGE });

    render(
      withPicker(
        <LinkedRecordInput
          tableName="Monitor"
          value=""
          onChange={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={sources}
        />,
      ),
    );

    await screen.findByText(LinkedRecordCopy.placeholder);

    jest.useFakeTimers();

    let answerSlow: (list: LinkedRecordList) => void = () => {};

    sources.load.mockImplementationOnce(() => {
      return new Promise((resolve: (list: LinkedRecordList) => void) => {
        answerSlow = resolve;
      });
    });

    sources.load.mockResolvedValueOnce({
      options: [{ value: SEV2, label: "Pay fast", isUserContent: true }],
      isComplete: false,
    });

    await openMenu();
    await typeInMenu("pa");

    await act(async () => {
      jest.advanceTimersByTime(LINKED_RECORD_SEARCH_DELAY_MS);
    });

    await typeInMenu("pay");

    await act(async () => {
      jest.advanceTimersByTime(LINKED_RECORD_SEARCH_DELAY_MS);
    });

    await act(async () => {
      answerSlow({
        options: [{ value: SEV9, label: "Pa slow", isUserContent: true }],
        isComplete: false,
      });
    });

    jest.useRealTimers();

    expect(await screen.findByText("Pay fast")).toBeInTheDocument();
    expect(screen.queryByText("Pa slow")).not.toBeInTheDocument();
  });
});

describe("a list that is all there", () => {
  test("is filtered where it is, and the server is not asked again", async () => {
    const sources: FakeSources = makeSources();

    render(
      withPicker(
        <LinkedRecordInput
          tableName="IncidentSeverity"
          value=""
          onChange={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={sources}
        />,
      ),
    );

    await screen.findByText(LinkedRecordCopy.placeholder);
    await openMenu();
    await typeInMenu("SEV2");

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, LINKED_RECORD_SEARCH_DELAY_MS + 50);
    });

    expect(sources.load).toHaveBeenCalledTimes(1);
    expect(screen.getByText("SEV2")).toBeInTheDocument();
    expect(screen.queryByText("SEV1")).not.toBeInTheDocument();
  });
});

describe("several records", () => {
  test("shows each by name, and reports the IDs as they change", async () => {
    const onChangeList: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <LinkedRecordInput
          tableName="Label"
          isList={true}
          values={[SEV1]}
          onChangeList={onChangeList}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    expect(await screen.findByText("SEV1")).toBeInTheDocument();

    await pickOption("SEV2");

    expect(onChangeList).toHaveBeenCalledWith([SEV1, SEV2]);
  });

  test("taking the last one off reports an empty list", async () => {
    const onChangeList: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <LinkedRecordInput
          tableName="Label"
          isList={true}
          values={[SEV1]}
          onChangeList={onChangeList}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    await screen.findByText("SEV1");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove SEV1"));
    });

    expect(onChangeList).toHaveBeenCalledWith([]);
  });

  test("keeps a value from an earlier step among them, as written", async () => {
    render(
      withPicker(
        <LinkedRecordInput
          tableName="Label"
          isList={true}
          values={["{{local.variables.labelId}}"]}
          onChangeList={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={makeSources()}
        />,
      ),
    );

    expect(
      await screen.findByText("{{local.variables.labelId}}"),
    ).toBeInTheDocument();
  });

  test("never asks the server what a reference is called", async () => {
    const sources: FakeSources = makeSources();

    render(
      withPicker(
        <LinkedRecordInput
          tableName="Label"
          isList={true}
          values={["{{local.variables.labelId}}"]}
          onChangeList={getJestMockFunction()}
          renderFallback={() => {
            return <div>fallback</div>;
          }}
          sources={sources}
        />,
      ),
    );

    await screen.findByText("{{local.variables.labelId}}");

    expect(sources.loadById).not.toHaveBeenCalled();
  });
});

describe("a step opened to be read", () => {
  test("shows the record by name, held still, with no { }", async () => {
    render(
      <WorkflowViewOnlyContext.Provider value={true}>
        {withPicker(
          <LinkedRecordInput
            tableName="IncidentSeverity"
            value={SEV1}
            onChange={getJestMockFunction()}
            onPickReference={getJestMockFunction()}
            dataTestId="severity"
            renderFallback={() => {
              return <div>fallback</div>;
            }}
            sources={makeSources()}
          />,
        )}
      </WorkflowViewOnlyContext.Provider>,
    );

    expect(await screen.findByText("SEV1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("severity-insert-value"),
    ).not.toBeInTheDocument();
    // Nothing to search or open: react-select draws no box while disabled.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  test("shows a list by name, with nothing to take off", async () => {
    render(
      <WorkflowViewOnlyContext.Provider value={true}>
        {withPicker(
          <LinkedRecordInput
            tableName="Label"
            isList={true}
            values={[SEV1, SEV2]}
            onChangeList={getJestMockFunction()}
            renderFallback={() => {
              return <div>fallback</div>;
            }}
            sources={makeSources()}
          />,
        )}
      </WorkflowViewOnlyContext.Provider>,
    );

    expect(await screen.findByText("SEV1")).toBeInTheDocument();
    expect(screen.getByText("SEV2")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remove SEV1")).not.toBeInTheDocument();
  });

  test("says so when a list holds nothing", async () => {
    render(
      <WorkflowViewOnlyContext.Provider value={true}>
        {withPicker(
          <LinkedRecordInput
            tableName="Label"
            isList={true}
            values={[]}
            renderFallback={() => {
              return <div>fallback</div>;
            }}
            sources={makeSources()}
          />,
        )}
      </WorkflowViewOnlyContext.Provider>,
    );

    expect(
      await screen.findByText(LinkedRecordCopy.noneChosen),
    ).toBeInTheDocument();
  });
});

describe("a step's own setting: LinkedRecordField", () => {
  interface ControlledFieldProps {
    initial: string;
    isList?: boolean;
    onChange: (value: string) => void;
    sources: LinkedRecordSources;
  }

  const ControlledField: React.FunctionComponent<ControlledFieldProps> = (
    props: ControlledFieldProps,
  ): ReactElement => {
    const [value, setValue] = useState<string>(props.initial);

    return (
      <LinkedRecordField
        tableName="IncidentSeverity"
        value={value}
        isList={props.isList}
        dataTestId="severity"
        onChange={(next: string) => {
          setValue(next);
          props.onChange(next);
        }}
        sources={props.sources}
      />
    );
  };

  test("picking a record stores its ID, as text", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <ControlledField
          initial=""
          onChange={onChange}
          sources={makeSources()}
        />,
      ),
    );

    await screen.findByText(LinkedRecordCopy.placeholder);
    await pickOption("SEV1");

    expect(onChange).toHaveBeenCalledWith(SEV1);
    expect(await screen.findByText("SEV1")).toBeInTheDocument();
  });

  test("a value from an earlier step replaces the list with its chip", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <ControlledField
          initial=""
          onChange={onChange}
          sources={makeSources()}
        />,
      ),
    );

    await act(async () => {
      fireEvent.click(await screen.findByTestId("severity-insert-value"));
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId("pick-a-value"));
    });

    expect(onChange).toHaveBeenCalledWith(
      "{{local.components.find-1.returnValues.model._id}}",
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      await screen.findByTestId("severity-pick-from-list"),
    ).toBeInTheDocument();
  });

  test("the way back to the list empties the setting and shows the list", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <ControlledField
          initial="{{local.variables.severityId}}"
          onChange={onChange}
          sources={makeSources()}
        />,
      ),
    );

    await act(async () => {
      fireEvent.click(await screen.findByTestId("severity-pick-from-list"));
    });

    expect(onChange).toHaveBeenCalledWith("");
    expect(
      await screen.findByText(LinkedRecordCopy.placeholder),
    ).toBeInTheDocument();
  });

  test("several records are stored separated by commas", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <ControlledField
          initial={SEV1}
          isList={true}
          onChange={onChange}
          sources={makeSources()}
        />,
      ),
    );

    await screen.findByText("SEV1");
    await pickOption("SEV2");

    expect(onChange).toHaveBeenCalledWith(`${SEV1},${SEV2}`);
  });

  test("a value from an earlier step joins the list, after a comma", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      withPicker(
        <ControlledField
          initial={SEV1}
          isList={true}
          onChange={onChange}
          sources={makeSources()}
        />,
      ),
    );

    await screen.findByText("SEV1");

    await act(async () => {
      fireEvent.click(screen.getByTestId("severity-insert-value"));
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId("pick-a-value"));
    });

    expect(onChange).toHaveBeenCalledWith(
      `${SEV1},{{local.components.find-1.returnValues.model._id}}`,
    );
  });

  test("where the records cannot be listed, it is a box to type into", async () => {
    const sources: FakeSources = makeSources();

    sources.load.mockRejectedValue(new Error("Not allowed"));

    render(
      withPicker(
        <ControlledField
          initial={SEV1}
          onChange={getJestMockFunction()}
          sources={sources}
        />,
      ),
    );

    await waitFor(() => {
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.getByTestId("severity")).toHaveTextContent(SEV1);
    });
  });
});
