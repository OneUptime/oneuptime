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
import Icon, { ThickProp } from "../Icon/Icon";

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
    "bg-white flex text-center items-center lg:py-2 hidden md:flex";

  // Find active item in more menu items (needed for breadcrumb)
  const activeMoreItem: MoreMenuItem | undefined = props.moreMenuItems?.find(
    (item: MoreMenuItem) => {
      const routeToCheck: Route = item.activeRoute || item.route;
      return Navigation.isStartWith(routeToCheck);
    },
  );

  // Group items by category for the menu
  const categories: Map<string, MoreMenuItem[]> = new Map();
  props.moreMenuItems?.forEach((item: MoreMenuItem) => {
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

  // Find Home item from navItems
  const homeItem: NavItem | undefined = props.items.find((item: NavItem) => {
    return item.title === "Home";
  });
  const otherNavItems: NavItem[] = props.items.filter((item: NavItem) => {
    return item.title !== "Home";
  });

  return (
    <nav
      className={props.rightElement ? `flex justify-between items-center` : ""}
    >
      <div data-testid="nav-children" className={className}>
        {/* Combined Home > Product breadcrumb */}
        <div className="flex items-center">
          {/* Home link */}
          {homeItem && (
            <NavBarItem
              key={homeItem.id}
              id={homeItem.id}
              title={homeItem.title}
              icon={homeItem.icon}
              activeRoute={homeItem.activeRoute}
              route={homeItem.route}
              exact={true}
            />
          )}

          {/* Separator and active product */}
          {activeMoreItem && (
            <>
              <span className="text-gray-400 mx-1">/</span>
              <div
                onMouseOver={showMoreMenu}
                onMouseLeave={hideMoreMenu}
                className="relative"
              >
                <button
                  onClick={showMoreMenu}
                  onMouseOver={showMoreMenu}
                  className="bg-gray-100 text-gray-900 hover:bg-gray-200 rounded-md py-2 px-3 inline-flex items-center text-sm font-medium transition-colors cursor-pointer"
                >
                  <Icon
                    icon={activeMoreItem.icon}
                    className="mr-1.5 h-4 w-4"
                    thick={ThickProp.Thick}
                  />
                  <span>{activeMoreItem.title}</span>
                  <Icon
                    icon={IconProp.ChevronDown}
                    className="ml-1.5 h-3 w-3 text-gray-500"
                  />
                </button>
                {isMoreMenuVisible && (
                  <NavBarMenu
                    sections={sections}
                    footer={props.moreMenuFooter}
                  />
                )}
              </div>
            </>
          )}

          {/* Show Products button when no product is selected */}
          {!activeMoreItem &&
            props.moreMenuItems &&
            props.moreMenuItems.length > 0 && (
              <>
                <span className="text-gray-400 mx-1">/</span>
                <div
                  onMouseOver={showMoreMenu}
                  onMouseLeave={hideMoreMenu}
                  className="relative"
                >
                  <button
                    onClick={showMoreMenu}
                    onMouseOver={showMoreMenu}
                    className="text-gray-500 hover:bg-gray-50 hover:text-gray-900 rounded-md py-2 px-3 inline-flex items-center text-sm font-medium transition-colors cursor-pointer"
                  >
                    <Icon
                      icon={IconProp.Squares}
                      className="mr-1.5 h-4 w-4"
                      thick={ThickProp.Thick}
                    />
                    <span>{props.moreMenuTitle || "Products"}</span>
                    <Icon
                      icon={IconProp.ChevronDown}
                      className="ml-1.5 h-3 w-3 text-gray-400"
                    />
                  </button>
                  {isMoreMenuVisible && (
                    <NavBarMenu
                      sections={sections}
                      footer={props.moreMenuFooter}
                    />
                  )}
                </div>
              </>
            )}
        </div>

        {/* Other nav items */}
        {otherNavItems.map((item: NavItem) => {
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
