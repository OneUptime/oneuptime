import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import PageComponentProps from '../PageComponentProps';

const Init: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    useEffect(() => {
        // set slug to latest project and redirect to home.
    });
    return (
        <Page title={''} breadcrumbLinks={[]}>
            <PageLoader isVisible={true} />
        </Page>
    );
};

export default Init;
