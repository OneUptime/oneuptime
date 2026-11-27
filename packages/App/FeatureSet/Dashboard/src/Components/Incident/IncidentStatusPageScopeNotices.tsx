import IconProp from "Common/Types/Icon/IconProp";
import { IncidentSubscriberAudienceNamedStatusPage } from "Common/Types/StatusPage/IncidentSubscriberAudience";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import IncidentStatusPageScopeCopy, {
  formatScopeText,
} from "./IncidentStatusPageScopeCopy";
import {
  getIdsFromFormValue,
  joinStatusPageNames,
} from "./IncidentStatusPageScopeForm";
import useSubscriberAudience, {
  SubscriberAudienceState,
} from "./useSubscriberAudience";

/*
 * The notices shown next to the status page picker and the fields it
 * interacts with (see IncidentStatusPageScopeCopy for what each one says).
 * They sit under a form field through its footer, so each renders nothing at
 * all when it has nothing to say.
 *
 * Every one of them is a warning. The picker does not explain an empty list:
 * someone who cannot read any status page (incident roles do not) simply
 * finds nothing to pick in it.
 */

export interface ScopeNoticeProps {
  // Already translated and filled in.
  text: string;
  dataTestId?: string | undefined;
}

export const ScopeNotice: FunctionComponent<ScopeNoticeProps> = (
  props: ScopeNoticeProps,
): ReactElement => {
  return (
    <p
      role="note"
      data-testid={props.dataTestId}
      className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <Icon icon={IconProp.Alert} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{props.text}</span>
    </p>
  );
};

// A notice for one of IncidentStatusPageScopeCopy's strings.
export const TranslatedScopeNotice: FunctionComponent<{
  text: string;
  values?: Record<string, string | number> | undefined;
  dataTestId?: string | undefined;
}> = (props: {
  text: string;
  values?: Record<string, string | number> | undefined;
  dataTestId?: string | undefined;
}): ReactElement => {
  const { translateString } = useTranslateValue();

  return (
    <ScopeNotice
      text={formatScopeText(
        translateString(props.text) || props.text,
        props.values || {},
      )}
      dataTestId={props.dataTestId}
    />
  );
};

// One of IncidentStatusPageScopeCopy's strings as plain text, translated.
export const TranslatedScopeText: FunctionComponent<{
  text: string;
  className?: string | undefined;
  dataTestId?: string | undefined;
}> = (props: {
  text: string;
  className?: string | undefined;
  dataTestId?: string | undefined;
}): ReactElement => {
  const { translateString } = useTranslateValue();

  return (
    <p className={props.className} data-testid={props.dataTestId}>
      {translateString(props.text) || props.text}
    </p>
  );
};

/*
 * Picked status pages that list none of the incident's monitors. The scope
 * narrows where the monitors already reach. Incidents without monitors use
 * the selected pages directly. The same audience endpoint accounts for
 * monitor groups when it checks the reach of an incident with monitors.
 */
export const StatusPagesNotListingMonitorsWarning: FunctionComponent<{
  // The incident's monitors, as the form holds them. None is none.
  monitorIds: unknown;
  statusPageIds: unknown;
}> = (props: { monitorIds: unknown; statusPageIds: unknown }): ReactElement => {
  const canCheckPages: boolean =
    getIdsFromFormValue(props.statusPageIds).length > 0 &&
    getIdsFromFormValue(props.monitorIds).length > 0;

  const { audience }: SubscriberAudienceState = useSubscriberAudience(
    canCheckPages
      ? {
          monitorIds: props.monitorIds,
          statusPageIds: props.statusPageIds,
        }
      : null,
  );

  const notListing: Array<IncidentSubscriberAudienceNamedStatusPage> =
    audience?.selectedStatusPagesNotListingMonitors || [];

  if (!canCheckPages || notListing.length === 0) {
    return <></>;
  }

  return (
    <TranslatedScopeNotice
      text={IncidentStatusPageScopeCopy.notListingMonitorsWarning}
      values={{ names: joinStatusPageNames(notListing) }}
      dataTestId="status-pages-not-listing-monitors"
    />
  );
};
