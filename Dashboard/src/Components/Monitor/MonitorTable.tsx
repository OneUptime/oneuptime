import React, { FunctionComponent, ReactElement } from 'react';
import Container from 'CommonUI/src/Components/Dashboard/Container/Container/Container';
import Pagination from 'CommonUI/src/Components/Dashboard/Container/Container/Pagination';
import Table from 'CommonUI/src/Components/Dashboard/Table/Table';
import Button from 'CommonUI/src/Components/Basic/Button/Button';
import ButtonTypes from 'CommonUI/src/Components/Basic/Button/ButtonTypes';
import MenuButton from 'CommonUI/src/Components/Basic/Button/MenuButton/MenuButton';
import MenuItem from 'CommonUI/src/Components/Basic/Button/MenuButton/MenuItem';
import ShortcutKey from 'CommonUI/src/Components/Basic/ShortcutKey/ShortcutKey';
import { ColumnSort } from 'CommonUI/src/Components/Dashboard/Table/Type/Table';

const MonitorTable: FunctionComponent = (): ReactElement => {
    return (
        <Container
            title="Monitors"
            description="Monitor the status of your projects."
            footerText="Page 1 of 1 (3 total monitors)"
            pagination={
                <Pagination>
                    <Button
                        title="Previous"
                        type={ButtonTypes.Button}
                        id="tableButton"
                    />
                    <Button
                        title="Next"
                        type={ButtonTypes.Button}
                        id="tableButton"
                    />
                </Pagination>
            }
            headerButtons={[
                <MenuButton key={1} title="Filter By">
                    <MenuItem title="Clear Filters" />
                    <MenuItem title="Unacknowledged" />
                    <MenuItem title="Unresolved" />
                </MenuButton>,
                <Button
                    key={2}
                    title="Create New Monitor"
                    id="tableButton"
                    type={ButtonTypes.Button}
                    shortcutKey={ShortcutKey.New}
                />,
            ]}
        >
            <Table
                columns={[
                    {
                        title: 'ID',
                        key: 'id',
                        isSortable: true,
                        sortDirection: ColumnSort.ASC,
                    },
                    {
                        title: 'Monitors',
                        key: 'monitors',
                    },
                    {
                        title: 'Created By',
                        key: 'createdBy',
                    },
                    {
                        title: 'Title',
                        key: 'title',
                    },
                    {
                        title: 'Priority',
                        key: 'priority',
                    },
                    {
                        title: 'Status',
                        key: 'status',
                    },
                ]}
                records={[
                    {
                        id: '#3',
                        createdBy: 'OneUptime Admin',
                        monitors: 'Website',
                        priority: 'High',
                        title: 'Website is down',
                        status: 'OFFLINE',
                    },
                    {
                        id: '#4',
                        monitors: 'Website',
                        createdBy: 'OneUptime Admin',
                        title: 'Website is down',
                        priority: 'High',
                        status: 'OFFLINE',
                    },
                    {
                        id: '#5',
                        monitors: 'Website',
                        createdBy: 'OneUptime Admin',
                        title: 'Website is down',
                        priority: 'High',
                        status: 'OFFLINE',
                    },
                ]}
            />
        </Container>
    );
};

export default MonitorTable;
