import React, { FunctionComponent, ReactElement } from 'react';
import PageError from '../Error/PageError';
import PageLoader from '../Loader/PageLoader';

export interface ComponentProps {
    header?: undefined | ReactElement;
    footer?: undefined | ReactElement;
    navBar?: undefined | ReactElement;
    children: ReactElement | Array<ReactElement>;
    isLoading: boolean;
    error: string;
    mainContentStyle?: React.CSSProperties | undefined;
}

const MasterPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    let err = "Are you sure you want to deactivate your account? All of your data will be permanently removed from our servers forever. This action cannot be undone."

    if (props.isLoading) {
        return (
            <React.Fragment>
                <PageLoader isVisible={true} />
            </React.Fragment>
        );
    }

    if (err) {
        return (
            <React.Fragment>
                <PageError message={err} />
            </React.Fragment>
        );
    }

    return (
        <React.Fragment>
            <>
                {props.header && props.header}
                {props.navBar && props.navBar}
                
                    {props.children}
               
                {props.footer && props.footer}
            </>
        </React.Fragment>
    );
};

export default MasterPage;
