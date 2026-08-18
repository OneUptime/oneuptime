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
  useRef,
} from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  show: boolean;
  isPreview: boolean;
  isPrivateStatusPage: boolean;
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
  enableSlackSubscribers?: boolean;
  enableMicrosoftTeamsSubscribers?: boolean;
  enableWebhookSubscribers?: boolean;
  showIncidentsOnStatusPage: boolean;
  showAnnouncementsOnStatusPage: boolean;
  showScheduledMaintenanceEventsOnStatusPage: boolean;
  showSubscriberPageOnStatusPage: boolean;
}

interface NavItem {
  id: string;
  title: string;
  icon: IconProp;
  route: Route;
  isActive: boolean;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const mobileNavRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  /*
   * Close the mobile menu when clicking outside it. The previous version found
   * the toggle and the menu with document.querySelector on data attributes
   * handed to <Button>, which never reach the DOM — Button declares an explicit
   * prop list and spreads nothing — so both lookups returned null and the guard
   * below could never be true. A ref on the wrapper that contains both is what
   * actually works.
   */
  useEffect(() => {
    const handleClickOutside: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (
        mobileNavRef.current &&
        event.target instanceof Node &&
        !mobileNavRef.current.contains(event.target)
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

  /*
   * Close the mobile menu when the viewport grows past the mobile breakpoint,
   * otherwise the dropdown stays mounted and overlaps the desktop nav.
   */
  useEffect(() => {
    if (!isMobileMenuOpen) {
      return undefined;
    }

    const closeOnDesktop: () => void = (): void => {
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
      }
    };

    window.addEventListener("resize", closeOnDesktop);

    return () => {
      return window.removeEventListener("resize", closeOnDesktop);
    };
  }, [isMobileMenuOpen]);

  if (!props.show) {
    return <></>;
  }

  type GetRouteFunction = (livePage: PageMap, previewPage: PageMap) => Route;

  const getRoute: GetRouteFunction = (
    livePage: PageMap,
    previewPage: PageMap,
  ): Route => {
    return RouteUtil.populateRouteParams(
      props.isPreview
        ? (RouteMap[previewPage] as Route)
        : (RouteMap[livePage] as Route),
    );
  };

  type AddNavItemFunction = (item: {
    id: string;
    title: string;
    icon: IconProp;
    route: Route;
  }) => void;

  /*
   * One list drives both layouts. The mobile and desktop navs used to be two
   * hand-maintained copies of the same items, which is how they drifted apart.
   */
  const navItems: Array<NavItem> = [];

  const addNavItem: AddNavItemFunction = (item: {
    id: string;
    title: string;
    icon: IconProp;
    route: Route;
  }): void => {
    navItems.push({
      ...item,
      isActive: Navigation.isOnThisPage(item.route),
    });
  };

  addNavItem({
    id: "overview-nav-bar-item",
    title: t("nav.overview"),
    icon: IconProp.CheckCircle,
    route: getRoute(PageMap.OVERVIEW, PageMap.PREVIEW_OVERVIEW),
  });

  if (props.showIncidentsOnStatusPage) {
    addNavItem({
      id: "incidents-nav-bar-item",
      title: t("nav.incidents"),
      icon: IconProp.Alert,
      route: getRoute(PageMap.INCIDENT_LIST, PageMap.PREVIEW_INCIDENT_LIST),
    });
  }

  if (props.showAnnouncementsOnStatusPage) {
    addNavItem({
      id: "announcements-nav-bar-item",
      title: t("nav.announcements"),
      icon: IconProp.Announcement,
      route: getRoute(
        PageMap.ANNOUNCEMENT_LIST,
        PageMap.PREVIEW_ANNOUNCEMENT_LIST,
      ),
    });
  }

  if (props.showScheduledMaintenanceEventsOnStatusPage) {
    addNavItem({
      id: "scheduled-events-nav-bar-item",
      title: t("nav.scheduledEvents"),
      icon: IconProp.Clock,
      route: getRoute(
        PageMap.SCHEDULED_EVENT_LIST,
        PageMap.PREVIEW_SCHEDULED_EVENT_LIST,
      ),
    });
  }

  if (
    props.showSubscriberPageOnStatusPage &&
    (props.enableEmailSubscribers ||
      props.enableSMSSubscribers ||
      props.enableSlackSubscribers ||
      props.enableMicrosoftTeamsSubscribers ||
      props.enableWebhookSubscribers)
  ) {
    addNavItem({
      id: "subscribe-nav-bar-item",
      title: t("nav.subscribe"),
      icon: IconProp.Email,
      route: getRoute(PageMap.SUBSCRIBE_EMAIL, PageMap.PREVIEW_SUBSCRIBE_EMAIL),
    });
  }

  if (props.isPrivateStatusPage) {
    addNavItem({
      id: "logout-nav-bar-item",
      title: t("nav.logout"),
      icon: IconProp.Logout,
      route: getRoute(PageMap.LOGOUT, PageMap.PREVIEW_LOGOUT),
    });
  }

  if (navItems.length === 0) {
    return <></>;
  }

  const activeItem: NavItem = (navItems.find((item: NavItem) => {
    return item.isActive;
  }) || navItems[0]) as NavItem;

  /*
   * Both layouts are always rendered and the breakpoint picks between them in
   * CSS. Deciding in JS from window.innerWidth meant the first paint always
   * assumed desktop, so on a phone the nav was missing until an effect ran and
   * then popped in.
   *
   * Because both are in the DOM at once, only the desktop nav may use the
   * canonical item ids — the mobile copies are prefixed so the document never
   * carries the same id twice.
   */
  return (
    <>
      <div className="relative md:hidden" ref={mobileNavRef}>
        <NavBar className="mt-5 justify-between rounded-lg bg-white px-5 py-2 text-center shadow">
          <div className="flex w-full items-center justify-between">
            {/*
             * A fixed id, not the active item's: the open dropdown below
             * renders every item including the active one, so deriving this id
             * from it would put the same id in the document twice.
             */}
            <NavBarItem
              id="mobile-active-nav-bar-item"
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
              ariaExpanded={isMobileMenuOpen}
            />
          </div>
        </NavBar>

        {isMobileMenuOpen && (
          <div className="animate-slide-down absolute left-0 right-0 top-full z-50 mt-1">
            <NavBar className="space-y-1 rounded-lg border border-gray-200 bg-white px-5 py-2 shadow-lg">
              {navItems.map((item: NavItem) => {
                return (
                  <div key={item.id} className="block">
                    <NavBarItem
                      id={`mobile-${item.id}`}
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

      <NavBar className="mt-5 hidden justify-between rounded-lg bg-white px-5 py-2 text-center shadow md:flex">
        {navItems.map((item: NavItem) => {
          return (
            <NavBarItem
              key={item.id}
              id={item.id}
              title={item.title}
              icon={item.icon}
              exact={true}
              route={item.route}
            />
          );
        })}
      </NavBar>
    </>
  );
};

export default DashboardNavbar;
