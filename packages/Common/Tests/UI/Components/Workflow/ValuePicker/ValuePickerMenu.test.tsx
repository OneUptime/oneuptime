/*
 * The list of values a setting can use. It names everything the way a
 * person would - the step, the value, what it holds - searches, walks with
 * the arrow keys, and opens a record to its fields or a JSON value to a path.
 */

import ValuePickerMenu, {
  ValuePickerMenuHandle,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerMenu";
import {
  ValueSuggestion,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  ValueSuggestionSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import {
  API_KEY,
  BODY,
  DEPLOY_ENV,
  HEADERS,
  SAMPLE_GROUPS,
  keys,
  staticSource,
  withPicker,
} from "./ValuePickerTestUtils";
import IconProp from "../../../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

const INCIDENT_MODEL: string =
  "{{local.components.incident-on-create-1.returnValues.model}}";

type RecordGroupFunction = (
  loadChildren: () => Promise<Array<ValueSuggestion>>,
) => ValueSuggestionGroup;

const recordGroup: RecordGroupFunction = (
  loadChildren: () => Promise<Array<ValueSuggestion>>,
): ValueSuggestionGroup => {
  return {
    id: "step:incident-on-create-1",
    kind: ValueSuggestionGroupKind.Step,
    title: "On Create Incident",
    subtitle: "incident-on-create-1",
    iconProp: IconProp.Bolt,
    order: 0,
    items: [
      {
        reference: INCIDENT_MODEL,
        label: "Incident",
        typeLabel: "Record",
        drillIn: {
          wholeValueLabel: "The whole Incident",
          allowsPath: true,
          loadChildren: loadChildren,
        },
      },
    ],
  };
};

const INCIDENT_FIELDS: Array<ValueSuggestion> = [
  {
    reference: "{{local.components.incident-on-create-1.returnValues.model.title}}",
    label: "Title",
    typeLabel: "Text",
  },
  {
    reference:
      "{{local.components.incident-on-create-1.returnValues.model.description}}",
    label: "Description",
    typeLabel: "Long text",
    badges: ["Not selected"],
  },
];

interface RenderMenuOptions {
  groups?: Array<ValueSuggestionGroup>;
  sources?: Array<ValueSuggestionSource>;
  hasSearchBox?: boolean;
  query?: string;
  groupFilter?: (group: ValueSuggestionGroup) => boolean;
  emptyMessage?: string;
  menuRef?: React.MutableRefObject<ValuePickerMenuHandle | null>;
  onActiveOptionChange?: (id: string | undefined) => void;
  valueSources?: {
    upstream: [];
    downstreamIds: [];
    hasIncomingConnection: boolean;
  };
  isTrigger?: boolean;
}

interface RenderedMenu {
  onPick: MockFunction;
  user: UserEvent;
  rerender: (options: RenderMenuOptions) => void;
}

type RenderMenuFunction = (options?: RenderMenuOptions) => RenderedMenu;

const renderMenu: RenderMenuFunction = (
  options: RenderMenuOptions = {},
): RenderedMenu => {
  const onPick: MockFunction = getJestMockFunction();

  const ui: (current: RenderMenuOptions) => ReactElement = (
    current: RenderMenuOptions,
  ): ReactElement => {
    return withPicker(
      <ValuePickerMenu
        ref={current.menuRef}
        hasSearchBox={current.hasSearchBox ?? true}
        query={current.query}
        groupFilter={current.groupFilter}
        emptyMessage={current.emptyMessage}
        onActiveOptionChange={current.onActiveOptionChange}
        onPick={onPick}
      />,
      {
        groups: current.groups,
        sources: current.sources,
        valueSources: current.valueSources,
        component: current.isTrigger
          ? ({ componentType: "Trigger" } as never)
          : undefined,
      },
    );
  };

  const view: ReturnType<typeof render> = render(ui(options));

  return {
    onPick: onPick,
    user: userEvent.setup({ delay: null }),
    rerender: (next: RenderMenuOptions) => {
      view.rerender(ui(next));
    },
  };
};

type OptionsFunction = () => Array<HTMLElement>;

const options: OptionsFunction = (): Array<HTMLElement> => {
  return screen.queryAllByRole("option");
};

type OptionLabelsFunction = () => Array<string>;

const optionReferences: OptionLabelsFunction = (): Array<string> => {
  return options().map((option: HTMLElement) => {
    return option.getAttribute("data-reference") || "";
  });
};

type ActiveFunction = () => HTMLElement | undefined;

const active: ActiveFunction = (): HTMLElement | undefined => {
  return options().find((option: HTMLElement) => {
    return option.getAttribute("aria-selected") === "true";
  });
};

afterEach(() => {
  cleanup();
});

describe("what it lists", () => {
  test("each step by its name, then the variables", () => {
    renderMenu();

    const groups: Array<HTMLElement> = screen.getAllByRole("group");

    expect(
      groups.map((group: HTMLElement) => {
        return group.getAttribute("aria-labelledby")
          ? document.getElementById(group.getAttribute("aria-labelledby")!)!
              .textContent
          : "";
      }),
    ).toEqual([
      "Webhookwebhook-1",
      "Workflow variables",
      "Global variables",
    ]);
  });

  test("each value by its name, with what it holds and its shape", () => {
    renderMenu();

    const body: HTMLElement = options()[0]!;

    expect(within(body).getByText("Request Body")).toBeInTheDocument();
    expect(within(body).getByText("What the request sent.")).toBeInTheDocument();
    expect(within(body).getByText("JSON")).toBeInTheDocument();
    // The reference itself is there for whoever hovers.
    expect(body).toHaveAttribute("title", BODY);
    // Nowhere is the reference written out.
    expect(screen.queryByText(BODY)).toBeNull();
  });

  test("badges say what matters about a value", () => {
    renderMenu();

    expect(
      within(options()[2]!).getByText("Secret"),
    ).toBeInTheDocument();
  });

  test("the first value is where the keys start", () => {
    renderMenu();

    expect(active()).toBe(options()[0]);
  });
});

describe("picking", () => {
  test("clicking a value picks it", () => {
    const { onPick } = renderMenu();

    fireEvent.click(options()[1]!);

    expect(onPick).toHaveBeenCalledWith(HEADERS);
  });

  test("the search box has the focus, and filters as it is typed in", async () => {
    const { user } = renderMenu();

    const search: HTMLElement = screen.getByRole("combobox", {
      name: "Search values",
    });

    expect(search).toHaveFocus();

    await user.type(search, "deploy");

    expect(optionReferences()).toEqual([DEPLOY_ENV]);
  });

  test("nothing matching says so", async () => {
    const { user } = renderMenu();

    await user.type(screen.getByTestId("value-picker-search"), "zzz");

    expect(screen.getByTestId("value-picker-no-match")).toHaveTextContent(
      "No values match “zzz”.",
    );
  });

  test("arrow keys walk the list, round at the ends, and Enter picks", async () => {
    const { user, onPick } = renderMenu();
    const search: HTMLElement = screen.getByTestId("value-picker-search");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(active()).toHaveAttribute("data-reference", DEPLOY_ENV);
    expect(search).toHaveAttribute("aria-activedescendant", active()!.id);

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(active()).toHaveAttribute("data-reference", BODY);

    await user.keyboard("{ArrowUp}");
    expect(active()).toHaveAttribute("data-reference", API_KEY);

    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(API_KEY);
  });

  test("the pointer moves the highlight too", () => {
    renderMenu();

    fireEvent.mouseMove(options()[3]!);

    expect(active()).toBe(options()[3]);
  });
});

describe("a record opens to its fields", () => {
  test("clicking it lists the whole record, then its fields", async () => {
    const { onPick } = renderMenu({
      groups: [
        recordGroup(async () => {
          return INCIDENT_FIELDS;
        }),
      ],
    });

    fireEvent.click(options()[0]!);

    await waitFor(() => {
      expect(optionReferences()).toEqual([
        INCIDENT_MODEL,
        INCIDENT_FIELDS[0]!.reference,
        INCIDENT_FIELDS[1]!.reference,
      ]);
    });
    expect(options()[0]).toHaveTextContent("The whole Incident");
    expect(within(options()[2]!).getByText("Not selected")).toBeInTheDocument();
    expect(screen.getByText("from On Create Incident", { exact: false })).toBeInTheDocument();

    fireEvent.click(options()[1]!);
    expect(onPick).toHaveBeenCalledWith(INCIDENT_FIELDS[0]!.reference);
  });

  test("its fields can be searched, and Back returns to every value", async () => {
    const { user } = renderMenu({
      groups: [
        recordGroup(async () => {
          return INCIDENT_FIELDS;
        }),
        SAMPLE_GROUPS[1]!,
      ],
    });

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(options()).toHaveLength(3);
    });

    await user.type(screen.getByTestId("value-picker-search"), "desc");
    expect(optionReferences()).toEqual([INCIDENT_FIELDS[1]!.reference]);

    fireEvent.click(screen.getByTestId("value-picker-back"));
    expect(optionReferences()).toEqual([INCIDENT_MODEL, DEPLOY_ENV]);
  });

  test("ArrowRight opens it and Backspace in an empty search box goes back", async () => {
    const { user } = renderMenu({
      groups: [
        recordGroup(async () => {
          return INCIDENT_FIELDS;
        }),
      ],
    });

    await user.keyboard("{ArrowRight}");
    await waitFor(() => {
      expect(options()).toHaveLength(3);
    });

    await user.keyboard("{Backspace}");
    expect(optionReferences()).toEqual([INCIDENT_MODEL]);
  });

  test("while the fields load it says so; if they cannot, it says why", async () => {
    let fail: (error: Error) => void = () => {};

    renderMenu({
      groups: [
        recordGroup(() => {
          return new Promise<Array<ValueSuggestion>>(
            (_resolve: unknown, reject: (error: Error) => void) => {
              fail = reject;
            },
          );
        }),
      ],
    });

    fireEvent.click(options()[0]!);

    expect(
      screen.getByText("Loading the fields of Incident…"),
    ).toBeInTheDocument();

    await act(async () => {
      fail(new Error("No access to Incident"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't load the fields of Incident/),
      ).toBeInTheDocument();
    });
    // The whole record can still be picked.
    expect(optionReferences()).toEqual([INCIDENT_MODEL]);
  });
});

describe("a JSON value opens to a path", () => {
  test("the row inserts the whole value; its arrow opens it", () => {
    const { onPick } = renderMenu();

    fireEvent.click(within(options()[0]!).getByTestId("value-picker-look-inside"));
    expect(onPick).not.toHaveBeenCalled();
    expect(options()[0]).toHaveTextContent("The whole Request Body");

    fireEvent.click(screen.getByTestId("value-picker-back"));
    fireEvent.click(options()[0]!);
    expect(onPick).toHaveBeenCalledWith(BODY);
  });

  test("a typed path is inserted as a reference into the value", async () => {
    const { user, onPick } = renderMenu();

    await user.keyboard("{ArrowRight}");

    const path: HTMLElement = screen.getByTestId("value-picker-path");
    expect(path).toHaveAttribute("placeholder", "e.g. title or items[0].name");

    await user.type(path, `${keys("alerts[0].status")}{Enter}`);

    expect(onPick).toHaveBeenCalledWith(
      "{{local.components.webhook-1.returnValues.request-body.alerts[0].status}}",
    );
  });

  test("a path that could not be followed is explained, not inserted", async () => {
    const { user, onPick } = renderMenu();

    fireEvent.click(within(options()[0]!).getByTestId("value-picker-look-inside"));
    await user.type(screen.getByTestId("value-picker-path"), "a b");
    fireEvent.click(screen.getByTestId("value-picker-path-insert"));

    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/separated by dots/);
  });
});

describe("when there is little or nothing to list", () => {
  test("nothing at all says where values come from", () => {
    renderMenu({ groups: [] });

    expect(screen.getByTestId("value-picker-empty")).toHaveTextContent(
      "Nothing to use yet. The values of the steps that run before this one, and the workflow's variables, show up here.",
    );
  });

  test("a trigger's settings say why there are no step values", () => {
    renderMenu({ groups: [], isTrigger: true });

    expect(screen.getByTestId("value-picker-empty")).toHaveTextContent(
      /A trigger runs first/,
    );
  });

  test("a step not yet connected says how to get more than the trigger's", () => {
    renderMenu({
      valueSources: {
        upstream: [],
        downstreamIds: [],
        hasIncomingConnection: false,
      },
    });

    expect(screen.getByTestId("value-picker-not-connected")).toHaveTextContent(
      "Only the trigger's values are listed until this step is connected.",
    );
  });

  test("a connected step says nothing of the kind", () => {
    renderMenu({
      valueSources: {
        upstream: [],
        downstreamIds: [],
        hasIncomingConnection: true,
      },
    });

    expect(screen.queryByTestId("value-picker-not-connected")).toBeNull();
  });

  test("variables still loading are said to be loading", () => {
    renderMenu({
      sources: [
        staticSource([SAMPLE_GROUPS[0]!]),
        {
          id: "variables",
          loadGroups: () => {
            return new Promise<Array<ValueSuggestionGroup>>(() => {});
          },
        },
      ],
    });

    expect(screen.getByText("Loading variables…")).toBeInTheDocument();
    expect(optionReferences()).toEqual([BODY, HEADERS]);
  });

  test("variables that fail to load say why, and the rest is still there", async () => {
    renderMenu({
      sources: [
        staticSource([SAMPLE_GROUPS[0]!]),
        {
          id: "variables",
          loadGroups: async () => {
            throw new Error("Permission denied");
          },
        },
      ],
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't load the variables: Permission denied/),
      ).toBeInTheDocument();
    });
    expect(optionReferences()).toEqual([BODY, HEADERS]);
  });

  test("only some groups, with words of its own when there are none", () => {
    renderMenu({
      groupFilter: (group: ValueSuggestionGroup) => {
        return group.kind === ValueSuggestionGroupKind.GlobalVariables;
      },
    });

    expect(optionReferences()).toEqual([API_KEY]);

    cleanup();

    renderMenu({
      groups: [SAMPLE_GROUPS[0]!],
      groupFilter: (group: ValueSuggestionGroup) => {
        return group.kind === ValueSuggestionGroupKind.GlobalVariables;
      },
      emptyMessage: "There are no variables yet.",
    });

    expect(screen.getByTestId("value-picker-empty")).toHaveTextContent(
      "There are no variables yet.",
    );
  });
});

describe("inline, under a field where {{ was typed", () => {
  test("no search box: what was typed filters it", () => {
    renderMenu({ hasSearchBox: false, query: "headers" });

    expect(screen.queryByTestId("value-picker-search")).toBeNull();
    expect(optionReferences()).toEqual([HEADERS]);
  });

  test("the field's keys walk it, and it reports the option they are on", () => {
    const menuRef: React.MutableRefObject<ValuePickerMenuHandle | null> = {
      current: null,
    };
    const onActiveOptionChange: MockFunction = getJestMockFunction();
    const { onPick } = renderMenu({
      hasSearchBox: false,
      query: "",
      menuRef: menuRef,
      onActiveOptionChange: onActiveOptionChange,
    });

    const prevented: MockFunction = getJestMockFunction();

    act(() => {
      expect(
        menuRef.current!.handleKeyDown({
          key: "ArrowDown",
          preventDefault: prevented,
        }),
      ).toBe(true);
    });

    expect(prevented).toHaveBeenCalled();
    expect(active()).toHaveAttribute("data-reference", HEADERS);
    expect(onActiveOptionChange).toHaveBeenLastCalledWith(active()!.id);

    // A key it has no use for is left to the field.
    expect(
      menuRef.current!.handleKeyDown({ key: "a", preventDefault: prevented }),
    ).toBe(false);

    act(() => {
      menuRef.current!.handleKeyDown({ key: "Enter", preventDefault: prevented });
    });

    expect(onPick).toHaveBeenCalledWith(HEADERS);
  });

  test("a new query starts from the top", () => {
    const menuRef: React.MutableRefObject<ValuePickerMenuHandle | null> = {
      current: null,
    };
    const { rerender } = renderMenu({
      hasSearchBox: false,
      query: "",
      menuRef: menuRef,
    });

    act(() => {
      menuRef.current!.handleKeyDown({
        key: "ArrowDown",
        preventDefault: () => {},
      });
    });
    expect(active()).toHaveAttribute("data-reference", HEADERS);

    rerender({ hasSearchBox: false, query: "request", menuRef: menuRef });

    expect(active()).toHaveAttribute("data-reference", BODY);
  });
});
