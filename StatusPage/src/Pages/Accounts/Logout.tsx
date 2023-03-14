import React, { FunctionComponent, useEffect } from 'react';
import Navigation from 'CommonUI/src/Utils/Navigation';
import UserUtil from '../../Utils/User';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    isPreviewPage: boolean;
    statusPageId: ObjectID
}

const Logout: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    useEffect(() => {

        if (props.statusPageId) {

            UserUtil.logout(props.statusPageId);
            Navigation.navigate(
                props.isPreviewPage
                    ? RouteUtil.populateRouteParams(RouteMap[PageMap.PREVIEW_LOGIN]!, props.statusPageId)
                    : RouteUtil.populateRouteParams(RouteMap[PageMap.LOGIN]!, props.statusPageId)
            );
        }
    }, [props.statusPageId]);

    return <PageLoader isVisible={true} />;
};

export default Logout;
