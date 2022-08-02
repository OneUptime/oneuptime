import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import BasicFormModal from '../FormModal/BasicFormModal';
import FormFieldSchemaType from '../Forms/Types/FormFieldSchemaType';

export interface PaginationNavigationItem {
    pageNumber: number;
    itemsOnPage: number;
}

export interface ComponentProps {
    currentPageNumber: number;
    totalItemsCount: number;
    itemsOnPage: number;
    onNavigateToPage: (pageNumber: number, itemsOnPage: number) => void;
    isLoading: boolean;
    isError: boolean;
    singularLabel: string;
    pluralLabel: string;
}

const Pagination: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [minPageNumber, setMinPageNumber] = useState<number>(1);
    const [maxPageNumber, setMaxPageNumber] = useState<number>(1);

    const setMinAndMaxPageNumber: () => void = (): void => {
        setMinPageNumber(1);
        let maxPageNo: number =
            props.totalItemsCount % props.itemsOnPage === 0
                ? props.totalItemsCount / props.itemsOnPage + 1
                : props.totalItemsCount / props.itemsOnPage;

        if (maxPageNo < 1) {
            maxPageNo = 1;
        }

        setMaxPageNumber(Math.ceil(maxPageNo));
    };

    useEffect(() => {
        setMinAndMaxPageNumber();
    }, []);

    useEffect(() => {
        setMinAndMaxPageNumber();
    }, [props.totalItemsCount, props.itemsOnPage]);

    const isPreviousDisabled: boolean =
        props.currentPageNumber === 1 || props.isLoading || props.isError;
    const isNextDisabled: boolean =
        props.currentPageNumber * props.itemsOnPage >= props.totalItemsCount ||
        props.isLoading ||
        props.isError;
    const isCurrentPageButtonDisabled: boolean =
        props.totalItemsCount === 0 || props.isLoading || props.isError;

    const [showPaginationModel, setShowPaginationModel] =
        useState<boolean>(false);

    return (
        <div className="justify-space-between">
            <div>
                <p
                    style={{ padding: '17px', margin: '0px' }}
                    className="color-light-grey"
                >
                    {!props.isLoading && <span>{props.totalItemsCount}{' '}
                        {props.totalItemsCount > 1
                            ? props.pluralLabel
                            : props.singularLabel}{' '}
                        {`in total. Showing ${props.itemsOnPage} on this page.`}
                    </span>}
                </p>
            </div>
            <div>
                <nav
                    className=""
                    aria-label="Page navigation example"
                    style={{
                        height: '45px',
                    }}
                >
                    <ul
                        className="pagination"
                        style={{
                            marginTop: '15px',
                            marginBottom: '15px',
                            marginRight: '15px',
                        }}
                    >
                        <li
                            onClick={() => {
                                if (
                                    props.onNavigateToPage &&
                                    !isPreviousDisabled
                                ) {
                                    props.onNavigateToPage(
                                        props.currentPageNumber - 1,
                                        props.itemsOnPage
                                    );
                                }
                            }}
                            className={`page-item ${
                                isPreviousDisabled ? 'disabled' : ''
                            }`}
                            style={{ padding: '0px' }}
                        >
                            <span className="page-link">Previous</span>
                        </li>
                        <li
                            className={`page-item ${
                                isCurrentPageButtonDisabled ? 'disabled' : ''
                            }`}
                            style={{ padding: '0px' }}
                        >
                            <span
                                onClick={() => {
                                    setShowPaginationModel(true);
                                }}
                                className="pointer page-link"
                            >
                                {props.currentPageNumber}
                            </span>
                        </li>
                        <li
                            onClick={() => {
                                if (props.onNavigateToPage && !isNextDisabled) {
                                    props.onNavigateToPage(
                                        props.currentPageNumber + 1,
                                        props.itemsOnPage
                                    );
                                }
                            }}
                            className={`page-item ${
                                isNextDisabled ? 'disabled' : ''
                            }`}
                            style={{ padding: '0px' }}
                        >
                            <span className="pointer page-link">Next</span>
                        </li>
                    </ul>
                </nav>
            </div>

            {showPaginationModel && (
                <BasicFormModal<PaginationNavigationItem>
                    title={'Navigate to Page'}
                    onClose={() => {
                        setShowPaginationModel(false);
                    }}
                    submitButtonText={'Go to Page'}
                    onSubmit={(item: PaginationNavigationItem) => {
                        if (props.onNavigateToPage && !isNextDisabled) {
                            props.onNavigateToPage(
                                item.pageNumber,
                                item.itemsOnPage
                            );
                        }
                        setShowPaginationModel(false);
                    }}
                    formProps={{
                        initialValues: {
                            pageNumber: props.currentPageNumber,
                            itemsOnPage: props.itemsOnPage,
                        },
                        fields: [
                            {
                                title: 'Page Number',
                                description: `You can enter page numbers from ${
                                    minPageNumber !== maxPageNumber
                                        ? minPageNumber + ' to ' + maxPageNumber
                                        : minPageNumber
                                }. Please enter it here:`,
                                field: {
                                    pageNumber: true,
                                },
                                disabled: minPageNumber === maxPageNumber,
                                placeholder: '1',
                                required: true,
                                validation: {
                                    minValue: minPageNumber,
                                    maxValue: maxPageNumber,
                                },
                                fieldType: FormFieldSchemaType.PositveNumber,
                            },
                            {
                                title: `${props.pluralLabel} on Page `,
                                description: `Enter the number of ${props.pluralLabel.toLowerCase()} you would like to see on the page:`,
                                field: {
                                    itemsOnPage: true,
                                },
                                placeholder: '10',
                                required: true,
                                fieldType: FormFieldSchemaType.Dropdown,
                                dropdownOptions: [
                                    {
                                        value: 10,
                                        label: '10',
                                    },
                                    {
                                        value: 20,
                                        label: '20',
                                    },
                                    {
                                        value: 25,
                                        label: '25',
                                    },
                                    {
                                        value: 50,
                                        label: '50',
                                    },
                                ],
                            },
                        ],
                    }}
                />
            )}
        </div>
    );
};

export default Pagination;
