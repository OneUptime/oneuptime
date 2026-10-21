import { PRIVATE_HOST_COPY, translateInterpolated } from "./CalendarFeedUtil";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The warnings the server attaches to a feed status when the deployment
 * itself would make the link unusable: HOST is empty or points at localhost,
 * HTTP_PROTOCOL is plain http, or HOST is a private address that Google
 * Calendar and Outlook on the web - which fetch from their own servers - can
 * never reach.
 *
 * They are their own component because the server sends them whether or not a
 * feed exists (buildAbsentFeedStatus does too), and a reader deserves to know
 * the link will be unreachable BEFORE they mint one and paste it into Google
 * Calendar - not after. Both the empty states and the link block render this,
 * with the same data-testids either way.
 */
export interface ComponentProps {
  hostWarning?: string | null | undefined;
  protocolWarning?: string | null | undefined;
  privateHost?: string | null | undefined;
  /** Prefix for the data-testids, so two blocks on one page stay distinct. */
  idPrefix?: string | undefined;
}

const FeedDeploymentWarnings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const idPrefix: string = props.idPrefix || "calendar-feed";

  return (
    <Fragment>
      {props.hostWarning && (
        <Alert
          type={AlertType.WARNING}
          title={props.hostWarning}
          dataTestId={`${idPrefix}-host-warning`}
        />
      )}

      {/*
       * Not next to the HOST warning: that one says no app outside this
       * machine can reach the link, which already covers Google.
       */}
      {props.privateHost && !props.hostWarning && (
        <Alert
          type={AlertType.WARNING}
          title={translateInterpolated(translateString, PRIVATE_HOST_COPY, {
            host: props.privateHost,
          })}
          dataTestId={`${idPrefix}-private-host-warning`}
        />
      )}

      {props.protocolWarning && (
        <Alert
          type={AlertType.WARNING}
          title={props.protocolWarning}
          dataTestId={`${idPrefix}-protocol-warning`}
        />
      )}
    </Fragment>
  );
};

export default FeedDeploymentWarnings;
