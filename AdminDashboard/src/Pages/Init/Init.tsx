import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageLoader from "Common/UI/src/Components/Loader/PageLoader";
import Page from "Common/UI/src/Components/Page/Page";
import Navigation from "Common/UI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

const Init: FunctionComponent = (): ReactElement => {
  useEffect(() => {
    Navigation.navigate(RouteMap[PageMap.USERS]!, {
      forceNavigate: true,
    });
  }, []);

  return (
    <Page title={""} breadcrumbLinks={[]}>
      <PageLoader isVisible={true} />
    </Page>
  );
};

export default Init;
