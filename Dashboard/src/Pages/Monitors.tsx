import React, { FunctionComponent, ReactElement } from 'react';
import Container from 'CommonUI/src/Components/Dashboard/Container/Container';
import Sidebar from 'CommonUI/src/Components/Dashboard/Sidebar/Sidebar';
import SidebarItem from 'CommonUI/src/Components/Dashboard/Sidebar/SidebarItem';
import SubItem from 'CommonUI/src/Components/Dashboard/Sidebar/SubItem';
import MonitorTable from '../Components/Tables/MonitorTable';

const Monitors: FunctionComponent = (): ReactElement => {
    return (
        <Container
            title="OneUptime | Monitors"
            sideBar={
                <Sidebar title="Monitors">
                    <SidebarItem title="All payments" isActive={true}>
                        <SubItem title="All transactions" />
                    </SidebarItem>
                    <SidebarItem title="Fraud &amp; risk" />
                    <SidebarItem title="Invoices" />
                    <SidebarItem title="Subscriptions" />
                    <SidebarItem title="Quotes" />
                    <SidebarItem title="Payment links" />
                    <SidebarItem title="Orders" />
                </Sidebar>
            }
        >
            <MonitorTable />
        </Container>
    );
};

export default Monitors;
