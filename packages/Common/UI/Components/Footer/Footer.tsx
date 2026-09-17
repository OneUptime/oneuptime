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
  /*
   * Classes for the inner row. The default adds its own horizontal padding,
   * which double-indents the footer inside a layout that is already padded —
   * the status page, for one. Override it to align the footer with the content
   * above it.
   */
  innerClassName?: string | undefined;
  /*
   * Classes for the copyright block. The default hides it between md and lg,
   * which is not something every layout wants.
   */
  copyrightClassName?: string | undefined;
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
        <div
          className={
            props.innerClassName ||
            "mx-auto w-full py-6 px-6 md:flex md:items-center md:justify-between lg:px-8"
          }
        >
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
          {/*
           * Guard the wrapper, not just the <p>: with no copyright configured
           * the empty div still contributed its mt-5, leaving a dead gap under
           * the links.
           */}
          {props.copyright && (
            <div
              className={
                props.copyrightClassName ||
                "mt-5 md:order-1 md:mt-0 block md:hidden lg:block"
              }
            >
              <p className="text-center text-sm text-gray-500">
                &copy; {props.copyright}
              </p>
            </div>
          )}
        </div>
      </footer>
    </React.Fragment>
  );
};

export default Footer;
