import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";
import Navigation from "../../Utils/Navigation";
import useTranslateValue from "../../Utils/Translation";
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
  // Use a different route for selection when the link target also changes query state.
  activeRoute?: Link["to"] | undefined;
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
  icon?: IconProp;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
}

export interface ComponentProps {
  sections?: SideMenuSectionProps[];
  items?: SideMenuItemProps[];
  className?: string;
  header?: ReactElement;
  footer?: ReactElement;
  // Keep children support for backward compatibility
  children?: ReactElement | Array<ReactElement>;
}

const SideMenu: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
  const { translateString } = useTranslateValue();
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
    icon?: IconProp;
  } = (): {
    sectionTitle?: string;
    itemTitle?: string;
    icon?: IconProp;
  } => {
    // Check sections first
    if (props.sections) {
      for (const section of props.sections) {
        for (const item of section.items) {
          if (Navigation.isOnThisPage(item.activeRoute || item.link.to)) {
            const result: {
              sectionTitle: string;
              itemTitle: string;
              icon?: IconProp;
            } = {
              sectionTitle: section.title,
              itemTitle: item.link.title,
            };
            if (item.icon) {
              result.icon = item.icon;
            }
            return result;
          }
        }
      }
    }

    // Check direct items
    if (props.items) {
      for (const item of props.items) {
        if (Navigation.isOnThisPage(item.activeRoute || item.link.to)) {
          const result: {
            itemTitle: string;
            icon?: IconProp;
          } = {
            itemTitle: item.link.title,
          };
          if (item.icon) {
            result.icon = item.icon;
          }
          return result;
        }
      }
    }

    return {};
  };

  const activeItem: {
    sectionTitle?: string;
    itemTitle?: string;
    icon?: IconProp;
  } = findActiveMenuItem();
  const translatedSectionTitle: string | undefined = translateString(
    activeItem.sectionTitle,
  );
  const translatedItemTitle: string | undefined = translateString(
    activeItem.itemTitle,
  );
  const displayText: string =
    translatedSectionTitle && translatedItemTitle
      ? `${translatedSectionTitle} / ${translatedItemTitle}`
      : translatedItemTitle || translateString("Navigation") || "Navigation";

  // Re-run active item detection when location changes
  useEffect(() => {
    /*
     * This will trigger a re-render when navigation changes
     * The activeItem will be recalculated
     */
  }, [Navigation.getCurrentPath().toString()]);

  // Render function for the menu content
  const renderMenuContent: () => ReactElement[] = (): ReactElement[] => {
    const content: ReactElement[] = [];

    // Render sections
    if (props.sections) {
      props.sections.forEach(
        (section: SideMenuSectionProps, sectionIndex: number) => {
          // Build section props conditionally to avoid undefined values
          const sectionProps: {
            key: string;
            title: string;
            icon?: IconProp;
            defaultCollapsed?: boolean;
            collapsible?: boolean;
            isActive: boolean;
          } = {
            key: `section-${sectionIndex}`,
            title: section.title,
            isActive: section.items.some((item: SideMenuItemProps): boolean => {
              return Navigation.isOnThisPage(item.activeRoute || item.link.to);
            }),
          };

          if (section.icon) {
            sectionProps.icon = section.icon;
          }
          if (section.defaultCollapsed !== undefined) {
            sectionProps.defaultCollapsed = section.defaultCollapsed;
          }
          if (section.collapsible !== undefined) {
            sectionProps.collapsible = section.collapsible;
          }

          content.push(
            <SideMenuSection {...sectionProps}>
              {section.items.map(
                (item: SideMenuItemProps, itemIndex: number) => {
                  // If item has modelType, render CountModelSideMenuItem
                  if (item.modelType && item.countQuery) {
                    return (
                      <CountModelSideMenuItem
                        key={`section-${sectionIndex}-count-item-${itemIndex}`}
                        link={item.link}
                        activeRoute={item.activeRoute}
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
                      activeRoute={item.activeRoute}
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
              activeRoute={item.activeRoute}
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
              activeRoute={item.activeRoute}
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
        <button
          type="button"
          onClick={() => {
            setIsMobileMenuOpen(!isMobileMenuVisible);
          }}
          className={`
            w-full flex items-center justify-between
            px-3 py-2.5
            bg-white rounded-xl
            border border-gray-200
            shadow-sm
            transition-all duration-200
            ${isMobileMenuVisible ? "ring-2 ring-indigo-100 border-indigo-200" : "hover:border-gray-300"}
          `}
          aria-expanded={isMobileMenuVisible}
          aria-label={
            isMobileMenuVisible
              ? translateString("Close navigation menu") ||
                "Close navigation menu"
              : translateString("Open navigation menu") ||
                "Open navigation menu"
          }
          data-testid="mobile-sidemenu-toggle"
        >
          <div className="flex items-center gap-2 min-w-0">
            {activeItem.icon && (
              <div className="flex items-center justify-center w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 flex-shrink-0">
                <Icon icon={activeItem.icon} className="h-3.5 w-3.5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs text-gray-400 font-medium">
                {translateString("Navigate to")}
              </p>
              <h3 className="text-sm font-semibold text-gray-900 truncate">
                {displayText}
              </h3>
            </div>
          </div>
          <div
            className={`
              flex items-center justify-center
              w-6 h-6 rounded-md
              transition-all duration-200
              ${isMobileMenuVisible ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-500"}
            `}
          >
            <Icon
              icon={isMobileMenuVisible ? IconProp.Close : IconProp.Bars3}
              className="h-3.5 w-3.5"
            />
          </div>
        </button>

        {/* Mobile collapsible menu with overlay */}
        {isMobileMenuVisible && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-200"
              onClick={() => {
                setIsMobileMenuOpen(false);
              }}
            />

            {/* Menu Panel */}
            <div
              ref={mobileMenuRef}
              className={`
                relative z-50
                mt-2
                bg-white rounded-xl
                border border-gray-200
                shadow-xl
                overflow-hidden
                animate-in slide-in-from-top-2 fade-in duration-200
              `}
              role="navigation"
              aria-label="Main navigation"
            >
              {/* Optional Header */}
              {props.header && (
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/50">
                  {props.header}
                </div>
              )}

              {/* Menu Items */}
              <nav
                className="p-2 max-h-[60vh] overflow-y-auto"
                onClick={handleMenuItemClick}
              >
                <div className="space-y-0.5">{renderMenuContent()}</div>
              </nav>

              {/* Optional Footer */}
              {props.footer && (
                <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50">
                  {props.footer}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // Desktop view
  return (
    <aside
      className={`hidden md:block w-52 lg:w-60 flex-shrink-0 mb-10 ${props.className || ""}`}
      role="navigation"
      aria-label="Main navigation"
    >
      {/*
       * Stick below the app header, not at the top of the viewport. The header
       * is sticky too, so a plain `top-6` slides the first menu items behind it
       * as soon as the page scrolls. --app-header-height is measured and
       * published by MasterPage; the 0px fallback keeps this correct on pages
       * that render without a sticky header.
       */}
      <div
        className="sticky"
        style={{ top: "calc(var(--app-header-height, 0px) + 1.5rem)" }}
      >
        <div
          className={`
            flex flex-col
            bg-white rounded-2xl
            border border-gray-200/80
            shadow-sm
            overflow-hidden
          `}
          /*
           * Menus longer than the viewport (the Kubernetes cluster menu, for
           * one) would otherwise get pushed back up behind the header near the
           * bottom of a long page. Cap the card to the space left under the
           * header and let the item list scroll inside it instead.
           */
          style={{
            maxHeight: "calc(100vh - var(--app-header-height, 0px) - 3rem)",
          }}
        >
          {/* Optional Header */}
          {props.header && (
            <div className="flex-shrink-0 px-3 py-3 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white">
              {props.header}
            </div>
          )}

          {/* Menu Content */}
          <nav className="p-2 min-h-0 overflow-y-auto">
            <div className="space-y-0.5">{renderMenuContent()}</div>
          </nav>

          {/* Optional Footer */}
          {props.footer && (
            <div className="flex-shrink-0 px-3 py-2 border-t border-gray-100 bg-gray-50/50">
              {props.footer}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default SideMenu;
