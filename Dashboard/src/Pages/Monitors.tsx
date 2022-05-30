import React, { FunctionComponent, ReactElement } from 'react';
import Container from 'CommonUI/src/Components/Dashboard/Container/Container';
import SidebarContainer from 'CommonUI/src/Components/Dashboard/Sidebar/SidebarContainer';
import Sidebar from 'CommonUI/src/Components/Dashboard/Sidebar/Sidebar';
import SubSidebar from 'CommonUI/src/Components/Dashboard/Sidebar/SubSidebar';

const Monitors: FunctionComponent = (): ReactElement => {
    return (
        <Container
            title="OneUptime | Monitors"
            showSideBar={true}
            sideBar={
                <SidebarContainer title="Monitors">
                    <Sidebar
                        title="All payments"
                        isActive={true}
                        showSubsidebar={true}
                        subSidebar={[<SubSidebar title="All transactions" />]}
                    />
                    <Sidebar title="Fraud &amp; risk" />
                    <Sidebar title="Invoices" />
                    <Sidebar title="Subscriptions" />
                    <Sidebar title="Quotes" />
                    <Sidebar title="Payment links" />
                    <Sidebar title="Orders" />
                </SidebarContainer>
            }
        >
            <h1>Monitors</h1>
        </Container>
    );
};

export default Monitors;
