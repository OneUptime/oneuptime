import {
  ADMIN_SERVER_PRODUCTS_PATH,
  SERVER_PRODUCT_OFF_GO_HOME_TEST_ID,
  SERVER_PRODUCT_OFF_OPEN_SETTINGS_TEST_ID,
  SERVER_PRODUCT_OFF_PAGE_TEST_ID,
  ServerProductOffCopy,
} from "./ServerProductsCopy";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../Utils/NavigationItems";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { getProductTitle } from "Common/Types/Product/ProductCatalog";
import ProductKey from "Common/Types/Product/ProductKey";
import { ServerProductOffReason } from "Common/Types/Product/ServerProducts";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import { MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import Page from "Common/UI/Components/Page/Page";
import { ADMIN_DASHBOARD_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE PAGE AN ADDRESS OF A PRODUCT SWITCHED OFF ON THE SERVER OPENS (#6815).
 *
 * A bookmark, an old link or the browser's history can still open a page of
 * a product the server's admin switched off. Instead of a broken or empty
 * page, this one says what happened, that nothing was deleted, and what to
 * do next: a master admin opens Admin Dashboard > Settings > Products in one
 * click; anyone else is told who can switch it on and where. When the
 * product is off because telemetry ingestion is stopped, it names the
 * setting that starts it again.
 *
 * App.tsx draws it in place of the page (Utils/ProjectProducts/
 * ProductOfRoute decides which product an address needs).
 */

export interface ComponentProps {
  product: ProductKey;
  reason: ServerProductOffReason;
  /*
   * The page's own product, when the one that is off is another it needs
   * (a guided setup that pages through On-Call Duty).
   */
  pageProduct?: ProductKey | null | undefined;
}

// The product's name as the reader's products menu says it.
const useProductTitle: (product: ProductKey) => string = (
  product: ProductKey,
): string => {
  const navigation: DashboardNavigationItems = useDashboardNavigationItems();
  const item: MoreMenuItem | undefined = navigation.moreMenuItems.find(
    (candidate: MoreMenuItem): boolean => {
      return candidate.key === product;
    },
  );

  return item?.title || getProductTitle(product);
};

const ServerProductOffPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const productTitle: string = useProductTitle(props.product);
  const pageTitle: string = useProductTitle(props.pageProduct || props.product);
  const isMasterAdmin: boolean = User.isMasterAdmin();
  const isIngestionStopped: boolean =
    props.reason === ServerProductOffReason.TelemetryIngestionStopped;

  const title: string = translator.translateTemplate(
    isIngestionStopped
      ? ServerProductOffCopy.ingestionStoppedTitle
      : ServerProductOffCopy.switchedOffTitle,
    { product: productTitle },
  );

  const description: string = isIngestionStopped
    ? translator.translateText(
        ServerProductOffCopy.ingestionStoppedDescription,
      ) || ServerProductOffCopy.ingestionStoppedDescription
    : translator.translateTemplate(
        props.pageProduct
          ? ServerProductOffCopy.neededBySetupDescription
          : ServerProductOffCopy.switchedOffDescription,
        { product: productTitle },
      );

  const nextStep: string =
    translator.translateText(
      isIngestionStopped
        ? ServerProductOffCopy.askAdminForIngestion
        : ServerProductOffCopy.askAdmin,
    ) || "";

  const homeRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.HOME] as Route,
  );

  return (
    <Page
      title={pageTitle}
      breadcrumbLinks={[
        {
          title: translator.translateText("Project") || "Project",
          to: homeRoute,
        },
        {
          title: pageTitle,
          to: Navigation.getCurrentRoute(),
        },
      ]}
    >
      <div data-testid={SERVER_PRODUCT_OFF_PAGE_TEST_ID}>
        <EmptyState
          id={SERVER_PRODUCT_OFF_PAGE_TEST_ID}
          icon={IconProp.Power}
          title={title}
          description={description}
          paddingClassName="pt-24 pb-24"
          footer={
            <div className="flex max-w-xl flex-col items-center gap-4">
              {/*
               * What to do next, under what happened: who can switch it
               * on, and where (or the setting that starts ingestion).
               */}
              <p
                className="text-balance text-sm leading-6 text-gray-600"
                data-testid={`${SERVER_PRODUCT_OFF_PAGE_TEST_ID}-next-step`}
              >
                {nextStep}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {isMasterAdmin && !isIngestionStopped ? (
                  <Button
                    title={translator.translateText(
                      ServerProductOffCopy.openSettings,
                    )}
                    buttonStyle={ButtonStyleType.PRIMARY}
                    icon={IconProp.Settings}
                    dataTestId={SERVER_PRODUCT_OFF_OPEN_SETTINGS_TEST_ID}
                    onClick={() => {
                      Navigation.navigate(
                        URL.fromString(ADMIN_DASHBOARD_URL.toString()).addRoute(
                          ADMIN_SERVER_PRODUCTS_PATH,
                        ),
                      );
                    }}
                  />
                ) : (
                  <></>
                )}
                <Button
                  title={translator.translateText(ServerProductOffCopy.goHome)}
                  buttonStyle={ButtonStyleType.NORMAL}
                  dataTestId={SERVER_PRODUCT_OFF_GO_HOME_TEST_ID}
                  onClick={() => {
                    Navigation.navigate(homeRoute);
                  }}
                />
              </div>
            </div>
          }
        />
      </div>
    </Page>
  );
};

export default ServerProductOffPage;
