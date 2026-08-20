import FieldType from "../../../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormFieldSchemaTypeUtil from "../../../../../UI/Components/Forms/Utils/FormFieldSchemaTypeUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * FormFieldSchemaTypeUtil.toFieldType maps a form's high-level schema type onto
 * the lower-level FieldType the renderer understands. The implementation is a
 * pure switch, so every case is a fixed input -> fixed output with no time,
 * network, database or randomness involved — all assertions below are
 * deterministic.
 */

interface SchemaToFieldExpectation {
  schemaType: FormFieldSchemaType;
  expected: FieldType;
}

/*
 * The full, hand-checked mapping table — one row per FormFieldSchemaType member.
 * This is the backbone of the suite: it pins down the exact FieldType every
 * schema type collapses to, including the several many-to-one and renamed
 * cases (for example Time -> DateTime, Domain -> Text, Query -> Element).
 */
const expectations: Array<SchemaToFieldExpectation> = [
  { schemaType: FormFieldSchemaType.ObjectID, expected: FieldType.ObjectID },
  { schemaType: FormFieldSchemaType.Name, expected: FieldType.Name },
  { schemaType: FormFieldSchemaType.Hostname, expected: FieldType.Hostname },
  { schemaType: FormFieldSchemaType.ImageFile, expected: FieldType.ImageFile },
  { schemaType: FormFieldSchemaType.URL, expected: FieldType.URL },
  { schemaType: FormFieldSchemaType.Route, expected: FieldType.Route },
  { schemaType: FormFieldSchemaType.Number, expected: FieldType.Number },
  { schemaType: FormFieldSchemaType.Password, expected: FieldType.Password },
  { schemaType: FormFieldSchemaType.Text, expected: FieldType.Text },
  { schemaType: FormFieldSchemaType.Time, expected: FieldType.DateTime },
  { schemaType: FormFieldSchemaType.Email, expected: FieldType.Email },
  {
    schemaType: FormFieldSchemaType.PositiveNumber,
    expected: FieldType.Number,
  },
  { schemaType: FormFieldSchemaType.Date, expected: FieldType.Date },
  { schemaType: FormFieldSchemaType.Phone, expected: FieldType.Phone },
  { schemaType: FormFieldSchemaType.DateTime, expected: FieldType.DateTime },
  { schemaType: FormFieldSchemaType.Domain, expected: FieldType.Text },
  { schemaType: FormFieldSchemaType.LongText, expected: FieldType.LongText },
  { schemaType: FormFieldSchemaType.Color, expected: FieldType.Color },
  { schemaType: FormFieldSchemaType.Dropdown, expected: FieldType.Dropdown },
  { schemaType: FormFieldSchemaType.File, expected: FieldType.File },
  {
    schemaType: FormFieldSchemaType.MultiSelectDropdown,
    expected: FieldType.MultiSelectDropdown,
  },
  {
    schemaType: FormFieldSchemaType.OptionChooserButton,
    expected: FieldType.Element,
  },
  { schemaType: FormFieldSchemaType.Toggle, expected: FieldType.Boolean },
  { schemaType: FormFieldSchemaType.Port, expected: FieldType.Port },
  {
    schemaType: FormFieldSchemaType.EncryptedText,
    expected: FieldType.HiddenText,
  },
  { schemaType: FormFieldSchemaType.Markdown, expected: FieldType.Markdown },
  {
    schemaType: FormFieldSchemaType.JavaScript,
    expected: FieldType.JavaScript,
  },
  { schemaType: FormFieldSchemaType.CSS, expected: FieldType.CSS },
  { schemaType: FormFieldSchemaType.HTML, expected: FieldType.HTML },
  { schemaType: FormFieldSchemaType.RadioButton, expected: FieldType.Text },
  { schemaType: FormFieldSchemaType.JSON, expected: FieldType.JSON },
  { schemaType: FormFieldSchemaType.Query, expected: FieldType.Element },
  {
    schemaType: FormFieldSchemaType.CustomComponent,
    expected: FieldType.Element,
  },
  { schemaType: FormFieldSchemaType.Checkbox, expected: FieldType.Boolean },
  {
    schemaType: FormFieldSchemaType.CategoryCheckbox,
    expected: FieldType.Boolean,
  },
  { schemaType: FormFieldSchemaType.Icon, expected: FieldType.Icon },
  /*
   * These three schema types have no explicit case in the switch and therefore
   * fall through to the default arm, which returns Text. They are listed here
   * so the exhaustiveness guard below sees them and so their default-path
   * behaviour is asserted alongside every other member.
   */
  { schemaType: FormFieldSchemaType.MultipleFiles, expected: FieldType.Text },
  { schemaType: FormFieldSchemaType.Dictionary, expected: FieldType.Text },
  { schemaType: FormFieldSchemaType.CardSelect, expected: FieldType.Text },
];

describe("FormFieldSchemaTypeUtil.toFieldType — full mapping table", () => {
  test.each(expectations)(
    "maps schema type $schemaType to field type $expected",
    (expectation: SchemaToFieldExpectation): void => {
      const actual: FieldType = FormFieldSchemaTypeUtil.toFieldType(
        expectation.schemaType,
      );

      expect(actual).toBe(expectation.expected);
    },
  );
});

describe("FormFieldSchemaTypeUtil.toFieldType — many-to-one and renamed cases", () => {
  /*
   * Several schema types deliberately do NOT map to a like-named FieldType.
   * These are the cases most likely to break silently under a careless edit, so
   * each is spelled out on its own to document the intended collapse.
   */
  test("Time renders as a DateTime field", () => {
    expect(FormFieldSchemaTypeUtil.toFieldType(FormFieldSchemaType.Time)).toBe(
      FieldType.DateTime,
    );
  });

  test("PositiveNumber renders as a plain Number field", () => {
    expect(
      FormFieldSchemaTypeUtil.toFieldType(FormFieldSchemaType.PositiveNumber),
    ).toBe(FieldType.Number);
  });

  test("Domain and RadioButton both render as Text fields", () => {
    expect(
      FormFieldSchemaTypeUtil.toFieldType(FormFieldSchemaType.Domain),
    ).toBe(FieldType.Text);
    expect(
      FormFieldSchemaTypeUtil.toFieldType(FormFieldSchemaType.RadioButton),
    ).toBe(FieldType.Text);
  });

  test("EncryptedText renders as a HiddenText field", () => {
    expect(
      FormFieldSchemaTypeUtil.toFieldType(FormFieldSchemaType.EncryptedText),
    ).toBe(FieldType.HiddenText);
  });

  test("OptionChooserButton, Query and CustomComponent all render as Element fields", () => {
    const elementSchemaTypes: Array<FormFieldSchemaType> = [
      FormFieldSchemaType.OptionChooserButton,
      FormFieldSchemaType.Query,
      FormFieldSchemaType.CustomComponent,
    ];

    for (const schemaType of elementSchemaTypes) {
      expect(FormFieldSchemaTypeUtil.toFieldType(schemaType)).toBe(
        FieldType.Element,
      );
    }
  });

  test("Toggle, Checkbox and CategoryCheckbox all render as Boolean fields", () => {
    const booleanSchemaTypes: Array<FormFieldSchemaType> = [
      FormFieldSchemaType.Toggle,
      FormFieldSchemaType.Checkbox,
      FormFieldSchemaType.CategoryCheckbox,
    ];

    for (const schemaType of booleanSchemaTypes) {
      expect(FormFieldSchemaTypeUtil.toFieldType(schemaType)).toBe(
        FieldType.Boolean,
      );
    }
  });
});

describe("FormFieldSchemaTypeUtil.toFieldType — default fallback", () => {
  /*
   * The switch matches on the enum's string VALUE. An input whose value is not a
   * known schema type must land on the default arm and come back as Text rather
   * than throwing or returning undefined.
   */
  test("an unrecognised value falls back to Text", () => {
    expect(
      FormFieldSchemaTypeUtil.toFieldType(
        "definitely-not-a-schema-type" as FormFieldSchemaType,
      ),
    ).toBe(FieldType.Text);
  });

  test("an empty string falls back to Text", () => {
    expect(FormFieldSchemaTypeUtil.toFieldType("" as FormFieldSchemaType)).toBe(
      FieldType.Text,
    );
  });

  test("the enum members with no explicit case (MultipleFiles, Dictionary, CardSelect) fall back to Text", () => {
    expect(
      FormFieldSchemaTypeUtil.toFieldType(FormFieldSchemaType.MultipleFiles),
    ).toBe(FieldType.Text);
    expect(
      FormFieldSchemaTypeUtil.toFieldType(FormFieldSchemaType.Dictionary),
    ).toBe(FieldType.Text);
    expect(
      FormFieldSchemaTypeUtil.toFieldType(FormFieldSchemaType.CardSelect),
    ).toBe(FieldType.Text);
  });
});

describe("FormFieldSchemaTypeUtil.toFieldType — the Toggle value quirk", () => {
  /*
   * FormFieldSchemaType.Toggle is unusual: its member name is Toggle but its
   * string value is "Boolean". Because the switch compares the underlying
   * string value, feeding the raw literal "Boolean" must resolve to the Toggle
   * case (Boolean), not to the default arm.
   */
  test("the Toggle member's underlying string value is 'Boolean'", () => {
    expect(FormFieldSchemaType.Toggle).toBe("Boolean");
  });

  test("the raw literal 'Boolean' resolves to the Toggle case", () => {
    expect(
      FormFieldSchemaTypeUtil.toFieldType("Boolean" as FormFieldSchemaType),
    ).toBe(FieldType.Boolean);
  });
});

describe("FormFieldSchemaTypeUtil.toFieldType — structural guarantees", () => {
  test("covers every FormFieldSchemaType member (guards against a new, unmapped type)", () => {
    const coveredValues: Set<string> = new Set(
      expectations.map((expectation: SchemaToFieldExpectation): string => {
        return expectation.schemaType;
      }),
    );
    const allSchemaValues: Array<string> = Object.values(FormFieldSchemaType);

    for (const schemaValue of allSchemaValues) {
      expect(coveredValues.has(schemaValue)).toBe(true);
    }

    /*
     * Every schema value is unique, so the covered set and the enum must be the
     * same size. If a member is added to the enum this fails, flagging that the
     * mapping (and this table) needs updating.
     */
    expect(coveredValues.size).toBe(allSchemaValues.length);
  });

  test("always returns a defined value that is a real FieldType member", () => {
    const validFieldTypes: Set<string> = new Set(Object.values(FieldType));

    for (const schemaValue of Object.values(FormFieldSchemaType)) {
      const result: FieldType = FormFieldSchemaTypeUtil.toFieldType(
        schemaValue as FormFieldSchemaType,
      );

      expect(result).toBeDefined();
      expect(validFieldTypes.has(result)).toBe(true);
    }
  });

  test("is pure — the same input yields the same output every time", () => {
    for (const expectation of expectations) {
      const first: FieldType = FormFieldSchemaTypeUtil.toFieldType(
        expectation.schemaType,
      );
      const second: FieldType = FormFieldSchemaTypeUtil.toFieldType(
        expectation.schemaType,
      );

      expect(first).toBe(second);
      expect(first).toBe(expectation.expected);
    }
  });
});
