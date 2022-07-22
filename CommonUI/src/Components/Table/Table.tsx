import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import TableBody from './TableBody';
import TableHeader from './TableHeader';
import Columns from './Types/Columns';
import Pagination from './Pagination';
import Loader, { LoaderType } from '../Loader/Loader';
import { VeryLightGrey } from '../../Utils/BrandColors';
import SortOrder from 'Common/Types/Database/SortOrder';

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
    singularLabel: string;
    pluralLabel: string;
    onRefreshClick?: () => void;
    noItemsMessage?: string;
    onSortChanged: (sortBy: string, sortOrder: SortOrder) => void;
}

const Table: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const getTablebody = (): ReactElement => {

        if (props.isLoading) {
            return (
                <tbody>
                    <tr>
                        <td colSpan={props.columns.length}>
                            <div className="row text-center" style={{
                                marginTop: "50px",
                                marginBottom: "50px"
                            }}>
                                <Loader loaderType={LoaderType.Bar} color={VeryLightGrey} size={200} />
                            </div>
                        </td>
                    </tr>
                </tbody>
            )
        }

        if (props.error) {
            return (
                <tbody>
                    <tr>
                        <td colSpan={props.columns.length}>
                            <p className='text-center color-light-grey' style={{
                                marginTop: "50px",
                                marginBottom: "50px"
                            }}>{props.error} <br /> {props.onRefreshClick ? <span onClick={() => {
                                if (props.onRefreshClick) {
                                    props.onRefreshClick();
                                }
                            }} className="underline primary-on-hover">Refresh?</span> : <></>}</p>
                        </td>
                    </tr>
                </tbody>
            )
        }

        if (props.data.length === 0) {
            return (
                <tbody>
                    <tr>
                        <td colSpan={props.columns.length}>
                            <p className='text-center color-light-grey' style={{
                                marginTop: "50px",
                                marginBottom: "50px"
                            }}> {props.noItemsMessage ? props.noItemsMessage : `No ${props.singularLabel.toLocaleLowerCase()}`} </p>
                        </td>
                    </tr>
                </tbody>
            )
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
                    onSortChanged={props.onSortChanged}
                />
                {getTablebody()}

            </table>
            <Pagination
                singularLabel={props.singularLabel}
                pluralLabel={props.pluralLabel}
                currentPageNumber={props.currentPageNumber}
                totalItemsCount={props.totalItemsCount}
                itemsOnPage={props.itemsOnPage}
                onNavigateToPage={props.onNavigateToPage}
                isLoading={props.isLoading}
                isError={!!props.error}
            />
        </div>
    );
};

export default Table;
