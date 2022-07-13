import React, { FunctionComponent, ReactElement } from 'react';
import PageError from '../Error/PageError';
import PageLoader from '../Loader/PageLoader';

export interface ComponentProps {
    header?: ReactElement;
    footer?: ReactElement;
    navBar?: ReactElement;
    children: ReactElement | Array<ReactElement>;
    isLoading: boolean;
    error: string;
}

const MasterPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    if (props.isLoading) {
        return (
            <React.Fragment>
                <PageLoader isVisible={true} />
            </React.Fragment>)
    }

    if (props.error) {
        return (
            <React.Fragment>
                <PageError message={props.error} />
            </React.Fragment>)
    }
    
    return (
        <React.Fragment>
            <div id="layout-wrapper">
                {props.header && props.header}
                {props.navBar && props.navBar}
                <div className="main-content">{props.children}</div>
                {props.footer && props.footer}
            </div>
        </React.Fragment>
    );
};

export default MasterPage;
