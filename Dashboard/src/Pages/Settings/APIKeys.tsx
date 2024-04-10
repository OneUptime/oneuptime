import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import ApiKey from 'Model/Models/ApiKey';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
const APIKeys: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            <ModelTable<ApiKey>
                modelType={ApiKey}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                id="api-keys-table"
                name="Settings > API Keys"
                isDeleteable={false}
                isEditable={false}
                showViewIdButton={false}
                isCreateable={true}
                isViewable={true}
                cardProps={{
                    title: 'API Keys',
                    description:
                        'Everything you can do on the dashboard can also be done via the OneUptime API- use it to automate repetitive work or integrate with other platforms.',
                }}
                noItemsMessage={'No API Keys found.'}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'API Key Name',
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
                        placeholder: 'API Key Description',
                    },
                    {
                        field: {
                            expiresAt: true,
                        },
                        title: 'Expires',
                        fieldType: FormFieldSchemaType.Date,
                        required: true,
                        placeholder: 'Expires at',
                        validation: {
                            dateShouldBeInTheFuture: true,
                        },
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                filters={[
                    {
                        field: {
                            name: true,
                        },
                        type: FieldType.Text,
                        title: 'Name',
                    },
                    {
                        field: {
                            description: true,
                        },
                        type: FieldType.Text,
                        title: 'Description',
                    },
                    {
                        field: {
                            expiresAt: true,
                        },
                        type: FieldType.Date,
                        title: 'Expires',
                    },
                
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
                            expiresAt: true,
                        },
                        title: 'Expires',
                        type: FieldType.Date,
                        
                    },
                ]}
            />
        </Fragment>
    );
};

export default APIKeys;
