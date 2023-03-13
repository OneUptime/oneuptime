import React, { FunctionComponent, useEffect } from 'react';
import Navigation from 'CommonUI/src/Utils/Navigation';
import UserUtil from '../../Utils/User';
import ObjectID from 'Common/Types/ObjectID';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';

export interface ComponentProps {
    statusPageId: ObjectID | null;
    isPreviewPage: boolean;
    statusPageName: string;
    logoFileId: ObjectID;
    isPrivatePage: boolean;
}

const Logout: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    useEffect(() => {

        UserUtil.logout();
        Navigation.navigate(props.isPreviewPage ? RouteMap[PageMap.PREVIEW_LOGIN]! : RouteMap[PageMap.LOGIN]!);
        
    }, []);

    return (
        <PageLoader isVisible={true} />
    );
};

export default Logout;
