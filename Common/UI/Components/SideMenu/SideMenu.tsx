import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import Button, { ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";
import Navigation from "../../Utils/Navigation";
import SideMenuItem from "./SideMenuItem";
import SideMenuSection from "./SideMenuSection";
import CountModelSideMenuItem from "./CountModelSideMenuItem";
import Link from "../../../Types/Link";
import { BadgeType } from "../Badge/Badge";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "../../../Types/BaseDatabase/Query";
import { RequestOptions } from "../../Utils/ModelAPI/ModelAPI";

export interface SideMenuItemProps {
  link: Link;
  showAlert?: boolean;
  showWarning?: boolean;
  badge?: number;
  badgeType?: BadgeType;
  icon?: IconProp;
  className?: string;
  subItemLink?: Link | undefined;
  subItemIcon?: IconProp;
  // For CountModelSideMenuItem support
  modelType?: { new (): BaseModel };
  countQuery?: Query<any>;
  requestOptions?: RequestOptions;
  onCountFetchInit?: () => void;
}

export interface SideMenuSectionProps {
  title: string;
  items: SideMenuItemProps[];
}

export interface ComponentProps {
  sections?: SideMenuSectionProps[];
  items?: SideMenuItemProps[];
  className?: string;
  // Keep children support for backward compatibility
  children?: ReactElement | Array<ReactElement>;
}

const SideMenu: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [isMobileMenuVisible, setIsMobileMenuVisible] =
    useState<boolean>(false);

  // Use the existing outside click hook for mobile menu
  const {
    ref: mobileMenuRef,
    isComponentVisible: isMobileMenuOpen,
    setIsComponentVisible: setIsMobileMenuOpen,
  } = useComponentOutsideClick(false);

  // Sync local state with hook state
  useEffect(() => {
    setIsMobileMenuVisible(isMobileMenuOpen);
  }, [isMobileMenuOpen]);

  // Check if we're on mobile
  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  // Close mobile menu when clicking on a menu item
  const handleMenuItemClick: () => void = (): void => {
    if (isMobile && isMobileMenuVisible) {
      setIsMobileMenuOpen(false);
    }
  };

  // Function to find the active menu item and section - much simpler now!
  const findActiveMenuItem: () => {
    sectionTitle?: string;
    itemTitle?: string;
  } = (): {
    sectionTitle?: string;
    itemTitle?: string;
  } => {
    // Check sections first
    if (props.sections) {
      for (const section of props.sections) {
        for (const item of section.items) {
          if (Navigation.isOnThisPage(item.link.to)) {
            return {
              sectionTitle: section.title,
              itemTitle: item.link.title,
            };
          }
        }
      }
    }

    // Check direct items
    if (props.items) {
      for (const item of props.items) {
        if (Navigation.isOnThisPage(item.link.to)) {
          return {
            itemTitle: item.link.title,
          };
        }
      }
    }

    return {};
  };

  const activeItem: {
    sectionTitle?: string;
    itemTitle?: string;
  } = findActiveMenuItem();
  const displayText: string =
    activeItem.sectionTitle && activeItem.itemTitle
      ? `${activeItem.sectionTitle} - ${activeItem.itemTitle}`
      : activeItem.itemTitle || "Navigation";

  // Re-run active item detection when location changes
  useEffect(() => {
    // This will trigger a re-render when navigation changes
    // The activeItem will be recalculated
  }, [Navigation.getCurrentPath().toString()]);

  // Render function for the menu content
  const renderMenuContent: () => ReactElement[] = (): ReactElement[] => {
    const content: ReactElement[] = [];

    // Render sections
    if (props.sections) {
      props.sections.forEach(
        (section: SideMenuSectionProps, sectionIndex: number) => {
          content.push(
            <SideMenuSection
              key={`section-${sectionIndex}`}
              title={section.title}
            >
              {section.items.map(
                (item: SideMenuItemProps, itemIndex: number) => {
                  // If item has modelType, render CountModelSideMenuItem
                  if (item.modelType && item.countQuery) {
                    return (
                      <CountModelSideMenuItem
                        key={`section-${sectionIndex}-count-item-${itemIndex}`}
                        link={item.link}
                        badgeType={item.badgeType}
                        modelType={item.modelType as any}
                        countQuery={item.countQuery as any}
                        requestOptions={item.requestOptions}
                        icon={item.icon}
                        className={item.className}
                        onCountFetchInit={item.onCountFetchInit}
                      />
                    );
                  }

                  // Otherwise render regular SideMenuItem
                  return (
                    <SideMenuItem
                      key={`section-${sectionIndex}-item-${itemIndex}`}
                      link={item.link}
                      showAlert={item.showAlert}
                      showWarning={item.showWarning}
                      badge={item.badge}
                      badgeType={item.badgeType}
                      icon={item.icon}
                      className={item.className}
                      subItemLink={item.subItemLink}
                      subItemIcon={item.subItemIcon}
                    />
                  );
                },
              )}
            </SideMenuSection>,
          );
        },
      );
    }

    // Render direct items
    if (props.items) {
      props.items.forEach((item: SideMenuItemProps, itemIndex: number) => {
        // If item has modelType, render CountModelSideMenuItem
        if (item.modelType && item.countQuery) {
          content.push(
            <CountModelSideMenuItem
              key={`count-item-${itemIndex}`}
              link={item.link}
              badgeType={item.badgeType}
              modelType={item.modelType as any}
              countQuery={item.countQuery as any}
              requestOptions={item.requestOptions}
              icon={item.icon}
              className={item.className}
              onCountFetchInit={item.onCountFetchInit}
            />,
          );
        } else {
          // Otherwise render regular SideMenuItem
          content.push(
            <SideMenuItem
              key={`item-${itemIndex}`}
              link={item.link}
              showAlert={item.showAlert}
              showWarning={item.showWarning}
              badge={item.badge}
              badgeType={item.badgeType}
              icon={item.icon}
              className={item.className}
              subItemLink={item.subItemLink}
              subItemIcon={item.subItemIcon}
            />,
          );
        }
      });
    }

    // Support legacy children prop for backward compatibility
    if (props.children) {
      const children: Array<ReactElement> = Array.isArray(props.children)
        ? props.children
        : [props.children];

      children.forEach((child: ReactElement, index: number) => {
        content.push(React.cloneElement(child, { key: `child-${index}` }));
      });
    }

    return content;
  };

  // Mobile view
  if (isMobile) {
    return (
      <div className="md:hidden mb-6">
        {/* Mobile toggle button */}
        <div className="flex items-center justify-between w-full mb-4 px-4 py-3 bg-white rounded-lg border border-gray-200">
          <div className="flex-1 mr-3">
            <h3 className="text-base font-medium text-gray-900 truncate">
              {displayText}
            </h3>
          </div>
          <Button
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={() => {
              setIsMobileMenuOpen(!isMobileMenuVisible);
            }}
            className="p-2 flex-shrink-0"
            icon={isMobileMenuVisible ? IconProp.Close : IconProp.Bars3}
            dataTestId="mobile-sidemenu-toggle"
            tooltip={
              isMobileMenuVisible
                ? "Close navigation menu"
                : "Open navigation menu"
            }
          />
        </div>

        {/* Mobile collapsible menu */}
        {isMobileMenuVisible && (
          <div
            ref={mobileMenuRef}
            className="bg-white rounded-lg border border-gray-200 py-4 px-4 mb-6 transition-all duration-200 ease-in-out"
            role="navigation"
            aria-label="Main navigation"
          >
            <nav className="space-y-3" onClick={handleMenuItemClick}>
              {renderMenuContent()}
            </nav>
          </div>
        )}
      </div>
    );
  }

  // Desktop view
  return (
    <aside
      className={`hidden md:block py-6 px-2 sm:px-6 lg:col-span-2 md:col-span-3 lg:py-0 lg:px-0 mb-10 ${props.className || ""}`}
      role="navigation"
      aria-label="Main navigation"
    >
      <nav className="space-y-3">{renderMenuContent()}</nav>
    </aside>
  );
};

export default SideMenu;
