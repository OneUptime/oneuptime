import QRCode from "qrcode";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ErrorMessage from "../ErrorMessage/ErrorMessage";

export interface ComponentProps {
  text: string;
}

const QRCodeElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(
      props.text,
      (err: Error | null | undefined, data: string) => {
        if (err) {
          setError(err.message);
          return;
        }
        setData(data);
      },
    );
  }, [props.text]);

  if (error) {
    return <ErrorMessage error={error} />;
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
