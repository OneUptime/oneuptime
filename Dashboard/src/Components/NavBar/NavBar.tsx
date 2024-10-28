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
import React, { FunctionComponent, ReactElement, useState } from "react";

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

  return (
    <NavBar
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

      {/* <NavBarItem
        title="Dashboards"
        activeRoute={RouteMap[PageMap.DASHBOARDS]}
        icon={IconProp.Window}
        route={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DASHBOARDS] as Route,
        )}
      ></NavBarItem> */}

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

              {/* <NavBarMenuItem
                            title="Logs Management"
                            description='Manage your application logs.'
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.LOGS] as Route
                            )}
                            icon={IconProp.Terminal}
                        />
                        <NavBarMenuItem
                            title="Error Tracker"
                            description='Manage your application errors.'
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.ERROR_TRACKER] as Route
                            )}
                            icon={IconProp.Error}
                        />

                        <NavBarMenuItem
                            title="Reports"
                            description='Get insights into your Observability process.'
                            route={RouteUtil.populateRouteParams(
                                RouteMap[PageMap.REPORTS] as Route
                            )}
                            icon={IconProp.Report}
                        /> */}
            </NavBarMenu>
          )}
        </div>
      </NavBarItem>
    </NavBar>
  );
};

export default DashboardNavbar;
