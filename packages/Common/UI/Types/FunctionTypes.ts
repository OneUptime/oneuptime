import { ReactElement } from "react";

export type GetReactElementFunction = () => ReactElement;

export type GetReactElementArrayFunction = () => Array<ReactElement>;

export type GetReactElementOrStringFunction = () => ReactElement | string;
