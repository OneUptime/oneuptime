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
        QRCode.toDataURL(props.text, function (err: Error | null | undefined, data: string) {
            if(err) {
                setError(err.message);
                return; 
            }
            setData(data);
          })
    }, [props.text]);

    if(error){
        return <ErrorMessage error={error} />
    }

  return (
    <img src={data || undefined} alt={props.text} />
  );
};

export default QRCodeElement;
