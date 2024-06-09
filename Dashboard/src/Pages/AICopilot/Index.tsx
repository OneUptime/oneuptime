import LabelsElement from '../../Components/Label/Labels';
import DashboardNavigation from '../../Utils/Navigation';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Page from 'CommonUI/src/Components/Page/Page';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import CodeRepository from 'Model/Models/CodeRepository';
import Label from 'Model/Models/Label';
import React, { FunctionComponent, ReactElement } from 'react';

const CodeRepositoryPage: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'AI Copilot'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'AI Copilot',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.AI_COPILOT] as Route
                    ),
                },
            ]}
        >
            <ModelTable<CodeRepository>
                modelType={CodeRepository}
                id="service-catalog-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                name="Git Repositories"
                isViewable={true}
                cardProps={{
                    title: 'Git Repository',
                    description:
                        'Git repositores where the AI Copilot can improve your code.',
                }}
                viewPageRoute={
                    new Route(
                        Navigation.getCurrentRoute().toString() +
                            '/code-repository'
                    )
                }
                showViewIdButton={true}
                noItemsMessage={'No repositories found.'}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Friendly Name',
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
                ]}
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
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,
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
                        filterEntityType: Label,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
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
                            labels: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Labels',
                        type: FieldType.EntityArray,

                        getElement: (item: CodeRepository): ReactElement => {
                            return (
                                <LabelsElement labels={item['labels'] || []} />
                            );
                        },
                    },
                ]}
            />
        </Page>
    );
};

export default CodeRepositoryPage;
