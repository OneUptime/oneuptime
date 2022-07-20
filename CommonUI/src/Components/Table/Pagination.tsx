import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    currentPageNumber: number;
    totalItemsCount: number;
    itemsOnPage: number;
    onNavigateToPage: (pageNumber: number) => void;
    isLoading: boolean;
    isError: boolean; 
    singularLabel: string;
    pluralLabel: string; 
}

const Pagination: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const isPreviousDisabled: boolean = (props.currentPageNumber === 1 || props.isLoading || props.isError);
    const isNextDisabled: boolean = (
        props.currentPageNumber * props.itemsOnPage >= props.totalItemsCount
        || props.isLoading || props.isError
    );
    const isCurrentPageButtonDisabled: boolean = props.totalItemsCount === 0 || props.isLoading || props.isError;

    return (
        <div className='justify-space-between'>
            <div>
                <p
                    style={{"padding": "17px", "margin": "0px"}}
                    className='color-light-grey'>{props.totalItemsCount} {props.totalItemsCount > 1 ? props.pluralLabel : props.singularLabel}</p>
            </div>
            <div>
                <nav className="" aria-label="Page navigation example" style={{
                    "height": "45px"
                }}>
                    <ul className="pagination" style={{
                        marginTop: "15px",
                        marginBottom: "15px",
                        marginRight: "15px",
                    }}>
                        <li onClick={() => {
                            if (props.onNavigateToPage && !isPreviousDisabled) {
                                props.onNavigateToPage(props.currentPageNumber - 1);
                            }
                        }}
                            className={`page-item ${isPreviousDisabled ? "disabled" : ""}`} style={{ "padding": "0px" }}>
                            <a href="#" className="page-link">Previous</a>
                        </li>
                        <li className={`page-item ${isCurrentPageButtonDisabled ? "disabled" : ""}`} style={{ "padding": "0px" }}>
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
