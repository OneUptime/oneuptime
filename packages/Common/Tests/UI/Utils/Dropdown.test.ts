import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Color from "../../../Types/Color";
import DropdownUtil from "../../../UI/Utils/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * String enums do not emit a numeric reverse-mapping, so every key is a real
 * member name. These stand in for the "English words shown verbatim" family
 * (TechStack, CodeRepositoryType) that the source documents.
 */
enum Fruit {
  Apple = "apple",
  Banana = "banana",
  Cherry = "cherry",
}

/*
 * A numeric enum. TypeScript compiles this to an object that also carries the
 * reverse mapping { "0": "Up", "1": "Down", ... }, which is exactly the shape
 * the util must strip out.
 */
enum Direction {
  Up,
  Down,
  Left,
  Right,
}

/* A numeric enum with explicit, non-zero-based values. */
enum HttpStatus {
  Ok = 200,
  NotFound = 404,
}

/* A string enum whose value is a run of concatenated English words. */
enum TriggerReason {
  OnErrorOrFrustration = "OnErrorOrFrustration",
}

/* A string enum whose value embeds an initialism run. */
enum SsoProtocol {
  OidcProvider = "OIDCProvider",
}

/* A string enum whose value is a number-looking string. */
enum NumericStringValue {
  Answer = "42",
}

/* A string enum whose value is the empty string. */
enum EmptyStringValue {
  Blank = "",
}

/* An enum with no members at all. */
enum EmptyEnum {}

/*
 * A hand-rolled stand-in for a BaseModel row. getDropdownOptionsFromEntityArray
 * only ever touches getColumnValue and getFirstColorColumn, so faithfully
 * reproducing those two is enough to exercise every branch without dragging in
 * the decorator/metadata machinery that real models need.
 */
interface StubColumnValues {
  [columnName: string]: string | Color | null;
}

class EntityStub {
  private readonly values: StubColumnValues;
  private readonly colorColumn: string | null;

  public constructor(
    values: StubColumnValues,
    colorColumn: string | null = null,
  ) {
    this.values = values;
    this.colorColumn = colorColumn;
  }

  public getColumnValue(columnName: string): string | Color | null {
    return columnName in this.values ? this.values[columnName]! : null;
  }

  public getFirstColorColumn(): string | null {
    return this.colorColumn;
  }
}

/* Turn a list of options into a plain [label, value] shape for terse asserts. */
type OptionPair = [string, DropdownOption["value"]];

const toPairs: (options: Array<DropdownOption>) => Array<OptionPair> = (
  options: Array<DropdownOption>,
): Array<OptionPair> => {
  return options.map((option: DropdownOption): OptionPair => {
    return [option.label, option.value];
  });
};

describe("DropdownUtil", () => {
  describe("getDropdownOptionsFromEnum", () => {
    test("maps a string enum to value-labelled options in declaration order", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(Fruit);

      expect(toPairs(options)).toEqual([
        ["apple", "apple"],
        ["banana", "banana"],
        ["cherry", "cherry"],
      ]);
    });

    test("uses the enum key as the label when useKeyAsLabel is true", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(Fruit, true);

      expect(toPairs(options)).toEqual([
        ["Apple", "apple"],
        ["Banana", "banana"],
        ["Cherry", "cherry"],
      ]);
    });

    test("defaults useKeyAsLabel to false (value is used as the label)", () => {
      const withDefault: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(Fruit);
      const explicitlyFalse: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(Fruit, false);

      expect(toPairs(withDefault)).toEqual(toPairs(explicitlyFalse));
      expect(withDefault[0]!.label).toBe("apple");
    });

    test("strips the numeric reverse-mapping keys of a numeric enum", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(Direction);

      /*
       * Object.keys(Direction) is ["0","1","2","3","Up","Down","Left","Right"].
       * The four numeric keys must be dropped, leaving four options. The label
       * comes from the value (the number), the value is the coerced number.
       */
      expect(options).toHaveLength(4);
      expect(toPairs(options)).toEqual([
        ["0", 0],
        ["1", 1],
        ["2", 2],
        ["3", 3],
      ]);
    });

    test("keeps the member name as label for a numeric enum when useKeyAsLabel is true", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(Direction, true);

      expect(toPairs(options)).toEqual([
        ["Up", 0],
        ["Down", 1],
        ["Left", 2],
        ["Right", 3],
      ]);
    });

    test("coerces explicit numeric-enum values to numbers", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(HttpStatus, true);

      expect(toPairs(options)).toEqual([
        ["Ok", 200],
        ["NotFound", 404],
      ]);
      /* The value is a real number, not the string "200". */
      expect(typeof options[0]!.value).toBe("number");
    });

    test("converts a number-looking string value into a number", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(NumericStringValue);

      expect(options).toHaveLength(1);
      expect(options[0]!.label).toBe("42");
      expect(options[0]!.value).toBe(42);
      expect(typeof options[0]!.value).toBe("number");
    });

    test("treats an empty-string value as the number zero (Number('') === 0)", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(EmptyStringValue);

      /*
       * canBeConvertedToNumber("") is true because Number("") is 0, so the
       * value is coerced to 0 while the label stays the empty string.
       */
      expect(options).toHaveLength(1);
      expect(options[0]!.label).toBe("");
      expect(options[0]!.value).toBe(0);
    });

    test("returns an empty array for an enum with no members", () => {
      expect(DropdownUtil.getDropdownOptionsFromEnum(EmptyEnum)).toEqual([]);
    });

    test("returns a fresh array on each call", () => {
      const first: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(Fruit);
      const second: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(Fruit);

      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });
  });

  describe("getDropdownOptionsFromEnumWithReadableLabels", () => {
    test("spaces out a PascalCase value while leaving the stored value untouched", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(
          TriggerReason,
        );

      expect(options).toHaveLength(1);
      expect(options[0]!.label).toBe("On Error Or Frustration");
      /* The value is the verbatim identifier, not the spaced-out label. */
      expect(options[0]!.value).toBe("OnErrorOrFrustration");
    });

    test("keeps an initialism run together (OIDCProvider -> 'OIDC Provider')", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(SsoProtocol);

      expect(options[0]!.label).toBe("OIDC Provider");
      expect(options[0]!.value).toBe("OIDCProvider");
    });

    test("labels off the value, not the key, matching getDropdownOptionsFromEnum's default", () => {
      /*
       * Fruit's values are already lower-case single words, so the readable
       * transform is a no-op and the label equals the value. This locks in the
       * fact that the readable helper starts from the value-based labels.
       */
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(Fruit);

      expect(toPairs(options)).toEqual([
        ["apple", "apple"],
        ["banana", "banana"],
        ["cherry", "cherry"],
      ]);
    });

    test("returns an empty array for an enum with no members", () => {
      expect(
        DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(EmptyEnum),
      ).toEqual([]);
    });
  });

  describe("getDropdownOptionFromEnumForValue", () => {
    test("returns the matching option for a present string value", () => {
      const option: DropdownOption | undefined =
        DropdownUtil.getDropdownOptionFromEnumForValue(Fruit, "banana");

      expect(option).toBeDefined();
      expect(option!.label).toBe("banana");
      expect(option!.value).toBe("banana");
    });

    test("returns undefined when no option carries the value", () => {
      const option: DropdownOption | undefined =
        DropdownUtil.getDropdownOptionFromEnumForValue(Fruit, "durian");

      expect(option).toBeUndefined();
    });

    test("returns undefined for a numeric enum searched by string, because values are coerced to numbers", () => {
      /*
       * Direction's option values are the numbers 0..3, and the lookup uses
       * strict equality against the string parameter, so "0" never matches 0.
       */
      const option: DropdownOption | undefined =
        DropdownUtil.getDropdownOptionFromEnumForValue(Direction, "0");

      expect(option).toBeUndefined();
    });

    test("returns undefined when the enum has no members", () => {
      expect(
        DropdownUtil.getDropdownOptionFromEnumForValue(EmptyEnum, "anything"),
      ).toBeUndefined();
    });
  });

  describe("getDropdownOptionsFromEntityArray", () => {
    test("maps each row's label and value columns", () => {
      const array: Array<BaseModel> = [
        new EntityStub({ name: "Acme", id: "row-1" }),
        new EntityStub({ name: "Globex", id: "row-2" }),
      ] as unknown as Array<BaseModel>;

      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEntityArray({
          array: array,
          labelField: "name",
          valueField: "id",
        });

      expect(toPairs(options)).toEqual([
        ["Acme", "row-1"],
        ["Globex", "row-2"],
      ]);
      /* No color column, so no color is attached. */
      expect(options[0]!.color).toBeUndefined();
    });

    test("attaches the color when the row exposes a populated color column", () => {
      const color: Color = new Color("#112233");
      const array: Array<BaseModel> = [
        new EntityStub({ name: "Priority", id: "p-1", color: color }, "color"),
      ] as unknown as Array<BaseModel>;

      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEntityArray({
          array: array,
          labelField: "name",
          valueField: "id",
        });

      expect(options[0]!.color).toBe(color);
      expect(options[0]!.color!.toString()).toBe("#112233");
    });

    test("omits the color when the named color column resolves to null", () => {
      const array: Array<BaseModel> = [
        new EntityStub({ name: "Priority", id: "p-1", color: null }, "color"),
      ] as unknown as Array<BaseModel>;

      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEntityArray({
          array: array,
          labelField: "name",
          valueField: "id",
        });

      expect(options).toHaveLength(1);
      expect(options[0]!.color).toBeUndefined();
    });

    test("does not crash and adds no color when getFirstColorColumn is not a function", () => {
      /*
       * The source guards the color lookup behind a typeof === "function"
       * check, so a row lacking the method entirely still maps cleanly.
       */
      const rowWithoutColorMethod: { getColumnValue(c: string): string } = {
        getColumnValue: (columnName: string): string => {
          return columnName === "name" ? "Legacy" : "legacy-1";
        },
      };
      const array: Array<BaseModel> = [
        rowWithoutColorMethod,
      ] as unknown as Array<BaseModel>;

      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEntityArray({
          array: array,
          labelField: "name",
          valueField: "id",
        });

      expect(toPairs(options)).toEqual([["Legacy", "legacy-1"]]);
      expect(options[0]!.color).toBeUndefined();
    });

    test("returns an empty array for an empty input array", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEntityArray({
          array: [],
          labelField: "name",
          valueField: "id",
        });

      expect(options).toEqual([]);
    });
  });

  describe("getDropdownOptionsFromArray", () => {
    test("maps each string to an option whose label and value are that string", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromArray(["red", "green", "blue"]);

      expect(toPairs(options)).toEqual([
        ["red", "red"],
        ["green", "green"],
        ["blue", "blue"],
      ]);
    });

    test("de-duplicates while preserving first-seen order", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromArray(["a", "b", "a", "c", "b"]);

      expect(toPairs(options)).toEqual([
        ["a", "a"],
        ["b", "b"],
        ["c", "c"],
      ]);
    });

    test("keeps a single empty-string entry rather than dropping it", () => {
      const options: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromArray(["", "x", ""]);

      expect(toPairs(options)).toEqual([
        ["", ""],
        ["x", "x"],
      ]);
    });

    test("returns an empty array for an empty input", () => {
      expect(DropdownUtil.getDropdownOptionsFromArray([])).toEqual([]);
    });
  });
});
