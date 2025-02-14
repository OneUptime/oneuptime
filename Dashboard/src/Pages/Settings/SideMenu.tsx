import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import { BILLING_ENABLED } from "Common/UI/Config";
import React, { ReactElement } from "react";

const DashboardSideMenu: () => JSX.Element = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Project",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS] as Route,
            ),
          }}
          icon={IconProp.Folder}
        />
        <SideMenuItem
          link={{
            title: "Labels",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_LABELS] as Route,
            ),
          }}
          icon={IconProp.Label}
        />
      </SideMenuSection>

      <SideMenuSection title="Workspace Connections">
        <SideMenuItem
          link={{
            title: "Slack",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SLACK_INTEGRATION] as Route,
            ),
          }}
          icon={IconProp.Slack}
        />
      </SideMenuSection>

      <SideMenuSection title="Monitors">
        <SideMenuItem
          link={{
            title: "Monitor Status",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_MONITORS_STATUS] as Route,
            ),
          }}
          icon={IconProp.AltGlobe}
        />
        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_MONITOR_CUSTOM_FIELDS] as Route,
            ),
          }}
          icon={IconProp.TableCells}
        />

        <SideMenuItem
          link={{
            title: "Secrets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_MONITOR_SECRETS] as Route,
            ),
          }}
          icon={IconProp.Lock}
        />
      </SideMenuSection>
      <SideMenuSection title="Status Pages">
        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_STATUS_PAGE_CUSTOM_FIELDS] as Route,
            ),
          }}
          icon={IconProp.TableCells}
        />
      </SideMenuSection>
      <SideMenuSection title="On-Call Policy">
        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SETTINGS_ON_CALL_DUTY_POLICY_CUSTOM_FIELDS
              ] as Route,
            ),
          }}
          icon={IconProp.TableCells}
        />
      </SideMenuSection>
      <SideMenuSection title="Incidents">
        <SideMenuItem
          link={{
            title: "Incident State",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENTS_STATE] as Route,
            ),
          }}
          icon={IconProp.ArrowCircleRight}
        />
        <SideMenuItem
          link={{
            title: "Incident Severity",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENTS_SEVERITY] as Route,
            ),
          }}
          icon={IconProp.Alert}
        />
        <SideMenuItem
          link={{
            title: "Incident Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENT_TEMPLATES] as Route,
            ),
          }}
          icon={IconProp.Template}
        />
        <SideMenuItem
          link={{
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES] as Route,
            ),
          }}
          icon={IconProp.Pencil}
        />
        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENT_CUSTOM_FIELDS] as Route,
            ),
          }}
          icon={IconProp.TableCells}
        />
        {/* <SideMenuItem
                    link={{
                        title: 'Incident Templates',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.TextFile}
                /> */}
      </SideMenuSection>

      <SideMenuSection title="Alerts">
        <SideMenuItem
          link={{
            title: "Alert State",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_ALERTS_STATE] as Route,
            ),
          }}
          icon={IconProp.ArrowCircleRight}
        />
        <SideMenuItem
          link={{
            title: "Alert Severity",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_ALERTS_SEVERITY] as Route,
            ),
          }}
          icon={IconProp.Alert}
        />

        <SideMenuItem
          link={{
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_ALERT_NOTE_TEMPLATES] as Route,
            ),
          }}
          icon={IconProp.Pencil}
        />
        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_ALERT_CUSTOM_FIELDS] as Route,
            ),
          }}
          icon={IconProp.TableCells}
        />
        {/* <SideMenuItem
                    link={{
                        title: 'Alert Templates',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.TextFile}
                /> */}
      </SideMenuSection>
      <SideMenuSection title="Telemetry & APM">
        <SideMenuItem
          link={{
            title: "Ingestion Keys",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS] as Route,
            ),
          }}
          icon={IconProp.Terminal}
        />
      </SideMenuSection>
      <SideMenuSection title="Scheduled Maintenance">
        <SideMenuItem
          link={{
            title: "Event State",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE] as Route,
            ),
          }}
          icon={IconProp.Clock}
        />

        {/** Templates */}

        <SideMenuItem
          link={{
            title: "Event Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SETTINGS_SCHEDULED_MAINTENANCE_TEMPLATES
              ] as Route,
            ),
          }}
          icon={IconProp.Template}
        />

        <SideMenuItem
          link={{
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES
              ] as Route,
            ),
          }}
          icon={IconProp.Pencil}
        />
        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SETTINGS_SCHEDULED_MAINTENANCE_CUSTOM_FIELDS
              ] as Route,
            ),
          }}
          icon={IconProp.TableCells}
        />
      </SideMenuSection>
      <SideMenuSection title="Team">
        <SideMenuItem
          link={{
            title: "Teams and Members",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TEAMS] as Route,
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>
      <SideMenuSection title="Notifications">
        <SideMenuItem
          link={{
            title: "Notification Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route,
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "SMS Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SMS_LOGS] as Route,
            ),
          }}
          icon={IconProp.SMS}
        />
        <SideMenuItem
          link={{
            title: "Call Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_CALL_LOGS] as Route,
            ),
          }}
          icon={IconProp.Call}
        />
        <SideMenuItem
          link={{
            title: "Email Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_EMAIL_LOGS] as Route,
            ),
          }}
          icon={IconProp.Email}
        />
      </SideMenuSection>
      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Probes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_PROBES] as Route,
            ),
          }}
          icon={IconProp.Signal}
        />
        <SideMenuItem
          link={{
            title: "Domains",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_DOMAINS] as Route,
            ),
          }}
          icon={IconProp.Globe}
        />
        <SideMenuItem
          link={{
            title: "API Keys",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
            ),
          }}
          icon={IconProp.Terminal}
        />
        <SideMenuItem
          link={{
            title: "Feature Flags",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_FEATURE_FLAGS] as Route,
            ),
          }}
          icon={IconProp.Flag}
        />

        {/* <SideMenuItem
                    link={{
                        title: 'SMS & Call Provider',
                        to: new Route('/:projectSlug/home'),
                    }}
                    icon={IconProp.Call}
                /> */}
      </SideMenuSection>
      {BILLING_ENABLED ? (
        <SideMenuSection title="Billing and Invoices">
          <SideMenuItem
            link={{
              title: "Billing",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_BILLING] as Route,
              ),
            }}
            icon={IconProp.Billing}
          />
          <SideMenuItem
            link={{
              title: "Usage History",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_USAGE_HISTORY] as Route,
              ),
            }}
            icon={IconProp.ChartBar}
          />
          <SideMenuItem
            link={{
              title: "Invoices",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_BILLING_INVOICES] as Route,
              ),
            }}
            icon={IconProp.TextFile}
          />
        </SideMenuSection>
      ) : (
        <></>
      )}
      <SideMenuSection title="Authentication Security">
        <SideMenuItem
          link={{
            title: "SSO",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SSO] as Route,
            ),
          }}
          icon={IconProp.Lock}
        />
      </SideMenuSection>
      <SideMenuSection title="Danger Zone">
        <SideMenuItem
          link={{
            title: "Danger Zone",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_DANGERZONE] as Route,
            ),
          }}
          icon={IconProp.Error}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
