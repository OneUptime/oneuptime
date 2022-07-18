import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    currentPageNumber: number;
    totalItemsCount: number;
    itemsOnPage: number;
    onNavigateToPage: (pageNumber: number) => void;
    isLoading: boolean;
    isError: boolean; 
}

const Pagination: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const isPreviousDisabled: boolean = props.currentPageNumber === 1;
    const isNextDisabled: boolean = props.currentPageNumber * props.itemsOnPage < props.totalItemsCount;

    return (
        <div className='justify-space-between'>
            <div>

            </div>
            <div>
                <nav className="" aria-label="Page navigation example">
                    <ul className="pagination">
                        <li onClick={() => {
                            if (props.onNavigateToPage && !isPreviousDisabled) {
                                props.onNavigateToPage(props.currentPageNumber - 1);
                            }
                        }}
                            className={`page-item ${isPreviousDisabled ? "disabled" : ""}`} style={{ "padding": "0px" }}>
                            <a href="#" className="page-link">Previous</a>
                        </li>
                        <li className="page-item" style={{ "padding": "0px" }}>
                            <a className="pointer page-link">{props.currentPageNumber}</a>
                        </li>
                        <li onClick={() => {
                            if (props.onNavigateToPage && !isNextDisabled) {
                                props.onNavigateToPage(props.currentPageNumber + 1);
                            }
                        }} className={`page-item ${isNextDisabled ? "disabled" : ""}`} style={{ "padding": "0px" }}>
                            <a className="pointer page-link">Next</a>
                        </li>
                    </ul>
                </nav>
            </div>

        </div>)
};

export default Pagination;
