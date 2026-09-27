import {
  CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX,
  CUSTOM_FIELD_VARIABLE_KEY_FALLBACK,
  CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH,
  generateCustomFieldVariableKey,
  getCustomFieldTemplateVariableName,
  getCustomFieldVariableKeyBase,
  isValidCustomFieldVariableKey,
} from "../../../Types/CustomField/CustomFieldVariableKey";
import Slug from "../../../Utils/Slug";
import SubscriberNotificationTemplateCompiler from "../../../Types/StatusPage/SubscriberNotificationTemplateCompiler";
import { describe, expect, test } from "@jest/globals";

/*
 * An incident custom field's template key is how a custom subscriber email
 * reaches its value: {{customFields.<key>}}. The template compiler fills only
 * placeholders of ASCII word characters and dots, so what matters most here
 * is that every key - whatever the name, whatever else the project holds -
 * is one the compiler will actually fill.
 */

type FillFunction = (key: string, value: string) => string;

// What a template using the key comes out as.
const fill: FillFunction = (key: string, value: string): string => {
  return SubscriberNotificationTemplateCompiler.compileTemplate(
    `Impact: {{${getCustomFieldTemplateVariableName(key)}}}`,
    {
      [getCustomFieldTemplateVariableName(key)]: value,
    },
  );
};

describe("getCustomFieldVariableKeyBase", () => {
  test.each([
    ["Impact", "impact"],
    ["Expected Resolution", "expected_resolution"],
    ["Estimated Duration (minutes)", "estimated_duration_minutes"],
    ["Affected Users/Systems", "affected_users_systems"],
    ["  Leading and trailing  ", "leading_and_trailing"],
    ["multiple---separators___here", "multiple_separators_here"],
    ["ALL CAPS", "all_caps"],
    ["2FA Status", "2fa_status"],
    ["already_snake_case", "already_snake_case"],
    ["tabs\tand\nnewlines", "tabs_and_newlines"],
    ["customFields.dotted", "customfields_dotted"],
  ])("%j becomes %j", (name: string, key: string) => {
    expect(getCustomFieldVariableKeyBase(name)).toBe(key);
  });

  test.each([
    ["Café", "cafe"],
    ["Résumé des impacts", "resume_des_impacts"],
    ["Größe", "grosse"],
    ["Straße", "strasse"],
    ["Ærø Ø", "aero_o"],
    ["Łódź", "lodz"],
    ["Þórður", "thordur"],
    ["Ñandú", "nandu"],
    ["Ｆｕｌｌ ｗｉｄｔｈ", "full_width"],
    ["ﬁeld", "field"],
    ["İstanbul", "istanbul"],
    ["São Tomé", "sao_tome"],
  ])(
    "transliterates the Latin letters of %j into %j",
    (name: string, key: string) => {
      expect(getCustomFieldVariableKeyBase(name)).toBe(key);
    },
  );

  test.each([
    ["影响"],
    ["Влияние"],
    ["التأثير"],
    ["🔥🔥"],
    ["!!!"],
    [""],
    ["   "],
    ["___"],
  ])(
    "falls back to %j's fallback key when nothing Latin is left",
    (name: string) => {
      expect(getCustomFieldVariableKeyBase(name)).toBe(
        CUSTOM_FIELD_VARIABLE_KEY_FALLBACK,
      );
    },
  );

  test("keeps the Latin part of a mixed name", () => {
    expect(getCustomFieldVariableKeyBase("Impact 影响")).toBe("impact");
    expect(getCustomFieldVariableKeyBase("SLA — 🔥 Tier")).toBe("sla_tier");
  });

  test("tolerates a missing name", () => {
    expect(getCustomFieldVariableKeyBase(undefined as unknown as string)).toBe(
      CUSTOM_FIELD_VARIABLE_KEY_FALLBACK,
    );
  });

  test("cuts a long name to the maximum without a trailing underscore", () => {
    const name: string = `${"word ".repeat(40)}end`;
    const key: string = getCustomFieldVariableKeyBase(name);

    expect(key.length).toBeLessThanOrEqual(
      CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH,
    );
    expect(key.endsWith("_")).toBe(false);
    expect(isValidCustomFieldVariableKey(key)).toBe(true);
  });
});

describe("generateCustomFieldVariableKey", () => {
  test("uses the name's key when nothing else has it", () => {
    expect(
      generateCustomFieldVariableKey({
        name: "Impact",
        existingKeys: ["expected_resolution"],
      }),
    ).toBe("impact");
  });

  test("numbers a collision from _2", () => {
    expect(
      generateCustomFieldVariableKey({
        name: "Impact",
        existingKeys: ["impact"],
      }),
    ).toBe("impact_2");
  });

  test("takes the first free number", () => {
    expect(
      generateCustomFieldVariableKey({
        name: "impact!",
        existingKeys: ["impact", "impact_2", "impact_3", "impact_5"],
      }),
    ).toBe("impact_4");
  });

  test("names differing only in punctuation or case get different keys", () => {
    const taken: Array<string> = [];

    for (const name of [
      "Expected Resolution",
      "expected-resolution",
      "EXPECTED RESOLUTION",
      "Expected  Resolution!",
    ]) {
      taken.push(generateCustomFieldVariableKey({ name, existingKeys: taken }));
    }

    expect(taken).toEqual([
      "expected_resolution",
      "expected_resolution_2",
      "expected_resolution_3",
      "expected_resolution_4",
    ]);
  });

  test("a field literally named like a numbered key is not given it twice", () => {
    const first: string = generateCustomFieldVariableKey({
      name: "Impact 2",
      existingKeys: [],
    });
    const second: string = generateCustomFieldVariableKey({
      name: "Impact",
      existingKeys: [first],
    });
    const third: string = generateCustomFieldVariableKey({
      name: "Impact",
      existingKeys: [first, second],
    });

    expect(first).toBe("impact_2");
    expect(second).toBe("impact");
    expect(third).toBe("impact_3");
  });

  test("names with nothing Latin share the fallback, numbered", () => {
    const taken: Array<string> = [];

    for (const name of ["影响", "Влияние", "🔥"]) {
      taken.push(generateCustomFieldVariableKey({ name, existingKeys: taken }));
    }

    expect(taken).toEqual(["field", "field_2", "field_3"]);
  });

  test("ignores empty and missing existing keys", () => {
    expect(
      generateCustomFieldVariableKey({
        name: "Impact",
        existingKeys: [null, undefined, ""],
      }),
    ).toBe("impact");
  });

  test("accepts any iterable of existing keys", () => {
    expect(
      generateCustomFieldVariableKey({
        name: "Impact",
        existingKeys: new Set<string>(["impact"]),
      }),
    ).toBe("impact_2");
  });

  test("a numbered key of a maximum-length name still fits", () => {
    const name: string = "a".repeat(200);
    const base: string = getCustomFieldVariableKeyBase(name);
    const numbered: string = generateCustomFieldVariableKey({
      name,
      existingKeys: [base],
    });

    expect(base.length).toBe(CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH);
    expect(numbered.length).toBeLessThanOrEqual(
      CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH,
    );
    expect(numbered.endsWith("_2")).toBe(true);
    expect(isValidCustomFieldVariableKey(numbered)).toBe(true);
  });

  test("never ends the cut before a suffix on an underscore", () => {
    // 62 characters, where the cut for "_2" lands right after an underscore.
    const name: string = `${"a".repeat(61)} b`;
    const base: string = getCustomFieldVariableKeyBase(name);
    const numbered: string = generateCustomFieldVariableKey({
      name,
      existingKeys: [base],
    });

    expect(numbered).not.toContain("__");
    expect(isValidCustomFieldVariableKey(numbered)).toBe(true);
  });

  test("hundreds of colliding fields all get distinct, valid keys", () => {
    const taken: Array<string> = [];

    for (let i: number = 0; i < 300; i++) {
      taken.push(
        generateCustomFieldVariableKey({
          name: i % 2 === 0 ? "Impact" : "impact?",
          existingKeys: taken,
        }),
      );
    }

    expect(new Set<string>(taken).size).toBe(300);
    for (const key of taken) {
      expect(isValidCustomFieldVariableKey(key)).toBe(true);
    }
  });
});

describe("keys always fit the template placeholder pattern", () => {
  const names: Array<string> = [
    "Impact",
    "Expected Resolution",
    "Größe",
    "影响",
    "Влияние",
    "🔥 hot",
    "a.b.c",
    "{{customFields.x}}",
    "$&",
    "<script>alert(1)</script>",
    "x".repeat(500),
    "   ",
    "2FA",
    "Ｆｕｌｌ ｗｉｄｔｈ",
  ];

  test.each(names)(
    "the key for %j is filled in by the compiler",
    (name: string) => {
      const key: string = generateCustomFieldVariableKey({
        name,
        existingKeys: ["impact", "field"],
      });

      expect(key).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
      expect(isValidCustomFieldVariableKey(key)).toBe(true);
      expect(
        SubscriberNotificationTemplateCompiler.isPlaceholderName(
          getCustomFieldTemplateVariableName(key),
        ),
      ).toBe(true);
      expect(fill(key, "High")).toBe("Impact: High");
    },
  );

  test("the prefix is the one custom templates use", () => {
    expect(CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX).toBe("customFields.");
    expect(getCustomFieldTemplateVariableName("impact")).toBe(
      "customFields.impact",
    );
  });

  test("a slug would not work, which is why keys are not slugs", () => {
    // Slug.getSlug joins with hyphens, which the compiler leaves as written.
    const slug: string = Slug.getSlug("Expected Resolution");

    expect(isValidCustomFieldVariableKey(slug)).toBe(false);
    expect(
      SubscriberNotificationTemplateCompiler.compileTemplate(
        `{{customFields.${slug}}}`,
        { [`customFields.${slug}`]: "x" },
      ),
    ).toBe(`{{customFields.${slug}}}`);
  });
});

describe("isValidCustomFieldVariableKey", () => {
  test.each(["impact", "expected_resolution", "a1_b2", "2fa", "x"])(
    "accepts %j",
    (key: string) => {
      expect(isValidCustomFieldVariableKey(key)).toBe(true);
    },
  );

  test.each([
    "",
    "Impact",
    "expected-resolution",
    "expected resolution",
    "_impact",
    "impact_",
    "im__pact",
    "im.pact",
    "größe",
    "a".repeat(CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH + 1),
    null,
    undefined,
    42,
  ])("rejects %j", (key: unknown) => {
    expect(isValidCustomFieldVariableKey(key)).toBe(false);
  });
});

describe("SubscriberNotificationTemplateCompiler.isPlaceholderName", () => {
  test("agrees with what the compiler fills", () => {
    for (const name of ["a", "a.b", "customFields.impact_2", "A_1.b"]) {
      expect(
        SubscriberNotificationTemplateCompiler.isPlaceholderName(name),
      ).toBe(true);
      expect(
        SubscriberNotificationTemplateCompiler.compileTemplate(`{{${name}}}`, {
          [name]: "filled",
        }),
      ).toBe("filled");
    }

    for (const name of ["a-b", "a b", "é", "", "a{b"]) {
      expect(
        SubscriberNotificationTemplateCompiler.isPlaceholderName(name),
      ).toBe(false);
      expect(
        SubscriberNotificationTemplateCompiler.compileTemplate(`{{${name}}}`, {
          [name]: "filled",
        }),
      ).toBe(`{{${name}}}`);
    }
  });
});
