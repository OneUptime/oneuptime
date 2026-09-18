import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import Select from "../../../Types/BaseDatabase/Select";
import React from "react";
import type { ModelField } from "../Forms/ModelForm";
import type Filter from "../ModelFilter/Filter";
import type Column from "../ModelTable/Column";
import type Columns from "../ModelTable/Columns";
import FieldType from "../Types/FieldType";
import { getRuleCriteriaFieldName } from "./RuleCriteriaBuilder";
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

export const RULE_CRITERIA_HELP_SECTION_BODY: string = `Add one or more conditions, then choose how they are combined:

- **Match all (AND)** — every condition must match.
- **Match any (OR)** — at least one condition must match.

Choose an operator for each condition. Only operators supported by the selected field are shown; these can include:

- **Equality** — Equals or Does not equal.
- **Text matching** — Contains, Does not contain, Starts with, or Ends with.
- **Pattern matching** — Matches pattern or Does not match pattern. Patterns accept a regular expression or a \`*\` wildcard pattern.
- **Multi-select matching** — Has any of, Has all of, or Has none of the selected values.`;

const RULE_CRITERIA_HELP_HEADING: RegExp =
  /^(#{1,6})[\t ]+Match Criteria(?:[\t ]+\(Filtering\))?[\t ]*$/;
const MARKDOWN_HEADING: RegExp = /^(#{1,6})[\t ]+/;

/**
 * Replace only the body of a rule help document's match-criteria section.
 * Other sections are intentionally retained because they describe the action
 * performed by that particular rule type.
 */
export function replaceRuleCriteriaHelpMarkdown(markdown: string): string {
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

    result.push(line, "", RULE_CRITERIA_HELP_SECTION_BODY, "");

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
): RuleCriteriaTableHelpContent | undefined {
  if (!helpContent) {
    return undefined;
  }

  const markdown: string = replaceRuleCriteriaHelpMarkdown(
    helpContent.markdown,
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
    helpContent: replaceRuleCriteriaHelpContent(data.helpContent),
  };
}

export default getRuleCriteriaTableConfiguration;
