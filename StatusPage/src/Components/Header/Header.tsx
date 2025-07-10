import Logo from "../Logo/Logo";
import Link from "Common/Types/Link";
import Header from "Common/UI/Components/Header/Header";
import UILink from "Common/UI/Components/Link/Link";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import File from "Common/Models/DatabaseModels/File";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";

export interface ComponentProps {
  links: Array<Link>;
  logo?: File | undefined;
  onLogoClicked: () => void;
}

const StatusPageHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);

  // Check if we're on mobile
  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      return window.removeEventListener("resize", checkMobile);
    };
  }, []);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (isMobileMenuOpen && event.target instanceof Element) {
        const mobileMenu: Element | null = document.querySelector(
          "[data-mobile-header-menu]",
        );
        const mobileToggle: Element | null = document.querySelector(
          "[data-mobile-header-toggle]",
        );

        if (
          mobileMenu &&
          mobileToggle &&
          !mobileMenu.contains(event.target) &&
          !mobileToggle.contains(event.target)
        ) {
          setIsMobileMenuOpen(false);
        }
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

  if (!props.logo && props.links.length === 0) {
    return <></>;
  }

  return (
    <div>
      {(props.logo || props.links?.length > 0) && (
        <Header
          className="bg-transparent flex justify-between mt-5"
          leftComponents={
            <>
              {props.logo && (
                <div id="status-page-logo" className="flex h-12 mt-2">
                  <Logo
                    file={props.logo}
                    onClick={() => {
                      props.onLogoClicked();
                    }}
                    style={{
                      height: "50px",
                    }}
                  />
                </div>
              )}
            </>
          }
          rightComponents={
            <>
              {props.links && props.links.length > 0 && (
                <div key={"links"} className="relative">
                  {/* Desktop: Show all links */}
                  <div className="hidden md:flex space-x-4">
                    {props.links.map((link: Link, i: number) => {
                      return (
                        <div key={i} className="flex items-center">
                          <UILink
                            className="flex w-full flex-col items-center text-gray-400 hover:text-gray-600 font-medium font-mono"
                            to={link.to}
                            openInNewTab={link.openInNewTab}
                          >
                            {link.title}
                          </UILink>
                        </div>
                      );
                    })}
                  </div>

                  {/* Mobile: Show hamburger menu */}
                  {isMobile && (
                    <div className="md:hidden">
                      <Button
                        buttonStyle={ButtonStyleType.OUTLINE}
                        onClick={() => {
                          return setIsMobileMenuOpen(!isMobileMenuOpen);
                        }}
                        className="p-2"
                        icon={isMobileMenuOpen ? IconProp.Close : IconProp.More}
                        dataTestId="mobile-header-toggle"
                        data-mobile-header-toggle
                      />

                      {/* Mobile dropdown menu */}
                      {isMobileMenuOpen && (
                        <div
                          className="absolute top-full right-0 z-50 mt-2 min-w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2"
                          data-mobile-header-menu
                        >
                          {props.links.map((link: Link, i: number) => {
                            return (
                              <div key={i} className="block">
                                <UILink
                                  className="block px-4 py-2 text-gray-700 hover:bg-gray-50 hover:text-gray-900 font-medium"
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
                  )}
                </div>
              )}
            </>
          }
        />
      )}
    </div>
  );
};

export default StatusPageHeader;
