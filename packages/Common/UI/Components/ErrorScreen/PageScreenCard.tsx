import {
  ERROR_SCREEN_CSS,
  RELOAD_ICON_PATH,
  getIcon,
} from "./ErrorScreenStyle";
import { getReadingDirection } from "../../../Types/ReadingDirection";
import { Translator } from "../../Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The card a page shows in its own place while it cannot be shown: a part
 * of it that will not download after a deploy (ChunkLoadRecovery - updating
 * to the new version, offline, the server not answering, a reload it needs,
 * a page that could not be loaded), and the browser going offline under a
 * page that is open (OfflineScreen, which the MasterPage of the Dashboard,
 * the Admin Dashboard and status pages shows in place of the page). One
 * card, so every frontend says these things the same way.
 *
 * Drawn with the error screens' own stylesheet (ErrorScreenStyle), never
 * with the app's: it is shown when the app's own files may be the ones that
 * did not arrive. A badge with its icon, the title, one short message and
 * the one thing to do.
 */

export enum PageScreenTone {
  // A new version loading, or one a reload would bring: the accent.
  Info = "info",
  // Offline, or the server not answering: nothing on the page is broken.
  Neutral = "neutral",
  // It could not be loaded.
  Alert = "alert",
}

export interface PageScreenAction {
  title: string;
  onClick: () => void;
  dataTestId: string;
  /*
   * Asking right now (offline, is the network back?): a spinner in place of
   * its icon, and a second press waits for the first.
   */
  isBusy?: boolean | undefined;
}

export interface ComponentProps {
  dataTestId: string;
  titleTestId: string;
  tone: PageScreenTone;
  // The badge's icon (ErrorScreenStyle's paths); none draws a spinner.
  iconPath?: string | undefined;
  title: string;
  message: string;
  // Said at once (role alert), not politely in turn (role status).
  isAlert?: boolean | undefined;
  actions?: Array<PageScreenAction> | undefined;
  /*
   * The language the words are in: the card says so (lang) and reads its
   * way (dir) even on a page that does not - a public dashboard is drawn in
   * English, left to right, while its visitor reads these words in
   * Persian.
   */
  language?: string | undefined;
  // data-* attributes for the screen's root: which screen, which step.
  dataAttributes?: Record<string, string> | undefined;
}

/*
 * The language a screen's words are in: the reader's when it words them,
 * English when it falls back to it - so a screen in Persian reads right to
 * left even on a page drawn left to right (a public dashboard), and one left
 * in English never does.
 */
export const getScreenLanguage: (
  translator: Translator,
  englishText: string,
) => string = (translator: Translator, englishText: string): string => {
  return translator.hasTranslation(englishText) ? translator.language : "en";
};

const getBadgeClassName: (tone: PageScreenTone) => string = (
  tone: PageScreenTone,
): string => {
  if (tone === PageScreenTone.Info) {
    return "oueb-badge oueb-badge-info";
  }

  if (tone === PageScreenTone.Neutral) {
    return "oueb-badge oueb-badge-neutral";
  }

  return "oueb-badge";
};

const PageScreenCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const actions: Array<PageScreenAction> = props.actions || [];

  return (
    <div
      className="oneuptime-error-boundary"
      data-testid={props.dataTestId}
      lang={props.language}
      dir={props.language ? getReadingDirection(props.language) : undefined}
      {...(props.dataAttributes || {})}
    >
      <style>{ERROR_SCREEN_CSS}</style>
      <div className="oueb-card">
        <div className={getBadgeClassName(props.tone)} aria-hidden="true">
          {props.iconPath ? (
            getIcon(props.iconPath)
          ) : (
            <span className="oueb-spinner" />
          )}
        </div>
        <div role={props.isAlert ? "alert" : "status"} aria-live="polite">
          <h1 className="oueb-title" data-testid={props.titleTestId}>
            {props.title}
          </h1>
          <p className="oueb-message">{props.message}</p>
        </div>
        {actions.length > 0 ? (
          <div className="oueb-actions">
            {actions.map((action: PageScreenAction): ReactElement => {
              return (
                <button
                  key={action.dataTestId}
                  type="button"
                  className="oueb-button oueb-button-primary"
                  data-testid={action.dataTestId}
                  aria-busy={action.isBusy ? "true" : undefined}
                  onClick={() => {
                    if (action.isBusy) {
                      return;
                    }

                    action.onClick();
                  }}
                >
                  {action.isBusy ? (
                    <span className="oueb-spinner" aria-hidden="true" />
                  ) : (
                    getIcon(RELOAD_ICON_PATH)
                  )}
                  {action.title}
                </button>
              );
            })}
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default PageScreenCard;
