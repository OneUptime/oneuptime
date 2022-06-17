import React, { FunctionComponent, ReactElement } from 'react';
import PageContainer from 'CommonUI/src/Components/Dashboard/Container/PageContainer/PageContainer';
import PageComponentProps from '../PageComponentProps';
import Breadcrumbs from 'CommonUI/src/Components/Dashboard/Breadcrumbs/Breadcrumbs';
import BreadcrumbItem from 'CommonUI/src/Components/Dashboard/Breadcrumbs/BreadcrumbItem';
import { IconProp } from 'CommonUI/src/Components/Basic/Icon/Icon';

const Home: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <PageContainer title="OneUptime | Home">
            <Breadcrumbs icon={IconProp.Home}>
                <BreadcrumbItem title="Home" />
                <BreadcrumbItem title="Monitors" />
                <BreadcrumbItem title="Hello" />
            </Breadcrumbs>
        </PageContainer>
    );
};

export default Home;
