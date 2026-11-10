import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { Logger } from "../../Utils/Logger";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { loadQRCodeImage } from "./QRCodeLoader";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  text: string;
  // What the code is, for someone who cannot see it: "QR code" when not set.
  alt?: string | undefined;
  /*
   * Told when the code cannot be drawn, so the page can offer its other way
   * in - the setup key beside an authenticator app's code
   * (AuthenticatorAppSetupCode), the link beside Telegram's.
   */
  onError?: (() => void) | undefined;
}

/*
 * A QR code, drawn once its library has loaded: the sign-in page draws one
 * only while two-factor authentication is being set up, and used to download
 * and parse the library on every visit before it could draw (issue #5619).
 *
 * It keeps its size from the first frame - a square where the code will be
 * while it is made - so nothing moves when it arrives, and a code for text
 * the element no longer shows is never drawn. A code that cannot be made says
 * so in words a person can act on, never the error a script threw ("L.toDataURL
 * is not a function", issue #6638), and tells the page through onError.
 */
const QRCodeElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [image, setImage] = useState<string | null>(null);
  const [hasFailed, setHasFailed] = useState<boolean>(false);

  // The page's latest callback, without drawing the code again for a new one.
  const onError: MutableRefObject<(() => void) | undefined> = useRef<
    (() => void) | undefined
  >(props.onError);

  useEffect(() => {
    onError.current = props.onError;
  }, [props.onError]);

  useEffect(() => {
    // A code for text the element no longer shows is not drawn.
    let isCurrent: boolean = true;

    setImage(null);
    setHasFailed(false);

    loadQRCodeImage(props.text).then(
      (url: string): void => {
        if (isCurrent) {
          setImage(url);
        }
      },
      (error: unknown): void => {
        if (isCurrent) {
          // What went wrong, for whoever opens the console to find out.
          Logger.error(
            `The QR code could not be drawn: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          setHasFailed(true);
          onError.current?.();
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [props.text]);

  const alt: string = props.alt || translator.translateText("QR code");

  if (hasFailed) {
    return (
      <div
        role="alert"
        data-testid="qr-code-failed"
        className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
      >
        <Icon icon={IconProp.Alert} className="h-5 w-5 flex-shrink-0" />
        <span>
          {translator.translateText("The QR code could not be shown.")}
        </span>
      </div>
    );
  }

  if (!image) {
    return (
      <div
        role="img"
        aria-label={alt}
        aria-busy="true"
        data-testid="qr-code-loading"
        className="h-48 w-48 animate-pulse rounded-lg bg-gray-100"
      />
    );
  }

  return (
    <img
      className="h-48 w-48"
      src={image}
      alt={alt}
      data-testid="qr-code"
    />
  );
};

export default QRCodeElement;
