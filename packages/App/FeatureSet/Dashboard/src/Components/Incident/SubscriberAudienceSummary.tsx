import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import IncidentStatusPageScopeCopy from "./IncidentStatusPageScopeCopy";
import {
  buildSubscriberAudienceView,
  SubscriberAudienceView,
  TranslateFunction,
} from "./SubscriberAudienceText";
import useSubscriberAudience, {
  SubscriberAudienceRequest,
  SubscriberAudienceState,
} from "./useSubscriberAudience";

/*
 * "Will notify: Site 03 (up to 41 email), Site 07 (up to 18 email)".
 *
 * Who the status page notifications of an incident would reach, shown before
 * anything is sent: on the last step of declaring an incident, and above a
 * public note while it is being written. The server works it out with the
 * same helper the subscriber jobs send through (see useSubscriberAudience),
 * so what this says is what will happen: the
 * pages the incident's scope lets through, with an "up to" count per channel,
 * and the pages that list its monitors but will not be told, with why.
 *
 * It only ever shows counts. Status pages the viewer cannot see are not
 * named - they are summed up as "N more status pages you do not have access
 * to". The summary is advisory: when the answer cannot be had, it says so in
 * a line and never blocks the form it sits in.
 */

export interface ComponentProps {
  /*
   * What to ask about: an incident that exists, or the monitors and status
   * pages of one being declared. Null asks nothing.
   */
  request: SubscriberAudienceRequest | null;
  /*
   * Set when nothing will be sent whatever the audience - notifying is
   * switched off, or the incident will be private. Shown instead of asking.
   */
  quietReason?: string | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

const TONE_CLASSES: Record<SubscriberAudienceView["tone"], string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
};

const SubscriberAudienceSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translate: TranslateFunction = (text: string): string => {
    return translateString(text) || text;
  };

  const dataTestId: string = props.dataTestId || "subscriber-audience-summary";

  const { audience, isLoading, error }: SubscriberAudienceState =
    useSubscriberAudience(props.quietReason ? null : props.request);

  const containerClass: string = `mt-2 rounded-lg border px-3 py-2.5 text-sm ${
    props.className || ""
  }`;

  if (props.quietReason) {
    return (
      <div
        role="status"
        data-testid={dataTestId}
        data-state="quiet"
        className={`${containerClass} ${TONE_CLASSES.warning}`}
      >
        <p className="flex items-start gap-2">
          <Icon icon={IconProp.Info} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{translate(props.quietReason)}</span>
        </p>
      </div>
    );
  }

  if (!props.request) {
    return <></>;
  }

  if (isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        data-testid={dataTestId}
        data-state="loading"
        className={`${containerClass} border-gray-200 bg-gray-50 text-gray-600`}
      >
        <p className="flex items-center gap-2">
          <Icon
            icon={IconProp.Spinner}
            className="h-4 w-4 shrink-0 animate-spin"
          />
          <span>{translate(IncidentStatusPageScopeCopy.audienceLoading)}</span>
        </p>
      </div>
    );
  }

  if (error || !audience) {
    return (
      <div
        role="status"
        data-testid={dataTestId}
        data-state="error"
        className={`${containerClass} border-gray-200 bg-gray-50 text-gray-600`}
      >
        <p>{translate(IncidentStatusPageScopeCopy.audienceError)}</p>
        {error ? <p className="mt-0.5 text-xs text-gray-500">{error}</p> : null}
      </div>
    );
  }

  const view: SubscriberAudienceView = buildSubscriberAudienceView({
    audience: audience,
    translate: translate,
  });

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={dataTestId}
      data-state={view.tone}
      className={`${containerClass} ${TONE_CLASSES[view.tone]}`}
    >
      <p className="flex items-start gap-2 font-medium">
        <Icon
          icon={view.tone === "info" ? IconProp.Email : IconProp.Info}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span data-testid={`${dataTestId}-headline`}>{view.headline}</span>
      </p>

      {view.pages.length > 0 && (
        <ul
          className="mt-1.5 list-disc space-y-0.5 pl-11"
          data-testid={`${dataTestId}-pages`}
        >
          {view.pages.map((line: string, index: number): ReactElement => {
            return <li key={index}>{line}</li>;
          })}
        </ul>
      )}

      {view.notNotified.length > 0 && (
        <div className="mt-2 pl-6" data-testid={`${dataTestId}-not-notified`}>
          <p className="text-xs font-medium opacity-80">
            {translate(IncidentStatusPageScopeCopy.audienceNotNotified)}
          </p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-xs opacity-80">
            {view.notNotified.map(
              (line: string, index: number): ReactElement => {
                return <li key={index}>{line}</li>;
              },
            )}
          </ul>
        </div>
      )}

      {view.notes.map((note: string, index: number): ReactElement => {
        return (
          <p
            key={index}
            className="mt-1.5 pl-6 text-xs opacity-80"
            data-testid={`${dataTestId}-note`}
          >
            {note}
          </p>
        );
      })}
    </div>
  );
};

export default SubscriberAudienceSummary;
