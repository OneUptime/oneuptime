import DashboardSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import PageMap from "@oneuptime/admin-dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/admin-dashboard/Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import API from "Common/UI/Utils/API/API";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import WhiteLabelImageSlot from "./WhiteLabelImageSlot";
import WhiteLabelProductNameCard from "./WhiteLabelProductNameCard";
import {
  fetchWhiteLabelSettings,
  isWhiteLabelAvailable,
  WHITE_LABEL_SETTINGS_PAGE_PATH,
  WhiteLabelImageSlot as Slot,
  WhiteLabelSettingsView,
} from "./WhiteLabelSettingsAPI";

/*
 * Admin Dashboard > Settings > White Label: the name the installation goes
 * by, its logos and its browser tab icon, in place of OneUptime's.
 *
 * Rendered only while the license allows white-labelling. Otherwise - or if
 * the license stops allowing it while the page is open, which the server
 * answers 404 - the page draws nothing at all, exactly as a settings path
 * that does not exist.
 */

const NOT_FOUND_STATUS: number = 404;

const WhiteLabelSettingsPage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const isAvailable: boolean = isWhiteLabelAvailable();

  const [settings, setSettings] = useState<WhiteLabelSettingsView | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(isAvailable);
  const [error, setError] = useState<string>("");
  const [isGone, setIsGone] = useState<boolean>(false);

  useEffect(() => {
    if (!isAvailable) {
      return;
    }

    let isMounted: boolean = true;

    fetchWhiteLabelSettings()
      .then((view: WhiteLabelSettingsView) => {
        if (isMounted) {
          setSettings(view);
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) {
          return;
        }

        if (
          err instanceof HTTPErrorResponse &&
          err.statusCode === NOT_FOUND_STATUS
        ) {
          setIsGone(true);
          return;
        }

        setError(API.getFriendlyMessage(err));
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isAvailable]);

  if (!isAvailable || isGone) {
    return <></>;
  }

  const getContent: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <PageLoader isVisible={true} />;
    }

    if (error || !settings) {
      return (
        <ErrorMessage message={error || "The settings could not be read."} />
      );
    }

    /*
     * Without a logo, the product shows its name when it has one of its own
     * (OneUptime's wordmark reads "OneUptime"), and OneUptime's logo
     * otherwise.
     */
    const withoutLogoText: string = settings.productName
      ? "The product name is shown in its place."
      : "OneUptime's logo is shown.";

    return (
      <div className="space-y-6" data-testid="white-label-settings">
        <WhiteLabelProductNameCard settings={settings} onSaved={setSettings} />

        <Card
          title="Logo"
          description="Shown in the Dashboard and Admin Dashboard headers, on the sign-in pages and at the top of emails."
        >
          <div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <WhiteLabelImageSlot
                slot={Slot.Logo}
                label="Logo for light backgrounds"
                image={settings.logo}
                background="light"
                emptyText={withoutLogoText}
                removedText={
                  settings.productName
                    ? "People will see the product name in its place."
                    : "People will see OneUptime's logo again."
                }
                onSaved={setSettings}
              />
              <WhiteLabelImageSlot
                slot={Slot.DarkLogo}
                label="Logo for dark backgrounds"
                hint="Optional. Used in dark mode; without it, the logo for light backgrounds is used."
                image={settings.darkLogo}
                background="dark"
                emptyText={
                  settings.logo
                    ? "The logo for light backgrounds is used."
                    : withoutLogoText
                }
                removedText="Dark mode will use the logo for light backgrounds."
                onSaved={setSettings}
              />
            </div>
            <p className="mt-4 text-sm text-gray-500">
              PNG, JPEG, GIF, WebP or SVG, up to 512 KB. A wide logo about 32
              pixels tall looks best. Emails show the logo when it is a PNG,
              JPEG or GIF, and the product name otherwise.
            </p>
          </div>
        </Card>

        <Card
          title="Browser tab icon"
          description="The icon in the browser tab of every page, in place of OneUptime's."
        >
          <div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <WhiteLabelImageSlot
                slot={Slot.Favicon}
                label="Browser tab icon"
                image={settings.favicon}
                background="light"
                emptyText="OneUptime's icon is shown."
                removedText="Browser tabs will show OneUptime's icon again."
                isCompact={true}
                onSaved={setSettings}
              />
            </div>
            <p className="mt-4 text-sm text-gray-500">
              PNG, ICO, SVG, GIF, JPEG or WebP, up to 128 KB. A square image of
              at least 32 by 32 pixels looks best.
            </p>
          </div>
        </Card>
      </div>
    );
  };

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "White Label",
          to: getEnterpriseSettingsPageRoute(WHITE_LABEL_SETTINGS_PAGE_PATH),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {getContent()}
    </Page>
  );
};

export default WhiteLabelSettingsPage;
