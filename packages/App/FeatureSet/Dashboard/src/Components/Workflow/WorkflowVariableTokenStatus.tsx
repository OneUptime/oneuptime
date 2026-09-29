import React, { FunctionComponent, ReactElement } from "react";
import { Amber500, Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  OAuth2TokenStatus,
  OAuth2TokenStatusSummary,
  getOAuth2TokenStatus,
} from "Common/Types/Workflow/WorkflowVariableOAuth";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Pill from "Common/UI/Components/Pill/Pill";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";

/*
 * The "Access Token" card on an OAuth 2.0 variable's page: what state its
 * cached access token is in, the one line somebody needs next to it, and - for
 * whoever may update the variable - a "Refresh now" button.
 *
 * "Expired" is amber, not red, on purpose. It is the normal state of a
 * variable no workflow has used for an hour - the next run that uses it fetches
 * a new token - so painting it as a failure would train people to ignore the
 * red that actually means something: a refresh that failed.
 *
 * A failed refresh shows the whole message. It used to be cut to 160
 * characters to fit a table cell, which left room for the provider's error code
 * and little else - the part that says what to do about it (replace the
 * refresh token, check the client secret) came last and never showed. The
 * server already caps the stored message.
 */

export interface RefreshAction {
  onClick: () => void;
  isLoading?: boolean | undefined;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
}

export interface ComponentProps {
  variable: WorkflowVariable;
  // Absent when the viewer may not refresh (or it is not yet known).
  refreshAction?: RefreshAction | undefined;
  // For tests; the table always renders against the current time.
  now?: Date | undefined;
}

type FormatDateFunction = (date: Date) => string;

const formatDate: FormatDateFunction = (date: Date): string => {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
};

const WorkflowVariableTokenStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const summary: OAuth2TokenStatusSummary = getOAuth2TokenStatus({
    accessTokenExpiresAt: props.variable.oauthAccessTokenExpiresAt,
    lastRefreshedAt: props.variable.oauthLastRefreshedAt,
    lastRefreshError: props.variable.oauthLastRefreshError,
    lastRefreshErrorAt: props.variable.oauthLastRefreshErrorAt,
    now: props.now || OneUptimeDate.getCurrentDate(),
  });

  let color: Color = Gray500;
  let icon: IconProp = IconProp.Clock;
  let detail: string = "";

  switch (summary.status) {
    case OAuth2TokenStatus.Valid:
      color = Green500;
      icon = IconProp.CheckCircle;
      detail = `Valid until ${formatDate(summary.expiresAt!)}`;
      break;
    case OAuth2TokenStatus.Expired:
      color = Amber500;
      icon = IconProp.Refresh;
      detail = "Refreshes automatically the next time a workflow uses it";
      break;
    case OAuth2TokenStatus.NoExpiry:
      color = Green500;
      icon = IconProp.CheckCircle;
      detail = `Fetched ${formatDate(
        summary.lastRefreshedAt!,
      )}. The provider did not say when it expires, so every run fetches a new one`;
      break;
    case OAuth2TokenStatus.RefreshFailed: {
      color = Red500;
      icon = IconProp.Error;
      detail = summary.lastRefreshError || "";

      if (summary.lastRefreshErrorAt) {
        detail = `${formatDate(summary.lastRefreshErrorAt)}: ${detail}`;
      }

      break;
    }
    case OAuth2TokenStatus.NotFetched:
    default:
      color = Gray500;
      icon = IconProp.Clock;
      detail = "Fetched the first time a workflow uses it";
      break;
  }

  return (
    <div
      className="flex flex-col items-start gap-1"
      data-testid="workflow-variable-token-status"
      data-status={summary.status}
    >
      <Pill text={summary.status} color={color} icon={icon} />
      {detail ? (
        // A refresh error is a sentence or two, so let it wrap.
        <span
          className="whitespace-normal break-words text-sm text-gray-500"
          data-testid="workflow-variable-token-status-detail"
        >
          {detail}
        </span>
      ) : (
        <></>
      )}
      {props.refreshAction ? (
        <Button
          title="Refresh now"
          icon={IconProp.Refresh}
          buttonStyle={ButtonStyleType.LINK}
          buttonSize={ButtonSize.ExtraSmall}
          isLoading={props.refreshAction.isLoading}
          disabled={
            props.refreshAction.disabled || props.refreshAction.isLoading
          }
          tooltip={props.refreshAction.tooltip}
          onClick={props.refreshAction.onClick}
          dataTestId="workflow-variable-refresh-token"
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default WorkflowVariableTokenStatus;
