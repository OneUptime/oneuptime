import React, { useEffect } from 'react';
import Navigation from 'CommonUI/src/Utils/Navigation';
import UserUtil from '../../Utils/User';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import StatusPageUtil from '../../Utils/StatusPage';

const Logout: () => JSX.Element = () => {
    useEffect(() => {
        if (StatusPageUtil.getStatusPageId()) {
            UserUtil.logout(StatusPageUtil.getStatusPageId()!);
            Navigation.navigate(
                StatusPageUtil.isPreviewPage()
                    ? RouteUtil.populateRouteParams(
                          RouteMap[PageMap.PREVIEW_LOGIN]!,
                          StatusPageUtil.getStatusPageId()!
                      )
                    : RouteUtil.populateRouteParams(
                          RouteMap[PageMap.LOGIN]!,
                          StatusPageUtil.getStatusPageId()!
                      )
            );
        }
    }, [StatusPageUtil.getStatusPageId()]);

    return <PageLoader isVisible={true} />;
};

export default Logout;
