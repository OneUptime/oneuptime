import ArrowGluedText from "./ArrowGluedText";
import InvestigationNotice, {
  NOTICE_ICON_CLASS_NAME,
} from "./InvestigationNotice";
import {
  INVESTIGATION_LOG_STALL_COPY,
  INVESTIGATION_LOG_STALL_LINKS,
  INVESTIGATION_LOG_STALL_TEST_IDS,
  InvestigationLogStallSubject,
  InvestigationLogStallWords,
  offersLogsAi,
} from "./InvestigationLogStallCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { InvestigationLogStall } from "Common/Utils/AI/InvestigationLogStall";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The AI card's line for an investigation that could not tell the cause for
 * lack of logs (InvestigationLogStallCopy): what stood in its way, under the
 * report, and the way forward - set up logs, and (when logs do reach
 * OneUptime) Logs AI, which finds the failures the code does not log. A
 * notice like the card's others: a mark, a sentence, a quieter line, never
 * a box.
 */

export interface ComponentProps {
  stall: InvestigationLogStall;
  subjectType: InvestigationLogStallSubject;
}

// The card's own link look, as the AI-off summary's links.
const LINK_CLASS_NAME: string =
  "min-w-0 break-words rounded text-sm font-medium leading-6 text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export function getLogsSetUpRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.LOGS_DOCUMENTATION] as Route,
  );
}

export function getLogsAiRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.LOGS_AI_INSIGHTS] as Route,
  );
}

const InvestigationLogStallNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const words: InvestigationLogStallWords =
    INVESTIGATION_LOG_STALL_COPY[props.subjectType][props.stall.reason];

  const text: string =
    typeof words.text === "string"
      ? translator.translateText(words.text) || words.text
      : translator.translatePlural(words.text, props.stall.logSearchCount);

  return (
    <InvestigationNotice
      role="status"
      testId={INVESTIGATION_LOG_STALL_TEST_IDS.notice}
      indicator={
        <Icon
          icon={IconProp.Logs}
          className={`${NOTICE_ICON_CLASS_NAME} text-amber-500`}
        />
      }
      title={words.title}
      actionsTestId={INVESTIGATION_LOG_STALL_TEST_IDS.actions}
      actions={
        <>
          <Link
            to={getLogsSetUpRoute()}
            className={LINK_CLASS_NAME}
            dataTestId={INVESTIGATION_LOG_STALL_TEST_IDS.setUpLogs}
          >
            <ArrowGluedText
              text={
                translator.translateText(
                  INVESTIGATION_LOG_STALL_LINKS.setUpLogs,
                ) || INVESTIGATION_LOG_STALL_LINKS.setUpLogs
              }
            />
          </Link>
          {offersLogsAi(props.stall) ? (
            <Link
              to={getLogsAiRoute()}
              className={LINK_CLASS_NAME}
              dataTestId={INVESTIGATION_LOG_STALL_TEST_IDS.logsAi}
            >
              <ArrowGluedText
                text={
                  translator.translateText(
                    INVESTIGATION_LOG_STALL_LINKS.logsAi,
                  ) || INVESTIGATION_LOG_STALL_LINKS.logsAi
                }
              />
            </Link>
          ) : (
            <></>
          )}
        </>
      }
    >
      {text}
    </InvestigationNotice>
  );
};

export default InvestigationLogStallNotice;
