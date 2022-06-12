import Route from 'Common/Types/API/Route';
import React, {
    FunctionComponent,
    MouseEventHandler,
    ReactElement,
} from 'react';
import Navigation from '../../../../Utils/Navigation';

export interface ComponentProps {
    title: string;
    onClick?: MouseEventHandler;
    route?: Route;
}

const MenuItem: FunctionComponent<ComponentProps> = ({
    onClick,
    title,
    route
}: ComponentProps): ReactElement => {
    return (
        <div className="dropdownButtonListItem" onClick={route ? () => {
            Navigation.navigate(route);
        } : onClick
        }>
            {title}
        </div>
    );
};

export default MenuItem;
