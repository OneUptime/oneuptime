import React, { ReactElement, useState } from 'react';
import TableContainer from 'CommonUI/src/Components/Dashboard/Container/TableContainer';
import Pagination from 'CommonUI/src/Components/Dashboard/Table/Pagination';
import Pager from 'CommonUI/src/Components/Dashboard/Table/Pager';
import Button from 'CommonUI/src/Components/Basic/Button/Button';
import ButtonTypes from 'CommonUI/src/Components/Basic/Button/ButtonTypes';
import DropdownButton from 'CommonUI/src/Components/Basic/Button/DropdownButton';
import DropdownItem from 'CommonUI/src/Components/Basic/Button/DropdownItem';

const Table = (): ReactElement => {
    const [showList, setShowList] = useState(false);
    const toggleDropdown = () => setShowList(!showList);
    return (
        <TableContainer
            title="Monitors"
            description="Lorem, ipsum dolor sit amet consectetur adipisicing elit."
            footerText="Page 1 of 1 (2 total monitors)"
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
        />
    );
};

export default Table;
