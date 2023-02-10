import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import IconProp from 'Common/Types/Icon/IconProp';

const PageNotFound: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page>
            <EmptyState
                title={'Page not found.'}
                description={'Page you are looking for does not exist.'}
                icon={IconProp.AltGlobe}
            />
        </Page>
    );
};

export default PageNotFound;
