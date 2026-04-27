import Link from "../Link/Link";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import { GetReactElementFunction } from "../../Types/FunctionTypes";

export interface ComponentProps {
  title: string;
  description: string;
  link?: URL | Route | undefined;
  openInNewTab?: boolean | undefined;
  hideOnMobile?: boolean | undefined;
}

const Banner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedTitle: string =
    translateString(props.title) || props.title;
  const translatedDescription: string =
    translateString(props.description) || props.description;
  const getContent: GetReactElementFunction = (): ReactElement => {
    return (
      <>
        <strong className="font-semibold">{translatedTitle}</strong>
        <svg
          viewBox="0 0 2 2"
          className="mx-2 inline h-0.5 w-0.5 fill-current"
          aria-hidden="true"
        >
          <circle cx="1" cy="1" r="1" />
        </svg>
        {translatedDescription}&nbsp;
        <span aria-hidden="true">&rarr;</span>
      </>
    );
  };

  return (
    <div
      className={`flex border-gray-200 rounded-xl border-2 py-2.5 px-6 sm:px-3.5 mb-5${props.hideOnMobile ? " hidden md:flex" : ""}`}
    >
      <p className="text-sm text-gray-400 hover:text-gray-500">
        {props.link && (
          <Link to={props.link} openInNewTab={props.openInNewTab}>
            {getContent()}
          </Link>
        )}
        {!props.link && getContent()}
      </p>
    </div>
  );
};

export default Banner;
