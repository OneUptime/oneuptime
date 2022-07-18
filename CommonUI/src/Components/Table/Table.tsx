import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import TableBody from './TableBody';
import TableHeader from './TableHeader';
import Columns from './Types/Columns';
import Pagination from './Pagination';
import PageLoader from '../Loader/PageLoader';

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    columns: Columns;
    disablePagination?: boolean;
    onNavigateToPage: (pageNumber: number) => void;
    currentPageNumber: number;
    totalItemsCount: number;
    itemsOnPage: number;
    error: string; 
    isLoading: boolean;
}

const Table: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const getTablebody = (): ReactElement => {

        if (props.isLoading) {
            return (<PageLoader isVisible={true} />)
        }

        if (props.error) {
            return (<p>{props.error}</p>)
        }

        return (<TableBody
            id={`${props.id}-body`}
            data={props.data}
            columns={props.columns}
        />)
    }

    return (
        <div className="table-responsive">
            <table className="table mb-0 table">
                <TableHeader
                    id={`${props.id}-header`}
                    columns={props.columns}
                />
                {getTablebody()}
                <Pagination
                    currentPageNumber={props.currentPageNumber}
                    totalItemsCount={props.totalItemsCount}
                    itemsOnPage={props.itemsOnPage}
                    onNavigateToPage={props.onNavigateToPage}
                    isLoading={props.isLoading}
                    isError={!!props.error}
                />
            </table>
        </div>
    );
};

export default Table;
