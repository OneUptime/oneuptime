import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import TeamMember from 'Model/Models/TeamMember';
import User from 'CommonUI/src/Utils/User';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import IconProp from 'Common/Types/Icon/IconProp';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import { JSONObject } from 'Common/Types/JSON';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import ObjectID from 'Common/Types/ObjectID';
import GlobalEvents from 'CommonUI/src/Utils/GlobalEvents';
import EventName from '../../Utils/EventName';
import Navigation from 'CommonUI/src/Utils/Navigation';

const Home: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Inviations'}
            breadcrumbLinks={[
                {
                    title: 'Home',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Project Invitations',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.PROJECT_INVITATIONS] as Route
                    ),
                },
            ]}
        >
            <ModelTable<TeamMember>
                modelType={TeamMember}
                name="Project Invitations"
                id="team-member-table"
                isDeleteable={true}
                query={{
                    userId: User.getUserId(),
                    hasAcceptedInvitation: false,
                }}
                fetchRequestOptions={{
                    isMultiTenantRequest: true,
                }}
                deleteRequestOptions={{
                    isMultiTenantRequest: true,
                }}
                isEditable={false}
                showRefreshButton={true}
                isCreateable={false}
                isViewable={false}
                cardProps={{
                    icon: IconProp.User,
                    title: 'Pending Invitations',
                    description:
                        'Here is a list of projects and teams you have been invited to.',
                }}
                noItemsMessage={
                    'No project or team invitations for you so far.'
                }
                singularName="Project Invitation"
                pluralName="Project Invitations"
                onItemDeleted={() => {
                    GlobalEvents.dispatchEvent(
                        EventName.PROJECT_INVITATIONS_REFRESH
                    );
                }}
                actionButtons={[
                    {
                        title: 'Accept',
                        buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
                        icon: IconProp.Check,
                        onClick: async (
                            item: JSONObject,
                            onCompleteAction: Function,
                            onError: (err: Error) => void
                        ) => {
                            try {
                                // accept invite.
                                await ModelAPI.updateById(
                                    TeamMember,
                                    new ObjectID(
                                        item['_id']
                                            ? item['_id'].toString()
                                            : ''
                                    ),
                                    {
                                        hasAcceptedInvitation: true,
                                        invitationAcceptedAt: new Date(),
                                    },
                                    undefined,
                                    {
                                        isMultiTenantRequest: true,
                                    }
                                );

                                onCompleteAction();
                                Navigation.reload();
                            } catch (err) {
                                GlobalEvents.dispatchEvent(
                                    EventName.PROJECT_INVITATIONS_REFRESH
                                );
                                onCompleteAction();
                                onError(err as Error);
                                
                            }
                        },
                    },
                ]}
                deleteButtonText="Reject"
                columns={[
                    {
                        field: {
                            project: {
                                name: true,
                            },
                        },
                        title: 'Project Invited to',
                        type: FieldType.Text,
                        isFilterable: true,
                        selectedProperty: 'name',
                    },
                    {
                        field: {
                            team: {
                                name: true,
                            },
                        },
                        title: 'Team Invited to',
                        type: FieldType.Text,
                        selectedProperty: 'name',
                    },
                ]}
            />
        </Page>
    );
};

export default Home;
