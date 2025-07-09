import UILink from "../Link/Link";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import React, { FunctionComponent, ReactElement } from "react";

export interface FooterLink {
  onClick?: (() => void) | undefined;
  openInNewTab?: boolean | undefined;
  to?: Route | URL | undefined;
  title: string;
}

export interface ComponentProps {
  copyright?: string | undefined;
  links: Array<FooterLink>;
  style?: React.CSSProperties | undefined;
  className?: string | undefined;
}

const Footer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <React.Fragment>
      <footer
        className={props.className || "bg-white min-h-16"}
        style={props.style}
      >
        <div className="mx-auto w-full py-5 px-6 md:flex md:items-center md:justify-between lg:px-0">
          {/* Mobile: Stack links vertically, Desktop: Horizontal layout */}
          <div className="flex flex-col space-y-3 md:flex-row md:justify-center md:space-y-0 md:space-x-6 md:order-2">
            {props.links &&
              props.links.length > 0 &&
              props.links.map((link: FooterLink, i: number) => {
                return (
                  <UILink
                    key={i}
                    className="text-gray-400 hover:text-gray-500 text-center md:text-left"
                    to={link.to}
                    openInNewTab={link.openInNewTab}
                    onClick={link.onClick}
                  >
                    {link.title}
                  </UILink>
                );
              })}
          </div>
          {/* Copyright: Show on mobile, hide on larger screens unless specified */}
          <div className="mt-4 md:order-1 md:mt-0 block md:hidden lg:block">
            {props.copyright && (
              <p className="text-center text-base text-gray-400">
                &copy; {props.copyright}
              </p>
            )}
          </div>
        </div>
      </footer>
    </React.Fragment>
  );
};

export default Footer;
