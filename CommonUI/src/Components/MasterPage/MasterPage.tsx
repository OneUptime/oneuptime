import React, { FunctionComponent, ReactElement } from 'react';
import PageError from '../Error/PageError';
import PageLoader from '../Loader/PageLoader';
import TopSection from '../TopSection/TopSection';

export interface ComponentProps {
    header?: undefined | ReactElement;
    footer?: undefined | ReactElement;
    navBar?: undefined | ReactElement;
    children: ReactElement | Array<ReactElement>;
    isLoading: boolean;
    error: string;
    topSectionClassName?: string | undefined;
    className?: string | undefined;
    hideHeader?: boolean | undefined;
    makeTopSectionUnstick?: boolean | undefined;
}

const MasterPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (props.isLoading) {
        return (
            <React.Fragment>
                <PageLoader isVisible={true} />
            </React.Fragment>
        );
    }

    if (props.error) {
        return (
            <React.Fragment>
                <PageError message={props.error} />
            </React.Fragment>
        );
    }

    return (
        <React.Fragment>
            <div className={props.className}>
                <div className={props.makeTopSectionUnstick ? "" : "sticky top-0"}>
                    <TopSection hideHeader={props.hideHeader} className={props.topSectionClassName} header={props.header} navbar={props.navBar} />
                </div>

                {props.children}

                {props.footer && props.footer}
            </div>
        </React.Fragment>
    );
};

export default MasterPage;
