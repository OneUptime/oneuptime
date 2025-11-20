import MasterPage from "./Components/MasterPage/MasterPage";
import PageMap from "./Utils/PageMap";
import RouteMap from "./Utils/RouteMap";
import StatusPageUtil from "./Utils/StatusPage";
import Route from "Common/Types/API/Route";
import { VoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { useEffect, useState, lazy, Suspense } from "react";
import {
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { SubscribePageProps } from "./Pages/Subscribe/SubscribePageUtils";
import { ComponentProps as ForgotPasswordComponentProps } from "./Pages/Accounts/ForgotPassword";
import { ComponentProps as LoginComponentProps } from "./Pages/Accounts/Login";
import { ComponentProps as ResetPasswordComponentProps } from "./Pages/Accounts/ResetPassword";
import { ComponentProps as MasterPasswordComponentProps } from "./Pages/Accounts/MasterPassword";
import { ComponentProps as SsoComponentProps } from "./Pages/Accounts/SSO";
import PageComponentProps from "./Pages/PageComponentProps";

// Lazy load components
const ForgotPassword: React.LazyExoticComponent<
  React.FunctionComponent<ForgotPasswordComponentProps>
> = lazy(() => {
  return import("./Pages/Accounts/ForgotPassword");
});
const Login: React.LazyExoticComponent<
  React.FunctionComponent<LoginComponentProps>
> = lazy(() => {
  return import("./Pages/Accounts/Login");
});
const Logout: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/Accounts/Logout");
});
const ResetPassword: React.LazyExoticComponent<
  React.FunctionComponent<ResetPasswordComponentProps>
> = lazy(() => {
  return import("./Pages/Accounts/ResetPassword");
});
const MasterPassword: React.LazyExoticComponent<
  React.FunctionComponent<MasterPasswordComponentProps>
> = lazy(() => {
  return import("./Pages/Accounts/MasterPassword");
});
const Sso: React.LazyExoticComponent<
  React.FunctionComponent<SsoComponentProps>
> = lazy(() => {
  return import("./Pages/Accounts/SSO");
});
const AnnouncementDetail: React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
> = lazy(() => {
  return import("./Pages/Announcement/Detail");
});
const AnnouncementList: React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
> = lazy(() => {
  return import("./Pages/Announcement/List");
});
const IncidentDetail: React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
> = lazy(() => {
  return import("./Pages/Incidents/Detail");
});
const IncidentList: React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
> = lazy(() => {
  return import("./Pages/Incidents/List");
});
const PageNotFound: React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
> = lazy(() => {
  return import("./Pages/NotFound/PageNotFound");
});
const Overview: React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
> = lazy(() => {
  return import("./Pages/Overview/Overview");
});
const ScheduledEventDetail: React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
> = lazy(() => {
  return import("./Pages/ScheduledEvent/Detail");
});
const ScheduledEventList: React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
> = lazy(() => {
  return import("./Pages/ScheduledEvent/List");
});
const EmailSubscribe: React.LazyExoticComponent<
  React.FunctionComponent<SubscribePageProps>
> = lazy(() => {
  return import("./Pages/Subscribe/EmailSubscribe");
});
const SMSSubscribe: React.LazyExoticComponent<
  React.FunctionComponent<SubscribePageProps>
> = lazy(() => {
  return import("./Pages/Subscribe/SmsSubscribe");
});
const UpdateSubscription: React.LazyExoticComponent<
  React.FunctionComponent<SubscribePageProps>
> = lazy(() => {
  return import("./Pages/Subscribe/UpdateSubscription");
});
const ConfirmSubscription: React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
> = lazy(() => {
  return import("./Pages/Subscribe/ConfirmSubscription");
});
const SlackSubscribe: React.LazyExoticComponent<
  React.FunctionComponent<SubscribePageProps>
> = lazy(() => {
  return import("./Pages/Subscribe/SlackSubscribe");
});
const MicrosoftTeamsSubscribe: React.LazyExoticComponent<
  React.FunctionComponent<SubscribePageProps>
> = lazy(() => {
  return import("./Pages/Subscribe/MicrosoftTeamsSubscribe");
});

// forbidden page
const PageForbidden: React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
> = lazy(() => {
  return import("./Pages/Forbidden/Forbidden");
});

const App: () => JSX.Element = () => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const [isPreview, setIsPreview] = useState<boolean>(false);
  const [enableEmailSubscribers, setenableEmailSubscribers] =
    useState<boolean>(true);

  const [
    allowSubscribersToChooseResources,
    setAllowSubscribersToChooseResources,
  ] = useState<boolean>(false);

  const [
    allowSubscriberToChooseEventTypes,
    setAllowSubscriberToChooseEventTypes,
  ] = useState<boolean>(false);

  const [enableSMSSubscribers, setenableSMSSubscribers] =
    useState<boolean>(false);
  const [enableSlackSubscribers, setenableSlackSubscribers] =
    useState<boolean>(false);
  const [enableMicrosoftTeamsSubscribers, setenableMicrosoftTeamsSubscribers] =
    useState<boolean>(false);
  const [statusPageName, setStatusPageName] = useState<string>("");
  const [statusPageLogoFileId, setStatusPageLogoFileId] = useState<string>("");
  const [isPrivateStatusPage, setIsPrivateStatusPage] =
    useState<boolean>(false);

  const [hasEnabledSSO, setHasEnabledSSO] = useState<boolean>(false);
  const [forceSSO, setForceSSO] = useState<boolean>(false);

  useEffect(() => {
    const preview: boolean = StatusPageUtil.isPreviewPage();
    setIsPreview(preview);
  }, []);

  const [javascript, setJavaScript] = useState<string | null>(null);

  const onPageLoadComplete: VoidFunction = (): void => {
    if (javascript) {
      new Function(javascript)();
    }
  };

  return (
    <MasterPage
      isPreview={isPreview}
      enableSMSSubscribers={enableSMSSubscribers}
      enableEmailSubscribers={enableEmailSubscribers}
      enableSlackSubscribers={enableSlackSubscribers}
      isPrivateStatusPage={isPrivateStatusPage}
      onLoadComplete={(masterpage: JSONObject) => {
        document.title =
          (JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.pageTitle",
          ) as string | null) || "Status Page";

        document
          .querySelector('meta[name="description"]')
          ?.setAttribute(
            "content",
            (JSONFunctions.getJSONValueInPath(
              masterpage || {},
              "statusPage.pageDescription",
            ) as string | null) || "",
          );

        const javascript: string | null = JSONFunctions.getJSONValueInPath(
          masterpage || {},
          "statusPage.customJavaScript",
        ) as string | null;
        if (javascript) {
          setJavaScript(javascript);
        }

        const statusPageName: string | null = JSONFunctions.getJSONValueInPath(
          masterpage || {},
          "statusPage.pageTitle",
        ) as string | null;

        const isPrivateStatusPage: boolean = !JSONFunctions.getJSONValueInPath(
          masterpage || {},
          "statusPage.isPublicStatusPage",
        ) as boolean;

        const enableMasterPassword: boolean = Boolean(
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.enableMasterPassword",
          ) as boolean,
        );

        const enableEmailSubscribers: boolean =
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.enableEmailSubscribers",
          ) as boolean;

        const enableSMSSubscribers: boolean = JSONFunctions.getJSONValueInPath(
          masterpage || {},
          "statusPage.enableSmsSubscribers",
        ) as boolean;

        const enableSlackSubscribers: boolean =
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.enableSlackSubscribers",
          ) as boolean;

        const enableMicrosoftTeamsSubscribers: boolean =
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.enableMicrosoftTeamsSubscribers",
          ) as boolean;

        const allowSubscribersToChooseResources: boolean =
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.allowSubscribersToChooseResources",
          ) as boolean;

        const allowSubscribersToChooseEventTypes: boolean =
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.allowSubscribersToChooseEventTypes",
          ) as boolean;

        setAllowSubscribersToChooseResources(allowSubscribersToChooseResources);
        setAllowSubscriberToChooseEventTypes(
          allowSubscribersToChooseEventTypes,
        );

        setenableSMSSubscribers(enableSMSSubscribers);
        setenableSlackSubscribers(enableSlackSubscribers);
        setenableMicrosoftTeamsSubscribers(enableMicrosoftTeamsSubscribers);
        setenableEmailSubscribers(enableEmailSubscribers);

        StatusPageUtil.setIsPrivateStatusPage(isPrivateStatusPage);
        setIsPrivateStatusPage(isPrivateStatusPage);
        StatusPageUtil.setRequiresMasterPassword(enableMasterPassword);

        const statusPageId: string | null = JSONFunctions.getJSONValueInPath(
          masterpage || {},
          "statusPage._id",
        ) as string | null;

        StatusPageUtil.setStatusPageId(
          statusPageId ? new ObjectID(statusPageId.toString()) : null,
        );

        setStatusPageName(statusPageName || "Status Page");

        const fileId: string | null = JSONFunctions.getJSONValueInPath(
          masterpage || {},
          "statusPage.logoFileId",
        ) as string | null;

        setStatusPageLogoFileId(fileId || "");

        setHasEnabledSSO(
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "hasEnabledSSO",
          ) as boolean,
        );

        setForceSSO(
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.requireSsoForLogin",
          ) as boolean,
        );
      }}
    >
      <Suspense fallback={<PageLoader isVisible={true} />}>
        <Routes>
          {/* Live */}
          <PageRoute
            path={RouteMap[PageMap.OVERVIEW]?.toString() || ""}
            element={
              <Overview
                pageRoute={RouteMap[PageMap.OVERVIEW] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.FORBIDDEN]?.toString() || ""}
            element={
              <PageForbidden
                pageRoute={RouteMap[PageMap.FORBIDDEN] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.LOGIN]?.toString() || ""}
            element={
              <Login
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                forceSSO={forceSSO}
                hasEnabledSSOConfig={hasEnabledSSO}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.MASTER_PASSWORD]?.toString() || ""}
            element={
              <MasterPassword
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.SSO]?.toString() || ""}
            element={
              <Sso
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.RESET_PASSWORD]?.toString() || ""}
            element={
              <ResetPassword
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                forceSSO={forceSSO}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.FORGOT_PASSWORD]?.toString() || ""}
            element={
              <ForgotPassword
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                forceSSO={forceSSO}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.SCHEDULED_EVENT_DETAIL]?.toString() || ""}
            element={
              <ScheduledEventDetail
                pageRoute={RouteMap[PageMap.SCHEDULED_EVENT_DETAIL] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.SCHEDULED_EVENT_LIST]?.toString() || ""}
            element={
              <ScheduledEventList
                pageRoute={RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.INCIDENT_DETAIL]?.toString() || ""}
            element={
              <IncidentDetail
                pageRoute={RouteMap[PageMap.INCIDENT_DETAIL] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.INCIDENT_LIST]?.toString() || ""}
            element={
              <IncidentList
                pageRoute={RouteMap[PageMap.INCIDENT_LIST] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.ANNOUNCEMENT_DETAIL]?.toString() || ""}
            element={
              <AnnouncementDetail
                pageRoute={RouteMap[PageMap.ANNOUNCEMENT_DETAIL] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.ANNOUNCEMENT_LIST]?.toString() || ""}
            element={
              <AnnouncementList
                pageRoute={RouteMap[PageMap.ANNOUNCEMENT_LIST] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.SUBSCRIBE_EMAIL]?.toString() || ""}
            element={
              <EmailSubscribe
                pageRoute={RouteMap[PageMap.SUBSCRIBE_EMAIL] as Route}
                allowSubscribersToChooseResources={
                  allowSubscribersToChooseResources
                }
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                enableEmailSubscribers={enableEmailSubscribers}
                enableSMSSubscribers={enableSMSSubscribers}
                enableSlackSubscribers={enableSlackSubscribers}
                enableMicrosoftTeamsSubscribers={
                  enableMicrosoftTeamsSubscribers
                }
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.SUBSCRIBE_SMS]?.toString() || ""}
            element={
              <SMSSubscribe
                pageRoute={RouteMap[PageMap.SUBSCRIBE_SMS] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                allowSubscribersToChooseResources={
                  allowSubscribersToChooseResources
                }
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                enableEmailSubscribers={enableEmailSubscribers}
                enableSMSSubscribers={enableSMSSubscribers}
                enableSlackSubscribers={enableSlackSubscribers}
                enableMicrosoftTeamsSubscribers={
                  enableMicrosoftTeamsSubscribers
                }
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.UPDATE_SUBSCRIPTION]?.toString() || ""}
            element={
              <UpdateSubscription
                pageRoute={RouteMap[PageMap.UPDATE_SUBSCRIPTION] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                allowSubscribersToChooseResources={
                  allowSubscribersToChooseResources
                }
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                enableEmailSubscribers={enableEmailSubscribers}
                enableSMSSubscribers={enableSMSSubscribers}
                enableSlackSubscribers={enableSlackSubscribers}
                enableMicrosoftTeamsSubscribers={
                  enableMicrosoftTeamsSubscribers
                }
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.CONFIRM_SUBSCRIPTION]?.toString() || ""}
            element={
              <ConfirmSubscription
                pageRoute={RouteMap[PageMap.CONFIRM_SUBSCRIPTION] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.SUBSCRIBE_SLACK]?.toString() || ""}
            element={
              <SlackSubscribe
                pageRoute={RouteMap[PageMap.SUBSCRIBE_SLACK] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                allowSubscribersToChooseResources={
                  allowSubscribersToChooseResources
                }
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                enableEmailSubscribers={enableEmailSubscribers}
                enableSMSSubscribers={enableSMSSubscribers}
                enableSlackSubscribers={enableSlackSubscribers}
                enableMicrosoftTeamsSubscribers={
                  enableMicrosoftTeamsSubscribers
                }
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.SUBSCRIBE_MICROSOFT_TEAMS]?.toString() || ""}
            element={
              <MicrosoftTeamsSubscribe
                pageRoute={RouteMap[PageMap.SUBSCRIBE_MICROSOFT_TEAMS] as Route}
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                allowSubscribersToChooseResources={
                  allowSubscribersToChooseResources
                }
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                enableEmailSubscribers={enableEmailSubscribers}
                enableSMSSubscribers={enableSMSSubscribers}
                enableSlackSubscribers={enableSlackSubscribers}
                enableMicrosoftTeamsSubscribers={
                  enableMicrosoftTeamsSubscribers
                }
              />
            }
          />

          {/* Preview */}

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_OVERVIEW]?.toString() || ""}
            element={
              <Overview
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={RouteMap[PageMap.PREVIEW_OVERVIEW] as Route}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_SUBSCRIBE_EMAIL]?.toString() || ""}
            element={
              <EmailSubscribe
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={RouteMap[PageMap.PREVIEW_SUBSCRIBE_EMAIL] as Route}
                allowSubscribersToChooseResources={
                  allowSubscribersToChooseResources
                }
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                enableEmailSubscribers={enableEmailSubscribers}
                enableSMSSubscribers={enableSMSSubscribers}
                enableSlackSubscribers={enableSlackSubscribers}
                enableMicrosoftTeamsSubscribers={
                  enableMicrosoftTeamsSubscribers
                }
              />
            }
          />

          <PageRoute
            path={
              RouteMap[PageMap.PREVIEW_UPDATE_SUBSCRIPTION]?.toString() || ""
            }
            element={
              <UpdateSubscription
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={
                  RouteMap[PageMap.PREVIEW_UPDATE_SUBSCRIPTION] as Route
                }
                allowSubscribersToChooseResources={
                  allowSubscribersToChooseResources
                }
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                enableEmailSubscribers={enableEmailSubscribers}
                enableSMSSubscribers={enableSMSSubscribers}
                enableSlackSubscribers={enableSlackSubscribers}
                enableMicrosoftTeamsSubscribers={
                  enableMicrosoftTeamsSubscribers
                }
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_SUBSCRIBE_SMS]?.toString() || ""}
            element={
              <SMSSubscribe
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                pageRoute={RouteMap[PageMap.PREVIEW_SUBSCRIBE_SMS] as Route}
                allowSubscribersToChooseResources={
                  allowSubscribersToChooseResources
                }
                enableEmailSubscribers={enableEmailSubscribers}
                enableSMSSubscribers={enableSMSSubscribers}
                enableSlackSubscribers={enableSlackSubscribers}
                enableMicrosoftTeamsSubscribers={
                  enableMicrosoftTeamsSubscribers
                }
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_SUBSCRIBE_SLACK]?.toString() || ""}
            element={
              <SlackSubscribe
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                pageRoute={RouteMap[PageMap.PREVIEW_SUBSCRIBE_SLACK] as Route}
                allowSubscribersToChooseResources={
                  allowSubscribersToChooseResources
                }
                enableEmailSubscribers={enableEmailSubscribers}
                enableSMSSubscribers={enableSMSSubscribers}
                enableSlackSubscribers={enableSlackSubscribers}
                enableMicrosoftTeamsSubscribers={
                  enableMicrosoftTeamsSubscribers
                }
              />
            }
          />

          <PageRoute
            path={
              RouteMap[PageMap.PREVIEW_SUBSCRIBE_MICROSOFT_TEAMS]?.toString() ||
              ""
            }
            element={
              <MicrosoftTeamsSubscribe
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                pageRoute={
                  RouteMap[PageMap.PREVIEW_SUBSCRIBE_MICROSOFT_TEAMS] as Route
                }
                allowSubscribersToChooseResources={
                  allowSubscribersToChooseResources
                }
                enableEmailSubscribers={enableEmailSubscribers}
                enableSMSSubscribers={enableSMSSubscribers}
                enableSlackSubscribers={enableSlackSubscribers}
                enableMicrosoftTeamsSubscribers={
                  enableMicrosoftTeamsSubscribers
                }
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_LOGOUT]?.toString() || ""}
            element={<Logout />}
          />

          <PageRoute
            path={RouteMap[PageMap.LOGOUT]?.toString() || ""}
            element={<Logout />}
          />

          <PageRoute
            path={
              RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL]?.toString() || ""
            }
            element={
              <ScheduledEventDetail
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={
                  RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL] as Route
                }
              />
            }
          />

          <PageRoute
            path={
              RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_LIST]?.toString() || ""
            }
            element={
              <ScheduledEventList
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={
                  RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_LIST] as Route
                }
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL]?.toString() || ""}
            element={
              <IncidentDetail
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL] as Route}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_INCIDENT_LIST]?.toString() || ""}
            element={
              <IncidentList
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route}
              />
            }
          />

          <PageRoute
            path={
              RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_DETAIL]?.toString() || ""
            }
            element={
              <AnnouncementDetail
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={
                  RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_DETAIL] as Route
                }
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_LIST]?.toString() || ""}
            element={
              <AnnouncementList
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={RouteMap[PageMap.PREVIEW_ANNOUNCEMENT_LIST] as Route}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_FORBIDDEN]?.toString() || ""}
            element={
              <PageForbidden
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={RouteMap[PageMap.PREVIEW_FORBIDDEN] as Route}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_LOGIN]?.toString() || ""}
            element={
              <Login
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                forceSSO={forceSSO}
                hasEnabledSSOConfig={hasEnabledSSO}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_MASTER_PASSWORD]?.toString() || ""}
            element={
              <MasterPassword
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_RESET_PASSWORD]?.toString() || ""}
            element={
              <ResetPassword
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                forceSSO={forceSSO}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_FORGOT_PASSWORD]?.toString() || ""}
            element={
              <ForgotPassword
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                forceSSO={forceSSO}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_SSO]?.toString() || ""}
            element={
              <Sso
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
              />
            }
          />

          <PageRoute
            path={
              RouteMap[PageMap.PREVIEW_CONFIRM_SUBSCRIPTION]?.toString() || ""
            }
            element={
              <ConfirmSubscription
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={
                  RouteMap[PageMap.PREVIEW_CONFIRM_SUBSCRIPTION] as Route
                }
              />
            }
          />

          {/* 👇️ only match this when no other routes match */}

          <PageRoute
            path="*"
            element={
              <PageNotFound
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                pageRoute={RouteMap[PageMap.NOT_FOUND] as Route}
              />
            }
          />
        </Routes>
      </Suspense>
    </MasterPage>
  );
};

export default App;
