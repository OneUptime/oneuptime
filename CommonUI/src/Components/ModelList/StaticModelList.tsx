
import BaseModel from 'Common/Models/BaseModel';
import Typeof from 'Common/Types/Typeof';
import React, { ReactElement } from 'react';

export interface ComponentProps<TBaseModel extends BaseModel> {
    list: Array<TBaseModel>;
    headerField?: string | ((item: TBaseModel) => ReactElement) | undefined;
    descriptionField: string;
    selectedItems: Array<TBaseModel>;
    onClick: (item: TBaseModel) => void;
    titleField: string;
}

const StaticModelList: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {


    return (
        <div>
            {props.list &&
                props.list.length > 0 &&
                props.list.map(
                    (model: TBaseModel, i: number): ReactElement => {
                        const isSelected: boolean =
                            props.selectedItems.filter(
                                (selectedItem: TBaseModel) => {
                                    return (
                                        selectedItem._id?.toString() ===
                                        model._id?.toString()
                                    );
                                }
                            ).length > 0;

                        return (
                            <div
                                key={i}
                                onClick={() => {
                                    props.onClick(model);
                                }}
                                className={`cursor-pointer mt-2 mb-2 relative flex items-center space-x-3 rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm focus-within:ring-2 focus-within:ring-pink-500 focus-within:ring-offset-2 hover:border-gray-400 ${isSelected ? 'ring ring-indigo-500' : ''
                                    }`}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="focus:outline-none">
                                        <span
                                            className="absolute inset-0"
                                            aria-hidden="true"
                                        ></span>
                                        {props.headerField &&
                                            typeof props.headerField ===
                                            Typeof.String && (
                                                <p className="text-sm font-medium text-gray-300">
                                                    {
                                                        model.getValue(
                                                            props.headerField as string
                                                        ) as string
                                                    }
                                                </p>
                                            )}

                                        {props.headerField &&
                                            typeof props.headerField ===
                                            'function' &&
                                            props.headerField(model)}
                                        <p className="text-sm font-medium text-gray-900">
                                            {
                                                model.getValue(
                                                    props.titleField
                                                ) as string
                                            }
                                        </p>
                                        {props.descriptionField && (
                                            <p className="truncate text-sm text-gray-500">
                                                {
                                                    model.getValue(
                                                        props.descriptionField
                                                    ) as string
                                                }
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    }
                )}
        </div>
    );
};

export default StaticModelList;
