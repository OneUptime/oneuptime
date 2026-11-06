import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ErrorMessage from "../ErrorMessage/ErrorMessage";

export interface ComponentProps {
  text: string;
}

/*
 * The QR code library is loaded when a code is drawn: the sign-in page draws
 * one only while two-factor authentication is being set up, and used to
 * download and parse the library for every visit before it could draw
 * (issue #5619). The code was drawn once it was made anyway; it is made once
 * the library is there.
 */
const QRCodeElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<string | null>(null);

  useEffect(() => {
    // A code for text the element no longer shows is not drawn.
    let isCurrent: boolean = true;

    setError(null);

    import("qrcode")
      .then((QRCode: typeof import("qrcode")) => {
        return QRCode.toDataURL(props.text);
      })
      .then(
        (url: string) => {
          if (isCurrent) {
            setData(url);
          }
        },
        (err: unknown) => {
          if (isCurrent) {
            setError(err instanceof Error ? err.message : String(err));
          }
        },
      );

    return () => {
      isCurrent = false;
    };
  }, [props.text]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <img
      className="h-42 w-42 flex align-center item-center"
      src={data || undefined}
      alt={props.text}
    />
  );
};

export default QRCodeElement;
