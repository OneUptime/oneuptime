import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';

const PageNotFound: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page title={'Page Not Found'}>
            <p>Page you are looking for does not exist.</p>
        </Page>
    );
};

export default PageNotFound;
