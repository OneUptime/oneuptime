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
const PageForbidden: React.LazyExoticComponent<
  AllPagesModule["PageForbidden"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.PageForbidden };
  });
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
