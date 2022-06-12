import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import Navigation from '../../Utils/Navigation';

export interface ComponentProps {
    children: ReactElement;
    route: Route;
}

const SubPage: FunctionComponent<ComponentProps> = ({
    children,
    route,
}: ComponentProps): ReactElement => {
    if (route.toString() === Navigation.getLocation().toString()) {
        return <div>{children}</div>;
    }

    return <></>;
};

export default SubPage;
