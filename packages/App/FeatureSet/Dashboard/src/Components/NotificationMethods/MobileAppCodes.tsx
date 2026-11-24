import {
  APP_STORE_NAME,
  GOOGLE_PLAY_NAME,
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_IOS_URL,
} from "../../Utils/MobileAppStoreLinks";
import { getMobileAppServerUrl } from "../../Utils/MobileAppServerUrl";
import {
  MobileAppOffer,
  MobileAppOfferKind,
  getHelpLinkLabel,
  getMobileAppOffer,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import { useHelpAndSupport } from "Common/UI/Utils/HelpAndSupport";
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

/*
 * Where the server's admins offer the app from a page of their own - an app
 * catalogue, a device manager's company portal (Admin Dashboard > Settings
 * > Help and Support, #10866): one code for that page, named by its address.
 */
export const MOBILE_APP_INSTALL_FROM_OWN_PAGE_SENTENCE: string = translationKey(
  "Scan the code with your phone to get the app from your organization, sign in to {{serverUrl}}, and allow notifications and critical alerts when it asks.",
);

export const MOBILE_APP_INSTALL_FROM_OWN_PAGE_ON_PHONE_SENTENCE: string =
  translationKey(
    "Get the app from the link above, sign in to {{serverUrl}}, and allow notifications and critical alerts when it asks.",
  );

export interface ComponentProps {
  dataTestId: string;
  serverUrlDataTestId: string;
  className?: string | undefined;
}

const StoreCode: FunctionComponent<{
  name: string;
  url: string;
  dataTestId?: string | undefined;
  // An address as its name: broken anywhere rather than run off a phone.
  isNamedByAddress?: boolean | undefined;
}> = (props: {
  name: string;
  url: string;
  dataTestId?: string | undefined;
  isNamedByAddress?: boolean | undefined;
}): ReactElement => {
  return (
    <div
      className={
        props.isNamedByAddress
          ? "flex min-w-0 flex-col items-center gap-2"
          : "flex flex-col items-center gap-2"
      }
      data-testid={props.dataTestId}
    >
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
        className={`${
          props.isNamedByAddress ? "break-all text-center " : ""
        }text-sm font-semibold text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-500`}
        dir={props.isNamedByAddress ? "ltr" : undefined}
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
   * How the server offers the app (Help and Support): OneUptime's stores,
   * a page of its own, or not at all - then nothing is drawn, and the places
   * that open this offer no way to it either. A page of the server's own
   * not read from the server yet draws nothing until it is.
   */
  const offer: MobileAppOffer | null = getMobileAppOffer(useHelpAndSupport());
  const isOwnPage: boolean = offer?.kind === MobileAppOfferKind.OwnPage;

  if (!offer || (isOwnPage && !offer.url)) {
    return <></>;
  }

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
        {isOwnPage && offer.url ? (
          <StoreCode
            name={getHelpLinkLabel(offer.url)}
            url={offer.url}
            dataTestId={`${props.dataTestId}-own-page`}
            isNamedByAddress={true}
          />
        ) : (
          <>
            <StoreCode name={APP_STORE_NAME} url={MOBILE_APP_IOS_URL} />
            <StoreCode name={GOOGLE_PLAY_NAME} url={MOBILE_APP_ANDROID_URL} />
          </>
        )}
      </div>
      {/* Beside the codes, from a laptop's width; a phone's sentence below it. */}
      <p className="min-w-0 text-sm leading-6 text-gray-700 max-sm:hidden">
        <TranslatedSentence
          template={
            isOwnPage
              ? MOBILE_APP_INSTALL_FROM_OWN_PAGE_SENTENCE
              : MOBILE_APP_INSTALL_SENTENCE
          }
          slots={{
            serverUrl: getServerUrl(props.serverUrlDataTestId),
          }}
        />
      </p>
      <p className="min-w-0 text-sm leading-6 text-gray-700 sm:hidden">
        <TranslatedSentence
          template={
            isOwnPage
              ? MOBILE_APP_INSTALL_FROM_OWN_PAGE_ON_PHONE_SENTENCE
              : MOBILE_APP_INSTALL_ON_PHONE_SENTENCE
          }
          slots={{
            serverUrl: getServerUrl(`${props.serverUrlDataTestId}-on-phone`),
          }}
        />
      </p>
    </div>
  );
};

export default MobileAppCodes;
