import React, { FunctionComponent, ReactElement } from 'react';
import Container from 'CommonUI/src/Components/Dashboard/Container/Container';
import Sidebar from 'CommonUI/src/Components/Dashboard/Sidebar/Sidebar';
import SubItems from 'CommonUI/src/Components/Dashboard/Sidebar/SubItems';
import SubItem from 'CommonUI/src/Components/Dashboard/Sidebar/SubItem';

const Monitors: FunctionComponent = (): ReactElement => {
    return (
        <Container
            title="OneUptime | Monitors"
            sideBar={
                <Sidebar title="Monitors">
                    <SubItems
                        title="All payments"
                        isActive={true}
                        subSidebar={[<SubItem title="All transactions" />]}
                    />
                    <SubItems title="Fraud &amp; risk" />
                    <SubItems title="Invoices" />
                    <SubItems title="Subscriptions" />
                    <SubItems title="Quotes" />
                    <SubItems title="Payment links" />
                    <SubItems title="Orders" />
                </Sidebar>
            }
        >
            <h1>Monitors</h1>
        </Container>
    );
};

export default Monitors;
