import {
  LATE_ARRIVALS_DESCRIPTION,
  LATE_ARRIVALS_LISTED_SOURCES,
  LATE_ARRIVALS_MORE_SOURCES,
  LATE_ARRIVALS_SOURCE,
  LATE_ARRIVALS_TEST_IDS,
  LATE_ARRIVALS_TITLE,
  LATE_ARRIVALS_UNNAMED_SOURCE,
} from "./LateArrivalsCopy";
import LateArrivalsRetrohuntModal from "./LateArrivalsRetrohuntModal";
import SecurityCaseApi from "../../SecurityCase/SecurityCaseApi";
import { RUN_ON_PAST_EVENTS } from "../Retrohunt/RetrohuntCopy";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityEventLateArrivalSource,
  SecurityEventLateArrivals,
  getLateArrivalsHappenedFrom,
  getLateArrivalsRetrohuntPeriodInHours,
} from "Common/Types/SecurityEvent/SecurityEventLateArrival";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { useWriteDatesInSentenceLanguage } from "Common/UI/Utils/SentenceLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// The name a source goes by: its product, or its vendor; null when it named neither.
export function getLateArrivalSourceName(
  source: SecurityEventLateArrivalSource,
): string | null {
  return source.productName.trim() || source.vendorName.trim() || null;
}

// A moment in a sentence: short, in the sentence's language, the full date under the pointer.
const LateMoment: FunctionComponent<{ date: Date }> = (props: {
  date: Date;
}): ReactElement => {
  const writeDates: <T>(write: () => T) => T =
    useWriteDatesInSentenceLanguage();

  return (
    <time
      dateTime={props.date.toISOString()}
      className="whitespace-nowrap"
      title={writeDates((): string => {
        return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          props.date,
        );
      })}
    >
      {writeDates((): string => {
        return OneUptimeDate.getDateAsCompactLocalString(props.date);
      })}
    </time>
  );
};

/*
 * SECURITY EVENTS THAT ARRIVED TOO LATE FOR THE RULES (#10491), on
 * Detection Rules: an event that arrives more than a day after it happened
 * is stored and searchable, but no rule's run checks it (the why is in
 * Common/Types/SecurityEvent/SecurityEventLateArrival). When any arrived so
 * in the last week, this says how many, from which sources and when they
 * happened, and Run on Past Events opens on a rule the person chooses, over
 * the period that reaches back to them.
 *
 * Shown only then: a page whose events all arrive in time has nothing here,
 * and a read that fails leaves the page as it was.
 */
const SecurityEventsLateArrivalsNotice: FunctionComponent =
  (): ReactElement => {
    const translator: Translator = useTranslator();
    const [lateArrivals, setLateArrivals] =
      useState<SecurityEventLateArrivals | null>(null);
    const [isRunOpen, setIsRunOpen] = useState<boolean>(false);

    useEffect(() => {
      let isCurrent: boolean = true;

      SecurityCaseApi.getLateArrivals()
        .then((answer: SecurityEventLateArrivals | null) => {
          if (isCurrent) {
            setLateArrivals(answer);
          }
        })
        .catch(() => {
          // Only a notice: without it, Detection Rules is as it was.
        });

      return () => {
        isCurrent = false;
      };
    }, []);

    const happenedFrom: Date | null = lateArrivals
      ? getLateArrivalsHappenedFrom(lateArrivals)
      : null;

    if (!lateArrivals || lateArrivals.eventCount === 0 || !happenedFrom) {
      return <></>;
    }

    const listed: Array<SecurityEventLateArrivalSource> =
      lateArrivals.sources.slice(0, LATE_ARRIVALS_LISTED_SOURCES);
    const moreSources: number = lateArrivals.sources.length - listed.length;

    return (
      <>
        <div
          role="status"
          data-testid={LATE_ARRIVALS_TEST_IDS.notice}
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-semibold text-amber-900">
              {translator.translatePlural(
                LATE_ARRIVALS_TITLE,
                lateArrivals.eventCount,
              )}
            </p>
            <p>{translator.translateText(LATE_ARRIVALS_DESCRIPTION)}</p>
            <ul className="list-disc space-y-1 pl-5">
              {listed.map(
                (
                  source: SecurityEventLateArrivalSource,
                  index: number,
                ): ReactElement => {
                  const name: string | null = getLateArrivalSourceName(source);

                  return (
                    <li
                      key={`${source.vendorName}:${source.productName}:${index}`}
                      data-testid={LATE_ARRIVALS_TEST_IDS.source}
                    >
                      <TranslatedSentence
                        template={LATE_ARRIVALS_SOURCE}
                        count={source.eventCount}
                        slots={{
                          source: name ? (
                            <IsolatedText text={name} />
                          ) : (
                            <>
                              {translator.translateText(
                                LATE_ARRIVALS_UNNAMED_SOURCE,
                              )}
                            </>
                          ),
                          from: <LateMoment date={source.happenedFrom} />,
                          to: <LateMoment date={source.happenedTo} />,
                        }}
                      />
                    </li>
                  );
                },
              )}
              {moreSources > 0 ? (
                <li data-testid={LATE_ARRIVALS_TEST_IDS.moreSources}>
                  {translator.translatePlural(
                    LATE_ARRIVALS_MORE_SOURCES,
                    moreSources,
                  )}
                </li>
              ) : (
                <></>
              )}
            </ul>
            <div>
              <Button
                title={RUN_ON_PAST_EVENTS}
                icon={IconProp.Search}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                onClick={() => {
                  setIsRunOpen(true);
                }}
                dataTestId={LATE_ARRIVALS_TEST_IDS.run}
              />
            </div>
          </div>
        </div>

        {/* Outside the status box, so its words are not read out as the notice's. */}
        {isRunOpen ? (
          <LateArrivalsRetrohuntModal
            initialPeriodInHours={getLateArrivalsRetrohuntPeriodInHours({
              happenedFrom,
              now: OneUptimeDate.getCurrentDate(),
            })}
            onClose={() => {
              setIsRunOpen(false);
            }}
          />
        ) : (
          <></>
        )}
      </>
    );
  };

export default SecurityEventsLateArrivalsNotice;
