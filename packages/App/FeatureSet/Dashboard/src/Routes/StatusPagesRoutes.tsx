import ComponentProps from "../Pages/PageComponentProps";
import StatusPageViewLayout from "../Pages/StatusPages/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, StatusPagesRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";
import StatusPageLayout from "../Pages/StatusPages/Layout";
import Navigation from "Common/UI/Utils/Navigation";

// Pages
import StatusPages from "../Pages/StatusPages/StatusPages";
import StatusPagesView from "../Pages/StatusPages/View/Index";
import StatusPagesViewDelete from "../Pages/StatusPages/View/Delete";
import StatusPagesViewBranding from "../Pages/StatusPages/View/Branding";
import StatusPagesViewSubscribers from "../Pages/StatusPages/View/Subscribers";
import StatusPagesViewEmbedded from "../Pages/StatusPages/View/EmbeddedStatus";
import StatusPagesViewDomains from "../Pages/StatusPages/View/Domains";
import StatusPagesViewResources from "../Pages/StatusPages/View/Resources";
import StatusPagesViewAnnouncement from "../Pages/StatusPages/View/Announcements";
import StatusPagesArchived from "../Pages/StatusPages/Archived";
import StatusPagesViewCustomHtmlCss from "../Pages/StatusPages/View/CustomHtmlCss";
import StatusPagesViewGroups from "../Pages/StatusPages/View/Groups";
import StatusPagesViewMonitorRules from "../Pages/StatusPages/View/MonitorRules";
import StatusPageViewSubscriberSettings from "../Pages/StatusPages/View/SubscriberSettings";
import StatusPageViewCustomFields from "../Pages/StatusPages/View/CustomFields";
import StatusPageViewSingleSignOn from "../Pages/StatusPages/View/SingleSignOn";
import StatusPageViewSCIM from "../Pages/StatusPages/View/SCIM";
import StatusPageViewPrivateUser from "../Pages/StatusPages/View/PrivateUser";
import StatusPageViewOwners from "../Pages/StatusPages/View/Owners";
import StatusPageViewAuthenticationSettings from "../Pages/StatusPages/View/AuthenticationSettings";

import StatusPageViewReports from "../Pages/StatusPages/View/Reports";

import StatusPageViewSettings from "../Pages/StatusPages/View/StatusPageSettings";

import StatusPageViewMcp from "../Pages/StatusPages/View/Mcp";

import StatusPageAnnouncements from "../Pages/StatusPages/Announcements";

import AnnouncementCreate from "../Pages/StatusPages/AnnouncementCreate";
import StatusPagesGuidedSetup from "../Pages/StatusPages/GuidedSetup";
import RemountOnAddressChange from "../Components/CreateFromRecord/RemountOnAddressChange";

import AnnouncementView from "../Pages/StatusPages/AnnouncementView";

import AnnouncementViewLayout from "../Pages/StatusPages/AnnouncementLayout";

import AnnouncementViewNotificationLogs from "../Pages/StatusPages/Announcements/View/NotificationLogs";
import AnnouncementViewDelete from "../Pages/StatusPages/Announcements/View/Delete";
import AnnouncementViewAuditLogs from "../Pages/StatusPages/Announcements/View/AuditLogs";

import StatusPageViewNotificationLogs from "../Pages/StatusPages/View/NotificationLogs";
import StatusPageViewAuditLogs from "../Pages/StatusPages/View/AuditLogs";

// Settings Pages
import StatusPagesSettingsAnnouncementTemplates from "../Pages/StatusPages/Settings/StatusPageAnnouncementTemplates";

import StatusPagesSettingsAnnouncementTemplatesView from "../Pages/StatusPages/Settings/StatusPageAnnouncementTemplateView";

import StatusPagesSettingsSubscriberTemplates from "../Pages/StatusPages/Settings/SubscriberNotificationTemplates";

import StatusPagesSettingsSubscriberTemplatesView from "../Pages/StatusPages/Settings/SubscriberNotificationTemplateView";

import StatusPagesSettingsCustomFields from "../Pages/StatusPages/Settings/StatusPageCustomFields";

import StatusPagesSettingsOwnerRules from "../Pages/StatusPages/Settings/StatusPageOwnerRules";

import StatusPagesSettingsLabelRules from "../Pages/StatusPages/Settings/StatusPageLabelRules";
import StatusPageRulesAuditLogs from "../Pages/StatusPages/Settings/StatusPageRulesAuditLogs";
import StatusPageLabelRule from "Common/Models/DatabaseModels/StatusPageLabelRule";
import StatusPageOwnerRule from "Common/Models/DatabaseModels/StatusPageOwnerRule";
import StatusPageMonitorRule from "Common/Models/DatabaseModels/StatusPageMonitorRule";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";
import MovedPageRedirect from "../Components/Routing/MovedPageRedirect";
import StatusPageSingleSignOnProtocol, {
  MOVED_SINGLE_SIGN_ON_PATHS,
  getStatusPageSingleSignOnProtocolQuery,
} from "Common/Types/StatusPage/StatusPageSingleSignOnProtocol";
import StatusPageSubscriberChannel, {
  MOVED_SUBSCRIBER_LIST_PATHS,
  getStatusPageSubscriberChannelQuery,
} from "Common/Types/StatusPage/StatusPageSubscriberChannel";

/*
 * Where a status page's Advanced Options page used to be, relative to the
 * page's own URL. Spelled out because nothing in the RouteMap points here
 * any more: no menu ever linked to it, and it repeated the Embedded Status
 * page's badge settings (its JSON export is on Settings now). The
 * URL is kept only so an old link still arrives somewhere.
 */
export const MOVED_STATUS_PAGE_ADVANCED_OPTIONS_PATH: string =
  "advanced-options";

/*
 * Where a status page's branding screens used to be, relative to the page's
 * own URL: Header, Footer, Overview Page and Languages, four of the five
 * screens the Branding section was split into, and navbar-style, an empty
 * page no menu linked to. What they held is on the one Branding page now
 * (the overall uptime % and the statuses that count as downtime, which were
 * on Overview Page, are on Settings). Nothing in the RouteMap
 * points here any more; the URLs are kept only so a bookmark or a link in a
 * wiki still arrives somewhere.
 */
export const MOVED_STATUS_PAGE_BRANDING_PATHS: ReadonlyArray<string> = [
  "header-style",
  "footer-style",
  "overview-page-branding",
  "languages",
  "navbar-style",
];

const StatusPagesRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let hideSideMenu: boolean = false;

  if (Navigation.isOnThisPage(RouteMap[PageMap.ANNOUNCEMENT_CREATE] as Route)) {
    hideSideMenu = true;
  }

  return (
    <Routes>
      <PageRoute
        path="/"
        element={<StatusPageLayout {...props} hideSideMenu={hideSideMenu} />}
      >
        <PageRoute
          path={StatusPagesRoutePath[PageMap.STATUS_PAGES] || ""}
          element={
            <StatusPages
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGES] as Route}
            />
          }
        />
        <PageRoute
          path={StatusPagesRoutePath[PageMap.STATUS_PAGE_ANNOUNCEMENTS] || ""}
          element={
            <StatusPageAnnouncements
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route}
            />
          }
        />

        {/* Static `archived` outranks the status page view's `:id`. */}
        <PageRoute
          path={StatusPagesRoutePath[PageMap.STATUS_PAGES_ARCHIVED] || ""}
          element={
            <StatusPagesArchived
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGES_ARCHIVED] as Route}
            />
          }
        />

        {/* Settings Routes */}
        <PageRoute
          path={
            StatusPagesRoutePath[
              PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES
            ] || ""
          }
          element={
            <StatusPagesSettingsAnnouncementTemplates
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            StatusPagesRoutePath[
              PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <StatusPagesSettingsAnnouncementTemplatesView
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES_VIEW
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            StatusPagesRoutePath[
              PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES
            ] || ""
          }
          element={
            <StatusPagesSettingsSubscriberTemplates
              {...props}
              pageRoute={
                RouteMap[
                  PageMap
                    .STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            StatusPagesRoutePath[
              PageMap
                .STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <StatusPagesSettingsSubscriberTemplatesView
              {...props}
              pageRoute={
                RouteMap[
                  PageMap
                    .STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES_VIEW
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            StatusPagesRoutePath[PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS] ||
            ""
          }
          element={
            <StatusPagesSettingsCustomFields
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            StatusPagesRoutePath[PageMap.STATUS_PAGES_SETTINGS_OWNER_RULES] ||
            ""
          }
          element={
            <StatusPagesSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGES_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            StatusPagesRoutePath[
              PageMap.STATUS_PAGES_SETTINGS_OWNER_RULE_VIEW
            ] || ""
          }
          element={
            <StatusPagesSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGES_SETTINGS_OWNER_RULE_VIEW] as Route
              }
              ruleViewModelType={StatusPageOwnerRule}
            />
          }
        />

        <PageRoute
          path={
            StatusPagesRoutePath[PageMap.STATUS_PAGES_SETTINGS_LABEL_RULES] ||
            ""
          }
          element={
            <StatusPagesSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGES_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            StatusPagesRoutePath[
              PageMap.STATUS_PAGES_SETTINGS_RULES_AUDIT_LOGS
            ] || ""
          }
          element={
            <StatusPageRulesAuditLogs
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.STATUS_PAGES_SETTINGS_RULES_AUDIT_LOGS
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            StatusPagesRoutePath[
              PageMap.STATUS_PAGES_SETTINGS_LABEL_RULE_VIEW
            ] || ""
          }
          element={
            <StatusPagesSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGES_SETTINGS_LABEL_RULE_VIEW] as Route
              }
              ruleViewModelType={StatusPageLabelRule}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: StatusPage,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.STATUS_PAGES_ROOT,
        })}
      </PageRoute>

      {/* Guided setup: publish a status page (#6806), with no side menu. */}
      <PageRoute
        path={StatusPagesRoutePath[PageMap.STATUS_PAGES_GUIDED_SETUP] || ""}
        element={
          <StatusPagesGuidedSetup
            {...props}
            pageRoute={RouteMap[PageMap.STATUS_PAGES_GUIDED_SETUP] as Route}
          />
        }
      />

      <PageRoute
        path={StatusPagesRoutePath[PageMap.ANNOUNCEMENT_CREATE] || ""}
        element={
          <RemountOnAddressChange>
            <AnnouncementCreate
              {...props}
              pageRoute={RouteMap[PageMap.ANNOUNCEMENT_CREATE] as Route}
            />
          </RemountOnAddressChange>
        }
      />

      <PageRoute
        path={StatusPagesRoutePath[PageMap.ANNOUNCEMENT_VIEW] || ""}
        element={<AnnouncementViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <AnnouncementView
              {...props}
              pageRoute={RouteMap[PageMap.ANNOUNCEMENT_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ANNOUNCEMENT_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <AnnouncementViewNotificationLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.ANNOUNCEMENT_VIEW_NOTIFICATION_LOGS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ANNOUNCEMENT_VIEW_AUDIT_LOGS,
          )}
          element={
            <AnnouncementViewAuditLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.ANNOUNCEMENT_VIEW_AUDIT_LOGS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ANNOUNCEMENT_VIEW_DELETE)}
          element={
            <AnnouncementViewDelete
              {...props}
              pageRoute={RouteMap[PageMap.ANNOUNCEMENT_VIEW_DELETE] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: StatusPageAnnouncement,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>

      <PageRoute
        path={StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW] || ""}
        element={<StatusPageViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <StatusPagesView
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <StatusPageViewNotificationLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS,
          )}
          element={
            <StatusPageViewSubscriberSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_DELETE)}
          element={
            <StatusPagesViewDelete
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_DELETE] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_AUDIT_LOGS,
          )}
          element={
            <StatusPageViewAuditLogs
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_AUDIT_LOGS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_BRANDING)}
          element={
            <StatusPagesViewBranding
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_BRANDING] as Route}
            />
          }
        />

        {MOVED_STATUS_PAGE_BRANDING_PATHS.map((path: string): ReactElement => {
          return (
            <PageRoute
              key={path}
              path={path}
              element={
                <MovedPageRedirect
                  pageMap={PageMap.STATUS_PAGE_VIEW_BRANDING}
                />
              }
            />
          );
        })}

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS,
          )}
          element={
            <StatusPagesViewCustomHtmlCss
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS] as Route
              }
            />
          }
        />

        <PageRoute
          path={MOVED_STATUS_PAGE_ADVANCED_OPTIONS_PATH}
          element={
            <MovedPageRedirect pageMap={PageMap.STATUS_PAGE_VIEW_EMBEDDED} />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS,
          )}
          element={
            <StatusPageViewCustomFields
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_OWNERS)}
          element={
            <StatusPageViewOwners
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_OWNERS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_SSO)}
          element={
            <StatusPageViewSingleSignOn
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_SSO] as Route}
            />
          }
        />

        {/*
         * OIDC providers had a page of their own beside SSO's until #9130:
         * its address forwards to the Single Sign-On page's OIDC tab, so a
         * bookmark or a link in a wiki still arrives.
         */}
        {Object.keys(MOVED_SINGLE_SIGN_ON_PATHS).map(
          (movedPath: string): ReactElement => {
            const protocol: StatusPageSingleSignOnProtocol =
              MOVED_SINGLE_SIGN_ON_PATHS[
                movedPath
              ] as StatusPageSingleSignOnProtocol;

            return (
              <PageRoute
                key={movedPath}
                path={movedPath}
                element={
                  <MovedPageRedirect
                    pageMap={PageMap.STATUS_PAGE_VIEW_SSO}
                    searchParams={getStatusPageSingleSignOnProtocolQuery(
                      protocol,
                    )}
                  />
                }
              />
            );
          },
        )}

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_SCIM)}
          element={
            <StatusPageViewSCIM
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_SCIM] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS,
          )}
          element={
            <StatusPagesViewSubscribers
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS] as Route
              }
            />
          }
        />

        {/*
         * Each channel's subscribers had a page of their own until #9125:
         * their addresses forward to the channel's tab, so a bookmark, a
         * link in a wiki or an email the server sent still arrives.
         */}
        {Object.keys(MOVED_SUBSCRIBER_LIST_PATHS).map(
          (movedPath: string): ReactElement => {
            const channel: StatusPageSubscriberChannel =
              MOVED_SUBSCRIBER_LIST_PATHS[
                movedPath
              ] as StatusPageSubscriberChannel;

            return (
              <PageRoute
                key={movedPath}
                path={movedPath}
                element={
                  <MovedPageRedirect
                    pageMap={PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS}
                    searchParams={getStatusPageSubscriberChannelQuery(channel)}
                  />
                }
              />
            );
          },
        )}

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS,
          )}
          element={
            <StatusPageViewAuthenticationSettings
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_REPORTS)}
          element={
            <StatusPageViewReports
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_REPORTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_SETTINGS)}
          element={
            <StatusPageViewSettings
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_SETTINGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_MCP)}
          element={
            <StatusPageViewMcp
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_MCP] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS,
          )}
          element={
            <StatusPageViewPrivateUser
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_EMBEDDED)}
          element={
            <StatusPagesViewEmbedded
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_EMBEDDED] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_RESOURCES)}
          element={
            <StatusPagesViewResources
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_RESOURCES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_DOMAINS)}
          element={
            <StatusPagesViewDomains
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_GROUPS)}
          element={
            <StatusPagesViewGroups
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_GROUPS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_MONITOR_RULES,
          )}
          element={
            <StatusPagesViewMonitorRules
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_MONITOR_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_MONITOR_RULE_VIEW,
            2,
          )}
          element={
            <StatusPagesViewMonitorRules
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_MONITOR_RULE_VIEW] as Route
              }
              ruleViewModelType={StatusPageMonitorRule}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS,
          )}
          element={
            <StatusPagesViewAnnouncement
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS] as Route
              }
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: StatusPage,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>
    </Routes>
  );
};

export default StatusPagesRoutes;
