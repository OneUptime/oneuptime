import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';

const Init: FunctionComponent = (): ReactElement => {
    return (
        <Page title={''} breadcrumbLinks={[]}>
            <PageLoader isVisible={true} />
        </Page>
    );
};

export default Init;
