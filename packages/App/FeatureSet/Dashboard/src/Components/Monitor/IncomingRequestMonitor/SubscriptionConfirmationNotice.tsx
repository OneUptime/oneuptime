import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import { translationKey } from "Common/Types/Translator";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ProviderLogoOrIcon from "Common/UI/Components/ProviderLogo/ProviderLogoOrIcon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import IncomingRequestSubscriptionConfirmationUtil, {
  IncomingRequestSubscriptionConfirmation,
  SubscriptionConfirmationAction,
  SubscriptionConfirmationProvider,
} from "Common/Utils/Monitor/IncomingRequestSubscriptionConfirmation";
import WebhookVerificationProvider from "Common/Types/Monitor/IncomingMonitor/WebhookVerificationProvider";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * "CONFIRM THE AMAZON SNS SUBSCRIPTION": THE ONE STEP LEFT AFTER POINTING A
 * TOPIC AT A MONITOR.
 *
 * https://github.com/OneUptime/oneuptime/issues/7723
 *
 * Amazon SNS sends an HTTPS subscription nothing until its owner opens the
 * link in the SubscriptionConfirmation it sent, and Azure Event Grid
 * validates a webhook once it is answered its validation code, or once its
 * owner opens the validationUrl. That link used to be masked in every copy
 * of the request people read, and finding it meant unfolding the request's
 * body. Now the copies keep it (MonitorRecordEvidence), and the request's
 * summary leads with it: what the service is waiting for, the topic, and
 * the link as the one button - wherever the request is shown (the
 * monitor's overview, a Monitoring Logs row, an incident's summary).
 *
 * OneUptime answers Event Grid's validation code itself now (issue #8429),
 * and a request it answered says so (answeredVerification): nothing is
 * left to do, so nothing is drawn for it. The link is offered only for a
 * validation OneUptime did not answer - one a probe relayed, say, or one
 * kept before it answered any.
 *
 * A link the copy holds masked (kept before the link was), or one past the
 * window the service gives it - two days for SNS, 10 minutes for Event
 * Grid - is not offered: the notice says how to get a new one instead.
 *
 * Only a link IncomingRequestSubscriptionConfirmation accepts - the
 * service's own endpoint, nothing else in it - is ever a button, and it
 * opens in a new tab with no referrer: anyone who knows the monitor's URL
 * can send it any body.
 */

export const SUBSCRIPTION_CONFIRMATION_NOTICE_TEST_ID: string =
  "subscription-confirmation-notice";

export const SUBSCRIPTION_CONFIRMATION_LINK_TEST_ID: string =
  "subscription-confirmation-link";

export const SUBSCRIPTION_CONFIRMATION_LINK_GONE_TEST_ID: string =
  "subscription-confirmation-link-gone";

export interface SubscriptionConfirmationCopy {
  title: string;
  description: string;
  // The button that opens the link.
  button: string;
  // What to do instead, when the link can no longer be opened.
  linkGone: string;
}

export const SUBSCRIPTION_CONFIRMATION_COPY: Record<
  SubscriptionConfirmationAction,
  SubscriptionConfirmationCopy
> = {
  [SubscriptionConfirmationAction.ConfirmSubscription]: {
    title: translationKey("Confirm the Amazon SNS subscription"),
    description: translationKey(
      "Amazon SNS sends nothing to this monitor until you confirm the subscription.",
    ),
    button: translationKey("Confirm Subscription"),
    linkGone: translationKey(
      "This link can no longer be opened. In the AWS console, select the subscription and choose Request confirmation, or create the subscription again if it is gone.",
    ),
  },
  [SubscriptionConfirmationAction.RestoreSubscription]: {
    title: translationKey("The Amazon SNS subscription was deleted"),
    description: translationKey(
      "This monitor gets no more messages from the topic. To get them again, restore the subscription.",
    ),
    button: translationKey("Restore Subscription"),
    linkGone: translationKey(
      "This link can no longer be opened. To get messages from the topic again, create the subscription again in the AWS console.",
    ),
  },
  [SubscriptionConfirmationAction.ValidateSubscription]: {
    title: translationKey("Validate the Azure Event Grid subscription"),
    description: translationKey(
      "Event Grid sends no events to this monitor until you validate the event subscription.",
    ),
    button: translationKey("Validate Subscription"),
    linkGone: translationKey(
      "This link can no longer be opened: it works for 10 minutes after Event Grid sends it. Create the event subscription again to get a new one.",
    ),
  },
};

export const SUBSCRIPTION_TOPIC_LABEL: string = translationKey("Topic");

export const SUBSCRIPTION_LINK_WORKS_UNTIL: string = translationKey(
  "The link works until {{time}}.",
);

export const SUBSCRIPTION_NOTICE_STAYS: string = translationKey(
  "This note stays until the monitor's next request arrives.",
);

// Each service by its own mark.
const PROVIDER_LOGOS: Record<SubscriptionConfirmationProvider, ProviderLogo> = {
  [SubscriptionConfirmationProvider.AmazonSns]: ProviderLogo.Aws,
  [SubscriptionConfirmationProvider.AzureEventGrid]: ProviderLogo.Azure,
};

export interface ComponentProps {
  // The request's body, from whichever copy is shown.
  requestBody: unknown;
  /*
   * The service OneUptime answered the request's verification handshake
   * for, when it did (IncomingMonitorRequest.answeredVerification).
   */
  answeredVerification?: WebhookVerificationProvider | undefined;
  // The moment the link's window is judged at: now, unless a test says.
  now?: Date | undefined;
}

// The confirmations OneUptime completes itself when it answers the request.
const ANSWERED_BY: Partial<
  Record<SubscriptionConfirmationAction, WebhookVerificationProvider>
> = {
  [SubscriptionConfirmationAction.ValidateSubscription]:
    WebhookVerificationProvider.AzureEventGrid,
};

const SubscriptionConfirmationNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const titleId: string = useId();

  const confirmation: IncomingRequestSubscriptionConfirmation | null =
    IncomingRequestSubscriptionConfirmationUtil.find(props.requestBody);

  if (!confirmation) {
    return <></>;
  }

  // Answered by OneUptime itself: the service is waiting for nothing.
  if (
    props.answeredVerification &&
    ANSWERED_BY[confirmation.action] === props.answeredVerification
  ) {
    return <></>;
  }

  const copy: SubscriptionConfirmationCopy =
    SUBSCRIPTION_CONFIRMATION_COPY[confirmation.action];

  const now: Date = props.now || OneUptimeDate.getCurrentDate();

  const url: string | null =
    confirmation.url &&
    !IncomingRequestSubscriptionConfirmationUtil.hasExpired(confirmation, now)
      ? confirmation.url
      : null;

  return (
    <section
      data-testid={SUBSCRIPTION_CONFIRMATION_NOTICE_TEST_ID}
      aria-labelledby={titleId}
      className="rounded-lg border border-amber-200 bg-amber-50 p-4"
    >
      <div className="flex items-start gap-3">
        <ProviderLogoOrIcon
          logo={PROVIDER_LOGOS[confirmation.provider]}
          icon={IconProp.Link}
          size={40}
          isDecorative={true}
          colorClassName="text-amber-700"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 id={titleId} className="text-sm font-semibold text-amber-900">
              {translator.translateText(copy.title)}
            </h3>
            <p className="mt-1 text-sm text-amber-800">
              {translator.translateText(copy.description)}
            </p>
          </div>

          {confirmation.topic ? (
            <div>
              <p className="text-xs font-medium text-amber-800">
                {translator.translateText(SUBSCRIPTION_TOPIC_LABEL)}
              </p>
              <p className="mt-0.5 font-mono text-xs text-amber-900 [overflow-wrap:anywhere]">
                <IsolatedText
                  text={confirmation.topic}
                  breaksLikeAName={true}
                />
              </p>
            </div>
          ) : (
            <></>
          )}

          {url ? (
            <div className="space-y-2">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={SUBSCRIPTION_CONFIRMATION_LINK_TEST_ID}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                {translator.translateText(copy.button)}
                <Icon
                  icon={IconProp.ExternalLink}
                  className="h-4 w-4 shrink-0"
                />
              </a>
              {confirmation.expiresAt ? (
                <p className="text-xs text-amber-800">
                  {translator.translateTemplate(SUBSCRIPTION_LINK_WORKS_UNTIL, {
                    time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                      confirmation.expiresAt,
                    ),
                  })}
                </p>
              ) : (
                <></>
              )}
              <p className="text-xs text-amber-800">
                {translator.translateText(SUBSCRIPTION_NOTICE_STAYS)}
              </p>
            </div>
          ) : (
            <p
              data-testid={SUBSCRIPTION_CONFIRMATION_LINK_GONE_TEST_ID}
              className="text-sm text-amber-900"
            >
              {translator.translateText(copy.linkGone)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

export default SubscriptionConfirmationNotice;
