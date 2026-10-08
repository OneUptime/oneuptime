import React, { FunctionComponent, ReactElement, useEffect } from "react";
import { getProductName } from "./Utils/ProductBranding";

type Props = {
  children: Array<ReactElement>;
  title: string;
};

const Container: FunctionComponent<Props> = ({ children, title }: Props) => {
  useEffect(() => {
    document.title = `${getProductName()} | ${title}`;
  }, []);

  return <div>{children}</div>;
};

export default Container;
