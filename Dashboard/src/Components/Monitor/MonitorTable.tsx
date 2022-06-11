import React, { FunctionComponent, ReactElement, useState } from 'react';
import Container from 'CommonUI/src/Components/Dashboard/Container/Container/Container';
import Pagination from 'CommonUI/src/Components/Dashboard/Container/Container/Pagination';
import Table from 'CommonUI/src/Components/Dashboard/Table/Table';
import Button from 'CommonUI/src/Components/Basic/Button/Button';
import ButtonTypes from 'CommonUI/src/Components/Basic/Button/ButtonTypes';
import DropdownButton from 'CommonUI/src/Components/Basic/Button/DropdownButton';
import DropdownItem from 'CommonUI/src/Components/Basic/Button/DropdownItem';
import ShortcutKey from 'CommonUI/src/Components/Basic/ShortcutKey/ShortcutKey';
import { ColumnSort } from 'CommonUI/src/Components/Dashboard/Table/Type/Table';

const MonitorTable: FunctionComponent = (): ReactElement => {
    const [showList, setShowList] = useState(false);
    const toggleDropdown: Function = (): void => {
        setShowList(!showList);
    };
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
                <DropdownButton
                    key={1}
                    title="Filter By"
                    onClick={toggleDropdown}
                    showDropdown={showList}
                >
                    <DropdownItem title="Clear Filters" />
                    <DropdownItem title="Unacknowledged" />
                    <DropdownItem title="Unresolved" />
                </DropdownButton>,
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
