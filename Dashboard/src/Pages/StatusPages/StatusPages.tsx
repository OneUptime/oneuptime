import React, { FunctionComponent, ReactElement } from 'react';
import PageContainer from 'CommonUI/src/Components/Dashboard/Container/PageContainer/PageContainer';
import PageComponentProps from '../PageComponentProps';

const StatusPages: FunctionComponent<PageComponentProps> = (
    __props: PageComponentProps
): ReactElement => {
    return (
        <PageContainer title="OneUptime | StatusPages">
            <div></div>
        </PageContainer>
    );
};

export default StatusPages;
