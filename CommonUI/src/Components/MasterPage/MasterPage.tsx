import React, { FunctionComponent, ReactElement } from 'react';
import PageLoader from '../Loader/PageLoader';

export interface ComponentProps {
    header?: ReactElement;
    footer?: ReactElement;
    navBar?: ReactElement;
    children: ReactElement | Array<ReactElement>;
    isLoading: boolean;
}

const MasterPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <React.Fragment>
            {props.isLoading ? <PageLoader isVisible={true} /> : <div id="layout-wrapper">
                {props.header && props.header}
                {props.navBar && props.navBar}
                <div className="main-content">{props.children}</div>
                {props.footer && props.footer}
            </div>}
        </React.Fragment>
    );
};

export default MasterPage;
