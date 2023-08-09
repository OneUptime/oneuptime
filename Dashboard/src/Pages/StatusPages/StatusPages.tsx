import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import StatusPage from 'Model/Models/StatusPage';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Label from 'Model/Models/Label';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import LabelsElement from '../../Components/Label/Labels';
import JSONFunctions from 'Common/Types/JSONFunctions';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Team from 'Model/Models/Team';
import ProjectUser from '../../Utils/ProjectUser';

const StatusPages: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Status Pages'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route
                    ),
                },
            ]}
        >
            <ModelTable<StatusPage>
                modelType={StatusPage}
                id="status-page-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                name="Status Pages"
                isViewable={true}
                cardProps={{
                    title: 'Status Pages',
                    description:
                        'Here is a list of status page for this project.',
                }}
                showViewIdButton={true}
                formSteps={[
                    {
                        title: 'Status Page Info',
                        id: 'status-page-info',
                    },
                    {
                        title: 'Owners',
                        id: 'owners',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                noItemsMessage={'No status pages found.'}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        stepId: 'status-page-info',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Status Page Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        stepId: 'status-page-info',
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Description',
                    },
                    {
                        field: {
                            ownerTeams: true,
                        },
                        forceShow: true,
                        title: 'Owner - Teams',
                        stepId: 'owners',
                        description:
                            'Select which teams own this status page. ',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Team,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Select Teams',
                        overrideFieldKey: 'ownerTeams',
                    },
                    {
                        field: {
                            ownerUsers: true,
                        },
                        forceShow: true,
                        title: 'Owner - Users',
                        stepId: 'owners',
                        description: 'Select which users own this status page.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        fetchDropdownOptions: async () => {
                            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                                DashboardNavigation.getProjectId()!
                            );
                        },
                        required: false,
                        placeholder: 'Select Users',
                        overrideFieldKey: 'ownerUsers',
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels ',
                        stepId: 'labels',
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

export default StatusPages;
