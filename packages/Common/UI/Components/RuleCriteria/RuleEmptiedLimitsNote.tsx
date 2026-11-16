import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import { Yellow } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import {
  readRuleEmptiedLimits,
  RuleEmptiedLimit,
} from "../../../Types/Rules/RuleEmptiedLimit";
import {
  formatList,
  translatableTerm,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Alert, { AlertType } from "../Alerts/Alert";
import type Column from "../ModelTable/Column";
import ExplainedPill from "../Pill/ExplainedPill";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A RULE LIMITED TO RECORDS THAT WERE ALL DELETED SAYS SO (#9066).
 *
 * Deleting the last record a rule's list held - the only monitor of an
 * on-call rule, the only label of a host label rule - switches the rule off
 * rather than leave it applying to every record, and the rule keeps a note
 * of why (RuleBaseModel.emptiedLimits). Switching it on is refused until
 * the list says something again. The note is drawn:
 *
 *   - in every table of rules, beside the rule's status: "Limited to
 *     deleted records", which says on hover, a tap, focus and to a screen
 *     reader what was deleted and what to do (ExplainedPill), as "Adds
 *     nothing" does;
 *   - on the rule's form, above what it applies to, where the person
 *     chooses that again.
 *
 * Each sentence is looked up whole, the list named as its form names it,
 * the records by their names and the date in the reader's language.
 */

export const RULE_EMPTIED_LIMITS_PILL_TEXT: string = translationKey(
  "Limited to deleted records",
);

export const RULE_EMPTIED_LIMITS_ENTRY: string = translationKey(
  "{{list}}: {{names}}, deleted {{date}}.",
);

export const RULE_EMPTIED_LIMITS_SWITCHED_OFF: string = translationKey(
  "OneUptime switched this rule off when they were deleted.",
);

export const RULE_EMPTIED_LIMITS_WHAT_TO_DO: string = translationKey(
  "Switched on as it is, the rule would not be limited by these lists at all. Edit it to choose what it applies to, then switch it on.",
);

export const RULE_EMPTIED_LIMITS_NAMES_AND_MORE: {
  one: string;
  other: string;
} = {
  one: translationKey("{{names}} and {{count}} more"),
  other: translationKey("{{names}} and {{count}} more"),
};

export const RULE_EMPTIED_LIMITS_TEST_ID: string = "rule-emptied-limits";

export const RULE_EMPTIED_LIMITS_ALERT_TEST_ID: string =
  "rule-emptied-limits-alert";

// The rule's column that holds the note.
export const RULE_EMPTIED_LIMITS_COLUMN: string = "emptiedLimits";

// The rule's status column, beside which a table draws the note.
const RULE_ENABLED_COLUMN: string = "isEnabled";

// The note a rule holds, read defensively: none for anything else.
export function getRuleEmptiedLimits(item: unknown): Array<RuleEmptiedLimit> {
  if (!item || typeof item !== "object") {
    return [];
  }

  return readRuleEmptiedLimits(
    (item as Record<string, unknown>)[RULE_EMPTIED_LIMITS_COLUMN],
  );
}

// A rule's list as its form names it: "Monitors", "Incident Severities".
function getListTitle(model: BaseModel, list: string): string {
  return model.getTableColumnMetadata(list)?.title || list;
}

// The deleted records by name, as the reader's language lists them.
function getNames(entry: RuleEmptiedLimit, translator: Translator): string {
  const names: string = formatList(entry.names, translator);
  const more: number = Math.max(entry.count - entry.names.length, 0);

  if (entry.names.length === 0) {
    return translator.formatNumber(entry.count);
  }

  if (more === 0) {
    return names;
  }

  return translator.translatePlural(RULE_EMPTIED_LIMITS_NAMES_AND_MORE, more, {
    names: names,
  });
}

// One sentence a list: "Monitors: Checkout, deleted Nov 16, 2026."
export function getRuleEmptiedLimitLines(data: {
  model: BaseModel;
  emptiedLimits: Array<RuleEmptiedLimit>;
  translator: Translator;
}): Array<string> {
  return data.emptiedLimits.map((entry: RuleEmptiedLimit): string => {
    return data.translator.translateTemplate(RULE_EMPTIED_LIMITS_ENTRY, {
      list: translatableTerm(getListTitle(data.model, entry.list)),
      names: getNames(entry, data.translator),
      date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        entry.deletedAt,
        true,
      ),
    });
  });
}

/*
 * Everything the note says, as plain sentences: what was deleted, whether
 * OneUptime switched the rule off for it, and what to do.
 */
export function getRuleEmptiedLimitsExplanation(data: {
  model: BaseModel;
  emptiedLimits: Array<RuleEmptiedLimit>;
  translator: Translator;
}): string {
  const switchedOff: boolean = data.emptiedLimits.some(
    (entry: RuleEmptiedLimit): boolean => {
      return entry.switchedOff;
    },
  );

  return [
    ...getRuleEmptiedLimitLines(data),
    ...(switchedOff
      ? [data.translator.translateText(RULE_EMPTIED_LIMITS_SWITCHED_OFF) || ""]
      : []),
    data.translator.translateText(RULE_EMPTIED_LIMITS_WHAT_TO_DO) || "",
  ]
    .filter((sentence: string): boolean => {
      return sentence.length > 0;
    })
    .join(" ");
}

// Beside a rule's status, in a table of rules.
export const RuleEmptiedLimitsPill: FunctionComponent<{
  model: BaseModel;
  emptiedLimits: Array<RuleEmptiedLimit>;
}> = (props: {
  model: BaseModel;
  emptiedLimits: Array<RuleEmptiedLimit>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.emptiedLimits.length === 0) {
    return <></>;
  }

  return (
    <span data-testid={RULE_EMPTIED_LIMITS_TEST_ID}>
      <ExplainedPill
        color={Yellow}
        text={RULE_EMPTIED_LIMITS_PILL_TEXT}
        explanation={getRuleEmptiedLimitsExplanation({
          model: props.model,
          emptiedLimits: props.emptiedLimits,
          translator: translator,
        })}
        dataTestId={`${RULE_EMPTIED_LIMITS_TEST_ID}-button`}
      />
    </span>
  );
};

// On the rule's form, above what it applies to.
export const RuleEmptiedLimitsAlert: FunctionComponent<{
  model: BaseModel;
  emptiedLimits: Array<RuleEmptiedLimit>;
}> = (props: {
  model: BaseModel;
  emptiedLimits: Array<RuleEmptiedLimit>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.emptiedLimits.length === 0) {
    return <></>;
  }

  const switchedOff: boolean = props.emptiedLimits.some(
    (entry: RuleEmptiedLimit): boolean => {
      return entry.switchedOff;
    },
  );

  return (
    <Alert
      type={AlertType.WARNING}
      dataTestId={RULE_EMPTIED_LIMITS_ALERT_TEST_ID}
      strongTitle={RULE_EMPTIED_LIMITS_PILL_TEXT}
      title={
        <div className="space-y-1">
          {getRuleEmptiedLimitLines({
            model: props.model,
            emptiedLimits: props.emptiedLimits,
            translator: translator,
          }).map((line: string, index: number): ReactElement => {
            return <p key={index}>{line}</p>;
          })}
          {switchedOff ? (
            <p>{translator.translateText(RULE_EMPTIED_LIMITS_SWITCHED_OFF)}</p>
          ) : (
            <></>
          )}
          <p>{translator.translateText(RULE_EMPTIED_LIMITS_WHAT_TO_DO)}</p>
        </div>
      }
    />
  );
};

/*
 * A table of rules' columns, with the note drawn beside each rule's status:
 * the column of its Enabled switch, as the page draws it. Every other column
 * is as the page gave it, and so is the status of a rule with no note.
 */
export function withRuleEmptiedLimitsMarker<TBaseModel extends BaseModel>(
  model: TBaseModel,
  columns: Array<Column<TBaseModel>>,
): Array<Column<TBaseModel>> {
  if (!(model instanceof RuleBaseModel)) {
    return columns;
  }

  return columns.map((column: Column<TBaseModel>): Column<TBaseModel> => {
    const getElement: Column<TBaseModel>["getElement"] = column.getElement;

    if (
      !getElement ||
      Object.keys(column.field || {})[0] !== RULE_ENABLED_COLUMN
    ) {
      return column;
    }

    return {
      ...column,
      getElement: (
        item: TBaseModel,
        onBeforeFetchData?: TBaseModel | undefined,
      ): ReactElement => {
        const status: ReactElement = getElement(item, onBeforeFetchData);
        const emptiedLimits: Array<RuleEmptiedLimit> =
          getRuleEmptiedLimits(item);

        if (emptiedLimits.length === 0) {
          return status;
        }

        return (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {status}
            <RuleEmptiedLimitsPill
              model={model}
              emptiedLimits={emptiedLimits}
            />
          </span>
        );
      },
    };
  });
}
