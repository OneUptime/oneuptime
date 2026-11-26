import EventStatBar from "../EventView/EventStatBar";
import EventStatTile from "../EventView/EventStatTile";
import { formatCompactDurationInMinutes } from "../../Utils/CompactDuration";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityAiOverviewMeasures } from "Common/Utils/SecurityCase/SecurityAiOverviewMeasures";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export const SECURITY_AI_OVERVIEW_BAR_TEST_ID: string =
  "security-overview-ai-figures";

/*
 * SECURITY EVENTS -> OVERVIEW: HOW ONEUPTIME AI WORKED THE CASES (#10352),
 * under the case figures and as they are drawn: the cases it resolved of
 * those it worked, how soon a case is contained and closed with it and
 * without it, and what it asked people - how long they took to answer, and
 * how many of its steps they undid (the UX rulebook's principle 7). Drawn
 * only once OneUptime AI has worked a case or asked about one in the
 * window: a project that leaves it off is not told about it here.
 */

export interface ComponentProps {
  measures: SecurityAiOverviewMeasures;
  caseWindowInDays: number;
}

// Whether the bar has anything to say.
export function isSecurityAiOverviewBarShown(
  measures: SecurityAiOverviewMeasures | null,
): measures is SecurityAiOverviewMeasures {
  return Boolean(measures && measures.hasActivity);
}

const SecurityAiOverviewBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const measures: SecurityAiOverviewMeasures = props.measures;
  const days: string = translator.formatNumber(props.caseWindowInDays);

  const duration: (minutes: number | null) => string = (
    minutes: number | null,
  ): string => {
    return formatCompactDurationInMinutes(minutes, translator.language);
  };

  // "3 h 10 min without AI", or nothing when no case went without it.
  const withoutAi: (minutes: number | null) => string | undefined = (
    minutes: number | null,
  ): string | undefined => {
    return minutes === null
      ? undefined
      : translator.translateTemplate("{{duration}} without AI", {
          duration: duration(minutes),
        });
  };

  return (
    <div data-testid={SECURITY_AI_OVERVIEW_BAR_TEST_ID}>
      <EventStatBar columns={4} ariaLabel="OneUptime AI figures">
        {[
          <EventStatTile
            key="resolved"
            variant="segment"
            icon={IconProp.Bolt}
            label={
              translator.translateText("Resolved by OneUptime AI") ||
              "Resolved by OneUptime AI"
            }
            value={translator.formatNumber(measures.casesResolvedByAi)}
            note={translator.translatePlural(
              {
                one: "Of {{count}} case it worked",
                other: "Of {{count}} cases it worked",
              },
              measures.casesWorkedByAi,
            )}
            description={translator.translateTemplate("Last {{days}} days", {
              days,
            })}
          />,
          <EventStatTile
            key="contain"
            variant="segment"
            icon={IconProp.ShieldCheck}
            label={
              translator.translateText("Time to Contain with AI") ||
              "Time to Contain with AI"
            }
            value={duration(measures.meanTimeToContainWithAiInMinutes)}
            note={withoutAi(measures.meanTimeToContainWithoutAiInMinutes)}
            description={translator.translateTemplate("Last {{days}} days", {
              days,
            })}
          />,
          <EventStatTile
            key="close"
            variant="segment"
            icon={IconProp.CheckCircle}
            label={
              translator.translateText("Time to Close with AI") ||
              "Time to Close with AI"
            }
            value={duration(measures.meanTimeToCloseWithAiInMinutes)}
            note={withoutAi(measures.meanTimeToCloseWithoutAiInMinutes)}
            description={translator.translateTemplate("Last {{days}} days", {
              days,
            })}
          />,
          <EventStatTile
            key="asked"
            variant="segment"
            icon={IconProp.User}
            label={
              translator.translateText("Approvals Asked") || "Approvals Asked"
            }
            value={translator.formatNumber(measures.approvalsAsked)}
            note={
              measures.medianTimeToAnswerInMinutes === null
                ? undefined
                : translator.translateTemplate(
                    "Half answered within {{duration}}",
                    {
                      duration: duration(measures.medianTimeToAnswerInMinutes),
                    },
                  )
            }
            description={translator.translatePlural(
              {
                one: "{{count}} step people undid",
                other: "{{count}} steps people undid",
              },
              measures.stepsUndone,
            )}
          />,
        ]}
      </EventStatBar>
    </div>
  );
};

export default SecurityAiOverviewBar;
