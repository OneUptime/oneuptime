import API from "../../Utils/API";
import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import LoginUtil from "../../Utils/Login";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import StatusPageUtil from "../../Utils/StatusPage";
import Banner from "../Banner/Banner";
import Footer from "../Footer/Footer";
import Header from "../Header/Header";
import NavBar from "../NavBar/NavBar";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import JSONWebTokenData from "Common/Types/JsonWebTokenData";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import MasterPage from "Common/UI/Components/MasterPage/MasterPage";
import JSONWebToken from "Common/UI/Utils/JsonWebToken";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  onLoadComplete: (masterPage: JSONObject) => void;
  isPreview: boolean;
  isPrivateStatusPage: boolean;
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
  enableSlackSubscribers?: boolean;
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [masterPageData, setMasterPageData] = useState<JSONObject | null>(null);

  const [statusPageId, setStatusPageId] = useState<ObjectID | null>(null);

  const [headerHtml, setHeaderHtml] = useState<null | string>(null);
  const [footerHtml, setFooterHTML] = useState<null | string>(null);

  const [statusPage, setStatusPage] = useState<StatusPage | null>(null);

  const [hidePoweredByOneUptimeBranding, setHidePoweredByOneUptimeBranding] =
    useState<boolean>(false);

  useEffect(() => {
    // if there is an SSO token. We need to save that to localstorage.

    const token: string | null = Navigation.getQueryStringByName("token");

    if (token && statusPageId) {
      // set token.

      const logoutRoute: Route = props.isPreview
        ? RouteUtil.populateRouteParams(
            RouteMap[PageMap.PREVIEW_LOGOUT]!,
            statusPageId,
          )
        : RouteUtil.populateRouteParams(
            RouteMap[PageMap.LOGOUT]!,
            statusPageId,
          );

      const decodedtoken: JSONWebTokenData | null = JSONWebToken.decode(
        token,
      ) as JSONWebTokenData;

      if (!decodedtoken) {
        alert("Invalid Token. Please log in again.");
        return Navigation.navigate(logoutRoute);
      }

      if (!decodedtoken.userId.toString()) {
        alert("User ID not found in Token. Logging out.");
        return Navigation.navigate(logoutRoute);
      }

      LoginUtil.login({
        user: { ...decodedtoken, _id: decodedtoken.userId },
        token: token,
      });

      if (!decodedtoken.statusPageId) {
        alert("Status Page ID not found in the token. Logging out.");
        return Navigation.navigate(logoutRoute);
      }

      if (Navigation.getQueryStringByName("redirectUrl")) {
        Navigation.navigate(
          new Route(Navigation.getQueryStringByName("redirectUrl")!),
          { forceNavigate: true },
        );
      } else {
        Navigation.navigate(
          !props.isPreview
            ? RouteUtil.populateRouteParams(
                RouteMap[PageMap.OVERVIEW]!,
                statusPageId,
              )
            : RouteUtil.populateRouteParams(
                RouteMap[PageMap.PREVIEW_OVERVIEW]!,
                statusPageId,
              ),
          { forceNavigate: true },
        );
      }
    }
  }, [statusPageId]);

  type GetIdFunction = () => Promise<ObjectID>;

  const getId: GetIdFunction = async (): Promise<ObjectID> => {
    if (StatusPageUtil.isPreviewPage()) {
      const id: string | null = Navigation.getParamByName(
        RouteParams.StatusPageId,
        RouteMap[PageMap.PREVIEW_OVERVIEW]!,
      );
      if (id) {
        return new ObjectID(id);
      }
    }
    // get status page id by hostname.
    const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
      url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(`/domain`),
      data: {
        domain: Navigation.getHostname().toString(),
      },
      headers: {},
    });

    if (response.data && response.data["statusPageId"]) {
      return new ObjectID(response.data["statusPageId"] as string);
    }

    throw new BadDataException("Status Page ID not found");
  };

  useAsyncEffect(async () => {
    try {
      setIsLoading(true);

      const id: ObjectID = await getId();

      setStatusPageId(id);

      StatusPageUtil.setStatusPageId(id);

      const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
        url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
          `/master-page/${id.toString()}`,
        ),
        data: {},
        headers: {},
      });

      setMasterPageData(response.data);

      // set status page.
      const statusPage: StatusPage = BaseModel.fromJSONObject(
        (response.data["statusPage"] as JSONObject) || [],
        StatusPage,
      );

      setStatusPage(statusPage);

      // setcss.
      const css: string | null = statusPage.customCSS || null;
      if (css) {
        const style: any = document.createElement("style");
        style.innerText = css;
        (document as any).getElementsByTagName("head")[0].appendChild(style);
      }

      const headHtml: string | null = statusPage.headerHTML || null;

      const hidePoweredByOneUptimeBranding: boolean | null =
        statusPage.hidePoweredByOneUptimeBranding || false;

      setHidePoweredByOneUptimeBranding(
        Boolean(hidePoweredByOneUptimeBranding),
      );

      const footHTML: string | null = statusPage.footerHTML || null;

      if (headHtml) {
        setHeaderHtml(headHtml);
      }

      if (footHTML) {
        setFooterHTML(footHTML);
      }

      props.onLoadComplete(response.data);

      // check SSO token.

      setIsLoading(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (
    Navigation.getCurrentRoute().toString().includes("login") ||
    Navigation.getCurrentRoute().toString().includes("forgot-password") ||
    Navigation.getCurrentRoute().toString().includes("reset-password") ||
    Navigation.getCurrentRoute().toString().includes("sso") ||
    Navigation.getCurrentRoute().toString().includes("forbidden") ||
    Navigation.getCurrentRoute().toString().includes("master-password")
  ) {
    return <>{props.children}</>;
  }

  const logo: BaseModel =
    (JSONFunctions.getJSONValueInPath(
      masterPageData || {},
      "statusPage.logoFile",
    ) as BaseModel) || undefined;

  const links: Array<Link> = (
    (JSONFunctions.getJSONValueInPath(
      masterPageData || {},
      "headerLinks",
    ) as Array<JSONObject>) || []
  ).map((link: JSONObject) => {
    return {
      title: link["title"] as string,
      to: link["link"] as URL,
      openInNewTab: true,
    };
  });

  return (
    <div className="max-w-5xl m-auto px-3 sm:px-5">
      {
        <div>
          <Banner
            file={
              (JSONFunctions.getJSONValueInPath(
                masterPageData || {},
                "statusPage.coverImageFile",
              ) as BaseModel) || undefined
            }
          />
        </div>
      }
      <MasterPage
        makeTopSectionUnstick={true}
        isLoading={props.isLoading || false}
        error={props.error || ""}
      >
        <>
          {!headerHtml ? (
            <Header
              logo={logo}
              links={links}
              onLogoClicked={() => {
                Navigation.navigate(
                  props.isPreview
                    ? RouteMap[PageMap.PREVIEW_OVERVIEW]!
                    : RouteMap[PageMap.OVERVIEW]!,
                );
              }}
            />
          ) : (
            <div
              dangerouslySetInnerHTML={{
                __html: headerHtml as string,
              }}
            />
          )}
          <NavBar
            isPrivateStatusPage={props.isPrivateStatusPage}
            show={true}
            isPreview={props.isPreview}
            enableEmailSubscribers={props.enableEmailSubscribers}
            enableSMSSubscribers={props.enableSMSSubscribers}
            enableSlackSubscribers={props.enableSlackSubscribers || false}
            showIncidentsOnStatusPage={
              statusPage?.showIncidentsOnStatusPage || false
            }
            showAnnouncementsOnStatusPage={
              statusPage?.showAnnouncementsOnStatusPage || false
            }
            showScheduledMaintenanceEventsOnStatusPage={
              statusPage?.showScheduledMaintenanceEventsOnStatusPage || false
            }
            showSubscriberPageOnStatusPage={
              statusPage?.showSubscriberPageOnStatusPage || false
            }
          />
          {props.children}
          {!footerHtml ? (
            <Footer
              hidePoweredByOneUptimeBranding={hidePoweredByOneUptimeBranding}
              className="mx-auto w-full py-3 px-0 sm:py-5 md:flex md:items-center md:justify-between lg:px-0"
              copyright={
                (JSONFunctions.getJSONValueInPath(
                  masterPageData || {},
                  "statusPage.copyrightText",
                ) as string) || ""
              }
              links={(
                (JSONFunctions.getJSONValueInPath(
                  masterPageData || {},
                  "footerLinks",
                ) as Array<JSONObject>) || []
              ).map((link: JSONObject) => {
                return {
                  title: link["title"] as string,
                  to: link["link"] as URL,
                  openInNewTab: true,
                };
              })}
            />
          ) : (
            <div
              dangerouslySetInnerHTML={{
                __html: footerHtml as string,
              }}
            />
          )}
        </>
      </MasterPage>
    </div>
  );
};

export default DashboardMasterPage;
