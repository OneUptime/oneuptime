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
        <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4">
            <div>
                <p className="text-sm text-gray-500">
                    {!props.isLoading && (
                        <span>
                            {props.totalItemsCount}{' '}
                            {props.totalItemsCount > 1
                                ? props.pluralLabel
                                : props.singularLabel}{' '}
                            {`in total. Showing ${
                                props.itemsOnPage *
                                    (props.currentPageNumber - 1) +
                                1
                            } to ${
                                props.itemsOnPage * props.currentPageNumber
                            } on this page.`}
                        </span>
                    )}
                </p>
            </div>
            <div>
                <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm">
                    <ul className="py-3">
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
                            className={`relative inline-flex items-center rounded-l-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500  focus:z-20 ${
                                isPreviousDisabled
                                    ? 'bg-gray-100'
                                    : 'hover:bg-gray-50 cursor-pointer'
                            }`}
                        >
                            <span className="page-link">Previous</span>
                        </li>
                        <li
                            className={`relative z-10 inline-flex items-center border border-x-0 border-gray-300 hover:bg-gray-50 px-4 py-2 text-sm font-medium text-text-600 focus:z-20 cursor-pointer ${
                                isCurrentPageButtonDisabled ? 'bg-gray-100' : ''
                            }`}
                            onClick={() => {
                                setShowPaginationModel(true);
                            }}
                        >
                            <span>{props.currentPageNumber}</span>
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
                            className={`relative inline-flex items-center rounded-r-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500 focus:z-20 ${
                                isNextDisabled
                                    ? 'bg-gray-100'
                                    : ' hover:bg-gray-50 cursor-pointer'
                            }`}
                        >
                            <span>Next</span>
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
                    name="Pagination Form"
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
