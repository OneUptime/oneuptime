import React, { FunctionComponent, ReactElement, useState } from 'react';
import Column from './Types/Column';
import Columns from './Types/Columns';
import Icon, { IconProp, ThickProp } from '../Icon/Icon';
import SortOrder from 'Common/Types/Database/SortOrder';

export interface ComponentProps {
    columns: Columns;
    id: string;
    onSortChanged: (sortBy: string, sortOrder: SortOrder) => void;
}

const TableHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const [currentSortColumn, setCurrentSortColumn] = useState<string>("");
    const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Ascending);

    return (
        <thead id={props.id} >
            <tr>
                {props.columns.map((column: Column, i: number) => {

                    const canSort = !column.disableSort && column.key;

                    return <th key={i} className={`${canSort ? "pointer" : ""}`} onClick={() => {
                        if (!column.key) {
                            return;
                        }

                        if (currentSortColumn === column.key) {
                            setSortOrder(sortOrder === SortOrder.Ascending ? SortOrder.Descending : SortOrder.Ascending);
                        } else {
                            setCurrentSortColumn(column.key);
                            setSortOrder(SortOrder.Ascending);
                        }

                        props.onSortChanged(currentSortColumn, sortOrder);

                    }}>
                        {column.title}
                        {canSort && currentSortColumn === column.key && sortOrder === SortOrder.Ascending && <Icon icon={IconProp.ChevronUp} thick={ThickProp.Thick} />}
                        {canSort && currentSortColumn === column.key && sortOrder === SortOrder.Descending && <Icon icon={IconProp.ChevronDown} thick={ThickProp.Thick} />}
                    </th>;
                })}
            </tr>
        </thead>
    );
};

export default TableHeader;
