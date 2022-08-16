import React, { FunctionComponent, ReactElement, useState } from 'react';
import TeamMember from 'Model/Models/TeamMember';
import User from 'CommonUI/src/Utils/User';

import FullPageModal from 'CommonUI/src/Components/FullPageModal/FullPageModal';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import { JSONObject } from 'Common/Types/JSON';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    onClose: () => void;
}

const ProjectInvitationsModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [
        projectInvitationsRefreshToggle,
        setProjectInvitationsRefreshToggle,
    ] = useState<boolean>(true);

    return (
        <>
            <FullPageModal
                onClose={() => {
                    props.onClose && props.onClose();
                }}
            >
                <ModelTable<TeamMember>
                    modelType={TeamMember}
                    id="team-member-table"
                    isDeleteable={true}
                    query={{
                        userId: User.getUserId(),
                        hasAcceptedInvitation: false,
                    }}
                    isEditable={false}
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
                    refreshToggle={projectInvitationsRefreshToggle}
                    actionButtons={[
                        {
                            title: 'Accept',
                            buttonStyleType:
                                ButtonStyleType.SUCCESS_OUTLINE,
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
                                            invitationAcceptedAt:
                                                new Date(),
                                        }
                                    );

                                    setProjectInvitationsRefreshToggle(
                                        !projectInvitationsRefreshToggle
                                    );
                                    onCompleteAction();
                                } catch (err) {
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
            </FullPageModal>
        </>
    );
};

export default ProjectInvitationsModal;
