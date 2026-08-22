import {
  DictionaryEntryValue,
  DictionaryFilterOperator,
  buildDictionaryValue,
  detectOperatorFromValue,
  formatDictionaryEntryValue,
} from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import { ObjectType } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("DictionaryFilterOperator - IsAnyOf (multi-value membership)", () => {
  it("builds an Includes wrapper from a multi-value selection", () => {
    const built: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.IsAnyOf,
      rawValue: "",
      rawValues: ["system", "user"],
    });

    expect(built).toBeInstanceOf(Includes);
    expect((built as Includes).values).toEqual(["system", "user"]);
  });

  it("drops empty-string entries so an empty pick becomes an empty Includes (treated as 'All' downstream)", () => {
    const built: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.IsAnyOf,
      rawValue: "",
      rawValues: ["system", "", "user"],
    });

    expect((built as Includes).values).toEqual(["system", "user"]);
  });

  it("builds an empty Includes when no values are supplied", () => {
    const built: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.IsAnyOf,
      rawValue: "",
    });

    expect(built).toBeInstanceOf(Includes);
    expect((built as Includes).values).toEqual([]);
  });

  it("detects a hydrated Includes instance as IsAnyOf with a joined display value and structured array", () => {
    const detected: {
      operator: DictionaryFilterOperator;
      rawValue: string;
      rawValues?: Array<string> | undefined;
    } = detectOperatorFromValue(new Includes(["system", "user"]));

    expect(detected.operator).toBe(DictionaryFilterOperator.IsAnyOf);
    expect(detected.rawValue).toBe("system, user");
    expect(detected.rawValues).toEqual(["system", "user"]);
  });

  it("detects the round-tripped `{_type, value}` JSON shape as IsAnyOf", () => {
    const jsonShape: { _type: ObjectType; value: Array<string> } = {
      _type: ObjectType.Includes,
      value: ["system", "user"],
    };

    const detected: {
      operator: DictionaryFilterOperator;
      rawValues?: Array<string> | undefined;
    } = detectOperatorFromValue(jsonShape);

    expect(detected.operator).toBe(DictionaryFilterOperator.IsAnyOf);
    expect(detected.rawValues).toEqual(["system", "user"]);
  });

  it("round-trips build -> detect without losing values", () => {
    const built: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.IsAnyOf,
      rawValue: "",
      rawValues: ["nice", "softirq", "steal"],
    });

    const detected: {
      operator: DictionaryFilterOperator;
      rawValues?: Array<string> | undefined;
    } = detectOperatorFromValue(built);

    expect(detected.operator).toBe(DictionaryFilterOperator.IsAnyOf);
    expect(detected.rawValues).toEqual(["nice", "softirq", "steal"]);
  });

  it("detects an empty Includes as IsAnyOf with an empty raw value", () => {
    const detected: {
      operator: DictionaryFilterOperator;
      rawValue: string;
      rawValues?: Array<string> | undefined;
    } = detectOperatorFromValue(new Includes([]));

    expect(detected.operator).toBe(DictionaryFilterOperator.IsAnyOf);
    expect(detected.rawValue).toBe("");
    expect(detected.rawValues).toEqual([]);
  });

  it("leaves a bare string mapping to EqualTo (existing single-value filters keep working)", () => {
    const detected: {
      operator: DictionaryFilterOperator;
      rawValue: string;
    } = detectOperatorFromValue("system");

    expect(detected.operator).toBe(DictionaryFilterOperator.EqualTo);
    expect(detected.rawValue).toBe("system");
  });
});

describe("DictionaryFilterOperator - IsNoneOf (multi-value exclusion)", () => {
  it("builds an IncludesNone wrapper from a multi-value selection", () => {
    const built: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.IsNoneOf,
      rawValue: "",
      rawValues: ["system", "user"],
    });

    expect(built).toBeInstanceOf(IncludesNone);
    expect((built as IncludesNone).values).toEqual(["system", "user"]);
  });

  it("drops empty-string entries", () => {
    const built: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.IsNoneOf,
      rawValue: "",
      rawValues: ["system", "", "user"],
    });

    expect((built as IncludesNone).values).toEqual(["system", "user"]);
  });

  it("detects a hydrated IncludesNone instance as IsNoneOf with a joined display value", () => {
    const detected: {
      operator: DictionaryFilterOperator;
      rawValue: string;
      rawValues?: Array<string> | undefined;
    } = detectOperatorFromValue(new IncludesNone(["system", "user"]));

    expect(detected.operator).toBe(DictionaryFilterOperator.IsNoneOf);
    expect(detected.rawValue).toBe("system, user");
    expect(detected.rawValues).toEqual(["system", "user"]);
  });

  it("detects the round-tripped `{_type, value}` JSON shape as IsNoneOf", () => {
    const jsonShape: { _type: ObjectType; value: Array<string> } = {
      _type: ObjectType.IncludesNone,
      value: ["system", "user"],
    };

    const detected: {
      operator: DictionaryFilterOperator;
      rawValues?: Array<string> | undefined;
    } = detectOperatorFromValue(jsonShape);

    expect(detected.operator).toBe(DictionaryFilterOperator.IsNoneOf);
    expect(detected.rawValues).toEqual(["system", "user"]);
  });

  it("round-trips build -> detect without losing values", () => {
    const built: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.IsNoneOf,
      rawValue: "",
      rawValues: ["nice", "softirq"],
    });

    const detected: {
      operator: DictionaryFilterOperator;
      rawValues?: Array<string> | undefined;
    } = detectOperatorFromValue(built);

    expect(detected.operator).toBe(DictionaryFilterOperator.IsNoneOf);
    expect(detected.rawValues).toEqual(["nice", "softirq"]);
  });
});

describe("formatDictionaryEntryValue", () => {
  /*
   * These values reach React children (filter chips, read-only viewers).
   * Rendering an operator instance directly throws "Objects are not valid as
   * a React child", so every branch has to come back as a string.
   */
  it("renders a bare scalar unchanged so pre-operator filters look the same", () => {
    expect(formatDictionaryEntryValue("prod")).toBe("prod");
    expect(formatDictionaryEntryValue(42)).toBe("42");
    expect(formatDictionaryEntryValue(true)).toBe("true");
  });

  it("renders an EqualTo wrapper without a redundant '=' prefix", () => {
    expect(formatDictionaryEntryValue(new EqualTo<string>("prod"))).toBe(
      "prod",
    );
  });

  it("prefixes every other operator with its symbol", () => {
    expect(formatDictionaryEntryValue(new NotEqual<string>("prod"))).toBe(
      "!= prod",
    );
    expect(formatDictionaryEntryValue(new Search<string>("prod"))).toBe(
      "contains prod",
    );
    expect(formatDictionaryEntryValue(new GreaterThan<number>(500))).toBe(
      "> 500",
    );
  });

  it("joins multi-value operators", () => {
    expect(formatDictionaryEntryValue(new Includes(["system", "user"]))).toBe(
      "is any of system, user",
    );
    expect(
      formatDictionaryEntryValue(new IncludesNone(["system", "user"])),
    ).toBe("is none of system, user");
  });

  it("renders value-less operators as the symbol alone", () => {
    expect(formatDictionaryEntryValue(new IsNull())).toBe("is empty");
    expect(formatDictionaryEntryValue(new NotNull())).toBe("is not empty");
  });

  it("renders raw `{_type, value}` JSON straight out of storage", () => {
    expect(
      formatDictionaryEntryValue({
        _type: ObjectType.Search,
        value: "prod",
      }),
    ).toBe("contains prod");
  });

  it("returns a string for null / undefined rather than throwing", () => {
    expect(formatDictionaryEntryValue(null)).toBe("");
    expect(formatDictionaryEntryValue(undefined)).toBe("");
  });
});
