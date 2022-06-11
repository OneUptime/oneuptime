import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import PageContainer from 'CommonUI/src/Components/Dashboard/Container/PageContainer/PageContainer';
import PageComponentProps from '../PageComponentProps';
import Laoder, { LoaderType } from 'CommonUI/src/Components/Basic/Loader/Loader';

const Init: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    useEffect(() => {
        // set slug to latest project and redirect to home. 
    })
    return (
        <PageContainer>
            <Laoder loaderType={LoaderType.Bar}/>
        </PageContainer>
    );
};

export default Init;
