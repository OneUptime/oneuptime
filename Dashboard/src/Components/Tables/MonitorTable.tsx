import React, { ReactElement, useState } from 'react';
import TableContainer from 'CommonUI/src/Components/Dashboard/Container/TableContainer';
import Pagination from 'CommonUI/src/Components/Dashboard/Table/Pagination';
import Table from 'CommonUI/src/Components/Dashboard/Table/Table';
import Pager from 'CommonUI/src/Components/Dashboard/Table/Pager';
import Button from 'CommonUI/src/Components/Basic/Button/Button';
import ButtonTypes from 'CommonUI/src/Components/Basic/Button/ButtonTypes';
import DropdownButton from 'CommonUI/src/Components/Basic/Button/DropdownButton';
import DropdownItem from 'CommonUI/src/Components/Basic/Button/DropdownItem';

const MonitorTable = (): ReactElement => {
    const [showList, setShowList] = useState(false);
    const toggleDropdown = () => setShowList(!showList);
    return (
        <TableContainer
            title="Monitors"
            description="Monitor the status of your projects."
            footerText="Page 1 of 1 (3 total monitors)"
            pagination={
                <Pagination>
                    <Pager title="Previous" />
                    <Pager title="Next" />
                </Pagination>
            }
            asideComponents={[
                <DropdownButton
                    title="Filter By"
                    action={toggleDropdown}
                    showDropdown={showList}
                    dropdownItems={[
                        <DropdownItem title="Clear Filters" />,
                        <DropdownItem title="Unacknowledged" />,
                        <DropdownItem title="Unresolved" />,
                    ]}
                />,
                <Button
                    title="Create New Monitor"
                    id="table_button"
                    type={ButtonTypes.Button}
                />,
            ]}
            table={
                <Table
                    columns={[
                        'ID',
                        'Monitor(s)',
                        'Created By',
                        'Title',
                        'Priority',
                        'Status',
                    ]}
                    records={[
                        {
                            id: '#3',
                            monitors: 'Website',
                            createdBy: 'OneUptime Admin',
                            title: 'Website is down',
                            priority: 'High',
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
            }
        />
    );
};

export default MonitorTable;
