import {
  REMEDIATION_DECISION_HEADING,
  RemediationDecisionLine,
  RemediationDecisionLink,
  RemediationDecisionTone,
} from "./RemediationDecisionLines";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  lines: Array<RemediationDecisionLine>;
}

// One small icon per line carries its tone, as on the AI investigation panel.
const TONE_ICON: Record<
  RemediationDecisionTone,
  { icon: IconProp; className: string }
> = {
  acted: { icon: IconProp.CheckCircle, className: "text-emerald-600" },
  attention: { icon: IconProp.Alert, className: "text-amber-500" },
  info: { icon: IconProp.Info, className: "text-gray-400" },
  waiting: { icon: IconProp.Clock, className: "text-indigo-500" },
};

/*
 * What auto-remediation did with an incident or alert: one line per fix
 * path, from RemediationDecisionLines. Drawn at the top of the Remediation
 * card, above the suggestions it may have produced.
 */
const RemediationDecisionList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.lines.length === 0) {
    return <></>;
  }

  return (
    <div data-testid="remediation-decision" className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(REMEDIATION_DECISION_HEADING)}
      </p>
      {props.lines.map((line: RemediationDecisionLine): ReactElement => {
        return (
          <div
            key={line.key}
            data-testid="remediation-decision-line"
            data-tone={line.tone}
            className="flex items-start gap-3"
          >
            <Icon
              icon={TONE_ICON[line.tone].icon}
              className={`mt-1 h-4 w-4 flex-shrink-0 ${TONE_ICON[line.tone].className}`}
            />
            <div className="min-w-0 text-sm leading-6 text-gray-600">
              <p>{line.text}</p>
              {line.why ? (
                <p className="mt-1">
                  <span className="font-medium text-gray-700">
                    {translator.translateText("Why:")}{" "}
                  </span>
                  {line.why}
                </p>
              ) : (
                <></>
              )}
              {line.whatToDo ? (
                <p className="mt-1">
                  <span className="font-medium text-gray-700">
                    {translator.translateText("What to do:")}{" "}
                  </span>
                  {line.whatToDo}
                </p>
              ) : (
                <></>
              )}
              {line.links.length > 0 ? (
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {line.links.map(
                    (
                      decisionLink: RemediationDecisionLink,
                      index: number,
                    ): ReactElement => {
                      return (
                        <Link
                          key={`${line.key}-link-${index}`}
                          to={decisionLink.route}
                          className="font-medium text-indigo-600 hover:text-indigo-500"
                        >
                          {decisionLink.text}
                        </Link>
                      );
                    },
                  )}
                </p>
              ) : (
                <></>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default RemediationDecisionList;
