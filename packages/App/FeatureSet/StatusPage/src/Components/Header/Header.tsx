import Logo from "../Logo/Logo";
import Link from "Common/Types/Link";
import UILink from "Common/UI/Components/Link/Link";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import File from "Common/Models/DatabaseModels/File";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
  useRef,
} from "react";

export interface ComponentProps {
  links: Array<Link>;
  logo?: File | undefined;
  logoAltText?: string | undefined;
  onLogoClicked: () => void;
}

const StatusPageHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const mobileMenuRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  /*
   * Close the mobile menu when clicking outside it. This used to look the
   * toggle and the menu up with document.querySelector on data attributes
   * passed to <Button>, which never reach the DOM — Button has an explicit
   * prop list and spreads nothing — so both lookups returned null and the
   * menu never closed. A ref on the wrapper that holds both is what actually
   * works.
   */
  useEffect(() => {
    const handleClickOutside: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (
        mobileMenuRef.current &&
        event.target instanceof Node &&
        !mobileMenuRef.current.contains(event.target)
      ) {
        setIsMobileMenuOpen(false);
      }
    };

    if (isMobileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        return document.removeEventListener("mousedown", handleClickOutside);
      };
    }

    return () => {}; // Return cleanup function for all paths
  }, [isMobileMenuOpen]);

  const hasLinks: boolean = Boolean(props.links && props.links.length > 0);

  if (!props.logo && !hasLinks) {
    return <></>;
  }

  /*
   * This deliberately does not use Common's <Header>. That component wraps its
   * rightComponents in "hidden lg:flex", which hid this header's links — and
   * the mobile menu button meant to replace them — on every viewport under
   * 1024px. The status page header is a logo and a row of links; a plain flex
   * row with md: breakpoints is both simpler and correct.
   */
  return (
    <div className="mt-5 flex items-start justify-between gap-4">
      <div className="flex min-h-[3rem] items-center">
        {props.logo && (
          <div id="status-page-logo" className="flex">
            <Logo
              file={props.logo}
              alt={props.logoAltText}
              onClick={() => {
                props.onLogoClicked();
              }}
              style={{
                height: "50px",
              }}
            />
          </div>
        )}
      </div>

      {hasLinks && (
        <div className="relative flex min-h-[3rem] items-center">
          {/* Desktop: every link inline. */}
          <div className="hidden md:flex md:items-center md:gap-5">
            {props.links.map((link: Link, i: number) => {
              return (
                <UILink
                  key={i}
                  className="rounded text-sm font-medium text-gray-500 transition-colors duration-200 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500"
                  to={link.to}
                  openInNewTab={link.openInNewTab}
                >
                  {link.title}
                </UILink>
              );
            })}
          </div>

          {/*
           * Mobile: collapse the same links behind a menu button. Rendered
           * unconditionally and hidden with md:hidden — deciding in JS from
           * window.innerWidth made the button pop in after the first paint.
           */}
          <div className="md:hidden" ref={mobileMenuRef}>
            <Button
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                return setIsMobileMenuOpen(!isMobileMenuOpen);
              }}
              className="p-2"
              icon={isMobileMenuOpen ? IconProp.Close : IconProp.More}
              dataTestId="mobile-header-toggle"
              ariaExpanded={isMobileMenuOpen}
            />

            {isMobileMenuOpen && (
              <div className="animate-slide-down absolute right-0 top-full z-50 mt-2 min-w-48 rounded-lg border border-gray-200 bg-white py-2 shadow-lg">
                {props.links.map((link: Link, i: number) => {
                  return (
                    <div key={i} className="block">
                      <UILink
                        className="block px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
                        to={link.to}
                        openInNewTab={link.openInNewTab}
                        onClick={() => {
                          return setIsMobileMenuOpen(false);
                        }}
                      >
                        {link.title}
                      </UILink>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StatusPageHeader;
