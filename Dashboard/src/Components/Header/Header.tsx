import React, { FunctionComponent, ReactElement, useState } from 'react';
import SearchBox from 'CommonUI/src/Components/Header/SearchBox';
import Notifications from './Notifications';
import Help from './Help';
import UserProfile from './UserProfile';
import ProjectPicker from './ProjectPicker';
// import ObjectID from 'Common/Types/ObjectID';

import Header from 'CommonUI/src/Components/Header/Header';
import Project from 'Model/Models/Project';
import CounterModelAlert from 'CommonUI/src/Components/CounterModelAlert/CounterModelAlert';
import { AlertType } from 'CommonUI/src/Components/Alerts/Alert';
import TeamMember from 'Model/Models/TeamMember';
import User from 'CommonUI/src/Utils/User';

import FullPageModal from "CommonUI/src/Components/FullPageModal/FullPageModal";
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FieldType from 'CommonUI/src/Components/Types/FieldType';

export interface ComponentProps {
    selectedProject: Project | null;
    projects: Array<Project>;
    onProjectSelected: (project: Project) => void;
}

const DashboardHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showProjectInvitationModal, setShowProjectInvitationModal] =
        useState<boolean>(false);

    return (
        <>
            <Header
                leftComponents={
                    <>
                        <ProjectPicker
                            projects={props.projects}
                            onProjectSelected={props.onProjectSelected}
                        />
                        <SearchBox key={2} onChange={(_value: string) => { }} />
                        <div
                            style={{
                                marginLeft: '15px',
                                marginTop: '15px',
                            }}
                        >
                            <CounterModelAlert<TeamMember>
                                alertType={AlertType.INFO}
                                modelType={TeamMember}
                                query={{
                                    userId: User.getUserId(),
                                    hasAcceptedInvitation: false,
                                }}
                                singularName="Project Invitation"
                                pluralName="Project Invitations"
                                queryOptions={{
                                    isMultiTenantRequest: true,
                                }}
                                onClick={() => {
                                    setShowProjectInvitationModal(true);
                                }}
                            />
                        </div>
                    </>
                }
                rightComponents={
                    <>
                        <Notifications />
                        <Help />
                        <UserProfile />
                    </>
                }
            />

            {showProjectInvitationModal && <FullPageModal onClose={() => {
                setShowProjectInvitationModal(false);
            }}>
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
                    columns={[
                        {
                            field: {
                                project: true,
                            },
                            title: 'Project Invited to',
                            type: FieldType.Text,
                            isFilterable: true,
                            selectedProperty: "name"
                        },
                        {
                            field: {
                                team: true,
                            },
                            title: 'Team Invited to',
                            type: FieldType.Text,
                            selectedProperty: "name"
                        },
                    ]}
                />
            </FullPageModal>}
        </>
    );
};

export default DashboardHeader;
