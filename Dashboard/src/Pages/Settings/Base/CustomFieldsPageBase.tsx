import React, { Fragment, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import DashboardNavigation from '../../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import CustomFieldType from 'Common/Types/CustomField/CustomFieldType';
import MonitorCustomField from 'Model/Models/MonitorCustomField';
import StatusPageCustomField from 'Model/Models/StatusPageCustomField';
import IncidentCustomField from 'Model/Models/IncidentCustomField';
import ScheduledMaintenanceCustomField from 'Model/Models/ScheduledMaintenanceCustomField';
import OnCallDutyPolicyCustomField from 'Model/Models/OnCallDutyPolicyCustomField';

export type CustomFieldsBaseModels =
    | MonitorCustomField
    | StatusPageCustomField
    | IncidentCustomField
    | ScheduledMaintenanceCustomField
    | OnCallDutyPolicyCustomField;

export interface ComponentProps<CustomFieldsBaseModels>
    extends PageComponentProps {
    title: string;
    modelType: { new (): CustomFieldsBaseModels };
}

const CustomFieldsPageBase: (
    props: ComponentProps<CustomFieldsBaseModels>
) => ReactElement = (
    props: ComponentProps<CustomFieldsBaseModels>
): ReactElement => {
    return (
        <Fragment>
            <ModelTable<CustomFieldsBaseModels>
                modelType={props.modelType}
                query={{
                    projectId: DashboardNavigation.getProjectId()!,
                }}
                showViewIdButton={true}
                id="custom-fields-table"
                name={'Settings > ' + props.title}
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    title: props.title,
                    description:
                        'Custom fields help you add new fields to your resources in OneUptime.',
                }}
                noItemsMessage={'No custom fields found.'}
                viewPageRoute={Navigation.getCurrentRoute()}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Field Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'internal-service',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Field Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder:
                            'This label is for all the internal services.',
                    },
                    {
                        field: {
                            type: true,
                        },
                        title: 'Field Type',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Please select field type.',
                        dropdownOptions: Object.keys(CustomFieldType).map(
                            (item: string) => {
                                return {
                                    label: item,
                                    value: item,
                                };
                            }
                        ),
                    },
                ]}
                showRefreshButton={true}
                
                filters={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Field Name',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Field Description',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            type: true,
                        },
                        title: 'Field Type',
                        type: FieldType.Text,
                    }
                ]}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Field Name',
                        type: FieldType.Text,
                        
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Field Description',
                        type: FieldType.Text,
                        
                    },
                    {
                        field: {
                            type: true,
                        },
                        title: 'Field Type',
                        type: FieldType.Text,
                        
                    },
                ]}
            />
        </Fragment>
    );
};

export default CustomFieldsPageBase;
