import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Team from 'Model/Models/Team';
import TeamMember from 'Model/Models/TeamMember';
import Navigation from 'CommonUI/src/Utils/Navigation';
import PermissionUtil from 'CommonUI/src/Utils/Permission';
import Label from 'Model/Models/Label';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import Permission, { PermissionHelper } from 'Common/Types/Permission';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import ObjectID from 'Common/Types/ObjectID';
import TeamPermission from 'Model/Models/TeamPermission';
import UserElement from '../../Components/User/User';
import User from 'Model/Models/User';
import LabelsElement from '../../Components/Label/Labels';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';

const TeamView: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam()?.toString().substring(1) || ''
    );

    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Settings',
                    to: RouteMap[PageMap.SETTINGS] as Route,
                },
                {
                    title: 'Teams',
                    to: RouteMap[PageMap.SETTINGS_TEAMS] as Route,
                },
                {
                    title: 'View Team',
                    to: RouteMap[PageMap.SETTINGS_TEAM_VIEW] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* API Key View  */}
            <CardModelDetail
                cardProps={{
                    title: 'Team Details',
                    description: "Here's more details on this team.",
                    icon: IconProp.User,
                }}
                isEditable={true}
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
                modelDetailProps={{
                    modelType: Team,
                    id: 'model-detail-team',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Team ID',
                        },
                        {
                            field: {
                                name: true,
                            },
                            title: 'Name',
                        },
                        {
                            field: {
                                description: true,
                            },
                            title: 'Description',
                        },
                    ],
                    modelId: Navigation.getLastParam(),
                }}
            />

            {/* Team Members Table */}

            <ModelTable<TeamMember>
                modelType={TeamMember}
                id="table-team-member"
                isDeleteable={true}
                createVerb={'Invite'}
                isCreateable={true}
                isViewable={false}
                query={{
                    teamId: modelId,
                    projectId: props.currentProject?._id,
                }}
                onBeforeCreate={(item: TeamMember): Promise<TeamPermission> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.teamId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.User,
                    title: 'Team Members',
                    description:
                        'See a list of members or invite them to this team. ',
                }}
                noItemsMessage={'No members found for this team.'}
                formFields={[
                    {
                        field: {
                            user: true,
                        },
                        title: 'User Email',
                        description:
                            'Please enter the email of the user you would like to invite. We will send them an email to let them know they have been invited to this team.',
                        fieldType: FormFieldSchemaType.Email,
                        required: false,
                        placeholder: 'member@company.com',
                        overideFieldKey: 'email',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            user: {
                                name: true,
                                email: true,
                            },
                        },
                        title: 'User',
                        type: FieldType.Text,
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['user']) {
                                return (
                                    <UserElement
                                        user={new User().fromJSON(
                                            item['user'] as JSONObject,
                                            User
                                        )}
                                    />
                                );
                            }

                            return <></>;
                        },
                    },
                    {
                        field: {
                            hasAcceptedInvitation: true,
                        },
                        title: 'Invitation Accepted',
                        type: FieldType.Boolean,
                        isFilterable: true,
                    },
                ]}
            />

            {/* Team Permisison Table */}

            <ModelTable<TeamPermission>
                modelType={TeamPermission}
                id="table-team-permission"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                isViewable={false}
                query={{
                    teamId: modelId,
                    projectId: props.currentProject?._id,
                }}
                onBeforeCreate={(
                    item: TeamPermission
                ): Promise<TeamPermission> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.teamId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.Lock,
                    title: 'Team Permissions',
                    description:
                        'Add different permisisons to this team to make it more granular.',
                }}
                noItemsMessage={'No permisisons created for this team so far.'}
                formFields={[
                    {
                        field: {
                            permission: true,
                        },
                        onChange: async (_value: any, form: any) => {
                            await form.setFieldValue(
                                'labels',
                                [],
                                true
                            );
                        },
                        title: 'Permission',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Permission',
                        dropdownOptions:
                            PermissionUtil.projectPermissionsAsDropdownOptions(),
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels (Optional)',
                        description:
                            'Labels on which this permissions will apply on. This is optional and an advanced feature.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Label,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        showIf: (values: FormValues<TeamPermission>): boolean => {

                            if (!values['permission']) {
                                return false;
                            }

                            if (values['permission'] && !PermissionHelper.isAccessControlPermission(values['permission'] as Permission)) {
                                return false; 
                            }

                            return true; 
                        },
                        required: false,
                        placeholder: 'Labels',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            permission: true,
                        },
                        title: 'Permission',
                        type: FieldType.Text,
                        isFilterable: true,
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <p>
                                    {PermissionHelper.getTitle(
                                        item['permission'] as Permission
                                    )}
                                </p>
                            );
                        },
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
                            projectId: props.currentProject?._id,
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <LabelsElement
                                    labels={
                                        Label.fromJSON(
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

            <ModelDelete
                modelType={Team}
                modelId={
                    new ObjectID(Navigation.getLastParam()?.toString() || '')
                }
                onDeleteSuccess={() => {
                    Navigation.navigate(
                        RouteMap[PageMap.SETTINGS_TEAMS] as Route
                    );
                }}
            />
        </Page>
    );
};

export default TeamView;
