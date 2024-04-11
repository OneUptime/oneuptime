import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Team from 'Model/Models/Team';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import DashboardNavigation from '../../Utils/Navigation';
const Teams: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            <ModelTable<Team>
                modelType={Team}
                id="teams-table"
                name="Settings > Teams"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                isViewable={true}
                cardProps={{
                    title: 'Teams',
                    description:
                        'Here is a list of all the teams in this project.',
                }}
                noItemsMessage={'No teams found.'}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                showViewIdButton={true}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Team Name',
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
                        placeholder: 'Team Description',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
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
                ]}
            />
        </Fragment>
    );
};

export default Teams;
