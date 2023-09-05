import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Project from 'Model/Models/Project';
import User from 'Model/Models/User';

const Projects: FunctionComponent = (): ReactElement => {
    return (
        <Page
            title={'Projects'}
            breadcrumbLinks={[
                {
                    title: 'Admin Dashboard',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Projects',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.PROJECTS] as Route
                    ),
                },
            ]}
        >
            <ModelTable<Project>
                modelType={Project}
                id="projects-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                name="Projects"
                isViewable={true}
                cardProps={{
                    title: 'Projects',
                    description: 'Here is a list of proejcts in OneUptime.',
                }}
                showViewIdButton={true}
                formSteps={[
                    {
                        title: 'Basic Info',
                        id: 'project-info',
                    },
                    {
                        title: 'Owner',
                        id: 'owners',
                    },
                ]}
                noItemsMessage={'No projects found.'}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        stepId: 'project-info',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Project Name',
                        validation: {
                            minLength: 4,
                        },
                    },
                    {
                        field: {
                            createdByUser: true,
                        },
                        title: 'Owner',
                        stepId: 'owners',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: User,
                            labelField: 'email',
                            valueField: '_id',
                        },
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
                ]}
            />
        </Page>
    );
};

export default Projects;
