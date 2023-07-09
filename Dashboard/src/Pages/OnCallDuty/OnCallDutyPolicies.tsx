import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import Label from 'Model/Models/Label';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import LabelsElement from '../../Components/Label/Labels';
import JSONFunctions from 'Common/Types/JSONFunctions';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import DashboardSideMenu from './SideMenu';

const OnCallDutyPage: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'On-Call Duty'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'On Call Duty',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY] as Route
                    ),
                },
                {
                    title: 'Policies',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<OnCallDutyPolicy>
                modelType={OnCallDutyPolicy}
                id="on-call-duty-table"
                isDeleteable={false}
                name="On Call > Policies"
                showViewIdButton={true}
                isEditable={false}
                isCreateable={true}
                isViewable={true}
                cardProps={{
                    icon: IconProp.Call,
                    title: 'On Call Duty Policies',
                    description:
                        'Here is a list of on-call-duty policies for this project.',
                }}
                noItemsMessage={'No on-call policy found.'}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'On Call Duty Name',
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
                        placeholder: 'Description',
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels ',
                        description:
                            'Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Label,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Labels',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            labels: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Labels',
                        type: FieldType.EntityArray,
                        isFilterable: true,
                        filterEntityType: Label,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <LabelsElement
                                    labels={
                                        JSONFunctions.fromJSON(
                                            (item['labels'] as JSONArray) || [],
                                            Label
                                        ) as Array<Label>
                                    }
                                />
                            );
                        },
                    },
                ]}
            />
        </Page>
    );
};

export default OnCallDutyPage;
