import MetricPipelineRule from "../../../Models/DatabaseModels/MetricPipelineRule";
import MetricPipelineRuleService from "../../../Server/Services/MetricPipelineRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  getMetricPipelineRuleFiltersRefusal,
  validateMetricPipelineRuleFilters,
} from "../../../Server/Utils/MetricPipelineRuleValidation";
import BadDataException from "../../../Types/Exception/BadDataException";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import {
  describePatternProblemReason,
  PatternProblemReason,
} from "../../../Utils/LinearRegExp/PatternProblem";
import {
  clearLinearRegExpCache,
  getCachedPatternCharacters,
  getCachedPatternCount,
} from "../../../Utils/LinearRegExp/PatternCache";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

jest.mock("../../../Server/Utils/Logger");

/*
 * ---------------------------------------------------------------------------
 * A METRIC PIPELINE RULE'S REGEX FILTER IS ONE INGEST CAN RUN, OR REFUSED.
 *
 * Matches Regex and Does Not Match Regex filters run, on the ingest every
 * project shares, on the linear-time matcher: JavaScript's syntax and
 * answers, in time in line with the metric name or attribute value. A
 * pattern it cannot run - not a regular expression, a back-reference, too
 * large - matched nothing, silently. It is now refused when the rule is
 * saved, from the dashboard, the API or Terraform, with what to change; a
 * write that sends no filters is never held up by ones saved before.
 * ---------------------------------------------------------------------------
 */

function regexFilter(
  pattern: string,
  conditionType: MetricPipelineRuleFilterConditionType = MetricPipelineRuleFilterConditionType.MatchesRegex,
): MetricPipelineRuleFilterCondition {
  return {
    checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
    conditionType: conditionType,
    value: pattern,
  };
}

const BACK_REFERENCE_PROBLEM: string = describePatternProblemReason(
  PatternProblemReason.BackReference,
);

describe("the refusal for a rule's filters", () => {
  test("none for filters ingest can run, look-arounds included", () => {
    expect(
      getMetricPipelineRuleFiltersRefusal([
        regexFilter("^http\\.server\\.(?!internal)\\w+$"),
        regexFilter(
          "(?<=k8s\\.)pod",
          MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
        ),
        {
          checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
          attributeKey: "http.method",
          conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
          value: "(",
        },
      ]),
    ).toBeNull();
  });

  test("a back-reference, in either regex condition, naming the filter", () => {
    for (const conditionType of [
      MetricPipelineRuleFilterConditionType.MatchesRegex,
      MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
    ]) {
      expect(
        getMetricPipelineRuleFiltersRefusal([
          regexFilter("^ok$"),
          regexFilter("(\\w)\\1", conditionType),
        ]),
      ).toBe(`Filter 2: the pattern ${BACK_REFERENCE_PROBLEM}`);
    }
  });

  test("a pattern too large to run", () => {
    expect(
      getMetricPipelineRuleFiltersRefusal([regexFilter(".{0,9000}")]),
    ).toBe(
      `Filter 1: the pattern ${describePatternProblemReason(PatternProblemReason.TooLarge)}`,
    );
  });

  test("megabytes of pattern, save after save: too large, said at once, and nothing of them kept", () => {
    clearLinearRegExpCache();

    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        for (let index: number = 0; index < 20; index++) {
          const pattern: string = `${index}(${"a".repeat(1_000_000)}`;
          const refusal: string | null = getMetricPipelineRuleFiltersRefusal([
            regexFilter(pattern),
          ]);

          expect(refusal).toBe(
            `Filter 1: the pattern ${describePatternProblemReason(PatternProblemReason.TooLarge)}`,
          );
          // The refusal does not repeat the pattern back.
          expect(refusal!.length).toBeLessThan(200);
        }
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(getCachedPatternCount()).toBe(0);
    expect(getCachedPatternCharacters()).toBe(0);
  });

  test("what is not a regular expression, with the engine's reason", () => {
    const refusal: string | null = getMetricPipelineRuleFiltersRefusal([
      regexFilter("([unclosed"),
    ]);

    expect(refusal).toMatch(
      /^Filter 1: the pattern is not a valid regular expression \(.+\), so the filter would never match\. Fix the pattern\.$/,
    );
    expect(refusal).not.toContain("Invalid regular expression: /");
  });

  test("not a text condition's value, nor what is not a list of filters", () => {
    expect(
      getMetricPipelineRuleFiltersRefusal([
        {
          checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
          conditionType: MetricPipelineRuleFilterConditionType.Contains,
          value: "(\\w)\\1",
        },
      ]),
    ).toBeNull();
    expect(getMetricPipelineRuleFiltersRefusal(undefined)).toBeNull();
    expect(getMetricPipelineRuleFiltersRefusal("(\\w)\\1")).toBeNull();
    expect(getMetricPipelineRuleFiltersRefusal([null, 7])).toBeNull();
  });

  test("throws it as bad data", () => {
    expect(() => {
      validateMetricPipelineRuleFilters([regexFilter("(a)\\1")]);
    }).toThrow(BadDataException);
  });
});

describe("every write of a metric pipeline rule is checked", () => {
  type Check = (write: unknown) => Promise<void>;

  const hooks: {
    checkCreateBeforeReferences: Check;
    checkUpdateBeforeReferences: Check;
  } = MetricPipelineRuleService as unknown as {
    checkCreateBeforeReferences: Check;
    checkUpdateBeforeReferences: Check;
  };

  test("a create", async () => {
    const rule: MetricPipelineRule = new MetricPipelineRule();
    rule.filters = [regexFilter("(\\d)\\1")];

    await expect(
      hooks.checkCreateBeforeReferences({
        data: rule,
        props: { isRoot: true },
      } as CreateBy<MetricPipelineRule>),
    ).rejects.toThrow(`Filter 1: the pattern ${BACK_REFERENCE_PROBLEM}`);

    rule.filters = [regexFilter("^node_\\w+_seconds$")];
    await expect(
      hooks.checkCreateBeforeReferences({
        data: rule,
        props: { isRoot: true },
      } as CreateBy<MetricPipelineRule>),
    ).resolves.toBeUndefined();
  });

  test("an update that sends filters", async () => {
    await expect(
      hooks.checkUpdateBeforeReferences({
        query: {},
        data: { filters: [regexFilter("([unclosed")] },
        props: { isRoot: true },
      } as unknown as UpdateBy<MetricPipelineRule>),
    ).rejects.toThrow(BadDataException);
  });

  test("but not an update that leaves the filters alone", async () => {
    await expect(
      hooks.checkUpdateBeforeReferences({
        query: {},
        data: { name: "Drop internal metrics", isEnabled: false },
        props: { isRoot: true },
      } as unknown as UpdateBy<MetricPipelineRule>),
    ).resolves.toBeUndefined();
  });
});
