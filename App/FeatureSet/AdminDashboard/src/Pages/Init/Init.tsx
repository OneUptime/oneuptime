import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import { IS_ENTERPRISE_EDITION } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

const Init: FunctionComponent = (): ReactElement => {
  useEffect(() => {
    // Health is the Enterprise Edition landing page; other builds keep the Users landing.
    Navigation.navigate(
      RouteMap[IS_ENTERPRISE_EDITION ? PageMap.HEALTH : PageMap.USERS]!,
      {
        forceNavigate: true,
      },
    );
  }, []);

  return (
    <Page title={""} breadcrumbLinks={[]}>
      <PageLoader isVisible={true} />
    </Page>
  );
};

export default Init;
