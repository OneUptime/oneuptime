import BooleanFilter from "../../../UI/Components/Filters/BooleanFilter";
import DateFilter from "../../../UI/Components/Filters/DateFilter";
import DropdownFilter from "../../../UI/Components/Filters/DropdownFilter";
import EntityFilter from "../../../UI/Components/Filters/EntityFilter";
import JSONFilter from "../../../UI/Components/Filters/JSONFilter";
import NumberFilter from "../../../UI/Components/Filters/NumberFilter";
import OperatorSelector from "../../../UI/Components/Filters/OperatorSelector";
import TextFilter from "../../../UI/Components/Filters/TextFilter";
import FilterOperator from "../../../UI/Components/Filters/Types/FilterOperator";
import Filter from "../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../UI/Components/Filters/Types/FilterData";
import FieldType from "../../../UI/Components/Types/FieldType";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import OneUptimeDate from "../../../Types/Date";
import GenericObject from "../../../Types/GenericObject";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The reported bug was "I don't see the dropdown contents": the operator menu
 * was absolutely positioned inside the modal body, which is a scroll container
 * (`overflow-y-auto`), so it was clipped down to a sliver. These tests render
 * every filter component that owns an OperatorSelector inside a clipping
 * scroll container and assert that the menu (a) only exists once opened,
 * (b) escapes the container by being portalled to document.body, (c) lists
 * exactly that filter's operator set in order, and (d) writes back the value
 * the picked operator is supposed to build — including the round trip that
 * reads that value back as the same operator.
 */

type Resource = GenericObject & {
  name?: string;
  count?: number;
  createdAt?: Date;
  lastSeenAt?: Date;
  ownerId?: string;
  labelIds?: Array<string>;
  isActive?: boolean;
  status?: string;
  attributes?: Record<string, string>;
};

const MENU_TEST_ID: string = "operator-selector-menu";

/*
 * Modal surfaces render at z-50 (Modal.tsx). The portalled menu has to sit
 * above that stacking context or it is hidden behind the dialog even though it
 * is no longer clipped.
 */
const MODAL_SURFACE_Z_INDEX: number = 50;

const TEXT_FILTER: Filter<Resource> = {
  key: "name",
  title: "Name",
  type: FieldType.Text,
} as unknown as Filter<Resource>;

const NUMBER_FILTER: Filter<Resource> = {
  key: "count",
  title: "Count",
  type: FieldType.Number,
} as unknown as Filter<Resource>;

const DATE_FILTER: Filter<Resource> = {
  key: "createdAt",
  title: "Created At",
  type: FieldType.Date,
} as unknown as Filter<Resource>;

const DATE_TIME_FILTER: Filter<Resource> = {
  key: "lastSeenAt",
  title: "Last Seen At",
  type: FieldType.DateTime,
} as unknown as Filter<Resource>;

const ENTITY_FILTER: Filter<Resource> = {
  key: "ownerId",
  title: "Owner",
  type: FieldType.Entity,
  filterDropdownOptions: [
    { label: "Alex", value: "user-1" },
    { label: "Sam", value: "user-2" },
  ],
} as unknown as Filter<Resource>;

const ENTITY_ARRAY_FILTER: Filter<Resource> = {
  key: "labelIds",
  title: "Labels",
  type: FieldType.EntityArray,
  filterDropdownOptions: [
    { label: "Critical", value: "label-1" },
    { label: "Backend", value: "label-2" },
  ],
} as unknown as Filter<Resource>;

const BOOLEAN_FILTER: Filter<Resource> = {
  key: "isActive",
  title: "Is Active",
  type: FieldType.Boolean,
} as unknown as Filter<Resource>;

const DROPDOWN_FILTER: Filter<Resource> = {
  key: "status",
  title: "Status",
  type: FieldType.Text,
  filterDropdownOptions: [
    { label: "Open", value: "open" },
    { label: "Closed", value: "closed" },
  ],
} as unknown as Filter<Resource>;

const JSON_FILTER: Filter<Resource> = {
  key: "attributes",
  title: "Attributes",
  type: FieldType.JSON,
} as unknown as Filter<Resource>;

const EMPTY_FILTER_DATA: FilterData<Resource> =
  {} as unknown as FilterData<Resource>;

const TEXT_OPERATOR_LABELS: Array<string> = [
  "contains",
  "does not contain",
  "equals",
  "does not equal",
  "starts with",
  "ends with",
  "is empty",
  "is not empty",
];

interface ClippedRender {
  container: HTMLDivElement;
  rerender: (element: ReactElement) => void;
  unmount: () => void;
}

/*
 * Mirrors the modal body: a scroll container that clips anything absolutely
 * positioned inside it.
 */
type RenderInClippingContainerFunction = (
  element: ReactElement,
) => ClippedRender;

const renderInClippingContainer: RenderInClippingContainerFunction = (
  element: ReactElement,
): ClippedRender => {
  const scrollContainer: HTMLDivElement = document.createElement("div");
  scrollContainer.style.overflowY = "auto";
  scrollContainer.style.maxHeight = "120px";
  document.body.appendChild(scrollContainer);

  const result: RenderResult = render(element, { container: scrollContainer });

  return {
    container: scrollContainer,
    rerender: (next: ReactElement): void => {
      result.rerender(next);
    },
    unmount: (): void => {
      result.unmount();
    },
  };
};

type GetTriggersFunction = (container: HTMLElement) => Array<HTMLButtonElement>;

const getTriggers: GetTriggersFunction = (
  container: HTMLElement,
): Array<HTMLButtonElement> => {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      '[id^="operator-selector-trigger"]',
    ),
  );
};

type GetTriggerFunction = (container: HTMLElement) => HTMLButtonElement | null;

const getTrigger: GetTriggerFunction = (
  container: HTMLElement,
): HTMLButtonElement | null => {
  return getTriggers(container)[0] || null;
};

type RequireTriggerFunction = (container: HTMLElement) => HTMLButtonElement;

const requireTrigger: RequireTriggerFunction = (
  container: HTMLElement,
): HTMLButtonElement => {
  const trigger: HTMLButtonElement | null = getTrigger(container);

  if (!trigger) {
    throw new Error("No OperatorSelector trigger was rendered.");
  }

  return trigger;
};

type GetTriggerLabelFunction = (container: HTMLElement) => string;

const getTriggerLabel: GetTriggerLabelFunction = (
  container: HTMLElement,
): string => {
  return (requireTrigger(container).textContent || "").trim();
};

type OpenMenuForTriggerFunction = (trigger: HTMLButtonElement) => HTMLElement;

/*
 * Opening is a state transition, so pin the closed half of it too: the menu
 * must not exist and the trigger must not advertise one before the click.
 * Without that, everything below would still pass against a menu that rendered
 * unconditionally.
 */
const openMenuForTrigger: OpenMenuForTriggerFunction = (
  trigger: HTMLButtonElement,
): HTMLElement => {
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.getAttribute("aria-controls")).toBeNull();

  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);

  const menuId: string | null = trigger.getAttribute("aria-controls");

  expect(menuId).toBeTruthy();

  const menu: HTMLElement | null = document.getElementById(menuId as string);

  if (!menu) {
    throw new Error("The OperatorSelector menu did not open.");
  }

  return menu;
};

type OpenMenuFunction = (container: HTMLElement) => HTMLElement;

const openMenu: OpenMenuFunction = (container: HTMLElement): HTMLElement => {
  expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();

  return openMenuForTrigger(requireTrigger(container));
};

type GetOptionLabelsFunction = (menu: HTMLElement) => Array<string>;

const getOptionLabels: GetOptionLabelsFunction = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return (option.textContent || "").trim();
    });
};

type GetSelectedLabelsFunction = (menu: HTMLElement) => Array<string>;

const getSelectedLabels: GetSelectedLabelsFunction = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("option")
    .filter((option: HTMLElement): boolean => {
      return option.getAttribute("aria-selected") === "true";
    })
    .map((option: HTMLElement): string => {
      return (option.textContent || "").trim();
    });
};

type PickOperatorFunction = (menu: HTMLElement, label: string) => void;

const pickOperator: PickOperatorFunction = (
  menu: HTMLElement,
  label: string,
): void => {
  fireEvent.click(within(menu).getByRole("option", { name: label }));

  // Picking always closes the menu, whatever branch the new operator renders.
  expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
};

type WrittenAtFunction = (mock: unknown, index: number) => FilterData<Resource>;

const writtenAt: WrittenAtFunction = (
  mock: unknown,
  index: number,
): FilterData<Resource> => {
  const calls: Array<Array<unknown>> = (
    mock as { mock: { calls: Array<Array<unknown>> } }
  ).mock.calls;

  return calls[index]![0] as FilterData<Resource>;
};

type WrittenFunction = (mock: unknown) => FilterData<Resource>;

const written: WrittenFunction = (mock: unknown): FilterData<Resource> => {
  return writtenAt(mock, 0);
};

/*
 * Walks up from the menu looking for a scroll container. A `position: fixed`
 * element is positioned against the viewport, but it is still clipped by an
 * ancestor with `overflow` — which is exactly how the original bug worked.
 */
type ClippingAncestorOfFunction = (element: HTMLElement) => HTMLElement | null;

const clippingAncestorOf: ClippingAncestorOfFunction = (
  element: HTMLElement,
): HTMLElement | null => {
  let current: HTMLElement | null = element.parentElement;

  while (current) {
    const overflow: string = [
      current.style.overflow,
      current.style.overflowX,
      current.style.overflowY,
    ].join(" ");

    if (overflow.includes("auto") || overflow.includes("hidden")) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
};

interface FilterCase {
  name: string;
  labels: Array<string>;
  element: () => ReactElement;
}

type BuildCasesFunction = () => Array<FilterCase>;

const buildCases: BuildCasesFunction = (): Array<FilterCase> => {
  return [
    {
      name: "TextFilter",
      labels: TEXT_OPERATOR_LABELS,
      element: (): ReactElement => {
        return (
          <TextFilter<Resource>
            filter={TEXT_FILTER}
            filterData={EMPTY_FILTER_DATA}
            onFilterChanged={jest.fn()}
          />
        );
      },
    },
    {
      name: "NumberFilter",
      labels: [
        "equals",
        "does not equal",
        "is greater than",
        "is less than",
        "is greater than or equal to",
        "is less than or equal to",
        "is between",
        "is empty",
        "is not empty",
      ],
      element: (): ReactElement => {
        return (
          <NumberFilter<Resource>
            filter={NUMBER_FILTER}
            filterData={EMPTY_FILTER_DATA}
            onFilterChanged={jest.fn()}
          />
        );
      },
    },
    {
      name: "DateFilter (Date)",
      labels: [
        "is",
        "is before",
        "is after",
        "is between",
        "is empty",
        "is not empty",
      ],
      element: (): ReactElement => {
        return (
          <DateFilter<Resource>
            filter={DATE_FILTER}
            filterData={EMPTY_FILTER_DATA}
            onFilterChanged={jest.fn()}
          />
        );
      },
    },
    {
      name: "DateFilter (DateTime)",
      labels: [
        "is",
        "is before",
        "is after",
        "is between",
        "is empty",
        "is not empty",
      ],
      element: (): ReactElement => {
        return (
          <DateFilter<Resource>
            filter={DATE_TIME_FILTER}
            filterData={EMPTY_FILTER_DATA}
            onFilterChanged={jest.fn()}
          />
        );
      },
    },
    {
      name: "EntityFilter (Entity)",
      labels: ["is", "is not", "is empty", "is not empty"],
      element: (): ReactElement => {
        return (
          <EntityFilter<Resource>
            filter={ENTITY_FILTER}
            filterData={EMPTY_FILTER_DATA}
            onFilterChanged={jest.fn()}
          />
        );
      },
    },
    {
      name: "EntityFilter (EntityArray)",
      labels: [
        "has any of",
        "has all of",
        "has none of",
        "is empty",
        "is not empty",
      ],
      element: (): ReactElement => {
        return (
          <EntityFilter<Resource>
            filter={ENTITY_ARRAY_FILTER}
            filterData={EMPTY_FILTER_DATA}
            onFilterChanged={jest.fn()}
          />
        );
      },
    },
  ];
};

describe("OperatorSelector as each filter type uses it", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  describe("the menu lists the complete operator set for the filter", () => {
    for (const filterCase of buildCases()) {
      test(`${filterCase.name} lists exactly its operators, in order`, () => {
        const rendered: ClippedRender = renderInClippingContainer(
          filterCase.element(),
        );

        const menu: HTMLElement = openMenu(rendered.container);

        expect(getOptionLabels(menu)).toEqual(filterCase.labels);
      });
    }

    /*
     * TextFilter is the dispatch target for nine field types. The operator list
     * is the same for all of them, so a regression that narrows
     * TEXT_FIELD_TYPES makes those filters render nothing at all — silently.
     */
    const OTHER_TEXT_FIELD_TYPES: Array<FieldType> = [
      FieldType.LongText,
      FieldType.Email,
      FieldType.Phone,
      FieldType.Name,
      FieldType.Port,
      FieldType.URL,
      FieldType.Hostname,
      FieldType.ObjectID,
    ];

    for (const fieldType of OTHER_TEXT_FIELD_TYPES) {
      test(`a ${fieldType} field routes to TextFilter and offers the text operators`, () => {
        const rendered: ClippedRender = renderInClippingContainer(
          <TextFilter<Resource>
            filter={
              {
                key: "name",
                title: "Name",
                type: fieldType,
              } as unknown as Filter<Resource>
            }
            filterData={EMPTY_FILTER_DATA}
            onFilterChanged={jest.fn()}
          />,
        );

        const menu: HTMLElement = openMenu(rendered.container);

        expect(getOptionLabels(menu)).toEqual(TEXT_OPERATOR_LABELS);
      });
    }
  });

  describe("the menu escapes the modal's clipping scroll container", () => {
    test("TextFilter's menu is portalled out of the scroll container", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      const menu: HTMLElement = openMenu(rendered.container);

      expect(rendered.container.contains(menu)).toBe(false);
      expect(menu.parentElement).toBe(document.body);
      // Nothing between the menu and the document root can clip it any more.
      expect(clippingAncestorOf(menu)).toBeNull();
    });

    test("EntityFilter's menu is portalled out of the scroll container", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      const menu: HTMLElement = openMenu(rendered.container);

      expect(rendered.container.contains(menu)).toBe(false);
      expect(menu.parentElement).toBe(document.body);
      expect(clippingAncestorOf(menu)).toBeNull();
    });

    test("the menu is viewport-positioned and stacks above the modal surface", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      const menu: HTMLElement = openMenu(rendered.container);

      /*
       * Fixed positioning is what makes portalling useful: the menu is placed
       * against the viewport from the trigger's rect rather than flowing inside
       * whatever ancestor it happens to sit in.
       */
      expect(menu.className.split(" ")).toContain("fixed");

      // Modal surfaces are z-50; the menu must win against them.
      expect(Number(menu.style.zIndex)).toBeGreaterThan(MODAL_SURFACE_Z_INDEX);
    });

    test("unmounting a filter while its menu is open tears the portal down", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      openMenu(rendered.container);

      rendered.unmount();

      /*
       * Checked here, before afterEach wipes document.body — a leaked fixed
       * z-60 node floating over the app is the failure mode portalling invites.
       */
      expect(
        document.querySelector(`[data-testid="${MENU_TEST_ID}"]`),
      ).toBeNull();
    });
  });

  describe("the trigger describes the menu it owns", () => {
    test("aria-expanded and aria-controls track the open state", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      const trigger: HTMLButtonElement = requireTrigger(rendered.container);

      expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.getAttribute("aria-controls")).toBeNull();

      const menu: HTMLElement = openMenuForTrigger(trigger);

      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
      expect(menu.getAttribute("aria-labelledby")).toBe(trigger.id);
      expect(menu.getAttribute("role")).toBe("listbox");

      fireEvent.click(trigger);

      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.getAttribute("aria-controls")).toBeNull();
      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    });

    test("the collapsed trigger shows the operator encoded in filterData", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={
            { name: new NotContains("db") } as unknown as FilterData<Resource>
          }
          onFilterChanged={jest.fn()}
        />,
      );

      // Read before anything is clicked: this is the collapsed state.
      expect(getTriggerLabel(rendered.container)).toBe("does not contain");
      expect(
        rendered.container.querySelector<HTMLInputElement>('input[type="text"]')
          ?.value,
      ).toBe("db");
    });

    test("the collapsed trigger of an EntityArray filter shows its array operator", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={
            {
              labelIds: new IncludesNone(["label-1"]),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={jest.fn()}
        />,
      );

      expect(getTriggerLabel(rendered.container)).toBe("has none of");
    });

    test("two filters side by side own separate menus, and only one is open at a time", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <>
          <TextFilter<Resource>
            filter={TEXT_FILTER}
            filterData={EMPTY_FILTER_DATA}
            onFilterChanged={jest.fn()}
          />
          <NumberFilter<Resource>
            filter={NUMBER_FILTER}
            filterData={EMPTY_FILTER_DATA}
            onFilterChanged={jest.fn()}
          />
        </>,
      );

      const triggers: Array<HTMLButtonElement> = getTriggers(
        rendered.container,
      );

      expect(triggers).toHaveLength(2);
      expect(triggers[0]!.id).not.toBe(triggers[1]!.id);

      const firstMenu: HTMLElement = openMenuForTrigger(triggers[0]!);

      expect(getOptionLabels(firstMenu)).toEqual(TEXT_OPERATOR_LABELS);

      const secondMenu: HTMLElement = openMenuForTrigger(triggers[1]!);

      expect(secondMenu.id).not.toBe(firstMenu.id);
      expect(triggers[0]!.getAttribute("aria-expanded")).toBe("false");
      expect(triggers[1]!.getAttribute("aria-controls")).toBe(secondMenu.id);
      expect(screen.queryAllByTestId(MENU_TEST_ID)).toHaveLength(1);
      expect(getOptionLabels(secondMenu)).toContain("is greater than");
    });
  });

  describe("an EntityArray filter offers array operators, not single-entity ones", () => {
    test("array operators are offered and single-entity ones are not", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      const labels: Array<string> = getOptionLabels(
        openMenu(rendered.container),
      );

      expect(labels).toContain("has any of");
      expect(labels).toContain("has all of");
      expect(labels).toContain("has none of");
      expect(labels).not.toContain("is");
      expect(labels).not.toContain("is not");
    });

    test("a single Entity filter offers 'is' / 'is not' and no array operators", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      const labels: Array<string> = getOptionLabels(
        openMenu(rendered.container),
      );

      expect(labels).toContain("is");
      expect(labels).toContain("is not");
      expect(labels).not.toContain("has any of");
      expect(labels).not.toContain("has all of");
      expect(labels).not.toContain("has none of");
    });
  });

  describe("the operator encoded in filterData is the selected one when the menu opens", () => {
    test("TextFilter: NotContains opens with 'does not contain' selected", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={
            { name: new NotContains("db") } as unknown as FilterData<Resource>
          }
          onFilterChanged={jest.fn()}
        />,
      );

      const menu: HTMLElement = openMenu(rendered.container);

      expect(getSelectedLabels(menu)).toEqual(["does not contain"]);
    });

    test("TextFilter: IsNull opens with 'is empty' selected", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={{ name: new IsNull() } as unknown as FilterData<Resource>}
          onFilterChanged={jest.fn()}
        />,
      );

      const menu: HTMLElement = openMenu(rendered.container);

      expect(getSelectedLabels(menu)).toEqual(["is empty"]);
    });

    test("NumberFilter: NotNull opens with 'is not empty' selected", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <NumberFilter<Resource>
          filter={NUMBER_FILTER}
          filterData={
            { count: new NotNull() } as unknown as FilterData<Resource>
          }
          onFilterChanged={jest.fn()}
        />,
      );

      const menu: HTMLElement = openMenu(rendered.container);

      expect(getSelectedLabels(menu)).toEqual(["is not empty"]);
    });

    test("DateFilter: GreaterThan opens with 'is after' selected", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <DateFilter<Resource>
          filter={DATE_FILTER}
          filterData={
            {
              createdAt: new GreaterThan(new Date("2024-03-04T05:06:07.000Z")),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={jest.fn()}
        />,
      );

      const menu: HTMLElement = openMenu(rendered.container);

      expect(getSelectedLabels(menu)).toEqual(["is after"]);
    });

    test("EntityFilter (EntityArray): IncludesNone opens with 'has none of' selected", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={
            {
              labelIds: new IncludesNone(["label-1"]),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={jest.fn()}
        />,
      );

      const menu: HTMLElement = openMenu(rendered.container);

      expect(getSelectedLabels(menu)).toEqual(["has none of"]);
    });

    /*
     * "has any of" is the odd one out on the write side: it encodes as a bare
     * array rather than an Includes instance, so the read side has to decode a
     * raw array too.
     */
    test("EntityFilter (EntityArray): a bare array opens with 'has any of' selected", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={
            {
              labelIds: ["label-1"],
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={jest.fn()}
        />,
      );

      const menu: HTMLElement = openMenu(rendered.container);

      expect(getSelectedLabels(menu)).toEqual(["has any of"]);
    });

    test("EntityFilter (Entity): a one-item IncludesNone opens with 'is not' selected", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_FILTER}
          filterData={
            {
              ownerId: new IncludesNone(["user-1"]),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={jest.fn()}
        />,
      );

      const menu: HTMLElement = openMenu(rendered.container);

      expect(getSelectedLabels(menu)).toEqual(["is not"]);
    });
  });

  describe("picking an operator writes the value that operator builds", () => {
    test("TextFilter: picking 'starts with' keeps the typed text", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={
            { name: new Search("prod") } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "starts with");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);

      const value: unknown = written(onFilterChanged)["name"];

      expect(value).toBeInstanceOf(StartsWith);
      expect((value as StartsWith<string>).value).toBe("prod");
    });

    test("TextFilter: picking 'is empty' writes IsNull", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={
            { name: new Search("prod") } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is empty");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);
      expect(written(onFilterChanged)["name"]).toBeInstanceOf(IsNull);
    });

    test("TextFilter: picking 'is not empty' writes NotNull", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is not empty");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);
      expect(written(onFilterChanged)["name"]).toBeInstanceOf(NotNull);
    });

    test("NumberFilter: picking 'is greater than' keeps the number", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <NumberFilter<Resource>
          filter={NUMBER_FILTER}
          filterData={
            { count: new EqualTo(5) } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is greater than");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);

      const value: unknown = written(onFilterChanged)["count"];

      expect(value).toBeInstanceOf(GreaterThan);
      expect((value as GreaterThan<number>).value).toBe(5);
    });

    test("DateFilter: picking 'is before' keeps the date and writes LessThan", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const date: Date = new Date("2024-03-04T05:06:07.000Z");

      const rendered: ClippedRender = renderInClippingContainer(
        <DateFilter<Resource>
          filter={DATE_FILTER}
          filterData={
            {
              createdAt: new GreaterThan(date),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is before");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);

      const value: unknown = written(onFilterChanged)["createdAt"];

      expect(value).toBeInstanceOf(LessThan);
      expect((value as LessThan<Date>).value.getTime()).toBe(date.getTime());
    });

    /*
     * A Date field has no time component, so "is" has to widen to the whole
     * day; a DateTime field keeps the exact instant. Same operator, two
     * encodings — the branch DateFilter.buildValue takes on `isDateTime`.
     */
    test("DateFilter (Date): picking 'is' widens to the bounds of that day", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const date: Date = new Date("2024-03-04T05:06:07.000Z");

      const rendered: ClippedRender = renderInClippingContainer(
        <DateFilter<Resource>
          filter={DATE_FILTER}
          filterData={
            {
              createdAt: new LessThan(date),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);

      const value: unknown = written(onFilterChanged)["createdAt"];

      expect(value).toBeInstanceOf(InBetween);
      expect((value as InBetween<Date>).startValue.getTime()).toBe(
        OneUptimeDate.getStartOfDay(date).getTime(),
      );
      expect((value as InBetween<Date>).endValue.getTime()).toBe(
        OneUptimeDate.getEndOfDay(date).getTime(),
      );
    });

    test("DateFilter (DateTime): picking 'is' keeps the exact instant", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const date: Date = new Date("2024-03-04T05:06:07.000Z");

      const rendered: ClippedRender = renderInClippingContainer(
        <DateFilter<Resource>
          filter={DATE_TIME_FILTER}
          filterData={
            {
              lastSeenAt: new LessThan(date),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);

      const value: unknown = written(onFilterChanged)["lastSeenAt"];

      expect(value).toBeInstanceOf(EqualTo);
      expect(value).not.toBeInstanceOf(InBetween);
      expect((value as EqualTo<Date>).value.getTime()).toBe(date.getTime());
    });

    test("EntityFilter (EntityArray): picking 'has all of' keeps the selected ids", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={
            {
              labelIds: new Includes(["label-1", "label-2"]),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "has all of");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);

      const value: unknown = written(onFilterChanged)["labelIds"];

      expect(value).toBeInstanceOf(IncludesAll);
      expect((value as IncludesAll).values).toEqual(["label-1", "label-2"]);
    });

    /*
     * Unlike every other array operator, "has any of" writes a bare string[] —
     * not an Includes instance. Wrapping it would change the query the server
     * sees, so pin the raw shape.
     */
    test("EntityFilter (EntityArray): picking 'has any of' writes a bare array", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={
            {
              labelIds: new IncludesAll(["label-1", "label-2"]),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "has any of");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);

      const value: unknown = written(onFilterChanged)["labelIds"];

      expect(Array.isArray(value)).toBe(true);
      expect(value).toEqual(["label-1", "label-2"]);
      expect(value).not.toBeInstanceOf(Includes);
    });

    test("EntityFilter (EntityArray): picking 'is empty' writes IsNull", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={
            {
              labelIds: new Includes(["label-1"]),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is empty");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);
      expect(written(onFilterChanged)["labelIds"]).toBeInstanceOf(IsNull);
    });

    test("EntityFilter (Entity): picking 'is not' encodes a one-item IncludesNone", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_FILTER}
          filterData={{ ownerId: "user-1" } as unknown as FilterData<Resource>}
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is not");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);

      const value: unknown = written(onFilterChanged)["ownerId"];

      expect(value).toBeInstanceOf(IncludesNone);
      expect((value as IncludesNone).values).toEqual(["user-1"]);
    });
  });

  /*
   * Closing the loop: feed the object the filter wrote straight back in as its
   * own props. Hand-authored fixtures on both sides can agree with each other
   * while disagreeing with what the component actually emits.
   */
  describe("what a filter writes reads back as the operator that wrote it", () => {
    test("EntityFilter (Entity): 'is not' survives a round trip through filterData", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_FILTER}
          filterData={{ ownerId: "user-1" } as unknown as FilterData<Resource>}
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is not");

      const emitted: FilterData<Resource> = written(onFilterChanged);

      rendered.rerender(
        <EntityFilter<Resource>
          filter={ENTITY_FILTER}
          filterData={emitted}
          onFilterChanged={jest.fn()}
        />,
      );

      expect(getTriggerLabel(rendered.container)).toBe("is not");
      expect(getSelectedLabels(openMenu(rendered.container))).toEqual([
        "is not",
      ]);
    });

    test("TextFilter: 'does not contain' survives a round trip through filterData", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={
            { name: new Search("prod") } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "does not contain");

      const emitted: FilterData<Resource> = written(onFilterChanged);

      rendered.rerender(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={emitted}
          onFilterChanged={jest.fn()}
        />,
      );

      expect(getTriggerLabel(rendered.container)).toBe("does not contain");
      expect(getSelectedLabels(openMenu(rendered.container))).toEqual([
        "does not contain",
      ]);
    });

    test("EntityFilter (EntityArray): the bare array 'has any of' writes reads back as 'has any of'", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={
            {
              labelIds: new IncludesAll(["label-1"]),
            } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "has any of");

      const emitted: FilterData<Resource> = written(onFilterChanged);

      rendered.rerender(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={emitted}
          onFilterChanged={jest.fn()}
        />,
      );

      expect(getTriggerLabel(rendered.container)).toBe("has any of");
      expect(getSelectedLabels(openMenu(rendered.container))).toEqual([
        "has any of",
      ]);
    });
  });

  /*
   * The operator has to stick even when it builds nothing yet — otherwise the
   * user picks "starts with", the key is deleted from filterData, and the
   * trigger snaps back to "contains" on the very next render.
   */
  describe("picking an operator before a value has been entered", () => {
    test("TextFilter: the key is dropped but the trigger keeps 'starts with'", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={onFilterChanged}
        />,
      );

      expect(getTriggerLabel(rendered.container)).toBe("contains");

      pickOperator(openMenu(rendered.container), "starts with");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);
      expect(Object.keys(written(onFilterChanged))).not.toContain("name");
      expect(getTriggerLabel(rendered.container)).toBe("starts with");
    });

    test("NumberFilter: the key is dropped but the trigger keeps 'is greater than'", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <NumberFilter<Resource>
          filter={NUMBER_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is greater than");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);
      expect(Object.keys(written(onFilterChanged))).not.toContain("count");
      expect(getTriggerLabel(rendered.container)).toBe("is greater than");
    });

    test("DateFilter: the key is dropped but the trigger keeps 'is before'", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <DateFilter<Resource>
          filter={DATE_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is before");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);
      expect(Object.keys(written(onFilterChanged))).not.toContain("createdAt");
      expect(getTriggerLabel(rendered.container)).toBe("is before");
    });

    test("EntityFilter (Entity): the key is dropped but the trigger keeps 'is not'", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={onFilterChanged}
        />,
      );

      pickOperator(openMenu(rendered.container), "is not");

      expect(onFilterChanged).toHaveBeenCalledTimes(1);
      expect(Object.keys(written(onFilterChanged))).not.toContain("ownerId");
      expect(getTriggerLabel(rendered.container)).toBe("is not");
    });
  });

  describe("the operator decides which value inputs the filter renders", () => {
    test("TextFilter: 'is empty' hides the text input, and a value operator brings it back", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={TEXT_FILTER}
          filterData={
            { name: new Search("prod") } as unknown as FilterData<Resource>
          }
          onFilterChanged={jest.fn()}
        />,
      );

      expect(
        rendered.container.querySelector('input[type="text"]'),
      ).not.toBeNull();

      pickOperator(openMenu(rendered.container), "is empty");

      expect(rendered.container.querySelector('input[type="text"]')).toBeNull();

      pickOperator(openMenu(rendered.container), "contains");

      expect(
        rendered.container.querySelector<HTMLInputElement>('input[type="text"]')
          ?.value,
      ).toBe("prod");
    });

    test("EntityFilter: 'is empty' hides the entity dropdown", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <EntityFilter<Resource>
          filter={ENTITY_ARRAY_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      expect(screen.queryByText("Filter by Labels")).not.toBeNull();

      pickOperator(openMenu(rendered.container), "is empty");

      expect(screen.queryByText("Filter by Labels")).toBeNull();
    });

    test("NumberFilter: 'is between' opens a second bound and writes nothing until both exist", () => {
      const onFilterChanged: (filterData: FilterData<Resource>) => void =
        jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <NumberFilter<Resource>
          filter={NUMBER_FILTER}
          filterData={
            { count: new EqualTo(5) } as unknown as FilterData<Resource>
          }
          onFilterChanged={onFilterChanged}
        />,
      );

      expect(rendered.container.querySelectorAll("input")).toHaveLength(1);

      pickOperator(openMenu(rendered.container), "is between");

      // Two bounds now, and the filter is dropped because only one is filled.
      expect(rendered.container.querySelectorAll("input")).toHaveLength(2);
      expect(onFilterChanged).toHaveBeenCalledTimes(1);
      expect(Object.keys(written(onFilterChanged))).not.toContain("count");

      const upperBound: HTMLElement = screen.getByPlaceholderText("To");

      fireEvent.change(upperBound, { target: { value: "9" } });

      expect(onFilterChanged).toHaveBeenCalledTimes(2);

      const value: unknown = writtenAt(onFilterChanged, 1)["count"];

      expect(value).toBeInstanceOf(InBetween);
      expect((value as InBetween<number>).startValue).toBe(5);
      expect((value as InBetween<number>).endValue).toBe(9);
    });

    test("DateFilter: 'is between' opens a second date input", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <DateFilter<Resource>
          filter={DATE_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      expect(rendered.container.querySelectorAll("input")).toHaveLength(1);

      pickOperator(openMenu(rendered.container), "is between");

      expect(rendered.container.querySelectorAll("input")).toHaveLength(2);

      pickOperator(openMenu(rendered.container), "is empty");

      expect(rendered.container.querySelectorAll("input")).toHaveLength(0);
    });
  });

  describe("filters that render no OperatorSelector", () => {
    test("BooleanFilter renders its yes/no dropdown and no operator trigger", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <BooleanFilter<Resource>
          filter={BOOLEAN_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      // Positive half: the filter really did render its own control.
      expect(screen.getByText("Filter by Is Active")).toBeTruthy();
      expect(getTrigger(rendered.container)).toBeNull();
      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    });

    test("DropdownFilter renders its dropdown and no operator trigger", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <DropdownFilter<Resource>
          filter={DROPDOWN_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      expect(screen.getByText("Filter by Status")).toBeTruthy();
      expect(getTrigger(rendered.container)).toBeNull();
      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    });

    test("JSONFilter renders its dictionary form and no operator trigger", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <JSONFilter<Resource>
          filter={JSON_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      expect(screen.getByText("Add Attributes")).toBeTruthy();
      expect(getTrigger(rendered.container)).toBeNull();
      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    });

    test("TextFilter renders nothing at all when the filter has dropdown options", () => {
      const rendered: ClippedRender = renderInClippingContainer(
        <TextFilter<Resource>
          filter={DROPDOWN_FILTER}
          filterData={EMPTY_FILTER_DATA}
          onFilterChanged={jest.fn()}
        />,
      );

      /*
       * TextFilter bails out entirely for a dropdown-backed filter; FiltersForm
       * renders DropdownFilter for it instead. So "no operator trigger" here
       * really does mean "no output".
       */
      expect(rendered.container.textContent).toBe("");
      expect(rendered.container.querySelectorAll("input")).toHaveLength(0);
      expect(getTrigger(rendered.container)).toBeNull();
    });
  });

  describe("OperatorSelector boundaries the filters do not currently reach", () => {
    test("an empty option list renders a trigger that never opens", () => {
      const onChange: (value: FilterOperator) => void = jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <OperatorSelector
          value={FilterOperator.Contains}
          options={[]}
          onChange={onChange}
        />,
      );

      const trigger: HTMLButtonElement = requireTrigger(rendered.container);

      expect(trigger.textContent).toContain("contains");

      fireEvent.click(trigger);

      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(onChange).not.toHaveBeenCalled();
    });

    /*
     * A filter can hold an operator its own option list does not contain — flip
     * a filter's type from Entity to EntityArray and the locally held operator
     * outlives the options it came from. The trigger still has to render a
     * label, and nothing may claim to be selected.
     *
     * Where focus lands on open is the keyboard contract and is pinned by
     * OperatorSelectorKeyboard.test.tsx, so it is deliberately not re-asserted
     * here.
     */
    test("a value outside the option list renders on the trigger but selects nothing", () => {
      const onChange: (value: FilterOperator) => void = jest.fn();

      const rendered: ClippedRender = renderInClippingContainer(
        <OperatorSelector
          value={FilterOperator.IsTrue}
          options={[
            FilterOperator.Contains,
            FilterOperator.DoesNotContain,
            FilterOperator.IsEmpty,
          ]}
          onChange={onChange}
        />,
      );

      expect(getTriggerLabel(rendered.container)).toBe("is true");

      const menu: HTMLElement = openMenu(rendered.container);

      expect(getOptionLabels(menu)).toEqual([
        "contains",
        "does not contain",
        "is empty",
      ]);
      expect(getSelectedLabels(menu)).toEqual([]);

      // Still a live menu: picking from it reports the operator that was picked.
      pickOperator(menu, "does not contain");

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(FilterOperator.DoesNotContain);
    });
  });
});
