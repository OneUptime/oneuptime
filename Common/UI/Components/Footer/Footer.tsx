import UILink from "../Link/Link";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export interface FooterLink {
  onClick?: (() => void) | undefined;
  openInNewTab?: boolean | undefined;
  to?: Route | URL | undefined;
  title?: ReactNode;
  content?: ReactNode;
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
        className={
          props.className || "bg-gray-50/50 border-t border-gray-100 min-h-16"
        }
        style={props.style}
      >
        <div className="mx-auto w-full py-6 px-6 md:flex md:items-center md:justify-between lg:px-8">
          {/* Mobile: Stack links vertically, Desktop: Horizontal layout */}
          <div className="flex flex-col space-y-3 md:flex-row md:justify-center md:items-center md:space-y-0 md:space-x-8 md:order-2">
            {props.links &&
              props.links.length > 0 &&
              props.links.map((link: FooterLink, i: number) => {
                if (link.content) {
                  return (
                    <div
                      key={i}
                      className="text-gray-500 text-sm text-center md:text-left transition-colors duration-200"
                    >
                      {link.content}
                    </div>
                  );
                }

                if (!link.title) {
                  return <React.Fragment key={i}></React.Fragment>;
                }

                return (
                  <UILink
                    key={i}
                    className="text-gray-500 hover:text-gray-700 text-sm font-medium text-center md:text-left transition-colors duration-200"
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
          <div className="mt-5 md:order-1 md:mt-0 block md:hidden lg:block">
            {props.copyright && (
              <p className="text-center text-sm text-gray-400">
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
