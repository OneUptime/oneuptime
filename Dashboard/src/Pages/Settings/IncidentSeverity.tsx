import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import { ShowAs } from 'CommonUI/src/Components/ModelTable/BaseModelTable';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Color from 'Common/Types/Color';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import Navigation from 'CommonUI/src/Utils/Navigation';
const IncidentSeverityPage: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            <ModelTable<IncidentSeverity>
                modelType={IncidentSeverity}
                id="incident-state-table"
                name="Settings > Incident Severity"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    title: 'Incident Severity',
                    description:
                        'Alerts and incidents will be categorised according to their severity level using the following classifications: ',
                }}
                sortBy="order"
                sortOrder={SortOrder.Ascending}
                selectMoreFields={{
                    color: true,
                    order: true,
                }}
                filters={[]}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        getElement: (item: IncidentSeverity): ReactElement => {
                            return (
                                <Pill
                                    isMinimal={true}
                                    color={item['color'] as Color}
                                    text={item['name'] as string}
                                />
                            );
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,

                        getElement: (item: IncidentSeverity): ReactElement => {
                            return (
                                <div>
                                    <p>{`${item['description']}`}</p>
                                    <p className="text-xs text-gray-400">
                                        ID: {`${item['_id']}`}
                                    </p>
                                </div>
                            );
                        },
                    },
                ]}
                noItemsMessage={'No incident severity found.'}
                viewPageRoute={Navigation.getCurrentRoute()}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Investigating',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder:
                            'This incident state happens when the incident is investigated',
                    },
                    {
                        field: {
                            color: true,
                        },
                        title: 'Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: true,
                        placeholder:
                            'Please select color for this incident state.',
                    },
                ]}
                showRefreshButton={true}
                showAs={ShowAs.OrderedStatesList}
                orderedStatesListProps={{
                    titleField: 'name',
                    descriptionField: 'description',
                    orderField: 'order',
                    shouldAddItemInTheEnd: true,
                }}
            />
        </Fragment>
    );
};

export default IncidentSeverityPage;
