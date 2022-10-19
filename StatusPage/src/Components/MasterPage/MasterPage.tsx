import MasterPage from 'CommonUI/src/Components/MasterPage/MasterPage';
import Footer from '../Footer/Footer';
import Header from '../Header/Header';
import NavBar from '../NavBar/NavBar';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    isLoading?: boolean | undefined;
    error?: string | undefined;
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <MasterPage
            footer={<Footer />}
            header={<Header />}
            navBar={<NavBar show={true} isPreview={true} />}
            isLoading={props.isLoading || false}
            error={props.error || ''}
            mainContentStyle={{
                display: 'flex',
                alignItems: 'center',
                margin: 'auto',
                maxWidth: '880px',
                marginLeft: 'auto !important',
            }}
        >
            {props.children}
        </MasterPage>
    );
};

export default DashboardMasterPage;
