import MasterPage from "./Components/MasterPage/MasterPage";
import PageMap from "./Utils/PageMap";
import RouteMap, { RouteUtil } from "./Utils/RouteMap";
import StatusPageUtil from "./Utils/StatusPage";
import { ManageLinkChannels } from "./Pages/Subscribe/ManageLinkRequestPage";
import {
  executeStatusPageCustomJavaScript,
  getPermittedStatusPageCustomization,
} from "./Utils/StatusPageCustomizations";
import i18n from "./Utils/i18n";
import Route from "Common/Types/API/Route";
import { VoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import { RouteFallbackSkeleton } from "./Components/Skeleton/PageSkeletons";
import Navigation from "Common/UI/Utils/Navigation";
import React, { useState, lazy, Suspense } from "react";
import {
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

// Lazy load all page components from a single barrel (minimizes chunk count)
type AllPagesModule = typeof import("./Pages/AllPages");
const ForgotPassword: React.LazyExoticComponent<
  AllPagesModule["ForgotPassword"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.ForgotPassword,
    };
  });
});
const Login: React.LazyExoticComponent<AllPagesModule["Login"]> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.Login };
  });
});
const Logout: React.LazyExoticComponent<AllPagesModule["Logout"]> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.Logout };
  });
});
const ResetPassword: React.LazyExoticComponent<
  AllPagesModule["ResetPassword"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.ResetPassword };
  });
});
const MasterPassword: React.LazyExoticComponent<
  AllPagesModule["MasterPassword"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.MasterPassword,
    };
  });
});
const Sso: React.LazyExoticComponent<AllPagesModule["Sso"]> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.Sso };
  });
});
const AnnouncementDetail: React.LazyExoticComponent<
  AllPagesModule["AnnouncementDetail"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.AnnouncementDetail,
    };
  });
});
const AnnouncementList: React.LazyExoticComponent<
  AllPagesModule["AnnouncementList"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.AnnouncementList,
    };
  });
});
const IncidentDetail: React.LazyExoticComponent<
  AllPagesModule["IncidentDetail"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.IncidentDetail,
    };
  });
});
const IncidentList: React.LazyExoticComponent<AllPagesModule["IncidentList"]> =
  lazy(() => {
    return import("./Pages/AllPages").then((m: AllPagesModule) => {
      return { default: m.IncidentList };
    });
  });
const PageNotFound: React.LazyExoticComponent<AllPagesModule["PageNotFound"]> =
  lazy(() => {
    return import("./Pages/AllPages").then((m: AllPagesModule) => {
      return { default: m.PageNotFound };
    });
  });
const Overview: React.LazyExoticComponent<AllPagesModule["Overview"]> = lazy(
  () => {
    return import("./Pages/AllPages").then((m: AllPagesModule) => {
      return { default: m.Overview };
    });
  },
);
const ScheduledEventDetail: React.LazyExoticComponent<
  AllPagesModule["ScheduledEventDetail"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.ScheduledEventDetail,
    };
  });
});
const ScheduledEventList: React.LazyExoticComponent<
  AllPagesModule["ScheduledEventList"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.ScheduledEventList,
    };
  });
});
const EmailSubscribe: React.LazyExoticComponent<
  AllPagesModule["EmailSubscribe"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.EmailSubscribe,
    };
  });
});
const SMSSubscribe: React.LazyExoticComponent<AllPagesModule["SMSSubscribe"]> =
  lazy(() => {
    return import("./Pages/AllPages").then((m: AllPagesModule) => {
      return { default: m.SMSSubscribe };
    });
  });
const UpdateSubscription: React.LazyExoticComponent<
  AllPagesModule["UpdateSubscription"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.UpdateSubscription,
    };
  });
});
const ConfirmSubscription: React.LazyExoticComponent<
  AllPagesModule["ConfirmSubscription"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.ConfirmSubscription,
    };
  });
});
const Unsubscribe: React.LazyExoticComponent<AllPagesModule["Unsubscribe"]> =
  lazy(() => {
    return import("./Pages/AllPages").then((m: AllPagesModule) => {
      return { default: m.Unsubscribe };
    });
  });
const SlackSubscribe: React.LazyExoticComponent<
  AllPagesModule["SlackSubscribe"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.SlackSubscribe,
    };
  });
});
const MicrosoftTeamsSubscribe: React.LazyExoticComponent<
  AllPagesModule["MicrosoftTeamsSubscribe"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.MicrosoftTeamsSubscribe,
    };
  });
});
const WebhookSubscribe: React.LazyExoticComponent<
  AllPagesModule["WebhookSubscribe"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return {
      default: m.WebhookSubscribe,
    };
  });
});
const PageForbidden: React.LazyExoticComponent<
  AllPagesModule["PageForbidden"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.PageForbidden };
  });
});

// The token-free form of a token-bearing route (see RouteUtil.tokenFreeRoute).
type TokenFreeRouteFunction = (route: string) => string;

const tokenFreeRoute: TokenFreeRouteFunction = (route: string): string => {
  return RouteUtil.tokenFreeRoute(route);
};

const App: () => JSX.Element = () => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const isPreview: boolean = StatusPageUtil.isPreviewPage();
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
  const [enableWebhookSubscribers, setenableWebhookSubscribers] =
    useState<boolean>(false);
  /*
   * The page takes only its private users as subscribers: a reader
   * subscribes by email, with the address they sign in with
   * (Common/Types/StatusPage/SubscriberRestrictions).
   */
  const [subscribeWithSignInEmail, setSubscribeWithSignInEmail] =
    useState<boolean>(false);
  const [statusPageName, setStatusPageName] = useState<string>("");
  const [statusPageLogoFileId, setStatusPageLogoFileId] = useState<string>("");
  // The logo made for the dark theme, shown instead while the page is dark.
  const [statusPageDarkThemeLogoFileId, setStatusPageDarkThemeLogoFileId] =
    useState<string>("");
  const [isPrivateStatusPage, setIsPrivateStatusPage] =
    useState<boolean>(false);

  /*
   * The channels whose Subscribe page has a Manage Existing Subscription tab,
   * for the unsubscribe page's way to a new link - and, of them, email and
   * SMS for the Confirm Subscription page's, when a link to confirm has
   * expired.
   */
  const manageLinkChannels: ManageLinkChannels = {
    enableEmailSubscribers: enableEmailSubscribers,
    enableSMSSubscribers: enableSMSSubscribers,
    enableSlackSubscribers: enableSlackSubscribers,
    enableMicrosoftTeamsSubscribers: enableMicrosoftTeamsSubscribers,
  };

  const [hasEnabledSSO, setHasEnabledSSO] = useState<boolean>(false);
  const [forceSSO, setForceSSO] = useState<boolean>(false);

  const [javascript, setJavaScript] = useState<string | null>(null);
  const [allowStatusPageCustomizations, setAllowStatusPageCustomizations] =
    useState<boolean>(false);

  const onPageLoadComplete: VoidFunction = (): void => {
    executeStatusPageCustomJavaScript(javascript, {
      allowStatusPageCustomizations: allowStatusPageCustomizations,
      isPreview: isPreview,
    });
  };

  return (
    <MasterPage
      isPreview={isPreview}
      enableSMSSubscribers={enableSMSSubscribers}
      enableEmailSubscribers={enableEmailSubscribers}
      enableSlackSubscribers={enableSlackSubscribers}
      enableMicrosoftTeamsSubscribers={enableMicrosoftTeamsSubscribers}
      enableWebhookSubscribers={enableWebhookSubscribers}
      isPrivateStatusPage={isPrivateStatusPage}
      onLoadComplete={(masterpage: JSONObject) => {
        const serverAllowsStatusPageCustomizations: boolean =
          masterpage["allowStatusPageCustomizations"] === true;

        setAllowStatusPageCustomizations(serverAllowsStatusPageCustomizations);

        document.title =
          (JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.pageTitle",
          ) as string | null) || i18n.t("common.statusPage");

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
        setJavaScript(
          getPermittedStatusPageCustomization(javascript, {
            allowStatusPageCustomizations: serverAllowsStatusPageCustomizations,
            isPreview: isPreview,
          }),
        );

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

        const enableWebhookSubscribers: boolean =
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.enableWebhookSubscribers",
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

        const limitSubscribersToPrivateUsers: boolean =
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.limitSubscribersToPrivateUsers",
          ) === true;

        // A page that takes only its private users takes only their email.
        setSubscribeWithSignInEmail(limitSubscribersToPrivateUsers);
        setenableSMSSubscribers(
          enableSMSSubscribers && !limitSubscribersToPrivateUsers,
        );
        setenableSlackSubscribers(
          enableSlackSubscribers && !limitSubscribersToPrivateUsers,
        );
        setenableMicrosoftTeamsSubscribers(
          enableMicrosoftTeamsSubscribers && !limitSubscribersToPrivateUsers,
        );
        setenableWebhookSubscribers(
          enableWebhookSubscribers && !limitSubscribersToPrivateUsers,
        );
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

        const darkThemeLogoFileId: string | null =
          JSONFunctions.getJSONValueInPath(
            masterpage || {},
            "statusPage.darkThemeLogoFileId",
          ) as string | null;

        setStatusPageDarkThemeLogoFileId(darkThemeLogoFileId || "");

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
      <Suspense fallback={<RouteFallbackSkeleton />}>
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
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
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
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.SSO]?.toString() || ""}
            element={
              <Sso
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
                forceSSO={forceSSO}
              />
            }
          />

          <PageRoute
            path={tokenFreeRoute(
              RouteMap[PageMap.RESET_PASSWORD]?.toString() || "",
            )}
            element={
              <ResetPassword
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
                forceSSO={forceSSO}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.RESET_PASSWORD]?.toString() || ""}
            element={
              <ResetPassword
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
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
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
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
                subscribeWithSignInEmail={subscribeWithSignInEmail}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
              />
            }
          />

          {/*
           * The subscriber's manage page, in both the form its link arrives in
           * and the token-free form SensitiveUrlToken leaves in the address
           * bar - which is also where the unsubscribe page's "manage instead"
           * link goes. The page reads the link's credential from the session,
           * not from the route.
           */}
          <PageRoute
            path={tokenFreeRoute(
              RouteMap[PageMap.UPDATE_SUBSCRIPTION]?.toString() || "",
            )}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
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
                signUpChannels={manageLinkChannels}
              />
            }
          />

          {/*
           * The unsubscribe page, in both the form its link arrives in and the
           * token-free form SensitiveUrlToken leaves in the address bar. Like
           * the sign-in pages it runs none of the page's custom JavaScript.
           */}
          <PageRoute
            path={tokenFreeRoute(
              RouteMap[PageMap.UNSUBSCRIBE]?.toString() || "",
            )}
            element={
              <Unsubscribe
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
                manageLinkChannels={manageLinkChannels}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.UNSUBSCRIBE]?.toString() || ""}
            element={
              <Unsubscribe
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
                manageLinkChannels={manageLinkChannels}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.SUBSCRIBE_WEBHOOKS]?.toString() || ""}
            element={
              <WebhookSubscribe
                pageRoute={RouteMap[PageMap.SUBSCRIBE_WEBHOOKS] as Route}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
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
                subscribeWithSignInEmail={subscribeWithSignInEmail}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
              />
            }
          />

          <PageRoute
            path={tokenFreeRoute(
              RouteMap[PageMap.PREVIEW_UPDATE_SUBSCRIPTION]?.toString() || "",
            )}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
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
                enableWebhookSubscribers={enableWebhookSubscribers}
              />
            }
          />

          <PageRoute
            path={
              RouteMap[PageMap.PREVIEW_SUBSCRIBE_WEBHOOKS]?.toString() || ""
            }
            element={
              <WebhookSubscribe
                onLoadComplete={() => {
                  onPageLoadComplete();
                }}
                allowSubscribersToChooseEventTypes={
                  allowSubscriberToChooseEventTypes
                }
                pageRoute={
                  RouteMap[PageMap.PREVIEW_SUBSCRIBE_WEBHOOKS] as Route
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
                enableWebhookSubscribers={enableWebhookSubscribers}
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
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
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
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
              />
            }
          />

          <PageRoute
            path={tokenFreeRoute(
              RouteMap[PageMap.PREVIEW_RESET_PASSWORD]?.toString() || "",
            )}
            element={
              <ResetPassword
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
                forceSSO={forceSSO}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_RESET_PASSWORD]?.toString() || ""}
            element={
              <ResetPassword
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
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
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
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
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
                forceSSO={forceSSO}
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
                signUpChannels={manageLinkChannels}
              />
            }
          />

          <PageRoute
            path={tokenFreeRoute(
              RouteMap[PageMap.PREVIEW_UNSUBSCRIBE]?.toString() || "",
            )}
            element={
              <Unsubscribe
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
                manageLinkChannels={manageLinkChannels}
              />
            }
          />

          <PageRoute
            path={RouteMap[PageMap.PREVIEW_UNSUBSCRIBE]?.toString() || ""}
            element={
              <Unsubscribe
                statusPageName={statusPageName}
                logoFileId={new ObjectID(statusPageLogoFileId)}
                darkThemeLogoFileId={
                  new ObjectID(statusPageDarkThemeLogoFileId)
                }
                manageLinkChannels={manageLinkChannels}
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
