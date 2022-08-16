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
import ProjectInvitationsModal from './ProjectInvitationsModal';

export interface ComponentProps {
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
                        <SearchBox key={2} onChange={(_value: string) => {}} />
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
                                requestOptions={{
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

            {showProjectInvitationModal && (
                <ProjectInvitationsModal
                    onClose={() => {
                        setShowProjectInvitationModal(false);
                    }}
                />
            )}
        </>
    );
};

export default DashboardHeader;
