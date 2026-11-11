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
import readAsWritten from "Common/UI/Components/IsolatedText/ReadAsWritten";
import Pill from "Common/UI/Components/Pill/Pill";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
 *
 * Every line is the reader's (#6752): the status, the sentence under it and
 * its date. The provider's own error message is shown as the provider wrote
 * it.
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

// In the reader's language, as the sentences around it are.
const formatDate: FormatDateFunction = (date: Date): string => {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
};

/*
 * What the pill calls each status. The pill looks its text up, so these are
 * the keys it finds.
 */
export const OAUTH2_TOKEN_STATUS_LABELS: Record<OAuth2TokenStatus, string> = {
  [OAuth2TokenStatus.NotFetched]: translationKey("Not fetched yet"),
  [OAuth2TokenStatus.Valid]: translationKey("Valid"),
  [OAuth2TokenStatus.Expired]: translationKey("Expired"),
  [OAuth2TokenStatus.NoExpiry]: translationKey("No expiry reported"),
  [OAuth2TokenStatus.RefreshFailed]: translationKey("Refresh failed"),
};

const WorkflowVariableTokenStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
  // The provider's own words, shown as it wrote them after the detail.
  let reason: string = "";

  switch (summary.status) {
    case OAuth2TokenStatus.Valid:
      color = Green500;
      icon = IconProp.CheckCircle;
      detail = translator.translateTemplate(
        "Valid until {{date}}",
        { date: formatDate(summary.expiresAt!) },
        { setsValuesApart: true },
      );
      break;
    case OAuth2TokenStatus.Expired:
      color = Amber500;
      icon = IconProp.Refresh;
      detail =
        translator.translateText(
          "Refreshes automatically the next time a workflow uses it",
        ) || "";
      break;
    case OAuth2TokenStatus.NoExpiry:
      color = Green500;
      icon = IconProp.CheckCircle;
      detail = translator.translateTemplate(
        "Fetched {{date}}. The provider did not say when it expires, so every run fetches a new one",
        { date: formatDate(summary.lastRefreshedAt!) },
        { setsValuesApart: true },
      );
      break;
    case OAuth2TokenStatus.RefreshFailed: {
      color = Red500;
      icon = IconProp.Error;
      /*
       * On a page read from the right, the provider's English kept its full
       * stop at its own end only when drawn apart from the date before it.
       */
      reason = summary.lastRefreshError || "";

      if (summary.lastRefreshErrorAt) {
        detail = `${formatDate(summary.lastRefreshErrorAt)}: `;
      }

      break;
    }
    case OAuth2TokenStatus.NotFetched:
    default:
      color = Gray500;
      icon = IconProp.Clock;
      detail =
        translator.translateText("Fetched the first time a workflow uses it") ||
        "";
      break;
  }

  return (
    <div
      className="flex flex-col items-start gap-1"
      data-testid="workflow-variable-token-status"
      data-status={summary.status}
    >
      <Pill
        text={OAUTH2_TOKEN_STATUS_LABELS[summary.status]}
        color={color}
        icon={icon}
      />
      {detail || reason ? (
        // A refresh error is a sentence or two, so let it wrap.
        <span
          className="whitespace-normal break-words text-sm text-gray-500"
          data-testid="workflow-variable-token-status-detail"
        >
          {detail}
          {reason ? readAsWritten(reason, translator.language) : <></>}
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
