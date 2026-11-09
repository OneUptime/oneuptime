import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import IsolatedTextList from "Common/UI/Components/IsolatedText/IsolatedTextList";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Link } from "react-router-dom";
import {
  PROFILE_WIDGET_CAPPED_WINDOW,
  PROFILE_WIDGET_CAPPED_WINDOW_EXPLAINED,
  PROFILE_WIDGET_OPEN_PROFILER,
} from "./ProfileWidgetCopy";

/*
 * THE TOP OF A PROFILE WIDGET: WHAT IT SHOWS, AND WHOSE.
 *
 *   Where the CPU time goes                                         ↗
 *   checkout · CPU time · Last 7 days
 *
 * The title is the widget's own, or a sentence that says what it draws.
 * The line under it names the scope the Profiler would show: the service
 * (as it was named - a value someone wrote, set apart in the direction its
 * letters read), the kind of profile, the ranking, and that only the
 * newest 7 days of a longer range are read. The link opens the Profiler
 * on exactly that - an icon, as the chart widget's Open in Metric Explorer
 * is - and is left out where nobody can follow it: while the dashboard is
 * edited, and on a playlist's screen.
 */

export interface ComponentProps {
  // The title as drawn: the widget's own (as written) or a translated one.
  title: string;
  isTitleAsWritten: boolean;
  // The service line: names someone wrote, or the product's own words.
  services: Array<string>;
  areServicesAsWritten: boolean;
  // Already in the reader's language.
  kindLabel: string;
  rankLabel?: string | undefined;
  isWindowCapped: boolean;
  profilerRoute: Route | null;
  dataTestId: string;
}

const ProfileWidgetHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const facts: Array<ReactElement> = [
    props.areServicesAsWritten ? (
      <IsolatedTextList
        key="services"
        texts={props.services}
        className="min-w-0 truncate"
        dataTestId={`${props.dataTestId}-services`}
      />
    ) : (
      <span
        key="services"
        className="min-w-0 truncate"
        data-testid={`${props.dataTestId}-services`}
      >
        {props.services.join(", ")}
      </span>
    ),
    <span key="kind" data-testid={`${props.dataTestId}-kind`}>
      {props.kindLabel}
    </span>,
  ];

  if (props.rankLabel) {
    facts.push(
      <span key="rank" data-testid={`${props.dataTestId}-rank`}>
        {props.rankLabel}
      </span>,
    );
  }

  if (props.isWindowCapped) {
    facts.push(
      <span
        key="capped"
        title={translator.translateText(PROFILE_WIDGET_CAPPED_WINDOW_EXPLAINED)}
        data-testid={`${props.dataTestId}-capped`}
      >
        {translator.translateText(PROFILE_WIDGET_CAPPED_WINDOW)}
      </span>,
    );
  }

  return (
    <div
      className="mb-2 flex items-start justify-between gap-3 px-1"
      data-testid={`${props.dataTestId}-header`}
    >
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm font-medium text-gray-900"
          data-testid={`${props.dataTestId}-title`}
        >
          {props.isTitleAsWritten ? (
            <IsolatedText text={props.title} />
          ) : (
            props.title
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-gray-500">
          {facts.map((fact: ReactElement, index: number) => {
            return (
              <React.Fragment key={index}>
                {index > 0 ? (
                  <span aria-hidden="true">
                    <InlineSeparator markOnly />
                  </span>
                ) : (
                  <></>
                )}
                {fact}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      {props.profilerRoute ? (
        /*
         * An icon, as the chart widget's Open in Metric Explorer is: the
         * tile's title says what it opens on.
         */
        <Link
          to={props.profilerRoute.toString()}
          className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-gray-500 transition-all duration-150 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          title={translator.translateText(PROFILE_WIDGET_OPEN_PROFILER)}
          aria-label={translator.translateText(PROFILE_WIDGET_OPEN_PROFILER)}
          data-testid={`${props.dataTestId}-open`}
        >
          <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ProfileWidgetHeader;
