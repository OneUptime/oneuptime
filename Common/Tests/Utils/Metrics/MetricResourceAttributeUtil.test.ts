import Label from "../../../Models/DatabaseModels/Label";
import { JSONObject } from "../../../Types/JSON";
import MetricResourceAttributeUtil, {
  CustomFieldMetricAttributeNamespace,
  LabelMetricAttributeNamespace,
  LabelPresentAttributeValue,
  ParsedLabelName,
} from "../../../Utils/Metrics/MetricResourceAttributeUtil";
import { describe, expect, test } from "@jest/globals";

function makeLabel(name: string | undefined): Label {
  const label: Label = new Label();

  if (name !== undefined) {
    label.name = name;
  }

  return label;
}

function labels(...names: Array<string | undefined>): Array<Label> {
  return names.map(makeLabel);
}

describe("MetricResourceAttributeUtil", () => {
  describe("namespaces", () => {
    test("labels and custom fields live in distinct oneuptime namespaces", () => {
      expect(LabelMetricAttributeNamespace).toBe("oneuptime.label");
      expect(CustomFieldMetricAttributeNamespace).toBe("oneuptime.customField");
      expect(LabelMetricAttributeNamespace).not.toBe(
        CustomFieldMetricAttributeNamespace,
      );
    });

    test("a bare label records the string true, not a boolean", () => {
      expect(LabelPresentAttributeValue).toBe("true");
      expect(typeof LabelPresentAttributeValue).toBe("string");
    });
  });

  describe("getAttributeKeySegment", () => {
    test.each([
      ["product", "product"],
      ["Product", "product"],
      ["  Product  ", "product"],
      ["PRODUCT", "product"],
      ["Team Name", "team_name"],
      ["high-priority", "high_priority"],
      ["service/api", "service_api"],
      ["tier1", "tier1"],
      ["cpu 90%", "cpu_90"],
      ["a  --  b", "a_b"],
      ["___x___", "x"],
      ["_leading", "leading"],
      ["trailing_", "trailing"],
      ["a.b.c", "a_b_c"],
      ["on-call", "on_call"],
    ])("normalizes %p to %p", (input: string, expected: string) => {
      expect(MetricResourceAttributeUtil.getAttributeKeySegment(input)).toBe(
        expected,
      );
    });

    test("preserves non-ASCII letters instead of mangling them", () => {
      /*
       * "produ_o" would collide with unrelated names and read as corruption in
       * a chart legend, so accented letters survive normalization.
       */
      expect(
        MetricResourceAttributeUtil.getAttributeKeySegment("Produção"),
      ).toBe("produção");
      expect(
        MetricResourceAttributeUtil.getAttributeKeySegment("ЛОКАЦИЯ"),
      ).toBe("локация");
    });

    test.each([
      ["", "empty string"],
      ["   ", "whitespace only"],
      [":::", "punctuation only"],
      ["---", "dashes only"],
      ["_", "single underscore"],
      ["\t\n", "control characters only"],
    ])("returns null for %p (%s)", (input: string) => {
      expect(
        MetricResourceAttributeUtil.getAttributeKeySegment(input),
      ).toBeNull();
    });

    test.each([[undefined], [null]])(
      "returns null for %p",
      (input: undefined | null) => {
        expect(
          MetricResourceAttributeUtil.getAttributeKeySegment(input),
        ).toBeNull();
      },
    );

    test("returns null for a non-string value", () => {
      expect(
        MetricResourceAttributeUtil.getAttributeKeySegment(
          42 as unknown as string,
        ),
      ).toBeNull();
    });

    test("collapses a run of separators into a single underscore", () => {
      expect(
        MetricResourceAttributeUtil.getAttributeKeySegment("a !@# $%^ b"),
      ).toBe("a_b");
    });
  });

  describe("parseLabelName", () => {
    test("a bare label has no value", () => {
      expect(MetricResourceAttributeUtil.parseLabelName("product")).toEqual({
        key: "product",
        value: null,
      });
    });

    test("a key:value label carries its value", () => {
      expect(MetricResourceAttributeUtil.parseLabelName("product:X")).toEqual({
        key: "product",
        value: "X",
      });
    });

    test("whitespace around the separator is trimmed", () => {
      expect(
        MetricResourceAttributeUtil.parseLabelName(
          "  Product Line :  Payments  ",
        ),
      ).toEqual({
        key: "product_line",
        value: "Payments",
      });
    });

    test("only the FIRST colon separates key from value", () => {
      // "env:us-east:1a" must not silently lose the ":1a" tail.
      expect(
        MetricResourceAttributeUtil.parseLabelName("env:us-east:1a"),
      ).toEqual({
        key: "env",
        value: "us-east:1a",
      });
    });

    test("the value keeps its original case and punctuation", () => {
      expect(
        MetricResourceAttributeUtil.parseLabelName("team:Payments & Billing"),
      ).toEqual({
        key: "team",
        value: "Payments & Billing",
      });
    });

    test.each([["product:"], ["product:   "], ["product :"]])(
      "%p is a bare label with a stray separator",
      (input: string) => {
        const parsed: ParsedLabelName | null =
          MetricResourceAttributeUtil.parseLabelName(input);
        expect(parsed?.key).toBe("product");
        expect(parsed?.value).toBeNull();
      },
    );

    test.each([[":x"], [":"], ["   "], [""], ["  :  value"]])(
      "returns null for %p, which yields no usable key",
      (input: string) => {
        expect(MetricResourceAttributeUtil.parseLabelName(input)).toBeNull();
      },
    );

    test.each([[undefined], [null]])(
      "returns null for %p",
      (input: undefined | null) => {
        expect(MetricResourceAttributeUtil.parseLabelName(input)).toBeNull();
      },
    );

    test("truncates a pathologically long value", () => {
      const parsed: ParsedLabelName | null =
        MetricResourceAttributeUtil.parseLabelName(`k:${"v".repeat(1000)}`);
      expect(parsed?.value).toHaveLength(512);
    });
  });

  describe("getLabelAttributes", () => {
    test.each([[undefined], [null]])(
      "returns {} for %p",
      (input: undefined | null) => {
        expect(MetricResourceAttributeUtil.getLabelAttributes(input)).toEqual(
          {},
        );
      },
    );

    test("returns {} for an empty list", () => {
      expect(MetricResourceAttributeUtil.getLabelAttributes([])).toEqual({});
    });

    test("a bare label records presence as true", () => {
      expect(
        MetricResourceAttributeUtil.getLabelAttributes(labels("product")),
      ).toEqual({
        "oneuptime.label.product": "true",
      });
    });

    test("a key:value label records the value", () => {
      expect(
        MetricResourceAttributeUtil.getLabelAttributes(labels("product:X")),
      ).toEqual({
        "oneuptime.label.product": "X",
      });
    });

    test("records every label as its own attribute", () => {
      expect(
        MetricResourceAttributeUtil.getLabelAttributes(
          labels("product:checkout", "Tier: 1", "customer-facing"),
        ),
      ).toEqual({
        "oneuptime.label.product": "checkout",
        "oneuptime.label.tier": "1",
        "oneuptime.label.customer_facing": "true",
      });
    });

    test("merges labels that normalize onto the same key, sorted", () => {
      expect(
        MetricResourceAttributeUtil.getLabelAttributes(
          labels("product:web", "Product: api"),
        ),
      ).toEqual({
        "oneuptime.label.product": "api, web",
      });
    });

    test("an explicit value beats the bare presence marker", () => {
      // "true, web" would be nonsense in a chart legend.
      expect(
        MetricResourceAttributeUtil.getLabelAttributes(
          labels("product", "product:web"),
        ),
      ).toEqual({
        "oneuptime.label.product": "web",
      });
    });

    test("deduplicates repeated values on the same key", () => {
      expect(
        MetricResourceAttributeUtil.getLabelAttributes(
          labels("product:web", "Product:web", "product: web"),
        ),
      ).toEqual({
        "oneuptime.label.product": "web",
      });
    });

    test("is independent of the order the database returned labels in", () => {
      /*
       * Incident and alert metrics are mutable: a refresh replaces the previous
       * point. If attributes varied with row order the series would churn on
       * every refresh.
       */
      const forward: JSONObject =
        MetricResourceAttributeUtil.getLabelAttributes(
          labels("product:web", "product:api", "tier:1", "urgent"),
        );
      const reverse: JSONObject =
        MetricResourceAttributeUtil.getLabelAttributes(
          labels("urgent", "tier:1", "product:api", "product:web"),
        );

      expect(forward).toEqual(reverse);
      expect(forward["oneuptime.label.product"]).toBe("api, web");
    });

    test("emits keys in a stable sorted order, not database row order", () => {
      // toEqual ignores key order, so assert the order itself.
      expect(
        Object.keys(
          MetricResourceAttributeUtil.getLabelAttributes(
            labels("urgent", "product:web", "customer-facing", "tier:1"),
          ),
        ),
      ).toEqual([
        "oneuptime.label.customer_facing",
        "oneuptime.label.product",
        "oneuptime.label.tier",
        "oneuptime.label.urgent",
      ]);
    });

    test("skips labels with no usable name", () => {
      expect(
        MetricResourceAttributeUtil.getLabelAttributes(
          labels(undefined, "", "   ", ":::", ":orphan", "kept"),
        ),
      ).toEqual({
        "oneuptime.label.kept": "true",
      });
    });

    test("survives a null entry in the label array", () => {
      const withNull: Array<Label> = [
        null as unknown as Label,
        makeLabel("kept"),
      ];

      expect(MetricResourceAttributeUtil.getLabelAttributes(withNull)).toEqual({
        "oneuptime.label.kept": "true",
      });
    });

    test("returns {} for a non-array value", () => {
      expect(
        MetricResourceAttributeUtil.getLabelAttributes(
          "product" as unknown as Array<Label>,
        ),
      ).toEqual({});
    });

    test("truncates a merged value that grows past the attribute limit", () => {
      const long: Array<Label> = labels(
        `k:${"a".repeat(400)}`,
        `k:${"b".repeat(400)}`,
      );

      expect(
        String(
          MetricResourceAttributeUtil.getLabelAttributes(long)[
            "oneuptime.label.k"
          ],
        ),
      ).toHaveLength(512);
    });

    test("every recorded value is a string, as Map(String, String) requires", () => {
      const attributes: JSONObject =
        MetricResourceAttributeUtil.getLabelAttributes(
          labels("bare", "withValue:1", "another:x"),
        );

      for (const value of Object.values(attributes)) {
        expect(typeof value).toBe("string");
      }
    });
  });

  describe("getCustomFieldAttributes", () => {
    test.each([[undefined], [null]])(
      "returns {} for %p",
      (input: undefined | null) => {
        expect(
          MetricResourceAttributeUtil.getCustomFieldAttributes(input),
        ).toEqual({});
      },
    );

    test("returns {} for an empty object", () => {
      expect(MetricResourceAttributeUtil.getCustomFieldAttributes({})).toEqual(
        {},
      );
    });

    test("maps a text field straight across", () => {
      expect(
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          Team: "Payments",
        }),
      ).toEqual({
        "oneuptime.customField.team": "Payments",
      });
    });

    test("normalizes the field name but keeps the value verbatim", () => {
      expect(
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          "Owning Team": "Payments & Billing",
        }),
      ).toEqual({
        "oneuptime.customField.owning_team": "Payments & Billing",
      });
    });

    test.each([
      [42, "42"],
      [0, "0"],
      [-1.5, "-1.5"],
      [true, "true"],
      [false, "false"],
    ])(
      "stringifies the scalar %p as %p",
      (input: unknown, expected: string) => {
        expect(
          MetricResourceAttributeUtil.getCustomFieldAttributes({
            Field: input as never,
          }),
        ).toEqual({
          "oneuptime.customField.field": expected,
        });
      },
    );

    test("joins a multi-select array in the order the user chose", () => {
      expect(
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          Squads: ["Payments", "Billing"],
        }),
      ).toEqual({
        "oneuptime.customField.squads": "Payments, Billing",
      });
    });

    test("drops empty entries from a multi-select array", () => {
      expect(
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          Squads: ["Payments", "", null, "  ", "Billing"] as never,
        }),
      ).toEqual({
        "oneuptime.customField.squads": "Payments, Billing",
      });
    });

    test.each([
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["whitespace", "   "],
      ["empty array", []],
      ["array of blanks", ["", "  "]],
      ["empty object", {}],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
    ])(
      "records no attribute for a %s value",
      (_name: string, value: unknown) => {
        expect(
          MetricResourceAttributeUtil.getCustomFieldAttributes({
            Field: value as never,
          }),
        ).toEqual({});
      },
    );

    test("skips a field whose name yields no usable key", () => {
      expect(
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          "   ": "dropped",
          ":::": "dropped",
          Kept: "yes",
        }),
      ).toEqual({
        "oneuptime.customField.kept": "yes",
      });
    });

    test("serializes a nested object rather than losing it", () => {
      expect(
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          Meta: { region: "us-east" } as never,
        }),
      ).toEqual({
        "oneuptime.customField.meta": '{"region":"us-east"}',
      });
    });

    test("renders a Date value as an ISO timestamp", () => {
      expect(
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          ReviewedAt: new Date("2026-08-10T09:30:00.000Z") as never,
        }),
      ).toEqual({
        "oneuptime.customField.reviewedat": "2026-08-10T09:30:00.000Z",
      });
    });

    test("resolves colliding field names deterministically, first by sorted name", () => {
      /*
       * "Team Name" and "team-name" normalize onto one key. They are two
       * different definitions, so their values must not merge into one
       * nonsense string — and which one wins must not depend on key order.
       */
      const forward: JSONObject =
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          "Team Name": "Payments",
          "team-name": "Billing",
        });
      const reverse: JSONObject =
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          "team-name": "Billing",
          "Team Name": "Payments",
        });

      expect(forward).toEqual({
        "oneuptime.customField.team_name": "Payments",
      });
      expect(forward).toEqual(reverse);
    });

    test("a collision does not let a dropped value resurrect the key", () => {
      // "Team Name" sorts first but has no usable value; "team-name" fills in.
      expect(
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          "Team Name": "",
          "team-name": "Billing",
        }),
      ).toEqual({
        "oneuptime.customField.team_name": "Billing",
      });
    });

    test("truncates a long-text field", () => {
      expect(
        String(
          MetricResourceAttributeUtil.getCustomFieldAttributes({
            Notes: "n".repeat(5000),
          })["oneuptime.customField.notes"],
        ),
      ).toHaveLength(512);
    });

    test("returns {} when handed an array instead of an object", () => {
      expect(
        MetricResourceAttributeUtil.getCustomFieldAttributes([
          "a",
          "b",
        ] as unknown as JSONObject),
      ).toEqual({});
    });

    test("every recorded value is a string, as Map(String, String) requires", () => {
      const attributes: JSONObject =
        MetricResourceAttributeUtil.getCustomFieldAttributes({
          Count: 7 as never,
          Flag: true as never,
          Squads: ["a", "b"] as never,
          Team: "Payments",
        });

      expect(Object.keys(attributes)).toHaveLength(4);

      for (const value of Object.values(attributes)) {
        expect(typeof value).toBe("string");
      }
    });
  });

  describe("getResourceAttributes", () => {
    test("returns {} when the resource has neither labels nor custom fields", () => {
      expect(MetricResourceAttributeUtil.getResourceAttributes({})).toEqual({});
      expect(
        MetricResourceAttributeUtil.getResourceAttributes({
          labels: [],
          customFields: {},
        }),
      ).toEqual({});
    });

    test("combines both sources", () => {
      expect(
        MetricResourceAttributeUtil.getResourceAttributes({
          labels: labels("product:checkout", "urgent"),
          customFields: { Team: "Payments", Severity: 3 as never },
        }),
      ).toEqual({
        "oneuptime.label.product": "checkout",
        "oneuptime.label.urgent": "true",
        "oneuptime.customField.team": "Payments",
        "oneuptime.customField.severity": "3",
      });
    });

    test("a label and a custom field of the same name do not collide", () => {
      const attributes: JSONObject =
        MetricResourceAttributeUtil.getResourceAttributes({
          labels: labels("team:from-label"),
          customFields: { Team: "from-custom-field" },
        });

      expect(attributes["oneuptime.label.team"]).toBe("from-label");
      expect(attributes["oneuptime.customField.team"]).toBe(
        "from-custom-field",
      );
    });

    test("every key is namespaced under oneuptime.", () => {
      const attributes: JSONObject =
        MetricResourceAttributeUtil.getResourceAttributes({
          labels: labels("product:checkout", "urgent"),
          customFields: { Team: "Payments" },
        });

      for (const key of Object.keys(attributes)) {
        expect(key.startsWith("oneuptime.")).toBe(true);
      }
    });

    test("cannot collide with the existing unprefixed metric dimensions", () => {
      const reserved: Array<string> = [
        "incidentId",
        "alertId",
        "projectId",
        "monitorId",
        "monitorName",
        "incidentSeverityId",
        "ownerTeamNames",
      ];

      const attributes: JSONObject =
        MetricResourceAttributeUtil.getResourceAttributes({
          labels: labels("projectId:spoofed", "monitorName:spoofed"),
          customFields: { incidentId: "spoofed", ownerTeamNames: "spoofed" },
        });

      for (const key of reserved) {
        expect(attributes[key]).toBeUndefined();
      }

      expect(attributes["oneuptime.label.projectid"]).toBe("spoofed");
      expect(attributes["oneuptime.customField.incidentid"]).toBe("spoofed");
    });
  });

  describe("mergeResourceAttributes", () => {
    test("keeps the existing attributes", () => {
      expect(
        MetricResourceAttributeUtil.mergeResourceAttributes(
          { monitorId: "m1", projectId: "p1" },
          { "oneuptime.label.product": "web" },
        ),
      ).toEqual({
        monitorId: "m1",
        projectId: "p1",
        "oneuptime.label.product": "web",
      });
    });

    test("resource attributes win, so a user-supplied attribute cannot shadow them", () => {
      /*
       * Custom code monitors let the user name their own metric attributes.
       * The oneuptime.* namespace has to stay trustworthy.
       */
      expect(
        MetricResourceAttributeUtil.mergeResourceAttributes(
          { "oneuptime.label.product": "spoofed" },
          { "oneuptime.label.product": "web" },
        ),
      ).toEqual({
        "oneuptime.label.product": "web",
      });
    });

    test("does not mutate either input", () => {
      const existing: JSONObject = { monitorId: "m1" };
      const resource: JSONObject = { "oneuptime.label.product": "web" };

      MetricResourceAttributeUtil.mergeResourceAttributes(existing, resource);

      expect(existing).toEqual({ monitorId: "m1" });
      expect(resource).toEqual({ "oneuptime.label.product": "web" });
    });
  });

  describe("the shapes named in the feature request", () => {
    test('a label "product" stores oneuptime.label.product = true', () => {
      expect(
        MetricResourceAttributeUtil.getResourceAttributes({
          labels: labels("product"),
        }),
      ).toEqual({
        "oneuptime.label.product": "true",
      });
    });

    test('a label "product:X" stores oneuptime.label.product = X', () => {
      expect(
        MetricResourceAttributeUtil.getResourceAttributes({
          labels: labels("product:X"),
        }),
      ).toEqual({
        "oneuptime.label.product": "X",
      });
    });
  });
});
