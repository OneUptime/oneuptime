import {
  REMEDIATION_DECISION_HEADING,
  RemediationDecisionLine,
  RemediationDecisionLink,
  RemediationDecisionPlace,
  RemediationDecisionTone,
} from "./RemediationDecisionLines";
import {
  bringPageAnchorIntoView,
  markPageAnchorLanded,
} from "Common/UI/Utils/PageAnchor";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ArrowGluedText from "../AI/ArrowGluedText";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  lines: Array<RemediationDecisionLine>;
  /*
   * A heading of its own, for a card that lists fixes under the lines. When
   * the lines are all the card holds, the card's description already says
   * what they are, and a heading under it would only say it again.
   */
  showHeading?: boolean | undefined;
}

export interface RemediationDecisionToneMark {
  icon: IconProp;
  className: string;
}

/*
 * Each line's tone, in a tinted square at its start, like the rows of "What
 * AI may do" on the AI agent pages these lines link to: green for what
 * OneUptime did, amber for what needs looking at, indigo for a wait and
 * gray for how things stand. A mark, never a box: the lines are the card's
 * content, not cards of their own.
 */
export const REMEDIATION_DECISION_TONE_MARK: Record<
  RemediationDecisionTone,
  RemediationDecisionToneMark
> = {
  acted: {
    icon: IconProp.CheckCircle,
    className: "bg-emerald-50 text-emerald-600",
  },
  attention: { icon: IconProp.Alert, className: "bg-amber-50 text-amber-600" },
  info: { icon: IconProp.Info, className: "bg-gray-100 text-gray-500" },
  waiting: { icon: IconProp.Clock, className: "bg-indigo-50 text-indigo-600" },
};

// A line's links: each the same indigo text with its arrow glued to it.
const DECISION_LINK_CLASS_NAME: string =
  "min-w-0 break-words rounded text-sm font-medium leading-6 text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/*
 * Takes the reader to a place on the page - the Affected Resources card -
 * the way a link to a place on a page lands (Utils/PageAnchor): brought
 * into view under the sticky header and tinted for a moment, so the eye
 * finds it, and given the focus of the control that went there (`from`),
 * so Tab goes on from the card and a screen reader reads it. A place that
 * is not on the page leaves the page as it is.
 */
export function goToPagePlace(
  placeId: string,
  from?: Element | null | undefined,
): boolean {
  const element: HTMLElement | null = document.getElementById(placeId);

  if (!element) {
    return false;
  }

  bringPageAnchorIntoView(element);
  markPageAnchorLanded(element, { takesFocusFrom: from || null });
  return true;
}

/*
 * What auto-remediation did with an incident or alert: one line per fix
 * path, from RemediationDecisionLines, divided by hairlines. Each line is
 * its sentence; the readiness gap's "why" and "what to do" under it, set
 * off by a rule; and the pages that change it, as links that say where they
 * go. Drawn at the top of the Remediation card, above the suggestions it
 * may have produced.
 */
const RemediationDecisionList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.lines.length === 0) {
    return <></>;
  }

  return (
    <div data-testid="remediation-decision">
      {props.showHeading ? (
        <h3
          data-testid="remediation-decision-heading"
          className="mb-4 text-sm font-semibold text-gray-900"
        >
          {translator.translateText(REMEDIATION_DECISION_HEADING)}
        </h3>
      ) : (
        <></>
      )}
      <ul role="list" className="divide-y divide-gray-100">
        {props.lines.map((line: RemediationDecisionLine): ReactElement => {
          const mark: RemediationDecisionToneMark =
            REMEDIATION_DECISION_TONE_MARK[line.tone];

          return (
            <li
              key={line.key}
              data-testid="remediation-decision-line"
              data-tone={line.tone}
              className="flex gap-3 py-4 first:pt-0 last:pb-0"
            >
              <div
                aria-hidden="true"
                data-testid="remediation-decision-mark"
                className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg ${mark.className}`}
              >
                <Icon icon={mark.icon} className="h-4 w-4" />
              </div>
              {/* The first line of text sits level with the mark's middle. */}
              <div className="min-w-0 flex-1 pt-1">
                <p
                  data-testid="remediation-decision-text"
                  className="break-words text-sm leading-6 text-gray-900"
                >
                  {line.text}
                </p>
                {line.why || line.whatToDo ? (
                  <dl
                    data-testid="remediation-decision-gap"
                    className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3 text-sm leading-6"
                  >
                    {line.why ? (
                      <div data-testid="remediation-decision-why">
                        <dt className="inline font-medium text-gray-900">
                          {translator.translateText("Why:")}{" "}
                        </dt>
                        <dd className="inline break-words text-gray-600">
                          {line.why}
                        </dd>
                      </div>
                    ) : (
                      <></>
                    )}
                    {line.whatToDo ? (
                      <div data-testid="remediation-decision-what-to-do">
                        <dt className="inline font-medium text-gray-900">
                          {translator.translateText("What to do:")}{" "}
                        </dt>
                        <dd className="inline break-words text-gray-600">
                          {line.whatToDo}
                        </dd>
                      </div>
                    ) : (
                      <></>
                    )}
                  </dl>
                ) : (
                  <></>
                )}
                {line.links.length > 0 || line.place ? (
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                    {line.place ? (
                      <button
                        type="button"
                        data-testid="remediation-decision-place"
                        onClick={(
                          event: React.MouseEvent<HTMLButtonElement>,
                        ) => {
                          goToPagePlace(
                            (line.place as RemediationDecisionPlace).placeId,
                            event.currentTarget,
                          );
                        }}
                        className={`text-start ${DECISION_LINK_CLASS_NAME}`}
                      >
                        <ArrowGluedText
                          text={line.place.text}
                          arrowTestId="remediation-decision-link-arrow"
                        />
                      </button>
                    ) : (
                      <></>
                    )}
                    {line.links.map(
                      (
                        decisionLink: RemediationDecisionLink,
                        index: number,
                      ): ReactElement => {
                        return (
                          /*
                           * The arrow glued to the last word
                           * (ArrowGluedText): an inline-flex link put it
                           * alone at the far edge when a long setting's
                           * name wrapped.
                           */
                          <Link
                            key={`${line.key}-link-${index}`}
                            to={decisionLink.route}
                            className={DECISION_LINK_CLASS_NAME}
                          >
                            <ArrowGluedText
                              text={decisionLink.text}
                              arrowTestId="remediation-decision-link-arrow"
                            />
                          </Link>
                        );
                      },
                    )}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default RemediationDecisionList;
