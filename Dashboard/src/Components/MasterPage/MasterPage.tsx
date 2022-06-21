import MasterPage from 'CommonUI/src/Components/MasterPage/MasterPage';
import Footer from '../Footer/Footer';
import Header from '../Header/Header';
import NavBar from '../NavBar/NavBar';

import React from 'react';
import { ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
}

const DashboardMasterPage = (props: ComponentProps) => {
    return (
        <MasterPage footer={<Footer />} header={<Header />} navBar={<NavBar />}>
            {props.children}
        </MasterPage>
    );
};

export default DashboardMasterPage;
