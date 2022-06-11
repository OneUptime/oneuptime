import React, { FunctionComponent, ReactElement } from 'react';
import PageContainer from 'CommonUI/src/Components/Dashboard/Container/PageContainer/PageContainer';
import PageComponentProps from '../PageComponentProps';

const Incidents: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <PageContainer title="OneUptime | Incidents">
            <div></div>
        </PageContainer>
    );
};

export default Incidents;
