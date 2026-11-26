import { AI_ACTION_EFFECT_HEADINGS } from "Common/Types/AI/AIActionWords";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import ToolActionSentence, { ToolActionSentences } from "./ToolActionSentence";
import { DrawnActionEffects, DrawnActionSentence } from "./ToolActionWords";

/*
 * WHAT AN ACTION DOES, ON ITS APPROVAL CARD (#10378).
 *
 * Under the action's title, the card says what changes, what stops working
 * and what it costs - each only where it applies - so a person who has
 * never opened Data Security knows what they allow before they allow it:
 * "Anything that reads it publicly - a website, a download link - stops
 * working." An action that asks in every mode, Auto-run included, says why
 * in a last line: Auto-run stopped for it, and the person sees the reason
 * rather than wonder.
 *
 * Each section is a small heading in capitals over its sentences, beside a
 * mark: a pencil for what changes, a warning for what stops working - in
 * amber, the one thing on the card to read twice - and a coin for the
 * cost. The sentences are the server's (Types/AI/AIActionWords), said in
 * the reader's language, each an isolate that reads its own way.
 */

interface EffectSection {
  key: string;
  heading: string;
  icon: IconProp;
  iconClassName: string;
  headingClassName: string;
  sentences: Array<DrawnActionSentence>;
}

export interface ComponentProps {
  effects: DrawnActionEffects;
}

const ToolActionEffects: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const sections: Array<EffectSection> = [
    {
      key: "changes",
      heading: AI_ACTION_EFFECT_HEADINGS.changes,
      icon: IconProp.Pencil,
      iconClassName: "text-gray-400",
      headingClassName: "text-gray-500",
      sentences: props.effects.changes,
    },
    {
      key: "stops-working",
      heading: AI_ACTION_EFFECT_HEADINGS.stopsWorking,
      icon: IconProp.Alert,
      iconClassName: "text-amber-600",
      headingClassName: "text-amber-800",
      sentences: props.effects.stopsWorking,
    },
    {
      key: "costs",
      heading: AI_ACTION_EFFECT_HEADINGS.costs,
      icon: IconProp.CurrencyDollar,
      iconClassName: "text-gray-400",
      headingClassName: "text-gray-500",
      sentences: props.effects.costs,
    },
  ].filter((section: EffectSection): boolean => {
    return section.sentences.length > 0;
  });

  return (
    <div
      data-testid="tool-approval-effects"
      className="mt-2 space-y-2 border-t border-gray-100 pt-2"
    >
      {sections.map((section: EffectSection) => {
        return (
          <div
            key={section.key}
            data-testid={`tool-approval-effect-${section.key}`}
            className="flex items-start gap-2"
          >
            <Icon
              icon={section.icon}
              className={`mt-[2px] h-3.5 w-3.5 flex-shrink-0 ${section.iconClassName}`}
            />
            <div className="min-w-0 flex-1">
              <p
                data-testid="tool-approval-effect-heading"
                className={`text-[11px] font-semibold uppercase leading-4 tracking-wide ${section.headingClassName}`}
              >
                {translator.translateText(section.heading)}
              </p>
              <p
                data-testid="tool-approval-effect-sentences"
                className="mt-0.5 break-words text-xs leading-relaxed text-gray-700"
              >
                <ToolActionSentences sentences={section.sentences} />
              </p>
            </div>
          </div>
        );
      })}
      {props.effects.asksBecause && (
        <p
          data-testid="tool-approval-asks-because"
          className="flex items-start gap-2 text-xs leading-relaxed text-gray-600"
        >
          <Icon
            icon={IconProp.Lock}
            className="mt-[3px] h-3.5 w-3.5 flex-shrink-0 text-gray-400"
          />
          <span className="min-w-0 flex-1">
            <ToolActionSentence sentence={props.effects.asksBecause} />
          </span>
        </p>
      )}
    </div>
  );
};

export default ToolActionEffects;
