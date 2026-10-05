import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import Select from "../../../Types/BaseDatabase/Select";
import { RuleCriteriaOperator } from "../../../Types/Rules/RuleCriteria";
import { isRuleCriteriaConditionRequired } from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import React from "react";
import type { ModelField } from "../Forms/ModelForm";
import type Field from "../Forms/Types/Field";
import type Filter from "../ModelFilter/Filter";
import type Column from "../ModelTable/Column";
import type Columns from "../ModelTable/Columns";
import FieldType from "../Types/FieldType";
import {
  getRuleCriteriaFieldName,
  getRuleCriteriaOperatorsForField,
  isRuleCriteriaAddressRangeField,
} from "./RuleCriteriaFields";
import {
  getLegacyRuleCriteriaFields,
  RULE_CRITERIA_FIELD_NAME,
} from "./RuleCriteriaModelForm";
import RuleCriteriaSummary, {
  getRuleCriteriaSummaryText,
} from "./RuleCriteriaSummary";

export interface RuleCriteriaTableConfiguration<TEntity extends BaseModel> {
  columns: Columns<TEntity>;
  filters: Array<Filter<TEntity>>;
  selectMoreFields?: Select<TEntity> | undefined;
  helpContent?: RuleCriteriaTableHelpContent | undefined;
}

export interface RuleCriteriaTableHelpContent {
  title: string;
  description?: string | undefined;
  markdown: string;
}

/*
 * The help panel's "Match Criteria" section, written for the conditions the
 * page's fields actually offer. Each line names the operators exactly as the
 * builder labels them.
 */
const HELP_COMBINE_LINES: string = `Add one or more conditions, then choose how they are combined:

- **Match all (AND)** — every condition must be true.
- **Match any (OR)** — at least one condition must be true.`;

const HELP_OPERATOR_INTRO: string =
  "Each condition compares one field. Only the operators that fit the field are offered:";

const HELP_EQUALITY_LINE: string = "- **Equality** — Equals or Does not equal.";
const HELP_TEXT_LINE: string =
  "- **Text** — Contains, Does not contain, Starts with or Ends with.";
const HELP_PATTERN_LINE: string =
  "- **Patterns** — Matches pattern or Does not match pattern. A pattern is a case-insensitive regular expression (`^api-.*`) or a `*` wildcard (`*api*`).";
const HELP_ADDRESS_RANGE_LINE: string =
  "- **Address ranges** — Is in or Is not in a CIDR (`10.0.0.0/24`) or an octet range (`10.16-22.0-255.1-254`).";
const HELP_LIST_LINE: string =
  "- **Lists** — Has any of, Has all of or Has none of the selected values.";

const HELP_EMPTY_MATCHES_EVERYTHING: string =
  "A rule with no conditions applies to everything.";
const HELP_EMPTY_NEEDS_CONDITION: string =
  "This kind of rule needs at least one condition: with none, it would match nothing.";

export function getRuleCriteriaHelpSectionBody<TEntity>(data: {
  // The page's match fields; without them every kind of operator is listed.
  fields?: Array<Field<TEntity>> | undefined;
  requiresCondition?: boolean | undefined;
}): string {
  const fields: Array<Field<TEntity>> = data.fields || [];
  const listsEverything: boolean = fields.length === 0;
  const offered: Set<RuleCriteriaOperator> = new Set<RuleCriteriaOperator>();
  let offersPatterns: boolean = listsEverything;
  let offersAddressRanges: boolean = listsEverything;

  for (const field of fields) {
    for (const operator of getRuleCriteriaOperatorsForField(field)) {
      offered.add(operator);

      if (
        operator === RuleCriteriaOperator.MatchesPattern ||
        operator === RuleCriteriaOperator.DoesNotMatchPattern
      ) {
        if (isRuleCriteriaAddressRangeField(field)) {
          offersAddressRanges = true;
        } else {
          offersPatterns = true;
        }
      }
    }
  }

  const offers: (operator: RuleCriteriaOperator) => boolean = (
    operator: RuleCriteriaOperator,
  ): boolean => {
    return listsEverything || offered.has(operator);
  };

  const operatorLines: Array<string> = [
    offers(RuleCriteriaOperator.Equals) ? HELP_EQUALITY_LINE : "",
    offers(RuleCriteriaOperator.Contains) ? HELP_TEXT_LINE : "",
    offersPatterns ? HELP_PATTERN_LINE : "",
    offersAddressRanges ? HELP_ADDRESS_RANGE_LINE : "",
    offers(RuleCriteriaOperator.HasAnyOf) ? HELP_LIST_LINE : "",
  ].filter((line: string): boolean => {
    return line.length > 0;
  });

  return [
    HELP_COMBINE_LINES,
    [HELP_OPERATOR_INTRO, "", ...operatorLines].join("\n"),
    data.requiresCondition
      ? HELP_EMPTY_NEEDS_CONDITION
      : HELP_EMPTY_MATCHES_EVERYTHING,
  ].join("\n\n");
}

// The section as it reads for a page that offers every kind of operator.
export const RULE_CRITERIA_HELP_SECTION_BODY: string =
  getRuleCriteriaHelpSectionBody({});

const RULE_CRITERIA_HELP_HEADING: RegExp =
  /^(#{1,6})[\t ]+Match Criteria(?:[\t ]+\(Filtering\))?[\t ]*$/;
const MARKDOWN_HEADING: RegExp = /^(#{1,6})[\t ]+/;

/**
 * Replace only the body of a rule help document's match-criteria section.
 * Other sections are intentionally retained because they describe the action
 * performed by that particular rule type.
 */
export function replaceRuleCriteriaHelpMarkdown(
  markdown: string,
  sectionBody: string = RULE_CRITERIA_HELP_SECTION_BODY,
): string {
  const lines: Array<string> = markdown.split("\n");
  const result: Array<string> = [];
  let sectionWasReplaced: boolean = false;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index]!;
    const targetHeadingMatch: RegExpMatchArray | null = line.match(
      RULE_CRITERIA_HELP_HEADING,
    );

    if (!targetHeadingMatch) {
      result.push(line);
      continue;
    }

    sectionWasReplaced = true;
    const headingLevel: number = targetHeadingMatch[1]!.length;

    result.push(line, "", sectionBody, "");

    while (index + 1 < lines.length) {
      const nextLine: string = lines[index + 1]!;
      const nextHeadingMatch: RegExpMatchArray | null =
        nextLine.match(MARKDOWN_HEADING);

      if (nextHeadingMatch && nextHeadingMatch[1]!.length <= headingLevel) {
        break;
      }

      index++;
    }
  }

  return sectionWasReplaced ? result.join("\n") : markdown;
}

function replaceRuleCriteriaHelpContent(
  helpContent: RuleCriteriaTableHelpContent | undefined,
  sectionBody: string,
): RuleCriteriaTableHelpContent | undefined {
  if (!helpContent) {
    return undefined;
  }

  const markdown: string = replaceRuleCriteriaHelpMarkdown(
    helpContent.markdown,
    sectionBody,
  );

  if (markdown === helpContent.markdown) {
    return helpContent;
  }

  return {
    ...helpContent,
    markdown,
  };
}

function getPrimaryFieldName(value: {
  field?: Record<string, unknown> | undefined;
}): string | null {
  return Object.keys(value.field || {})[0] || null;
}

export function getRuleCriteriaTableConfiguration<
  TEntity extends BaseModel,
>(data: {
  model: TEntity;
  formFields?: Array<ModelField<TEntity>> | undefined;
  columns: Columns<TEntity>;
  filters: Array<Filter<TEntity>>;
  selectMoreFields?: Select<TEntity> | undefined;
  helpContent?: RuleCriteriaTableHelpContent | undefined;
}): RuleCriteriaTableConfiguration<TEntity> {
  const legacyFields: Array<ModelField<TEntity>> = data.formFields
    ? getLegacyRuleCriteriaFields(data.formFields)
    : [];

  if (!(data.model instanceof RuleBaseModel) || legacyFields.length === 0) {
    return {
      columns: data.columns,
      filters: data.filters,
      selectMoreFields: data.selectMoreFields,
      helpContent: data.helpContent,
    };
  }

  const legacyFieldNames: Set<string> = new Set<string>(
    legacyFields
      .map((field: ModelField<TEntity>): string | null => {
        return getRuleCriteriaFieldName(field);
      })
      .filter((fieldName: string | null): fieldName is string => {
        return Boolean(fieldName);
      }),
  );
  const retainedColumns: Columns<TEntity> = [];
  let summaryColumnIndex: number | null = null;

  for (const column of data.columns) {
    const fieldName: string | null = getPrimaryFieldName(column);

    if (fieldName && legacyFieldNames.has(fieldName)) {
      summaryColumnIndex ??= retainedColumns.length;
      continue;
    }

    retainedColumns.push(column);
  }

  const summaryColumn: Column<TEntity> = {
    id: "rule-criteria",
    field: { [RULE_CRITERIA_FIELD_NAME]: true } as Column<TEntity>["field"],
    title: "Match Criteria",
    type: FieldType.Element,
    disableSort: true,
    wrapContent: true,
    getElement: (item: TEntity) => {
      return <RuleCriteriaSummary fields={legacyFields} item={item} />;
    },
    getExportValue: (item: TEntity): string => {
      return getRuleCriteriaSummaryText({
        fields: legacyFields,
        item: item,
      });
    },
  };
  const insertionIndex: number =
    summaryColumnIndex ?? Math.min(1, retainedColumns.length);

  retainedColumns.splice(insertionIndex, 0, summaryColumn);

  const selectMoreFields: Record<string, unknown> = {
    ...((data.selectMoreFields || {}) as Record<string, unknown>),
    [RULE_CRITERIA_FIELD_NAME]: true,
  };

  for (const field of legacyFields) {
    Object.assign(selectMoreFields, field.field || {});
  }

  return {
    columns: retainedColumns,
    filters: data.filters.filter((filter: Filter<TEntity>): boolean => {
      const fieldName: string | null = getPrimaryFieldName(filter);
      return !fieldName || !legacyFieldNames.has(fieldName);
    }),
    selectMoreFields: selectMoreFields as Select<TEntity>,
    helpContent: replaceRuleCriteriaHelpContent(
      data.helpContent,
      getRuleCriteriaHelpSectionBody({
        fields: legacyFields,
        requiresCondition: isRuleCriteriaConditionRequired(
          data.model.tableName,
        ),
      }),
    ),
  };
}

export default getRuleCriteriaTableConfiguration;
