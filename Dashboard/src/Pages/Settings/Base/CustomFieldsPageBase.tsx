import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import DashboardSideMenu from '../SideMenu';
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
    currentRoute: Route;
    modelType: { new (): CustomFieldsBaseModels };
}

const CustomFieldsPageBase: (
    props: ComponentProps<CustomFieldsBaseModels>
) => ReactElement = (
    props: ComponentProps<CustomFieldsBaseModels>
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS] as Route
                    ),
                },
                {
                    title: props.title,
                    to: props.currentRoute,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
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
                showFilterButton={true}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Field Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Field Description',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            type: true,
                        },
                        title: 'Field Type',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default CustomFieldsPageBase;
