import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { translatableTerm } from "Common/Types/Translator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Plain-language explanation for a single metric or section on the health
 * cards. The copy lives next to each card (in a METRIC_INFO map) so it is easy
 * to review; these shared components give every card the same tooltip look.
 */
export interface MetricInfo {
  title: string;
  body: string;
}

// The bold-title-over-description body shared by every health metric tooltip.
export const metricTooltipContent: (
  info: MetricInfo,
  translator: Translator,
) => ReactElement = (
  info: MetricInfo,
  translator: Translator,
): ReactElement => {
  return (
    <div className="text-left py-0.5">
      <div className="text-xs font-semibold text-gray-900 mb-1">
        {translator.translateText(info.title) || info.title}
      </div>
      <div className="text-xs text-gray-600 leading-relaxed">
        {translator.translateText(info.body) || info.body}
      </div>
    </div>
  );
};

export interface MetricInfoWrapProps {
  info: MetricInfo;
  children: ReactElement;
}

/*
 * Wraps any element so it reveals its explanation on hover/focus. Used both by
 * the small info glyph below and directly around a status badge.
 */
export const MetricInfoWrap: FunctionComponent<MetricInfoWrapProps> = (
  props: MetricInfoWrapProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Tooltip richContent={metricTooltipContent(props.info, translator)}>
      {props.children}
    </Tooltip>
  );
};

export interface MetricInfoTipProps {
  info: MetricInfo;
}

/*
 * A small info glyph that reveals a plain-language explanation on hover/focus.
 * Colour is inherited via currentColor so the icon dims/darkens with the span.
 */
export const MetricInfoTip: FunctionComponent<MetricInfoTipProps> = (
  props: MetricInfoTipProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <MetricInfoWrap info={props.info}>
      <span className="ml-1 inline-flex items-center align-middle text-gray-400 hover:text-gray-600 cursor-help">
        <Icon
          icon={IconProp.InformationCircle}
          className="h-3.5 w-3.5"
          ariaLabel={translator.translateTemplate("What is {{metric}}?", {
            metric: translatableTerm(props.info.title, { inSentence: true }),
          })}
        />
      </span>
    </MetricInfoWrap>
  );
};

export interface MetricSectionHeadingProps {
  text: string;
  info: MetricInfo;
}

// A section heading with an adjacent info tooltip explaining the whole section.
export const MetricSectionHeading: FunctionComponent<
  MetricSectionHeadingProps
> = (props: MetricSectionHeadingProps): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <div className="text-sm font-semibold text-gray-900 mb-2 flex items-center">
      {translator.translateText(props.text) || props.text}
      <MetricInfoTip info={props.info} />
    </div>
  );
};
