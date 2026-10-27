import { OFFLINE_ICON_PATH } from "../ErrorScreen/ErrorScreenStyle";
import PageScreenCard, {
  PageScreenTone,
  getScreenLanguage,
} from "../ErrorScreen/PageScreenCard";
import NewVersion from "../../Utils/NewVersion/NewVersion";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * "You're offline", in place of a page whose browser went offline while it
 * was open: the Dashboard's, the Admin Dashboard's and a status page's
 * (MasterPage). The same card a page shows when its code cannot download
 * offline (ChunkLoadRecovery), in the reader's language.
 *
 * The page stays as it was under it - what was typed, where it was scrolled
 * - and comes back the moment the network does. Try again looks at once,
 * and a page whose browser says it is offline while the server answers
 * comes back too.
 */

export const OFFLINE_SCREEN_TITLE: string = translationKey("You're offline");

export const OFFLINE_SCREEN_MESSAGE: string = translationKey(
  "This page will come back as soon as you're online again, just as you left it.",
);

export const OFFLINE_SCREEN_TRY_AGAIN: string = translationKey("Try again");

export const OFFLINE_SCREEN_TEST_ID: string = "offline-screen";

export interface ComponentProps {
  // Try again is asking right now.
  isChecking: boolean;
  onTryAgain: () => void;
}

const OfflineScreen: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  /*
   * One message at a time: "OneUptime has been updated" and its Reload
   * wait until the page is back - a reload now would only reach the
   * browser's own offline page.
   */
  useEffect(() => {
    return NewVersion.holdNotice();
  }, []);

  return (
    <PageScreenCard
      dataTestId={OFFLINE_SCREEN_TEST_ID}
      titleTestId={`${OFFLINE_SCREEN_TEST_ID}-title`}
      tone={PageScreenTone.Neutral}
      iconPath={OFFLINE_ICON_PATH}
      title={translate(OFFLINE_SCREEN_TITLE)}
      message={translate(OFFLINE_SCREEN_MESSAGE)}
      language={getScreenLanguage(translator, OFFLINE_SCREEN_TITLE)}
      actions={[
        {
          title: translate(OFFLINE_SCREEN_TRY_AGAIN),
          dataTestId: `${OFFLINE_SCREEN_TEST_ID}-try-again`,
          isBusy: props.isChecking,
          onClick: props.onTryAgain,
        },
      ]}
    />
  );
};

export default OfflineScreen;
