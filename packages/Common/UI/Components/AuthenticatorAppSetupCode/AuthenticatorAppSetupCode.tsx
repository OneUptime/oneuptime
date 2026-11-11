import CopyTextButton from "../CopyTextButton/CopyTextButton";
import Icon from "../Icon/Icon";
import QRCodeElement from "../QR/QR";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import {
  getTotpSetupKey,
  getTotpSetupKeyGroups,
} from "../../../Utils/TotpSetupKey";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  // The otpauth:// URL of the authenticator app being set up.
  otpUrl: string;
}

const WHITESPACE: RegExp = /\s+/g;

/*
 * The key's groups are flex items, which a copy would put on lines of their
 * own. So a selection made within the key is copied as the characters it
 * holds, without the breaks - pasted into an authenticator app, it is the key.
 * A selection that reaches beyond the key is copied as the browser would.
 */
export function copySelectedKeyWhole(
  event: React.ClipboardEvent<HTMLElement>,
  keyElement: HTMLElement | null,
): void {
  const selection: Selection | null = window.getSelection();

  if (!keyElement || !selection || selection.rangeCount === 0) {
    return;
  }

  const range: Range = selection.getRangeAt(0);

  if (!keyElement.contains(range.commonAncestorContainer)) {
    return;
  }

  const selected: string = selection.toString().replace(WHITESPACE, "");

  if (!selected) {
    return;
  }

  event.clipboardData.setData("text/plain", selected);
  event.preventDefault();
}

/*
 * What a person adds an authenticator app with: the QR code to scan, and the
 * setup key to type or paste in for anyone who cannot scan it - a camera that
 * will not focus, an authenticator on the phone this page is open on, or a
 * code that could not be drawn at all. Drawn where two-factor authentication
 * is set up: the sign-in page, when an administrator requires it of an
 * account with nothing set up, and the Dashboard's authenticator apps.
 *
 * Issue #6638: every QR code failed to draw, and the sign-in page had nothing
 * else - someone required to set up two-factor authentication could not, and
 * so could not sign in. The key is offered under the code, folded away,
 * since most people scan; when the code cannot be drawn, the key is shown in
 * its place, so setting up never comes to a dead end. The mobile app's
 * enrolment shows the same key (TwoFactorEnrolmentScreen).
 */
const AuthenticatorAppSetupCode: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isKeyShown, setIsKeyShown] = useState<boolean>(false);
  const [hasQRCodeFailed, setHasQRCodeFailed] = useState<boolean>(false);
  const keyPanelId: string = React.useId();
  const setupKeyElement: MutableRefObject<HTMLElement | null> =
    useRef<HTMLElement | null>(null);

  const setupKey: string = getTotpSetupKey(props.otpUrl);
  const isKeyPanelOpen: boolean =
    Boolean(setupKey) && (isKeyShown || hasQRCodeFailed);

  return (
    <div className="flex w-full flex-col items-center">
      <QRCodeElement
        text={props.otpUrl}
        onError={() => {
          setHasQRCodeFailed(true);
        }}
      />

      {/*
       * The disclosure pattern: the button stays where it is, says whether
       * the key is open, and the key appears under it. Not offered once the
       * code has failed - there is no code to fail to scan, and the key is
       * already open.
       */}
      {setupKey && !hasQRCodeFailed && (
        <button
          type="button"
          aria-expanded={isKeyShown}
          aria-controls={keyPanelId}
          data-testid="authenticator-setup-key-toggle"
          className="mt-3 inline-flex items-center gap-1 rounded-md text-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            setIsKeyShown(!isKeyShown);
          }}
        >
          {translator.translateText("Can't scan the QR code?")}
          <Icon
            icon={IconProp.ChevronDown}
            className={`h-4 w-4 transition-transform ${
              isKeyShown ? "rotate-180" : ""
            }`}
          />
        </button>
      )}

      {isKeyPanelOpen && (
        <div
          id={keyPanelId}
          data-testid="authenticator-setup-key-panel"
          className="mt-4 w-full rounded-lg border border-gray-200 bg-gray-50 p-4 text-start"
        >
          <p className="text-sm text-gray-700">
            {translator.translateText(
              "Enter this setup key in your authenticator app instead.",
            )}
          </p>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
            {/*
             * In groups of four, read off the screen in groups - four to a
             * line on a phone as on a desktop, the gap only between them -
             * and copied, by the button or by selecting it, whole, as every
             * authenticator app takes it. Left to right on a right-to-left
             * page too: it is a code.
             */}
            <code
              ref={setupKeyElement}
              dir="ltr"
              data-testid="authenticator-setup-key"
              className="flex min-w-0 flex-wrap gap-x-2 font-mono text-sm font-medium tracking-wider text-gray-900 sm:text-base"
              onCopy={(event: React.ClipboardEvent<HTMLElement>) => {
                copySelectedKeyWhole(event, setupKeyElement.current);
              }}
            >
              {getTotpSetupKeyGroups(setupKey).map(
                (group: string, index: number): ReactElement => {
                  return <span key={index}>{group}</span>;
                },
              )}
            </code>
            <CopyTextButton
              textToBeCopied={setupKey}
              size="sm"
              variant="soft"
              className="flex-shrink-0"
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {translator.translateText(
              "If your app asks, choose a time-based key.",
            )}
          </p>
        </div>
      )}
    </div>
  );
};

export default AuthenticatorAppSetupCode;
