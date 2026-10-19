import {
  countPostmortemRuleTemplates,
  getPostmortemRuleTemplatesProblem,
  MAX_POSTMORTEM_RULE_TEMPLATES,
  POSTMORTEM_RULE_TOO_MANY_TEMPLATES_MESSAGE,
} from "../../../Types/AI/PostmortemRuleTemplates";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * How many templates a postmortem rule may name: at most
 * MAX_POSTMORTEM_RULE_TEMPLATES, each counted once however it is written -
 * the dashboard sends { _id }, the API and Terraform may send ids as text
 * or { id }, and a model carries an ObjectID.
 */

const ids: (count: number) => Array<string> = (
  count: number,
): Array<string> => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  });
};

describe("MAX_POSTMORTEM_RULE_TEMPLATES", () => {
  it("is ten, and the refusal names it", () => {
    expect(MAX_POSTMORTEM_RULE_TEMPLATES).toBe(10);
    expect(POSTMORTEM_RULE_TOO_MANY_TEMPLATES_MESSAGE).toBe(
      "A postmortem rule can name at most 10 templates. Split the incidents it matches between two rules, or name fewer templates.",
    );
  });
});

describe("countPostmortemRuleTemplates", () => {
  it("counts nothing when nothing, or no list, is written", () => {
    expect(countPostmortemRuleTemplates(undefined)).toBe(0);
    expect(countPostmortemRuleTemplates(null)).toBe(0);
    expect(countPostmortemRuleTemplates([])).toBe(0);
    expect(countPostmortemRuleTemplates("not a list")).toBe(0);
    expect(countPostmortemRuleTemplates({ _id: ids(1)[0] })).toBe(0);
  });

  it("counts ids however they are written", () => {
    const [first, second, third, fourth] = ids(4);

    expect(
      countPostmortemRuleTemplates([
        first,
        { _id: second },
        { id: third },
        { _id: new ObjectID(fourth!) },
      ]),
    ).toBe(4);
  });

  it("counts a template named twice once, whatever its case or spacing", () => {
    const [first] = ids(1);

    expect(
      countPostmortemRuleTemplates([
        first,
        { _id: first },
        ` ${first!.toUpperCase()} `,
      ]),
    ).toBe(1);
  });

  it("leaves out entries that name no template", () => {
    const [first] = ids(1);

    expect(
      countPostmortemRuleTemplates([
        first,
        "",
        "   ",
        null,
        undefined,
        42,
        {},
        { _id: "" },
        { name: "Database outage" },
      ]),
    ).toBe(1);
  });
});

describe("getPostmortemRuleTemplatesProblem", () => {
  it("lets a rule name no template, one, or up to the most", () => {
    expect(getPostmortemRuleTemplatesProblem(undefined)).toBeNull();
    expect(getPostmortemRuleTemplatesProblem([])).toBeNull();
    expect(getPostmortemRuleTemplatesProblem(ids(1))).toBeNull();
    expect(
      getPostmortemRuleTemplatesProblem(ids(MAX_POSTMORTEM_RULE_TEMPLATES)),
    ).toBeNull();
  });

  it("refuses one more than the most, saying what to do instead", () => {
    expect(
      getPostmortemRuleTemplatesProblem(ids(MAX_POSTMORTEM_RULE_TEMPLATES + 1)),
    ).toBe(POSTMORTEM_RULE_TOO_MANY_TEMPLATES_MESSAGE);
  });

  it("does not count the same template twice towards the most", () => {
    const repeated: Array<string> = [
      ...ids(MAX_POSTMORTEM_RULE_TEMPLATES),
      ...ids(MAX_POSTMORTEM_RULE_TEMPLATES),
    ];

    expect(getPostmortemRuleTemplatesProblem(repeated)).toBeNull();
  });
});
