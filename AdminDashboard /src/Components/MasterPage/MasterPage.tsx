import MasterPage from 'CommonUI/src/Components/MasterPage/MasterPage';
import Footer from '../Footer/Footer';
import Header from '../Header/Header';
import NavBar from '../NavBar/NavBar';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <MasterPage
            footer={<Footer />}
            header={<Header />}
            navBar={<NavBar />}
            isLoading={false}
            error={''}
            className="flex flex-col h-screen justify-between"
        >
            {props.children}
        </MasterPage>
    );
};

export default DashboardMasterPage;
