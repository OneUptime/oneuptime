import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import NavBar from "Common/UI/Components/Navbar/NavBar";
import NavBarItem from "Common/UI/Components/Navbar/NavBarItem";
import NavBarMenu from "Common/UI/Components/Navbar/NavBarMenu";
import NavBarMenuItem from "Common/UI/Components/Navbar/NavBarMenuItem";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Navigation from "Common/UI/Utils/Navigation";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import React, { FunctionComponent, ReactElement, useState, useEffect } from "react";

export interface ComponentProps {
  show: boolean;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isComponentVisible, setIsComponentVisible] = useState<boolean>(false);
  const [moreMenuTimeout, setMoreMenuTimeout] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  
  // Use the existing outside click hook for mobile menu
  const { 
    ref: mobileMenuRef, 
    isComponentVisible: isMobileMenuOpen, 
    setIsComponentVisible: setIsMobileMenuOpen 
  } = useComponentOutsideClick(false);

  // Check if we're on mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const hideMoreMenu: VoidFunction = (): void => {
    if (moreMenuTimeout) {
      clearTimeout(moreMenuTimeout);
      setMoreMenuTimeout(null);
    }

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setIsComponentVisible(false);
    }, 500);

    setMoreMenuTimeout(timeout);
  };

  const forceHideMoreMenu: VoidFunction = (): void => {
    if (moreMenuTimeout) {
      clearTimeout(moreMenuTimeout);
      setMoreMenuTimeout(null);
    }

    setIsComponentVisible(false);
  };

  const showMoreMenu: VoidFunction = (): void => {
    if (moreMenuTimeout) {
      clearTimeout(moreMenuTimeout);
    }
    setIsComponentVisible(true);
  };

  if (!props.show) {
    return <></>;
  }

  // Build array of all visible nav items
  const navItems: Array<{
    id: string;
    title: string;
    icon: IconProp;
    route: Route;
    isActive: boolean;
    description?: string;
  }> = [];

  // Home item
  const homeRoute = RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route);
  navItems.push({
    id: "home-nav-bar-item",
    title: "Home",
    icon: IconProp.Home,
    route: homeRoute,
    isActive: Navigation.isOnThisPage(homeRoute),
  });

  // Monitors item
  const monitorsRoute = RouteUtil.populateRouteParams(RouteMap[PageMap.MONITORS] as Route);
  navItems.push({
    id: "monitors-nav-bar-item",
    title: "Monitors",
    icon: IconProp.AltGlobe,
    route: monitorsRoute,
    isActive: Navigation.isOnThisPage(monitorsRoute),
  });

  // Alerts item
  const alertsRoute = RouteUtil.populateRouteParams(RouteMap[PageMap.ALERTS] as Route);
  navItems.push({
    id: "alerts-nav-bar-item",
    title: "Alerts",
    icon: IconProp.ExclaimationCircle,
    route: alertsRoute,
    isActive: Navigation.isOnThisPage(alertsRoute),
  });

  // Incidents item
  const incidentsRoute = RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENTS] as Route);
  navItems.push({
    id: "incidents-nav-bar-item",
    title: "Incidents",
    icon: IconProp.Alert,
    route: incidentsRoute,
    isActive: Navigation.isOnThisPage(incidentsRoute),
  });

  // Telemetry and APM item
  const telemetryRoute = RouteUtil.populateRouteParams(RouteMap[PageMap.TELEMETRY] as Route);
  navItems.push({
    id: "telemetry-nav-bar-item",
    title: "Telemetry and APM",
    icon: IconProp.Cube,
    route: telemetryRoute,
    isActive: Navigation.isOnThisPage(telemetryRoute),
  });

  // Status Pages item
  const statusPagesRoute = RouteUtil.populateRouteParams(RouteMap[PageMap.STATUS_PAGES] as Route);
  navItems.push({
    id: "status-pages-nav-bar-item",
    title: "Status Pages",
    icon: IconProp.CheckCircle,
    route: statusPagesRoute,
    isActive: Navigation.isOnThisPage(statusPagesRoute),
  });

  // Dashboards item
  const dashboardsRoute = RouteUtil.populateRouteParams(RouteMap[PageMap.DASHBOARDS] as Route);
  navItems.push({
    id: "dashboards-nav-bar-item",
    title: "Dashboards",
    icon: IconProp.Window,
    route: dashboardsRoute,
    isActive: Navigation.isOnThisPage(dashboardsRoute),
  });

  // More menu items (flattened for mobile)
  const moreMenuItems = [
    {
      id: "reliability-copilot-nav-bar-item",
      title: "Reliability Copilot",
      icon: IconProp.Bolt,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.RELIABILITY_COPILOT] as Route),
      isActive: Navigation.isOnThisPage(RouteUtil.populateRouteParams(RouteMap[PageMap.RELIABILITY_COPILOT] as Route)),
      description: "Fix and improve your code automatically.",
    },
    {
      id: "service-catalog-nav-bar-item",
      title: "Service Catalog",
      icon: IconProp.SquareStack,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICE_CATALOG] as Route),
      isActive: Navigation.isOnThisPage(RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICE_CATALOG] as Route)),
      description: "Manage your services and their dependencies.",
    },
    {
      id: "scheduled-maintenance-nav-bar-item",
      title: "Scheduled Maintenance",
      icon: IconProp.Clock,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route),
      isActive: Navigation.isOnThisPage(RouteUtil.populateRouteParams(RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route)),
      description: "Manage your scheduled maintenance events.",
    },
    {
      id: "on-call-duty-nav-bar-item",
      title: "On-Call Duty",
      icon: IconProp.Call,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.ON_CALL_DUTY] as Route),
      isActive: Navigation.isOnThisPage(RouteUtil.populateRouteParams(RouteMap[PageMap.ON_CALL_DUTY] as Route)),
      description: "Manage your on-call schedules, escalations and more.",
    },
    {
      id: "workflows-nav-bar-item",
      title: "Workflows",
      icon: IconProp.Workflow,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.WORKFLOWS] as Route),
      isActive: Navigation.isOnThisPage(RouteUtil.populateRouteParams(RouteMap[PageMap.WORKFLOWS] as Route)),
      description: "Integrate OneUptime with the rest of your ecosystem.",
    },
    {
      id: "project-settings-nav-bar-item",
      title: "Project Settings",
      icon: IconProp.Settings,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
      isActive: Navigation.isOnThisPage(RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route)),
      description: "Review or manage settings related to this project here.",
    },
  ];

  // Add more menu items to nav items for mobile
  navItems.push(...moreMenuItems);

  // Add User Settings for mobile dropdown
  const userSettingsRoute = RouteUtil.populateRouteParams(RouteMap[PageMap.USER_SETTINGS] as Route);
  navItems.push({
    id: "user-settings-nav-bar-item",
    title: "User Settings",
    icon: IconProp.User,
    route: userSettingsRoute,
    isActive: Navigation.isOnThisPage(userSettingsRoute),
  });

  // Find the currently active item
  const activeItem = navItems.find(item => item.isActive) || navItems[0];

  // Mobile view
  if (isMobile && navItems.length > 0 && activeItem) {
    return (
      <div className="relative md:hidden">
        <NavBar className="bg-white text-center justify-between py-2 mt-5 rounded-lg shadow px-5">
          {/* Mobile: Show only active item and hamburger menu */}
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center">
              <NavBarItem
                id={activeItem.id}
                title={activeItem.title}
                icon={activeItem.icon}
                exact={true}
                route={undefined}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                isRenderedOnMobile={true}
              />
              
              <Button
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="ml-2 p-2"
                icon={isMobileMenuOpen ? IconProp.Close : IconProp.Bars3}
                dataTestId="mobile-nav-toggle"
              />
            </div>
            
            <NavBarItem
              title="User Settings"
              route={RouteUtil.populateRouteParams(
                RouteMap[PageMap.USER_SETTINGS] as Route,
              )}
              activeRoute={RouteMap[PageMap.USER_SETTINGS]}
              icon={IconProp.User}
              isRenderedOnMobile={true}
            />
          </div>
        </NavBar>

        {/* Mobile dropdown menu */}
        {isMobileMenuOpen && (
          <div 
            ref={mobileMenuRef}
            className="absolute top-full left-0 right-0 z-50 mt-1 transition-all duration-200 ease-in-out"
          >
            <NavBar className="bg-white rounded-lg shadow-lg px-3 py-3 space-y-1 border border-gray-200">
              {navItems.map((item) => (
                <div key={item.id} className="block w-full">
                  <NavBarItem
                    id={item.id}
                    title={item.title}
                    icon={item.icon}
                    exact={true}
                    route={item.route}
                    onClick={() => setIsMobileMenuOpen(false)}
                    isRenderedOnMobile={true}
                  />
                </div>
              ))}
            </NavBar>
          </div>
        )}
      </div>
    );
  }

  // Desktop view
  return (
    <NavBar
      className="bg-white flex text-center lg:space-x-8 lg:py-2 hidden md:flex"
      rightElement={
        <NavBarItem
          title="User Settings"
          route={RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_SETTINGS] as Route,
          )}
          activeRoute={RouteMap[PageMap.USER_SETTINGS]}
          icon={IconProp.User}
        />
      }
    >
      <NavBarItem
        title="Home"
        icon={IconProp.Home}
        activeRoute={RouteMap[PageMap.HOME]}
        route={RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route)}
      ></NavBarItem>

      <NavBarItem
        title="Monitors"
        activeRoute={RouteMap[PageMap.MONITORS]}
        route={RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITORS] as Route,
        )}
        icon={IconProp.AltGlobe}
      ></NavBarItem>

      <NavBarItem
        title="Alerts"
        activeRoute={RouteMap[PageMap.ALERTS]}
        route={RouteUtil.populateRouteParams(RouteMap[PageMap.ALERTS] as Route)}
        icon={IconProp.ExclaimationCircle}
      ></NavBarItem>

      <NavBarItem
        title="Incidents"
        activeRoute={RouteMap[PageMap.INCIDENTS]}
        route={RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENTS] as Route,
        )}
        icon={IconProp.Alert}
      ></NavBarItem>

      <NavBarItem
        title="Telemetry and APM"
        activeRoute={RouteMap[PageMap.TELEMETRY]}
        icon={IconProp.Cube}
        route={RouteUtil.populateRouteParams(
          RouteMap[PageMap.TELEMETRY] as Route,
        )}
      ></NavBarItem>

      <NavBarItem
        title="Status Pages"
        activeRoute={RouteMap[PageMap.STATUS_PAGES]}
        icon={IconProp.CheckCircle}
        route={RouteUtil.populateRouteParams(
          RouteMap[PageMap.STATUS_PAGES] as Route,
        )}
      ></NavBarItem>

      <NavBarItem
        title="Dashboards"
        activeRoute={RouteMap[PageMap.DASHBOARDS]}
        icon={IconProp.Window}
        route={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DASHBOARDS] as Route,
        )}
      ></NavBarItem>

      <NavBarItem
        title="More"
        icon={IconProp.More}
        onMouseLeave={() => {
          hideMoreMenu();
        }}
        onMouseOver={() => {
          showMoreMenu();
        }}
        onClick={() => {
          showMoreMenu();
        }}
      >
        <div
          onMouseOver={() => {
            showMoreMenu();
          }}
          onMouseLeave={() => {
            hideMoreMenu();
          }}
        >
          {isComponentVisible && (
            <NavBarMenu
              footer={{
                title: "Report a bug or request a feature.",
                description:
                  "We embrace open source! Please report any issue you find and make feature requests on GitHub.",
                link: URL.fromString(
                  "https://github.com/OneUptime/oneuptime/issues/new/choose",
                ),
              }}
            >
              <NavBarMenuItem
                title="Reliability Copilot"
                description="Fix and improve your code automatically."
                route={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.RELIABILITY_COPILOT] as Route,
                )}
                icon={IconProp.Bolt}
                onClick={() => {
                  forceHideMoreMenu();
                }}
              />

              <NavBarMenuItem
                title="Service Catalog"
                description="Manage your services and their dependencies."
                route={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SERVICE_CATALOG] as Route,
                )}
                icon={IconProp.SquareStack}
                onClick={() => {
                  forceHideMoreMenu();
                }}
              />

              <NavBarMenuItem
                title="Scheduled Maintenance"
                description="Manage your scheduled maintenance events."
                route={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
                )}
                icon={IconProp.Clock}
                onClick={() => {
                  forceHideMoreMenu();
                }}
              />

              <NavBarMenuItem
                title="On-Call Duty"
                description="Manage your on-call schedules, escalations and more."
                route={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.ON_CALL_DUTY] as Route,
                )}
                icon={IconProp.Call}
                onClick={() => {
                  forceHideMoreMenu();
                }}
              />

              <NavBarMenuItem
                title="Workflows"
                description="Integrate OneUptime with the rest of your ecosystem."
                route={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.WORKFLOWS] as Route,
                )}
                icon={IconProp.Workflow}
                onClick={() => {
                  forceHideMoreMenu();
                }}
              />
              <NavBarMenuItem
                title="Project Settings"
                description="Review or manage settings related to this project here."
                route={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SETTINGS] as Route,
                )}
                icon={IconProp.Settings}
                onClick={() => {
                  forceHideMoreMenu();
                }}
              />
              
            </NavBarMenu>
          )}
        </div>
      </NavBarItem>
    </NavBar>
  );
};

export default DashboardNavbar;
