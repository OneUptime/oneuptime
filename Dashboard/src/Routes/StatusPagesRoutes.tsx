import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import StatusPageViewLayout from "../Pages/StatusPages/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, StatusPagesRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  ReactElement,
  Suspense,
  lazy,
} from "react";
import { Route as PageRoute, Routes } from "react-router-dom";
import StatusPageLayout from "../Pages/StatusPages/Layout";
import Navigation from "Common/UI/Utils/Navigation";

// Pages
const StatusPages: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/StatusPages/StatusPages");
  });
const StatusPagesView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/StatusPages/View/Index");
  });
const StatusPagesViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/Delete");
});
const StatusPagesViewBranding: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/Branding");
});
const StatusPagesViewEmailSubscribers: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/EmailSubscribers");
});
const StatusPagesViewSMSSubscribers: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/SMSSubscribers");
});
const StatusPagesViewSlackSubscribers: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/SlackSubscribers");
});
const StatusPagesViewMicrosoftTeamsSubscribers: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/MicrosoftTeamsSubscribers");
});
const StatusPagesViewWebhookSubscribers: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/WebhookSubscribers");
});
const StatusPagesViewEmbedded: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/EmbeddedStatus");
});
const StatusPagesViewDomains: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/Domains");
});
const StatusPagesViewResources: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/Resources");
});
const StatusPagesViewAnnouncement: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/Announcements");
});
const StatusPagesViewAdvancedOptions: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/AdvancedOptions");
});
const StatusPagesViewCustomHtmlCss: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/CustomHtmlCss");
});
const StatusPagesViewHeaderStyle: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/HeaderStyle");
});
const StatusPagesViewFooterStyle: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/FooterStyle");
});
const StatusPagesViewNavBarStyle: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/NavBarStyle");
});
const StatusPagesViewGroups: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/Groups");
});
const StatusPageViewSubscriberSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/SubscriberSettings");
});
const StatusPageViewCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/CustomFields");
});
const StatusPageViewSSO: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/SSO");
});
const StatusPageViewSCIM: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/SCIM");
});
const StatusPageViewPrivateUser: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/PrivateUser");
});
const StatusPageViewOwners: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/Owners");
});
const StatusPageViewAuthenticationSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/AuthenticationSettings");
});

const StatusPageViewReports: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/Reports");
});

const StatusPageViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/StatusPageSettings");
});

const StatusPagesViewOverviewPageBranding: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/OverviewPageBranding");
});

const StatusPageAnnouncements: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/Announcements");
});

const AnnouncementCreate: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/AnnouncementCreate");
});

const AnnouncementView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/StatusPages/AnnouncementView");
  });

const AnnouncementViewLayout: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/AnnouncementLayout");
});

const AnnouncementViewNotificationLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/Announcements/View/NotificationLogs");
});
const AnnouncementViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/Announcements/View/Delete");
});

const StatusPageViewNotificationLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/View/NotificationLogs");
});

// Settings Pages
const StatusPagesSettingsAnnouncementTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/StatusPages/Settings/StatusPageAnnouncementTemplates"
  );
});

const StatusPagesSettingsAnnouncementTemplatesView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/StatusPages/Settings/StatusPageAnnouncementTemplateView"
  );
});

const StatusPagesSettingsSubscriberTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/StatusPages/Settings/SubscriberNotificationTemplates"
  );
});

const StatusPagesSettingsSubscriberTemplatesView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import(
    "../Pages/StatusPages/Settings/SubscriberNotificationTemplateView"
  );
});

const StatusPagesSettingsCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/StatusPages/Settings/StatusPageCustomFields");
});

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
            <Suspense fallback={Loader}>
              <StatusPages
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGES] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={StatusPagesRoutePath[PageMap.STATUS_PAGE_ANNOUNCEMENTS] || ""}
          element={
            <Suspense fallback={Loader}>
              <StatusPageAnnouncements
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route}
              />
            </Suspense>
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
            <Suspense fallback={Loader}>
              <StatusPagesSettingsAnnouncementTemplates
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            StatusPagesRoutePath[
              PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES_VIEW
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <StatusPagesSettingsAnnouncementTemplatesView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            StatusPagesRoutePath[
              PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES
            ] || ""
          }
          element={
            <Suspense fallback={Loader}>
              <StatusPagesSettingsSubscriberTemplates
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap
                      .STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES
                  ] as Route
                }
              />
            </Suspense>
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
            <Suspense fallback={Loader}>
              <StatusPagesSettingsSubscriberTemplatesView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap
                      .STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={
            StatusPagesRoutePath[PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS] ||
            ""
          }
          element={
            <Suspense fallback={Loader}>
              <StatusPagesSettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>

      <PageRoute
        path={StatusPagesRoutePath[PageMap.ANNOUNCEMENT_CREATE] || ""}
        element={
          <Suspense fallback={Loader}>
            <AnnouncementCreate
              {...props}
              pageRoute={RouteMap[PageMap.ANNOUNCEMENT_CREATE] as Route}
            />
          </Suspense>
        }
      />

      <PageRoute
        path={StatusPagesRoutePath[PageMap.ANNOUNCEMENT_VIEW] || ""}
        element={
          <Suspense fallback={Loader}>
            <AnnouncementViewLayout {...props} />
          </Suspense>
        }
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <AnnouncementView
                {...props}
                pageRoute={RouteMap[PageMap.ANNOUNCEMENT_VIEW] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.ANNOUNCEMENT_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <AnnouncementViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.ANNOUNCEMENT_VIEW_NOTIFICATION_LOGS] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.ANNOUNCEMENT_VIEW_DELETE)}
          element={
            <Suspense fallback={Loader}>
              <AnnouncementViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.ANNOUNCEMENT_VIEW_DELETE] as Route}
              />
            </Suspense>
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
            <Suspense fallback={Loader}>
              <StatusPagesView
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPageViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPageViewSubscriberSettings
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_DELETE)}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_DELETE] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_BRANDING)}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewBranding
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_BRANDING] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewCustomHtmlCss
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewAdvancedOptions
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPageViewCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_OWNERS)}
          element={
            <Suspense fallback={Loader}>
              <StatusPageViewOwners
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_OWNERS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_SSO)}
          element={
            <Suspense fallback={Loader}>
              <StatusPageViewSSO
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_SSO] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_SCIM)}
          element={
            <Suspense fallback={Loader}>
              <StatusPageViewSCIM
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_SCIM] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewEmailSubscribers
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPageViewAuthenticationSettings
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_REPORTS)}
          element={
            <Suspense fallback={Loader}>
              <StatusPageViewReports
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_REPORTS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_SETTINGS)}
          element={
            <Suspense fallback={Loader}>
              <StatusPageViewSettings
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_SETTINGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPageViewPrivateUser
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewSMSSubscribers
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_HEADER_STYLE,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewHeaderStyle
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_HEADER_STYLE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewFooterStyle
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewOverviewPageBranding
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewNavBarStyle
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewWebhookSubscribers
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_SLACK_SUBSCRIBERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewSlackSubscribers
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_SLACK_SUBSCRIBERS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_MICROSOFT_TEAMS_SUBSCRIBERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewMicrosoftTeamsSubscribers
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.STATUS_PAGE_VIEW_MICROSOFT_TEAMS_SUBSCRIBERS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_EMBEDDED)}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewEmbedded
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_EMBEDDED] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_RESOURCES)}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewResources
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_RESOURCES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_DOMAINS)}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewDomains
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STATUS_PAGE_VIEW_GROUPS)}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewGroups
                {...props}
                pageRoute={RouteMap[PageMap.STATUS_PAGE_VIEW_GROUPS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPagesViewAnnouncement
                {...props}
                pageRoute={
                  RouteMap[PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default StatusPagesRoutes;
