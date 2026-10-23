import Label from "../../Models/DatabaseModels/Label";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Color from "../../Types/Color";
import {
  compareLabels,
  getLabelDisplayName,
  getLabelListSort,
  LABEL_NAME_COLUMN,
  LABEL_NAME_SORT_KEY_COLUMN,
  OrderableLabel,
  sortLabelNames,
  sortLabels,
} from "../../Utils/LabelOrder";
import { SeededRandom, seededRandom, shuffled } from "../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ORDER LABELS ARE LISTED IN (Utils/LabelOrder, OneUptime issue #5183):
 * a record's labels in the browser (sortLabels), label names in what the
 * server writes (sortLabelNames), and the order the server reads labels in
 * (getLabelListSort) - by the stored sort key whenever it is asked for them
 * by name or in no order.
 */

const label: (id: string, name: string | undefined, slug?: string) => Label = (
  id: string,
  name: string | undefined,
  slug?: string,
): Label => {
  const model: Label = new Label();
  model._id = id;
  if (name !== undefined) {
    model.name = name;
  }
  if (slug !== undefined) {
    model.slug = slug;
  }
  model.color = new Color("#6366f1");
  return model;
};

const namesOf: (labels: Array<OrderableLabel>) => Array<string> = (
  labels: Array<OrderableLabel>,
): Array<string> => {
  return labels.map((item: OrderableLabel): string => {
    return getLabelDisplayName(item);
  });
};

const ID: (index: number) => string = (index: number): string => {
  return `21000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
};

describe("a record's labels (sortLabels)", () => {
  test("come in natural order, however the database joined them", () => {
    const joined: Array<Label> = [
      label(ID(1), "4.Business System=Customer Mobile App"),
      label(ID(2), "Claude"),
      label(ID(3), "10.Owner=Loyalty Platform Team"),
      label(ID(4), "2.SubCategory=Website"),
      label(ID(5), "3.Item=Connectivity"),
      label(ID(6), "1.Category=Application"),
      label(ID(7), "production"),
    ];

    expect(namesOf(sortLabels(joined))).toEqual([
      "1.Category=Application",
      "2.SubCategory=Website",
      "3.Item=Connectivity",
      "4.Business System=Customer Mobile App",
      "10.Owner=Loyalty Platform Team",
      "Claude",
      "production",
    ]);
  });

  test("in one order, whatever order they arrive in", () => {
    const labels: Array<Label> = [
      "Tier 10",
      "Tier 2",
      "EU West",
      "eu east",
      "Église",
      "1. Category",
      "#infra",
      "Database",
    ].map((name: string, index: number): Label => {
      return label(ID(index + 1), name);
    });
    const random: SeededRandom = seededRandom(5183);
    const expected: Array<string> = namesOf(sortLabels(labels));

    expect(expected).toEqual([
      "1. Category",
      "#infra",
      "Database",
      "Église",
      "eu east",
      "EU West",
      "Tier 2",
      "Tier 10",
    ]);

    for (let round: number = 0; round < 25; round++) {
      expect(namesOf(sortLabels(shuffled(labels, random)))).toEqual(expected);
    }
  });

  test("two labels of one name (two projects' 'Production') keep one order, by id", () => {
    const first: Label = label(ID(1), "Production");
    const second: Label = label(ID(2), "Production");

    expect(sortLabels([second, first])).toEqual([first, second]);
    expect(sortLabels([first, second])).toEqual([first, second]);
    expect(compareLabels(first, second)).toBeLessThan(0);
    expect(compareLabels(second, first)).toBeGreaterThan(0);
    expect(compareLabels(first, first)).toBe(0);
  });

  test("a label read without its name is sorted by its slug, as it is shown", () => {
    const labels: Array<Label> = [
      label(ID(1), undefined, "zeta-team"),
      label(ID(2), "Alpha"),
      label(ID(3), undefined, "2-sub"),
    ];

    expect(namesOf(sortLabels(labels))).toEqual([
      "2-sub",
      "Alpha",
      "zeta-team",
    ]);
    expect(getLabelDisplayName(label(ID(4), undefined))).toBe("");
  });

  test("a missing entry - a label deleted under a relation - is left out", () => {
    const labels: Array<Label | null | undefined> = [
      label(ID(1), "b"),
      null,
      undefined,
      label(ID(2), "a"),
    ];

    expect(namesOf(sortLabels(labels))).toEqual(["a", "b"]);
    expect(sortLabels(null)).toEqual([]);
    expect(sortLabels(undefined)).toEqual([]);
  });

  test("gives a new array and leaves the one given as it was", () => {
    const labels: Array<Label> = [label(ID(1), "b"), label(ID(2), "a")];
    const sorted: Array<Label> = sortLabels(labels);

    expect(sorted).not.toBe(labels);
    expect(namesOf(labels)).toEqual(["b", "a"]);
    // The very models, not copies: a page reads their colours and ids.
    expect(sorted[0]).toBe(labels[1]);
  });

  test("takes plain objects as well as models", () => {
    expect(
      namesOf(
        sortLabels<OrderableLabel>([
          { _id: ID(1), name: "10" },
          { _id: ID(2), name: "9" },
        ]),
      ),
    ).toEqual(["9", "10"]);
  });
});

describe("label names in what the server writes (sortLabelNames)", () => {
  test("in natural order, without the empty ones", () => {
    expect(
      sortLabelNames([
        "4. Business System",
        "",
        "  ",
        null,
        undefined,
        "Claude",
        "10. Owner",
        "2. SubCategory",
      ]),
    ).toEqual(["2. SubCategory", "4. Business System", "10. Owner", "Claude"]);
  });

  test("keeps each name as it was given", () => {
    expect(sortLabelNames(["  b  ", "a"])).toEqual(["a", "  b  "]);
    expect(sortLabelNames(null)).toEqual([]);
  });
});

describe("the order the server reads labels in (getLabelListSort)", () => {
  test("asked for no order: by name, in natural order", () => {
    const naturalByName: Record<string, SortOrder> = {
      [LABEL_NAME_SORT_KEY_COLUMN]: SortOrder.Ascending,
      [LABEL_NAME_COLUMN]: SortOrder.Ascending,
    };

    expect(getLabelListSort(undefined)).toEqual(naturalByName);
    expect(getLabelListSort(null)).toEqual(naturalByName);
    expect(getLabelListSort({})).toEqual(naturalByName);
    // A column named with no order is no order.
    expect(getLabelListSort({ name: undefined })).toEqual(naturalByName);
    expect(Object.keys(getLabelListSort({}))).toEqual(["nameSortKey", "name"]);
  });

  test("asked for them by name, either way: by the sort key that way", () => {
    expect(getLabelListSort({ name: SortOrder.Ascending })).toEqual({
      nameSortKey: SortOrder.Ascending,
      name: SortOrder.Ascending,
    });
    expect(getLabelListSort({ name: SortOrder.Descending })).toEqual({
      nameSortKey: SortOrder.Descending,
      name: SortOrder.Descending,
    });
  });

  test("by name after another column: the key takes the name's place", () => {
    const sort: Record<string, SortOrder> = getLabelListSort({
      isArchived: SortOrder.Ascending,
      name: SortOrder.Descending,
    });

    expect(sort).toEqual({
      isArchived: SortOrder.Ascending,
      nameSortKey: SortOrder.Descending,
      name: SortOrder.Descending,
    });
    expect(Object.keys(sort)).toEqual(["isArchived", "nameSortKey", "name"]);
  });

  test("any other order: as asked", () => {
    expect(getLabelListSort({ createdAt: SortOrder.Descending })).toEqual({
      createdAt: SortOrder.Descending,
    });
    expect(getLabelListSort({ _id: SortOrder.Ascending })).toEqual({
      _id: SortOrder.Ascending,
    });
  });

  test("a caller that names the key itself is read as it asked", () => {
    expect(
      getLabelListSort({
        nameSortKey: SortOrder.Descending,
        name: SortOrder.Ascending,
      }),
    ).toEqual({
      nameSortKey: SortOrder.Descending,
      name: SortOrder.Ascending,
    });
  });

  test("never changes the caller's own object", () => {
    const asked: Record<string, SortOrder> = { name: SortOrder.Ascending };

    getLabelListSort(asked);

    expect(asked).toEqual({ name: SortOrder.Ascending });
  });
});
