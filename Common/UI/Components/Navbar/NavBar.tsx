import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import NavBarItem from "./NavBarItem";
import NavBarMenu from "./NavBarMenu";
import NavBarMenuItem from "./NavBarMenuItem";
import Button, { ButtonStyleType } from "../Button/Button";
import Navigation from "../../Utils/Navigation";
import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";

export interface NavItem {
  id: string;
  title: string;
  icon: IconProp;
  route: Route;
  activeRoute?: Route | undefined;
  exact?: boolean | undefined;
  description?: string | undefined;
}

export interface MoreMenuItem {
  title: string;
  description: string;
  route: Route;
  icon: IconProp;
  iconColor?: string; // Tailwind color name like "blue", "purple", "amber"
  category?: string; // Category for grouping items (e.g., "Essentials", "Observability")
  activeRoute?: Route | undefined; // Route to check for active state
}

export interface ComponentProps {
  items?: NavItem[];
  rightElement?: NavItem;
  moreMenuItems?: MoreMenuItem[];
  moreMenuTitle?: string; // Title for the more menu (default: "More")
  moreMenuFooter?: {
    title: string;
    description: string;
    link: URL;
  };
  className?: string;
  // Legacy support for children-based usage
  children?: ReactElement | Array<ReactElement>;
}

const Navbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [isMobileMenuVisible, setIsMobileMenuVisible] =
    useState<boolean>(false);
  const [isMoreMenuVisible, setIsMoreMenuVisible] = useState<boolean>(false);
  const [moreMenuTimeout, setMoreMenuTimeout] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);

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
      return window.removeEventListener("resize", checkMobile);
    };
  }, []);

  // More menu functions
  const hideMoreMenu: () => void = (): void => {
    if (moreMenuTimeout) {
      clearTimeout(moreMenuTimeout);
      setMoreMenuTimeout(null);
    }

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setIsMoreMenuVisible(false);
    }, 500);

    setMoreMenuTimeout(timeout);
  };

  const forceHideMoreMenu: () => void = (): void => {
    if (moreMenuTimeout) {
      clearTimeout(moreMenuTimeout);
      setMoreMenuTimeout(null);
    }

    setIsMoreMenuVisible(false);
  };

  const showMoreMenu: () => void = (): void => {
    if (moreMenuTimeout) {
      clearTimeout(moreMenuTimeout);
    }
    setIsMoreMenuVisible(true);
  };

  // Legacy support: if children are provided, render the old way
  if (props.children) {
    const className: string =
      props.className || "flex text-center lg:space-x-8 lg:py-2 bg-white ";

    return (
      <nav className={props.rightElement ? `flex justify-between` : ""}>
        <div data-testid="nav-children" className={className}>
          {props.children}
        </div>
        {props.rightElement && (
          <div className={className}>
            <NavBarItem
              title={props.rightElement.title}
              icon={props.rightElement.icon}
              route={props.rightElement.route}
              activeRoute={props.rightElement.activeRoute}
              exact={props.rightElement.exact ?? false}
            />
          </div>
        )}
      </nav>
    );
  }

  // New props-based implementation
  if (!props.items || props.items.length === 0) {
    return <></>;
  }

  // Build all nav items including more menu items for mobile
  const allNavItems: Array<any> = [...props.items];
  if (props.moreMenuItems) {
    allNavItems.push(
      ...props.moreMenuItems.map((item: any) => {
        return {
          id: `more-${item.title.toLowerCase().replace(/\s+/g, "-")}`,
          title: item.title,
          icon: item.icon,
          route: item.route,
          description: item.description,
        };
      }),
    );
  }

  // Add right element to mobile menu
  if (props.rightElement) {
    allNavItems.push({
      id: `right-${props.rightElement.title.toLowerCase().replace(/\s+/g, "-")}`,
      title: props.rightElement.title,
      icon: props.rightElement.icon,
      route: props.rightElement.route,
      activeRoute: props.rightElement.activeRoute,
      exact: props.rightElement.exact,
    });
  }

  // Find the currently active item
  const activeItem: any =
    allNavItems.find((item: any) => {
      const routeToCheck: any = item.activeRoute || item.route;
      return item.exact
        ? Navigation.isOnThisPage(routeToCheck)
        : Navigation.isStartWith(routeToCheck);
    }) || allNavItems[0];

  // Mobile view
  if (isMobile && activeItem) {
    return (
      <div className="relative md:hidden">
        <nav className="bg-white text-center justify-between py-2 mt-5">
          {/* Mobile: Show only active item and hamburger menu */}
          <div className="flex items-center justify-between w-full">
            <NavBarItem
              id={activeItem.id}
              title={activeItem.title}
              icon={activeItem.icon}
              exact={true}
              route={undefined}
              onClick={() => {
                return setIsMobileMenuOpen(!isMobileMenuVisible);
              }}
              isRenderedOnMobile={true}
            />

            <Button
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                return setIsMobileMenuOpen(!isMobileMenuVisible);
              }}
              className="ml-2 p-2"
              icon={isMobileMenuOpen ? IconProp.Close : IconProp.Bars3}
              dataTestId="mobile-nav-toggle"
            />
          </div>
        </nav>

        {/* Mobile dropdown menu */}
        {isMobileMenuOpen && (
          <div
            ref={mobileMenuRef}
            className="absolute top-full left-0 right-0 z-50 mt-1 transition-all duration-200 ease-in-out"
          >
            <nav className="bg-white rounded-lg shadow-lg px-3 py-3 space-y-1 border border-gray-200">
              {allNavItems.map((item: any) => {
                return (
                  <div key={item.id} className="block w-full">
                    <NavBarItem
                      id={item.id}
                      title={item.title}
                      icon={item.icon}
                      exact={item.exact ?? false}
                      route={item.route}
                      activeRoute={item.activeRoute}
                      onClick={() => {
                        return setIsMobileMenuOpen(false);
                      }}
                      isRenderedOnMobile={true}
                    />
                  </div>
                );
              })}
            </nav>
          </div>
        )}
      </div>
    );
  }

  // Desktop view
  const className: string =
    props.className ||
    "bg-white flex text-center lg:space-x-8 lg:py-2 hidden md:flex";

  return (
    <nav className={props.rightElement ? `flex justify-between` : ""}>
      <div data-testid="nav-children" className={className}>
        {props.items.map((item: any) => {
          return (
            <NavBarItem
              key={item.id}
              id={item.id}
              title={item.title}
              icon={item.icon}
              activeRoute={item.activeRoute}
              route={item.route}
              exact={item.exact ?? false}
            />
          );
        })}

        {/* Products menu for desktop - shows active product if one is selected */}
        {props.moreMenuItems && props.moreMenuItems.length > 0 && (() => {
          // Find active item in more menu items
          const activeMoreItem: MoreMenuItem | undefined = props.moreMenuItems.find((item: MoreMenuItem) => {
            const routeToCheck: Route = item.activeRoute || item.route;
            return Navigation.isStartWith(routeToCheck);
          });

          // Group items by category
          const categories: Map<string, MoreMenuItem[]> = new Map();
          props.moreMenuItems.forEach((item: MoreMenuItem) => {
            const cat: string = item.category || "Other";
            if (!categories.has(cat)) {
              categories.set(cat, []);
            }
            categories.get(cat)!.push(item);
          });

          // Convert to sections array for NavBarMenu
          const sections: Array<{ title: string; items: Array<ReactElement> }> = [];
          categories.forEach((items: MoreMenuItem[], category: string) => {
            sections.push({
              title: category,
              items: items.map((item: MoreMenuItem) => {
                return (
                  <NavBarMenuItem
                    key={item.title}
                    title={item.title}
                    description={item.description}
                    route={item.route}
                    icon={item.icon}
                    iconColor={item.iconColor}
                    onClick={forceHideMoreMenu}
                  />
                );
              }),
            });
          });

          const menuTitle: string = props.moreMenuTitle || "Products";

          return (
            <>
              {/* Show active product as a separate nav item */}
              {activeMoreItem && (
                <NavBarItem
                  id={`active-product-${activeMoreItem.title.toLowerCase().replace(/\s+/g, "-")}`}
                  title={activeMoreItem.title}
                  icon={activeMoreItem.icon}
                  route={activeMoreItem.route}
                  activeRoute={activeMoreItem.activeRoute || activeMoreItem.route}
                  exact={false}
                />
              )}

              {/* Products dropdown menu */}
              <NavBarItem
                title={menuTitle}
                icon={IconProp.Squares}
                onMouseLeave={hideMoreMenu}
                onMouseOver={showMoreMenu}
                onClick={showMoreMenu}
              >
                <div onMouseOver={showMoreMenu} onMouseLeave={hideMoreMenu}>
                  {isMoreMenuVisible && (
                    <NavBarMenu 
                      sections={sections}
                      footer={props.moreMenuFooter}
                    />
                  )}
                </div>
              </NavBarItem>
            </>
          );
        })()}
      </div>

      {props.rightElement && (
        <div className={className}>
          <NavBarItem
            title={props.rightElement.title}
            icon={props.rightElement.icon}
            route={props.rightElement.route}
            activeRoute={props.rightElement.activeRoute}
            exact={props.rightElement.exact ?? false}
          />
        </div>
      )}
    </nav>
  );
};

export default Navbar;
