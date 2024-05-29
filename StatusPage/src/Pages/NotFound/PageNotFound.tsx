import Page from '../../Components/Page/Page';
import PageComponentProps from '../PageComponentProps';
import IconProp from 'Common/Types/Icon/IconProp';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import React, { FunctionComponent, ReactElement } from 'react';

const PageNotFound: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page>
            <EmptyState
                id="empty-state-page-not-found"
                title={'Page not found.'}
                description={'Page you are looking for does not exist.'}
                icon={IconProp.AltGlobe}
            />
        </Page>
    );
};

export default PageNotFound;
