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
import StatusPagesViewEmailSubscribers from "../Pages/StatusPages/View/EmailSubscribers";
import StatusPagesViewSMSSubscribers from "../Pages/StatusPages/View/SMSSubscribers";
import StatusPagesViewSlackSubscribers from "../Pages/StatusPages/View/SlackSubscribers";
import StatusPagesViewMicrosoftTeamsSubscribers from "../Pages/StatusPages/View/MicrosoftTeamsSubscribers";
import StatusPagesViewWebhookSubscribers from "../Pages/StatusPages/View/WebhookSubscribers";
import StatusPagesViewEmbedded from "../Pages/StatusPages/View/EmbeddedStatus";
import StatusPagesViewDomains from "../Pages/StatusPages/View/Domains";
import StatusPagesViewResources from "../Pages/StatusPages/View/Resources";
import StatusPagesViewAnnouncement from "../Pages/StatusPages/View/Announcements";
import StatusPagesViewAdvancedOptions from "../Pages/StatusPages/View/AdvancedOptions";
import StatusPagesViewCustomHtmlCss from "../Pages/StatusPages/View/CustomHtmlCss";
import StatusPagesViewHeaderStyle from "../Pages/StatusPages/View/HeaderStyle";
import StatusPagesViewFooterStyle from "../Pages/StatusPages/View/FooterStyle";
import StatusPagesViewNavBarStyle from "../Pages/StatusPages/View/NavBarStyle";
import StatusPagesViewGroups from "../Pages/StatusPages/View/Groups";
import StatusPageViewSubscriberSettings from "../Pages/StatusPages/View/SubscriberSettings";
import StatusPageViewCustomFields from "../Pages/StatusPages/View/CustomFields";
import StatusPageViewSSO from "../Pages/StatusPages/View/SSO";
import StatusPageViewSCIM from "../Pages/StatusPages/View/SCIM";
import StatusPageViewPrivateUser from "../Pages/StatusPages/View/PrivateUser";
import StatusPageViewOwners from "../Pages/StatusPages/View/Owners";
import StatusPageViewAuthenticationSettings from "../Pages/StatusPages/View/AuthenticationSettings";

import StatusPageViewReports from "../Pages/StatusPages/View/Reports";

import StatusPageViewSettings from "../Pages/StatusPages/View/StatusPageSettings";

import StatusPagesViewOverviewPageBranding from "../Pages/StatusPages/View/OverviewPageBranding";

import StatusPageAnnouncements from "../Pages/StatusPages/Announcements";

import AnnouncementCreate from "../Pages/StatusPages/AnnouncementCreate";

import AnnouncementView from "../Pages/StatusPages/AnnouncementView";

import AnnouncementViewLayout from "../Pages/StatusPages/AnnouncementLayout";

import AnnouncementViewNotificationLogs from "../Pages/StatusPages/Announcements/View/NotificationLogs";
import AnnouncementViewDelete from "../Pages/StatusPages/Announcements/View/Delete";

import StatusPageViewNotificationLogs from "../Pages/StatusPages/View/NotificationLogs";

// Settings Pages
import StatusPagesSettingsAnnouncementTemplates from "../Pages/StatusPages/Settings/StatusPageAnnouncementTemplates";

import StatusPagesSettingsAnnouncementTemplatesView from "../Pages/StatusPages/Settings/StatusPageAnnouncementTemplateView";

import StatusPagesSettingsSubscriberTemplates from "../Pages/StatusPages/Settings/SubscriberNotificationTemplates";

import StatusPagesSettingsSubscriberTemplatesView from "../Pages/StatusPages/Settings/SubscriberNotificationTemplateView";

import StatusPagesSettingsCustomFields from "../Pages/StatusPages/Settings/StatusPageCustomFields";

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
      </PageRoute>

      <PageRoute
        path={StatusPagesRoutePath[PageMap.ANNOUNCEMENT_CREATE] || ""}
        element={
          <AnnouncementCreate
            {...props}
            pageRoute={RouteMap[PageMap.ANNOUNCEMENT_CREATE] as Route}
          />
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
          path={RouteUtil.getLastPathForKey(PageMap.ANNOUNCEMENT_VIEW_DELETE)}
          element={
            <AnnouncementViewDelete
              {...props}
              pageRoute={RouteMap[PageMap.ANNOUNCEMENT_VIEW_DELETE] as Route}
            />
          }
        />
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
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_BRANDING)}
          element={
            <StatusPagesViewBranding
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_BRANDING] as Route}
            />
          }
        />

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
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS,
          )}
          element={
            <StatusPagesViewAdvancedOptions
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS] as Route
              }
            />
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
            <StatusPageViewSSO
              {...props}
              pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_SSO] as Route}
            />
          }
        />

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
            PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS,
          )}
          element={
            <StatusPagesViewEmailSubscribers
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS] as Route
              }
            />
          }
        />

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
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS,
          )}
          element={
            <StatusPagesViewSMSSubscribers
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_HEADER_STYLE,
          )}
          element={
            <StatusPagesViewHeaderStyle
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_HEADER_STYLE] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE,
          )}
          element={
            <StatusPagesViewFooterStyle
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING,
          )}
          element={
            <StatusPagesViewOverviewPageBranding
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE,
          )}
          element={
            <StatusPagesViewNavBarStyle
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS,
          )}
          element={
            <StatusPagesViewWebhookSubscribers
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_SLACK_SUBSCRIBERS,
          )}
          element={
            <StatusPagesViewSlackSubscribers
              {...props}
              pageRoute={
                RouteMap[PageMap.STATUS_PAGE_VIEW_SLACK_SUBSCRIBERS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_MICROSOFT_TEAMS_SUBSCRIBERS,
          )}
          element={
            <StatusPagesViewMicrosoftTeamsSubscribers
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.STATUS_PAGE_VIEW_MICROSOFT_TEAMS_SUBSCRIBERS
                ] as Route
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
      </PageRoute>
    </Routes>
  );
};

export default StatusPagesRoutes;
