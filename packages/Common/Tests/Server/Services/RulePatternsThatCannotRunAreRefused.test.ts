import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorRulePatternValidator from "../../../Server/Utils/Rules/MonitorRulePatternValidator";
import NetworkDeviceRulePatternValidator from "../../../Server/Utils/NetworkDevice/RulePatternValidator";
import SloRulePatternValidator from "../../../Server/Utils/Slo/SloRulePatternValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { RULE_CRITERIA_FIELDS_BY_MODEL } from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getRuleCriteriaValidationError } from "../../../Utils/Rules/RuleCriteriaMatcher";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A RULE PATTERN THE MATCHER CANNOT RUN IS REFUSED WHEN IT IS SAVED.
 *
 * Every rule's patterns run on the linear-time matcher, which cannot run a
 * back-reference (\1, \k<name>) or a pattern too large. A rule saved with
 * one would match nothing, silently - so the save refuses it, through every
 * way a rule is written (the form, the API, Terraform, an import all reach
 * DatabaseService), and says what to change. A pattern that is not a
 * regular expression at all is left as it was before: some engines read it
 * as a '*' wildcard, and the forms that validate it still do.
 * ---------------------------------------------------------------------------
 */

type SanitizeFunction = (
  data: unknown,
  props: DatabaseCommonInteractionProps,
  isUpdate: boolean,
) => Promise<JSONObject>;

const BACK_REFERENCE: string = "(db)-\\1";
const CANNOT_RUN_REASON: string =
  "it refers back to what an earlier group matched (\\1 or \\k<name>). Patterns are run in time that grows only in line with the text they read, which a back-reference cannot do. Write the pattern without it.";

// A rule column that holds a pattern, by its name.
const PATTERN_FIELD_NAME: RegExp = /pattern|regex/i;

// Pattern fields matched as '*' wildcards or OID prefixes, never as regex.
const WILDCARD_ONLY: ReadonlySet<string> = new Set<string>([
  "hostnamePattern",
  "sysObjectIdPattern",
]);

interface PatternColumn {
  model: string;
  field: string;
  title: string;
  service: DatabaseService<BaseModel>;
}

function patternColumns(): Array<PatternColumn> {
  const columns: Array<PatternColumn> = [];

  for (const [modelName, fields] of Object.entries(
    RULE_CRITERIA_FIELDS_BY_MODEL,
  )) {
    const modelType: { new (): BaseModel } | undefined = AllModelTypes.find(
      (candidate: { new (): BaseModel }): boolean => {
        return new candidate().constructor.name === modelName;
      },
    );

    if (!modelType) {
      throw new Error(`No model named ${modelName}.`);
    }

    const model: BaseModel = new modelType();

    for (const field of fields) {
      if (!PATTERN_FIELD_NAME.test(field) || WILDCARD_ONLY.has(field)) {
        continue;
      }

      const metadata: { type: TableColumnType; title?: string } | undefined =
        model.getTableColumnMetadata(field);

      if (!metadata || metadata.type === TableColumnType.EntityArray) {
        continue;
      }

      columns.push({
        model: modelName,
        field: field,
        title: metadata.title || field,
        service: new DatabaseService<BaseModel>(modelType),
      });
    }
  }

  return columns;
}

async function sanitize(
  column: PatternColumn,
  data: JSONObject,
  isUpdate: boolean,
): Promise<JSONObject> {
  return await (
    column.service as unknown as { sanitizeCreateOrUpdate: SanitizeFunction }
  ).sanitizeCreateOrUpdate(data, { isRoot: true }, isUpdate);
}

describe("saving a rule's pattern", () => {
  test("finds the pattern columns of every rule kind", () => {
    const columns: Array<PatternColumn> = patternColumns();

    // Name and description patterns of some eighty rule kinds.
    expect(columns.length).toBeGreaterThan(120);
    expect(
      columns.some((column: PatternColumn): boolean => {
        return (
          column.model === "AlertGroupingRule" &&
          column.field === "alertTitlePattern"
        );
      }),
    ).toBe(true);
  });

  test.each([false, true])(
    "refuses a back-reference in every rule kind's pattern columns (update=%p)",
    async (isUpdate: boolean) => {
      const wrong: Array<string> = [];

      for (const column of patternColumns()) {
        let refusal: unknown = null;

        try {
          await sanitize(column, { [column.field]: BACK_REFERENCE }, isUpdate);
        } catch (error: unknown) {
          refusal = error;
        }

        if (
          !(refusal instanceof BadDataException) ||
          refusal.message !==
            `${column.title} "${BACK_REFERENCE}" cannot run: ${CANNOT_RUN_REASON}`
        ) {
          wrong.push(`${column.model}.${column.field}: ${String(refusal)}`);
        }
      }

      expect(wrong).toEqual([]);
    },
  );

  test("refuses a pattern too large, saying so", async () => {
    const column: PatternColumn = patternColumns().find(
      (candidate: PatternColumn): boolean => {
        return (
          candidate.model === "MonitorLabelRule" &&
          candidate.field === "monitorNamePattern"
        );
      },
    )!;

    await expect(
      sanitize(column, { monitorNamePattern: "a{20000}" }, false),
    ).rejects.toThrow(
      'Monitor Name Pattern "a{20000}" cannot run: it is too large to run. Shorten it, or repeat its parts fewer times.',
    );
  });

  test("keeps every pattern that runs - look-arounds too - and what it kept before", async () => {
    for (const column of patternColumns()) {
      for (const pattern of [
        "^prod-(?!test)",
        "(?<=db-)\\d+",
        "*checkout*",
        "api-(01",
        "",
      ]) {
        await expect(
          sanitize(column, { [column.field]: pattern }, true),
        ).resolves.toBeTruthy();
      }
    }
  });

  test("leaves the wildcard-only fields to their own checks", async () => {
    const siteRule: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
      AllModelTypes.find((candidate: { new (): BaseModel }): boolean => {
        return new candidate().constructor.name === "NetworkSiteAssignmentRule";
      })!,
    );

    await expect(
      (
        siteRule as unknown as { sanitizeCreateOrUpdate: SanitizeFunction }
      ).sanitizeCreateOrUpdate(
        { hostnamePattern: "(sw)\\1*" },
        { isRoot: true },
        true,
      ),
    ).resolves.toBeTruthy();
  });
});

describe("a rule's conditions", () => {
  function criteriaMatching(pattern: string): RuleCriteria {
    return {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.MatchesPattern,
          value: pattern,
        },
      ],
    } as RuleCriteria;
  }

  test("refuse a Matches pattern condition with a back-reference, saying why", () => {
    expect(
      getRuleCriteriaValidationError(criteriaMatching(BACK_REFERENCE)),
    ).toBe(
      `Rule criteria filter 1: A pattern rule criteria operator's pattern cannot run: ${CANNOT_RUN_REASON}`,
    );
  });

  test("refuse one whose back-reference is followed by a '*': it is no wildcard", () => {
    expect(getRuleCriteriaValidationError(criteriaMatching("(\\w)\\1*"))).toBe(
      `Rule criteria filter 1: A pattern rule criteria operator's pattern cannot run: ${CANNOT_RUN_REASON}`,
    );
    expect(() => {
      MonitorRulePatternValidator.validate({ namePattern: "(\\w)\\1*" });
    }).toThrow(
      `Monitor Name Pattern "(\\w)\\1*" cannot run: ${CANNOT_RUN_REASON}`,
    );
  });

  test("keep one with a look-ahead, and one that is a wildcard", () => {
    expect(
      getRuleCriteriaValidationError(criteriaMatching("^api-(?!internal)")),
    ).toBeNull();
    expect(
      getRuleCriteriaValidationError(criteriaMatching("*api*")),
    ).toBeNull();
  });
});

describe("the forms' own pattern checks say why", () => {
  test.each([
    [
      "status page and SLO monitor rules",
      (): void => {
        MonitorRulePatternValidator.validate({ namePattern: BACK_REFERENCE });
      },
      `Monitor Name Pattern "${BACK_REFERENCE}" cannot run: ${CANNOT_RUN_REASON}`,
    ],
    [
      "SLO label and owner rules",
      (): void => {
        SloRulePatternValidator.validate({ namePattern: BACK_REFERENCE });
      },
      `SLO Name Pattern "${BACK_REFERENCE}" cannot run: ${CANNOT_RUN_REASON}`,
    ],
    [
      "network device rules",
      (): void => {
        NetworkDeviceRulePatternValidator.validate({
          namePattern: BACK_REFERENCE,
        });
      },
      `Network Device Name Pattern "${BACK_REFERENCE}" cannot run: ${CANNOT_RUN_REASON}`,
    ],
  ])("%s", (_name: string, validate: () => void, message: string) => {
    expect(validate).toThrow(message);
  });
});
