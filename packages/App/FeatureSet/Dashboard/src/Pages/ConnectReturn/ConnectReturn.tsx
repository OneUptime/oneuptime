import { RoutesProps } from "../../Types/RoutesProps";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import { getConnectReturnPath } from "../../Utils/Workspace/ConnectCallbackMessage";
import Route from "Common/Types/API/Route";
import {
  CONNECT_ERROR_QUERY_PARAM,
  CONNECT_PROVIDER_QUERY_PARAM,
} from "Common/Types/Workspace/ConnectCallback";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * Where a Slack, Microsoft Teams or GitHub connection comes back to when the
 * server cannot tell which project it was for: its one-use link was unknown,
 * had expired, had been used, or was brought back by another browser - or
 * GitHub sent the browser back on its own, after an installation was changed
 * on GitHub. Nothing in such a redirect may choose a project, so the project
 * the person has open is the one it is shown in: this passes the browser on
 * to the provider's page there, with the code the callback answered with,
 * where the page says what happened and its Connect button is right there to
 * start again (Utils/Workspace/ConnectCallbackMessage).
 *
 * It passes the browser on in place of itself, so Back does not land here to
 * be passed on again. Someone with no project yet is sent to create one, as
 * the Dashboard's landing page sends them.
 */
const ConnectReturn: FunctionComponent<RoutesProps> = (
  props: RoutesProps,
): ReactElement => {
  useEffect(() => {
    const projectId: string | undefined = props.currentProject?._id?.toString();

    if (!projectId) {
      return;
    }

    Navigation.navigate(
      new Route(
        getConnectReturnPath({
          projectId: projectId,
          provider: Navigation.getQueryStringByName(
            CONNECT_PROVIDER_QUERY_PARAM,
          ),
          error: Navigation.getQueryStringByName(CONNECT_ERROR_QUERY_PARAM),
        }),
      ),
      { replace: true },
    );
  }, [props.currentProject?._id]);

  useEffect(() => {
    if (!props.isLoading && props.projects.length === 0) {
      Navigation.navigate(RouteMap[PageMap.WELCOME] as Route, {
        replace: true,
      });
    }
  }, [props.projects, props.isLoading]);

  return (
    <Page title={""} breadcrumbLinks={[]}>
      <PageLoader isVisible={true} />
    </Page>
  );
};

export default ConnectReturn;
