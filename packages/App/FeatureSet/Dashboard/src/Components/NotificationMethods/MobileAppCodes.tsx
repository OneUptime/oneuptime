import {
  APP_STORE_NAME,
  GOOGLE_PLAY_NAME,
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_IOS_URL,
} from "../../Utils/MobileAppStoreLinks";
import { getMobileAppServerUrl } from "../../Utils/MobileAppServerUrl";
import QRCode from "Common/UI/Components/QR/QR";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * GET THE MOBILE APP: a code for each store and the address to sign in to.
 *
 * A code is held up to a big screen by a phone, so a laptop shows one per
 * store - the App Store and Google Play, the links the app is downloaded
 * from (MobileAppStoreLinks) - and a phone shows the two links alone. The
 * app's first screen asks for the server it connects to, which is said
 * beside them (getMobileAppServerUrl): OneUptime Cloud's is filled in by
 * the app, a self-hosted server's has to be typed. There is no sign-in
 * link to put in a code: the codes lead to the stores.
 *
 * An invited member's first steps on Home (MemberFirstSteps) and the
 * on-call guided setup's "Get the app" (#7149) draw it alike.
 */

export const MOBILE_APP_INSTALL_SENTENCE: string = translationKey(
  "Scan a code with your phone to install the app, sign in to {{serverUrl}}, and allow notifications and critical alerts when it asks.",
);

/*
 * A phone shows no codes - it is the phone the app goes on - so it is told
 * where the app is instead: the two links above. How to Reach Me's "Get the
 * app" (#7451) asked a phone to scan a code it did not show.
 */
export const MOBILE_APP_INSTALL_ON_PHONE_SENTENCE: string = translationKey(
  "Install the app from the App Store or Google Play, sign in to {{serverUrl}}, and allow notifications and critical alerts when it asks.",
);

export interface ComponentProps {
  dataTestId: string;
  serverUrlDataTestId: string;
  className?: string | undefined;
}

const StoreCode: FunctionComponent<{ name: string; url: string }> = (props: {
  name: string;
  url: string;
}): ReactElement => {
  return (
    <div className="flex flex-col items-center gap-2">
      {/*
       * A code is for a phone held up to a big screen, not for a phone.
       * max-sm:hidden, not a bare hidden: a foreign .hidden rule would
       * hide the code at every width.
       */}
      <div className="max-sm:hidden sm:block">
        <QRCode text={props.url} alt={props.name} />
      </div>
      <a
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-semibold text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-500"
      >
        {props.name}
      </a>
    </div>
  );
};

const MobileAppCodes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * The address, read left to right on every page. It moves to a line of
   * its own before it is broken, and is broken only when it is longer than
   * a line: "http://localhost" was drawn "ht" / "tp://localhost" on a phone.
   */
  const getServerUrl: (dataTestId: string) => ReactElement = (
    dataTestId: string,
  ): ReactElement => {
    return (
      <code
        className="break-words rounded bg-white px-1 py-0.5 font-mono text-[0.8125rem] font-medium text-gray-900"
        data-testid={dataTestId}
        dir="ltr"
      >
        {getMobileAppServerUrl()}
      </code>
    );
  };

  return (
    <div
      data-testid={props.dataTestId}
      className={`flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center ${
        props.className || ""
      }`}
    >
      <div className="flex flex-shrink-0 justify-center gap-6">
        <StoreCode name={APP_STORE_NAME} url={MOBILE_APP_IOS_URL} />
        <StoreCode name={GOOGLE_PLAY_NAME} url={MOBILE_APP_ANDROID_URL} />
      </div>
      {/* Beside the codes, from a laptop's width; a phone's sentence below it. */}
      <p className="min-w-0 text-sm leading-6 text-gray-700 max-sm:hidden">
        <TranslatedSentence
          template={MOBILE_APP_INSTALL_SENTENCE}
          slots={{
            serverUrl: getServerUrl(props.serverUrlDataTestId),
          }}
        />
      </p>
      <p className="min-w-0 text-sm leading-6 text-gray-700 sm:hidden">
        <TranslatedSentence
          template={MOBILE_APP_INSTALL_ON_PHONE_SENTENCE}
          slots={{
            serverUrl: getServerUrl(`${props.serverUrlDataTestId}-on-phone`),
          }}
        />
      </p>
    </div>
  );
};

export default MobileAppCodes;
