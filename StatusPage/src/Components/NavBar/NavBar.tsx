import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import NavBar from "Common/UI/Components/Navbar/NavBar";
import NavBarItem from "Common/UI/Components/Navbar/NavBarItem";
import Navigation from "Common/UI/Utils/Navigation";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";

export interface ComponentProps {
  show: boolean;
  isPreview: boolean;
  isPrivateStatusPage: boolean;
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
  enableSlackSubscribers?: boolean;
  showIncidentsOnStatusPage: boolean;
  showAnnouncementsOnStatusPage: boolean;
  showScheduledMaintenanceEventsOnStatusPage: boolean;
  showSubscriberPageOnStatusPage: boolean;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
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
          "[data-mobile-nav-menu]",
        );
        const mobileToggle: Element | null = document.querySelector(
          "[data-mobile-nav-toggle]",
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
  }> = [];

  // Overview item
  const overviewRoute: Route = RouteUtil.populateRouteParams(
    props.isPreview
      ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
      : (RouteMap[PageMap.OVERVIEW] as Route),
  );
  navItems.push({
    id: "overview-nav-bar-item",
    title: "Overview",
    icon: IconProp.CheckCircle,
    route: overviewRoute,
    isActive: Navigation.isOnThisPage(overviewRoute),
  });

  // Incidents item
  if (props.showIncidentsOnStatusPage) {
    const incidentsRoute: Route = RouteUtil.populateRouteParams(
      props.isPreview
        ? (RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route)
        : (RouteMap[PageMap.INCIDENT_LIST] as Route),
    );
    navItems.push({
      id: "incidents-nav-bar-item",
      title: "Incidents",
      icon: IconProp.Alert,
      route: incidentsRoute,
      isActive: Navigation.isOnThisPage(incidentsRoute),
    });
  }

  // Announcements item
  if (props.showAnnouncementsOnStatusPage) {
    const announcementsRoute: Route = RouteUtil.populateRouteParams(
      props.isPreview
        ? (RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_LIST] as Route)
        : (RouteMap[PageMap.ANNOUNCEMENT_LIST] as Route),
    );
    navItems.push({
      id: "announcements-nav-bar-item",
      title: "Announcements",
      icon: IconProp.Announcement,
      route: announcementsRoute,
      isActive: Navigation.isOnThisPage(announcementsRoute),
    });
  }

  // Scheduled Events item
  if (props.showScheduledMaintenanceEventsOnStatusPage) {
    const scheduledEventsRoute: Route = RouteUtil.populateRouteParams(
      props.isPreview
        ? (RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_LIST] as Route)
        : (RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route),
    );
    navItems.push({
      id: "scheduled-events-nav-bar-item",
      title: "Scheduled Events",
      icon: IconProp.Clock,
      route: scheduledEventsRoute,
      isActive: Navigation.isOnThisPage(scheduledEventsRoute),
    });
  }

  // Subscribe item
  if (
    props.showSubscriberPageOnStatusPage &&
    (props.enableEmailSubscribers ||
      props.enableSMSSubscribers ||
      props.enableSlackSubscribers)
  ) {
    const subscribeRoute: Route = RouteUtil.populateRouteParams(
      props.isPreview
        ? (RouteMap[PageMap.PREVIEW_SUBSCRIBE_EMAIL] as Route)
        : (RouteMap[PageMap.SUBSCRIBE_EMAIL] as Route),
    );
    navItems.push({
      id: "subscribe-nav-bar-item",
      title: "Subscribe",
      icon: IconProp.Email,
      route: subscribeRoute,
      isActive: Navigation.isOnThisPage(subscribeRoute),
    });
  }

  // Logout item
  if (props.isPrivateStatusPage) {
    const logoutRoute: Route = RouteUtil.populateRouteParams(
      props.isPreview
        ? (RouteMap[PageMap.PREVIEW_LOGOUT] as Route)
        : (RouteMap[PageMap.LOGOUT] as Route),
    );
    navItems.push({
      id: "logout-nav-bar-item",
      title: "Logout",
      icon: IconProp.Logout,
      route: logoutRoute,
      isActive: Navigation.isOnThisPage(logoutRoute),
    });
  }

  // Find the currently active item
  const activeItem: any =
    navItems.find((item: any) => {
      return item.isActive;
    }) || navItems[0];

  const spaceAroundClassName: string = "justify-between";

  if (isMobile && navItems.length > 0 && activeItem) {
    return (
      <div className="relative md:hidden">
        <NavBar
          className={`bg-white text-center ${spaceAroundClassName} py-2 mt-5 rounded-lg shadow px-5`}
        >
          {/* Mobile: Show only active item and hamburger menu */}
          <div className="flex items-center justify-between w-full">
            <NavBarItem
              id={activeItem.id}
              title={activeItem.title}
              icon={activeItem.icon}
              exact={true}
              route={undefined}
              onClick={() => {
                return setIsMobileMenuOpen(!isMobileMenuOpen);
              }}
            />

            <Button
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                return setIsMobileMenuOpen(!isMobileMenuOpen);
              }}
              className="ml-2 p-2"
              icon={isMobileMenuOpen ? IconProp.Close : IconProp.Bars3}
              dataTestId="mobile-nav-toggle"
              data-mobile-nav-toggle
            />
          </div>
        </NavBar>

        {/* Mobile dropdown menu */}
        {isMobileMenuOpen && (
          <div
            className="absolute top-full left-0 right-0 z-50 mt-1 animate-in slide-in-from-top-2 duration-200"
            data-mobile-nav-menu
          >
            <NavBar className="bg-white rounded-lg shadow-lg px-5 py-2 space-y-1 border border-gray-200">
              {navItems.map((item: any) => {
                return (
                  <div key={item.id} className="block">
                    <NavBarItem
                      id={item.id}
                      title={item.title}
                      icon={item.icon}
                      exact={true}
                      route={item.route}
                      onClick={() => {
                        return setIsMobileMenuOpen(false);
                      }}
                      isRenderedOnMobile={true}
                    />
                  </div>
                );
              })}
            </NavBar>
          </div>
        )}
      </div>
    );
  }

  // Desktop: Show all items as before
  return (
    <NavBar
      className={`bg-white flex text-center ${spaceAroundClassName} py-2 mt-5 rounded-lg shadow px-5 hidden md:flex`}
    >
      <NavBarItem
        id="overview-nav-bar-item"
        title="Overview"
        icon={IconProp.CheckCircle}
        exact={true}
        route={RouteUtil.populateRouteParams(
          props.isPreview
            ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
            : (RouteMap[PageMap.OVERVIEW] as Route),
        )}
      ></NavBarItem>

      {props.showIncidentsOnStatusPage ? (
        <NavBarItem
          id="incidents-nav-bar-item"
          title="Incidents"
          icon={IconProp.Alert}
          exact={true}
          route={RouteUtil.populateRouteParams(
            props.isPreview
              ? (RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route)
              : (RouteMap[PageMap.INCIDENT_LIST] as Route),
          )}
        ></NavBarItem>
      ) : (
        <></>
      )}

      {props.showAnnouncementsOnStatusPage ? (
        <NavBarItem
          id="announcements-nav-bar-item"
          title="Announcements"
          icon={IconProp.Announcement}
          exact={true}
          route={RouteUtil.populateRouteParams(
            props.isPreview
              ? (RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_LIST] as Route)
              : (RouteMap[PageMap.ANNOUNCEMENT_LIST] as Route),
          )}
        ></NavBarItem>
      ) : (
        <></>
      )}

      {props.showScheduledMaintenanceEventsOnStatusPage ? (
        <NavBarItem
          id="scheduled-events-nav-bar-item"
          title="Scheduled Events"
          icon={IconProp.Clock}
          exact={true}
          route={RouteUtil.populateRouteParams(
            props.isPreview
              ? (RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_LIST] as Route)
              : (RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route),
          )}
        ></NavBarItem>
      ) : (
        <></>
      )}

      {props.showSubscriberPageOnStatusPage &&
      (props.enableEmailSubscribers ||
        props.enableSMSSubscribers ||
        props.enableSlackSubscribers) ? (
        <NavBarItem
          id="subscribe-nav-bar-item"
          title="Subscribe"
          icon={IconProp.Email}
          exact={true}
          route={RouteUtil.populateRouteParams(
            props.isPreview
              ? (RouteMap[PageMap.PREVIEW_SUBSCRIBE_EMAIL] as Route)
              : (RouteMap[PageMap.SUBSCRIBE_EMAIL] as Route),
          )}
        ></NavBarItem>
      ) : (
        <></>
      )}

      {props.isPrivateStatusPage ? (
        <NavBarItem
          id="logout-nav-bar-item"
          title="Logout"
          icon={IconProp.Logout}
          exact={true}
          route={RouteUtil.populateRouteParams(
            props.isPreview
              ? (RouteMap[PageMap.PREVIEW_LOGOUT] as Route)
              : (RouteMap[PageMap.LOGOUT] as Route),
          )}
        ></NavBarItem>
      ) : (
        <></>
      )}
    </NavBar>
  );
};

export default DashboardNavbar;
