import IconProp from "Common/Types/Icon/IconProp";
import {
  PagedFirst,
  PagedFirstKind,
  PagedFirstResponder,
  PagedFirstResponderKind,
  getShownPagedFirstResponders,
} from "Common/Types/OnCallDutyPolicy/PagedFirst";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { TABLE_VALUE_LOADING_ATTRIBUTE } from "Common/UI/Components/Table/TableFoldedValues";
import {
  formatInline,
  formatList,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A POLICY'S PAGED FIRST CELL, ON THE ON-CALL POLICIES LIST (#9701).
 *
 * Who the policy pages first, at a glance, so nobody opens each policy to
 * find out: a chip for each schedule, team and person of its first
 * escalation rule (Common/Types/OnCallDutyPolicy/PagedFirst). A schedule
 * says who is on call in it now - "Primary · Alice Smith" - and in amber
 * when nobody is, as the policy's Escalation Rules page draws it; one paged
 * for the next person in its rotation says so. Three chips at most, then
 * "+2 more", with the rest named under the pointer.
 *
 * Where the chain breaks, the cell names the break, in amber: a policy with
 * no escalation rules pages nobody, and a first rule that names nobody is
 * passed at once. The policy's page is where either is fixed.
 *
 * While the cell's rows are read it draws the line its chips will take;
 * when they could not be read, the quiet dash every empty cell draws.
 */

export const PAGED_FIRST_COLUMN_TITLE: string = translationKey("Paged First");

export const NO_ESCALATION_RULES_TEXT: string = translationKey(
  "No escalation rules",
);

export const NO_ESCALATION_RULES_TOOLTIP: string = translationKey(
  "This policy has no escalation rules, so it pages nobody. Add one on its Escalation Rules page.",
);

export const NO_RESPONDERS_TEXT: string = translationKey("No responders");

export const NO_RESPONDERS_TOOLTIP: string = translationKey(
  "The first escalation rule names nobody, so the policy moves on to the next rule at once.",
);

// What a schedule's chip says beside its name, and under the pointer.
export const NO_ONE_ON_CALL_TEXT: string = translationKey("no one on call");

export const NO_ONE_ON_CALL_TOOLTIP: string = translationKey(
  "No one is currently on call in this schedule.",
);

export const NEXT_IN_ROTATION_TEXT: string = translationKey("next in rotation");

export const ON_CALL_NOW_TOOLTIP: string = translationKey(
  "{{name}} is on call now in {{schedule}}.",
);

// The chips a cell leaves out, counted: the Dashboard's shared words.
export const MORE_RESPONDERS_TEXT: { one: string; other: string } = {
  one: "+{{count}} more",
  other: "+{{count}} more",
};

// A responder's chip: its icon, its words in the reader's language, its tip.
export interface PagedFirstChip {
  icon: IconProp;
  text: string;
  tone: PillTone;
  tooltip: string | undefined;
}

// What a responder's chip shows. Exported for its tests.
export const getPagedFirstChip: (
  responder: PagedFirstResponder,
  translator: Translator,
) => PagedFirstChip = (
  responder: PagedFirstResponder,
  translator: Translator,
): PagedFirstChip => {
  if (responder.kind === PagedFirstResponderKind.Team) {
    return {
      icon: IconProp.Team,
      text: responder.name,
      tone: PillTone.Neutral,
      tooltip: undefined,
    };
  }

  if (responder.kind === PagedFirstResponderKind.User) {
    return {
      icon: IconProp.User,
      text: responder.name,
      tone: PillTone.Neutral,
      tooltip: undefined,
    };
  }

  // A schedule: its name, and who it pages now, set apart by " · ".
  if (responder.isNextInRotation) {
    return {
      icon: IconProp.Forward,
      text: formatInline(
        [
          responder.name,
          translator.translateText(NEXT_IN_ROTATION_TEXT) ||
            NEXT_IN_ROTATION_TEXT,
        ],
        translator,
      ),
      tone: PillTone.Neutral,
      tooltip: undefined,
    };
  }

  if (responder.onCallUserName === null) {
    return {
      icon: IconProp.Alert,
      text: formatInline(
        [
          responder.name,
          translator.translateText(NO_ONE_ON_CALL_TEXT) || NO_ONE_ON_CALL_TEXT,
        ],
        translator,
      ),
      tone: PillTone.Warning,
      tooltip:
        translator.translateText(NO_ONE_ON_CALL_TOOLTIP) ||
        NO_ONE_ON_CALL_TOOLTIP,
    };
  }

  if (responder.onCallUserName) {
    return {
      icon: IconProp.Calendar,
      text: formatInline(
        [responder.name, responder.onCallUserName],
        translator,
      ),
      tone: PillTone.Neutral,
      tooltip: translator.translateTemplate(ON_CALL_NOW_TOOLTIP, {
        name: responder.onCallUserName,
        schedule: responder.name,
      }),
    };
  }

  // Who is on call there was not read: the schedule alone.
  return {
    icon: IconProp.Calendar,
    text: responder.name,
    tone: PillTone.Neutral,
    tooltip: undefined,
  };
};

/*
 * The cell as text, for the list's CSV export: each responder by name, a
 * schedule with who it pages now in brackets, or the break in the reader's
 * words.
 */
export const getPagedFirstExportText: (
  pagedFirst: PagedFirst | undefined,
  translator: Translator,
) => string = (
  pagedFirst: PagedFirst | undefined,
  translator: Translator,
): string => {
  if (!pagedFirst) {
    return "";
  }

  if (pagedFirst.kind === PagedFirstKind.NoEscalationRules) {
    return (
      translator.translateText(NO_ESCALATION_RULES_TEXT) ||
      NO_ESCALATION_RULES_TEXT
    );
  }

  if (pagedFirst.kind === PagedFirstKind.NoResponders) {
    return translator.translateText(NO_RESPONDERS_TEXT) || NO_RESPONDERS_TEXT;
  }

  return pagedFirst.responders
    .map((responder: PagedFirstResponder): string => {
      if (responder.kind !== PagedFirstResponderKind.Schedule) {
        return responder.name;
      }

      const pages: string = responder.isNextInRotation
        ? translator.translateText(NEXT_IN_ROTATION_TEXT) ||
          NEXT_IN_ROTATION_TEXT
        : responder.onCallUserName === null
          ? translator.translateText(NO_ONE_ON_CALL_TEXT) || NO_ONE_ON_CALL_TEXT
          : responder.onCallUserName || "";

      return pages ? `${responder.name} (${pages})` : responder.name;
    })
    .join("; ");
};

export interface ComponentProps {
  pagedFirst: PagedFirst | undefined;
  isLoading: boolean;
}

const PagedFirstCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.pagedFirst) {
    if (props.isLoading) {
      /*
       * Marked as on its way: folded under a row's title (TableFit), it
       * draws no line of its own until the chips are in.
       */
      return (
        <div {...{ [TABLE_VALUE_LOADING_ATTRIBUTE]: "true" }}>
          <InlineValueSkeleton widthClassName="w-28" />
        </div>
      );
    }

    return <TableEmptyValue />;
  }

  if (props.pagedFirst.kind === PagedFirstKind.NoEscalationRules) {
    return (
      <Pill
        text={NO_ESCALATION_RULES_TEXT}
        tone={PillTone.Warning}
        icon={IconProp.Alert}
        tooltip={NO_ESCALATION_RULES_TOOLTIP}
        dataTestId="paged-first-no-escalation-rules"
      />
    );
  }

  if (props.pagedFirst.kind === PagedFirstKind.NoResponders) {
    return (
      <Pill
        text={NO_RESPONDERS_TEXT}
        tone={PillTone.Warning}
        icon={IconProp.Alert}
        tooltip={NO_RESPONDERS_TOOLTIP}
        dataTestId="paged-first-no-responders"
      />
    );
  }

  const { shown, moreCount } = getShownPagedFirstResponders(
    props.pagedFirst.responders,
  );
  const leftOut: Array<PagedFirstResponder> = props.pagedFirst.responders.slice(
    shown.length,
  );

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="paged-first"
    >
      {shown.map((responder: PagedFirstResponder): ReactElement => {
        const chip: PagedFirstChip = getPagedFirstChip(responder, translator);

        return (
          <Pill
            key={`${responder.kind}-${responder.id}-${responder.isNextInRotation ? "next" : "now"}`}
            text={chip.text}
            // A name as the project wrote it, the rest in the reader's words.
            isUserContent={true}
            tone={chip.tone}
            icon={chip.icon}
            isIconMirroredRightToLeft={chip.icon === IconProp.Forward}
            tooltip={chip.tooltip}
            isTooltipUserContent={true}
            dataTestId="paged-first-responder"
          />
        );
      })}
      {moreCount > 0 ? (
        <Pill
          text={translator.translatePlural(MORE_RESPONDERS_TEXT, moreCount)}
          isUserContent={true}
          tone={PillTone.Neutral}
          isDotHidden={true}
          // The rest, named with the language's own separator.
          tooltip={formatList(
            leftOut.map((responder: PagedFirstResponder): string => {
              return getPagedFirstChip(responder, translator).text;
            }),
            translator,
          )}
          isTooltipUserContent={true}
          dataTestId="paged-first-more"
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default PagedFirstCell;
