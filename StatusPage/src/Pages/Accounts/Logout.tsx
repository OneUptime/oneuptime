import React, { useEffect } from 'react';
import Navigation from 'CommonUI/src/Utils/Navigation';
import UserUtil from '../../Utils/User';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import StatusPageUtil from '../../Utils/StatusPage';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import Route from 'Common/Types/API/Route';

const Logout: () => JSX.Element = () => {
    const [error, setError] = React.useState<string | null>(null);

    const logout: Function = async () => {
        if (StatusPageUtil.getStatusPageId()) {
            await UserUtil.logout(StatusPageUtil.getStatusPageId()!);
            const navRoute: Route = StatusPageUtil.isPreviewPage()
                ? RouteUtil.populateRouteParams(
                      RouteMap[PageMap.PREVIEW_LOGIN]!,
                      StatusPageUtil.getStatusPageId()!
                  )
                : RouteUtil.populateRouteParams(
                      RouteMap[PageMap.LOGIN]!,
                      StatusPageUtil.getStatusPageId()!
                  );
            Navigation.navigate(navRoute, {
                forceNavigate: true,
            });
        }
    };

    useEffect(() => {
        logout().catch((error: Error) => {
            setError(error.message || error.toString());
        });
    }, [StatusPageUtil.getStatusPageId()]);

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return <PageLoader isVisible={true} />;
};

export default Logout;
