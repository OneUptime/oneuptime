import React, { FunctionComponent, ReactElement } from 'react';
import PageContainer from 'CommonUI/src/Components/Dashboard/Container/PageContainer/PageContainer';
import PageComponentProps from '../PageComponentProps';

const Logs: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <PageContainer title="OneUptime | Logs">
            <div></div>
        </PageContainer>
    );
};

export default Logs;
