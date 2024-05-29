import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import MonitorSecret from 'Model/Models/MonitorSecret';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Monitor from 'Model/Models/Monitor';
import MonitorsElement from '../../Components/Monitor/Monitors';

const MonitorSecrets: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            <ModelTable<MonitorSecret>
                modelType={MonitorSecret}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                id="monitor-secret-table"
                name="Settings > Monitor Secret"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    title: 'Monitor Secrets',
                    description:
                        'Monitor secrets are used to store sensitive information like API keys, passwords, etc. that can be shared with monitors.',
                }}
                noItemsMessage={'No monitor secret found. Click on the "Create" button to add a new monitor secret.'}
                viewPageRoute={Navigation.getCurrentRoute()}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Secret Name',
                        validation: {
                            minLength: 2,
                            noSpaces: true,
                            noNumbers: true,
                            noSpecialCharacters: true,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Secret Description',
                    },
                    {
                        field: {
                            secretValue: true,
                        },
                        title: 'Secret Value',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder:
                            'Secret Value (eg: API Key, Password, etc.)',
                    },
                    {
                        field: {
                            monitors: true,
                        },
                        title: 'Monitors which have access to this secret',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Monitor,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        description: 'Whcih monitors should have access to this secret?',
                        placeholder:
                            'Select monitors',
                    },
                ]}
                sortBy="name"
                sortOrder={SortOrder.Ascending}
                showRefreshButton={true}
                filters={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            monitors: true,
                        },
                        title: 'Monitors which have access to this secret',
                        type: FieldType.EntityArray,

                        filterEntityType: Monitor,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },

                    }
                ]}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,

                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,

                    },
                    {
                        field: {
                            monitors: {
                                name: true,
                                _id: true,
                                projectId: true,
                            },
                        },
                        title: 'Monitors which have access to this secret',
                        type: FieldType.EntityArray,

                        getElement: (item: MonitorSecret): ReactElement => {
                            return (
                                <MonitorsElement
                                    monitors={item['monitors'] || []}
                                />
                            );
                        },
                    },
                ]}
            />
        </Fragment>
    );
};

export default MonitorSecrets;
