import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import StatusPageOwnerTeam from 'Model/Models/StatusPageOwnerTeam';
import DashboardNavigation from '../../../Utils/Navigation';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IconProp from 'Common/Types/Icon/IconProp';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Team from 'Model/Models/Team';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import TeamElement from '../../../Components/Team/Team';
import StatusPageOwnerUser from 'Model/Models/StatusPageOwnerUser';
import User from 'Model/Models/User';
import UserElement from '../../../Components/User/User';
import ProjectUser from '../../../Utils/ProjectUser';

const StatusPageOwners: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="StatusPage"
            modelType={StatusPage}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Owners',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_OWNERS] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<StatusPageOwnerTeam>
                modelType={StatusPageOwnerTeam}
                id="table-statusPage-owner-team"
                name="StatusPage > Owner Team"
                singularName="Team"
                isDeleteable={true}
                createVerb={'Add'}
                isCreateable={true}
                isViewable={false}
                showViewIdButton={true}
                query={{
                    statusPageId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: StatusPageOwnerTeam
                ): Promise<StatusPageOwnerTeam> => {
                    item.statusPageId = modelId;
                    item.projectId = DashboardNavigation.getProjectId()!;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.Team,
                    title: 'Owners - Teams',
                    description:
                        'Here is list of teams that own this status page. They will be alerted when this status page is created or updated.',
                }}
                noItemsMessage={
                    'No teams associated with this status page so far.'
                }
                formFields={[
                    {
                        field: {
                            team: true,
                        },
                        title: 'Team',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Select Team',
                        dropdownModal: {
                            type: Team,
                            labelField: 'name',
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
                            team: {
                                name: true,
                            },
                        },
                        title: 'Team',
                        type: FieldType.Entity,
                        isFilterable: true,
                        getElement: (item: JSONObject): ReactElement => {
                            if (!item['team']) {
                                throw new BadDataException('Team not found');
                            }

                            return <TeamElement team={item['team'] as Team} />;
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Owner from',
                        type: FieldType.DateTime,
                    },
                ]}
            />

            <ModelTable<StatusPageOwnerUser>
                modelType={StatusPageOwnerUser}
                id="table-statusPage-owner-team"
                name="StatusPage > Owner Team"
                isDeleteable={true}
                singularName="User"
                isCreateable={true}
                isViewable={false}
                showViewIdButton={true}
                createVerb={'Add'}
                query={{
                    statusPageId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: StatusPageOwnerUser
                ): Promise<StatusPageOwnerUser> => {
                    item.statusPageId = modelId;
                    item.projectId = DashboardNavigation.getProjectId()!;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.Team,
                    title: 'Owners - User',
                    description:
                        'Here is list of users that own this status page. They will be alerted when this status page is created or updated.',
                }}
                noItemsMessage={
                    'No users associated with this status page so far.'
                }
                formFields={[
                    {
                        field: {
                            user: true,
                        },
                        title: 'User',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Select User',
                        fetchDropdownOptions: async () => {
                            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                                DashboardNavigation.getProjectId()!
                            );
                        },
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            user: {
                                name: true,
                                email: true,
                                profilePictureId: true,
                            },
                        },
                        title: 'User',
                        type: FieldType.Entity,
                        isFilterable: true,
                        getElement: (item: JSONObject): ReactElement => {
                            if (!item['user']) {
                                throw new BadDataException('User not found');
                            }

                            return <UserElement user={item['user'] as User} />;
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Owner from',
                        type: FieldType.DateTime,
                    },
                ]}
            />
        </ModelPage>
    );
};

export default StatusPageOwners;
