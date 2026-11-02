import AppLink from "../AppLink/AppLink";
import {
  SecurityCasePriorityPill,
  SecurityCaseStatusPill,
} from "../SecurityCase/SecurityCasePills";
import { SECURITY_CONNECTIONS_TEST_IDS } from "./SecurityConnectionsCopy";
import { getSecurityCaseRoute } from "./SecurityConnectionsModel";
import Route from "Common/Types/API/Route";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { ResourceSecurityCaseJson } from "Common/Types/SecurityCase/SecurityConnection";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One security case as another product's page lists it: its number and
 * title, opening the case, with its priority, its status and when it last
 * detected something - the way the case queues read it - and, under, what
 * the page says about it ("Names web-1").
 */
export interface ComponentProps {
  securityCase: ResourceSecurityCaseJson;
  under?: ReactElement | undefined;
}

function readColor(value: string | undefined): Color | undefined {
  return value ? new Color(value) : undefined;
}

const SecurityCaseSummaryRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const securityCase: ResourceSecurityCaseJson = props.securityCase;
  const route: Route | null = getSecurityCaseRoute(securityCase.id);
  /*
   * The number and the title are each isolated (IsolatedText, a <bdi> that
   * reads the way most of its letters do): on a right-to-left page, a
   * number and a title both written in Latin letters ran together as one
   * left-to-right run - "SEC-141Repeated failed..." - with the number's gap
   * on its far side. Isolated, the number keeps the line's start. Its gap
   * is on the span around it, which reads in the page's direction, so the
   * gap stays between the two either way (an isolate reads in its own
   * text's direction, and its end would be the far side again).
   */
  const title: ReactElement = (
    <>
      {securityCase.number ? (
        <span className="mr-1.5 font-medium text-gray-500">
          <IsolatedText text={securityCase.number} />
        </span>
      ) : (
        <></>
      )}
      <IsolatedText
        text={securityCase.title}
        className="font-medium text-gray-900 group-hover:text-indigo-700"
      />
    </>
  );

  return (
    <li
      className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
      data-testid={SECURITY_CONNECTIONS_TEST_IDS.resourceSecurityCase}
    >
      <Icon
        icon={IconProp.ShieldExclamation}
        className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
      />
      <div className="min-w-0 flex-1">
        {route ? (
          <AppLink
            to={route}
            className="group text-sm hover:underline [overflow-wrap:anywhere]"
          >
            {title}
          </AppLink>
        ) : (
          <span className="text-sm [overflow-wrap:anywhere]">{title}</span>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <SecurityCasePriorityPill
            value={
              securityCase.priorityName
                ? {
                    name: securityCase.priorityName,
                    color: readColor(securityCase.priorityColor),
                  }
                : null
            }
            size={PillSize.Small}
          />
          <SecurityCaseStatusPill
            value={
              securityCase.statusName
                ? {
                    name: securityCase.statusName,
                    color: readColor(securityCase.statusColor),
                  }
                : null
            }
            size={PillSize.Small}
          />
          {securityCase.lastDetectedAt ? (
            <span
              className="text-xs text-gray-500"
              title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                new Date(securityCase.lastDetectedAt),
              )}
            >
              {translator.translateTemplate("Last detection {{when}}", {
                when: OneUptimeDate.fromNow(
                  new Date(securityCase.lastDetectedAt),
                ),
              })}
            </span>
          ) : (
            <></>
          )}
        </div>
        {props.under || <></>}
      </div>
    </li>
  );
};

export default SecurityCaseSummaryRow;
