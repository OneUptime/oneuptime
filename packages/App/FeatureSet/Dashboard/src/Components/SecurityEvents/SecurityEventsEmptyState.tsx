import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

export const SECURITY_EVENTS_EMPTY_STATE_ID: string =
  "security-events-empty-state";

/*
 * Both variants carry md:ml-3 for modal footers; the row's gap spaces them
 * here, and the margin would push the pair off centre.
 */
const ACTION_CLASS_NAME: string = "md:!ml-0";

/*
 * The Security Events table with nothing in it. That means "nothing is
 * sending yet" far more often than "nothing happened", and there are two
 * ways to start sending: push events to the ingest API (the setup guide), or
 * have OneUptime poll a security product (Connections). Both are offered.
 */
const SecurityEventsEmptyState: FunctionComponent = (): ReactElement => {
  const navigateTo: (pageMap: PageMap) => void = (pageMap: PageMap): void => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[pageMap] as Route),
    );
  };

  return (
    <EmptyState
      id={SECURITY_EVENTS_EMPTY_STATE_ID}
      icon={IconProp.ShieldCheck}
      paddingClassName="py-4"
      title="No security events yet"
      description="Send events from any source that can POST JSON — a SIEM, a SOAR webhook, a log forwarder — or connect a security product and OneUptime polls it for you. Every event is normalized to OCSF, whatever dialect it arrives in."
      footer={
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            title="Read the setup guide"
            icon={IconProp.Book}
            buttonStyle={ButtonStyleType.PRIMARY}
            className={ACTION_CLASS_NAME}
            dataTestId={`${SECURITY_EVENTS_EMPTY_STATE_ID}-setup-guide`}
            onClick={() => {
              navigateTo(PageMap.SECURITY_EVENTS_DOCUMENTATION);
            }}
          />
          <Button
            title="Connect a security product"
            icon={IconProp.Link}
            buttonStyle={ButtonStyleType.NORMAL}
            className={ACTION_CLASS_NAME}
            dataTestId={`${SECURITY_EVENTS_EMPTY_STATE_ID}-connections`}
            onClick={() => {
              navigateTo(PageMap.SECURITY_EVENTS_CONNECTIONS);
            }}
          />
        </div>
      }
    />
  );
};

export default SecurityEventsEmptyState;
