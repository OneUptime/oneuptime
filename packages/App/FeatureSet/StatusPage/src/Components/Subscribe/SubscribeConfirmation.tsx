import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a subscribe page says once its form has done its job: subscribed,
 * a confirmation link sent, a manage link sent, changes saved.
 *
 * Each page drew it as one centred paragraph in gray-400 - 2.5:1 on the
 * page, with no icon, no heading and 80px of space round it - so the one
 * sign that the subscription worked looked like disabled text on an empty
 * page (#9027). It is a card now: an icon, a heading where the visitor has a
 * next step ("Check your email"), and the sentence in gray-600, announced to
 * a screen reader as a status.
 *
 * The words come in the reader's language already (the page's t()), and
 * are drawn as given.
 */

export enum SubscribeConfirmationTone {
  // Done: subscribed, saved.
  Done = "done",
  // Waiting on the visitor: a link to open in an email or a text message.
  NextStep = "next-step",
}

export interface ComponentProps {
  message: string;
  title?: string | undefined;
  icon: IconProp;
  tone: SubscribeConfirmationTone;
  dataTestId?: string | undefined;
}

export const SUBSCRIBE_CONFIRMATION_TEST_ID: string = "subscribe-confirmation";

export const SUBSCRIBE_CONFIRMATION_TITLE_CLASS_NAME: string =
  "mt-4 text-base font-semibold text-gray-900";

export const SUBSCRIBE_CONFIRMATION_MESSAGE_CLASS_NAME: string =
  "text-sm text-gray-600";

const ICON_TILE_CLASS_NAMES: Record<SubscribeConfirmationTone, string> = {
  [SubscribeConfirmationTone.Done]: "bg-green-50 text-green-600",
  [SubscribeConfirmationTone.NextStep]: "bg-indigo-50 text-indigo-600",
};

const SubscribeConfirmation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      role="status"
      data-testid={props.dataTestId || SUBSCRIBE_CONFIRMATION_TEST_ID}
      data-tone={props.tone}
      className="mx-auto my-10 max-w-lg rounded-xl bg-white px-6 py-10 text-center shadow"
    >
      <div
        className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${ICON_TILE_CLASS_NAMES[props.tone]}`}
      >
        <Icon icon={props.icon} className="h-6 w-6" />
      </div>
      {props.title ? (
        <h2 className={SUBSCRIBE_CONFIRMATION_TITLE_CLASS_NAME}>
          {props.title}
        </h2>
      ) : null}
      <p
        className={`${props.title ? "mt-2" : "mt-4"} ${SUBSCRIBE_CONFIRMATION_MESSAGE_CLASS_NAME}`}
      >
        {props.message}
      </p>
    </div>
  );
};

export default SubscribeConfirmation;
