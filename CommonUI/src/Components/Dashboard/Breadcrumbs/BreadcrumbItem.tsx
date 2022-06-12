import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import Navigation from '../../../Utils/Navigation';

export interface ComponentProps { 
    title: string, 
    route?: Route
}

const BreadcrumbItem: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {
    return (<p onClick={() => {
        if (props.route) {
            Navigation.navigate(props.route);
        }
    }}>
        { props.title }
    </p>)
}

export default BreadcrumbItem;