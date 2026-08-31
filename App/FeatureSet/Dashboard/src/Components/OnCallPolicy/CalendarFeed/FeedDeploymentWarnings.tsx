import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The two warnings the server attaches to a feed status when the deployment
 * itself would make the link unusable: HOST is empty or points at localhost,
 * or HTTP_PROTOCOL is plain http.
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
  /** Prefix for the data-testids, so two blocks on one page stay distinct. */
  idPrefix?: string | undefined;
}

const FeedDeploymentWarnings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
