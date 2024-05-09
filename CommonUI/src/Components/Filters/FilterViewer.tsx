import React, { ReactElement, useEffect, useState } from 'react';
import Filter from './Types/Filter';
import GenericObject from 'Common/Types/GenericObject';
import FilterData from './Types/FilterData';
import FilterUtil from './Utils/Filter';
import FilterViewerItem from './FilterViewerItem';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import Button, { ButtonStyleType } from '../Button/Button';
import Modal, { ModalWidth } from '../Modal/Modal';
import FiltersForm from './FiltersForm';

export interface ComponentProps<T extends GenericObject> {
    filters: Array<Filter<T>>;
    id: string;
    showFilterModal: boolean;
    onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
    filterError?: string | undefined;
    onFilterModalClose: () => void;
    onFilterModalOpen: () => void;
    isModalLoading?: boolean;
    onFilterRefreshClick?: undefined | (() => void);
}

type FilterComponentFunction = <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement;

const FilterComponent: FilterComponentFunction = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
    const [filterData, setFilterData] = useState<FilterData<T>>({});
    const [tempFilterDataForModal, setTempFilterDataForModal] = useState<
        FilterData<T>
    >({});

    const filterTexts: Array<string> = FilterUtil.translateFilterToText({
        filters: props.filters,
        filterData: filterData,
    });

    if (props.filterError) {
        return <ErrorMessage error={props.filterError} />;
    }

    const changeFilterData = (filterData: FilterData<T>) => {
        setFilterData(filterData);
        setTempFilterDataForModal(filterData);
    };

    const showViewer: boolean = filterTexts.length > 0;

    useEffect(() => {
        if (props.showFilterModal) {
            setTempFilterDataForModal({ ...filterData });
        }
    }, [props.showFilterModal]);

    return (
        <div>
            {showViewer && (
                <div>
                    <div className="relative">
                        <div
                            className="absolute inset-0 flex items-center"
                            aria-hidden="true"
                        >
                            <div className="w-full border-t border-gray-300"></div>
                        </div>
                        <div className="relative flex justify-center">
                            <span className="bg-white px-2 text-sm text-gray-500">
                                Filter By
                            </span>
                        </div>
                    </div>
                    <div className="ml-5 mt-5 mb-5 bg-gray-50 rounded rounded-xl p-5 border border-2 border-gray-100">
                        <ul role="list" className="space-y-6">
                            {filterTexts.map(
                                (filterText: string, index: number) => {
                                    const isLastItem: boolean =
                                        index === filterTexts.length - 1;
                                    return (
                                        <li
                                            className="relative flex gap-x-4"
                                            key={index}
                                        >
                                            {!isLastItem && (
                                                <div className="absolute left-0 top-0 flex w-6 justify-center -bottom-6">
                                                    <div className="w-px bg-gray-200"></div>
                                                </div>
                                            )}
                                            <div className="relative flex h-6 w-6  flex-none items-center justify-center bg-gray-50">
                                                <div className="h-1.5 w-1.5 rounded-full bg-gray-100 ring-1 ring-gray-300"></div>
                                            </div>
                                            <FilterViewerItem
                                                key={index}
                                                text={filterText}
                                            />{' '}
                                        </li>
                                    );
                                }
                            )}
                        </ul>
                    </div>

                    <div>
                        {/** Clear Filter Button */}
                        <Button
                            onClick={() => {
                                changeFilterData({});
                                props.onFilterModalClose();
                            }}
                            title="Clear Filters"
                            buttonStyle={ButtonStyleType.LINK}
                        />

                        {/** Edit Filter Button */}
                        <Button
                            onClick={props.onFilterModalOpen}
                            title="Edit Filters"
                            buttonStyle={ButtonStyleType.LINK}
                        />
                    </div>
                </div>
            )}

            {props.showFilterModal && (
                <Modal
                    modalWidth={ModalWidth.Large}
                    isLoading={props.isModalLoading}
                    title="Filters"
                    description="Select Filters"
                    submitButtonText="Save"
                    onClose={() => {
                        props.onFilterModalClose();
                    }}
                    onSubmit={() => {
                        setFilterData({ ...tempFilterDataForModal });
                        setTempFilterDataForModal({});
                        if (props.onFilterChanged) {
                            props.onFilterChanged({
                                ...tempFilterDataForModal,
                            });
                        }
                        props.onFilterModalClose();
                    }}
                >
                    <FiltersForm
                        onFilterRefreshClick={props.onFilterRefreshClick}
                        filterData={tempFilterDataForModal}
                        filters={props.filters}
                        id={props.id + '-form'}
                        showFilter={true}
                        onFilterChanged={(filterData: FilterData<T>) => {
                            setTempFilterDataForModal(filterData);
                        }}
                    />
                </Modal>
            )}
        </div>
    );
};

export default FilterComponent;
