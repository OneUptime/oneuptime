import React, { FunctionComponent, ReactElement, useState } from 'react';
// import SearchBox from './SearchBox';
// import Notifications from './Notifications';
import Help from './Help';
import UserProfile from './UserProfile';
import ProjectPicker from './ProjectPicker';

import Header from 'CommonUI/src/Components/Header/Header';
import Project from 'Model/Models/Project';
import CounterModelAlert from 'CommonUI/src/Components/CounterModelAlert/CounterModelAlert';
import { AlertType } from 'CommonUI/src/Components/Alerts/Alert';
import TeamMember from 'Model/Models/TeamMember';
import User from 'CommonUI/src/Utils/User';
import ProjectInvitationsModal from './ProjectInvitationsModal';
import ActiveIncidentsModal from './ActiveIncidentsModal';
import Incident from 'Model/Models/Incident';
import Logo from './Logo';

export interface ComponentProps {
    projects: Array<Project>;
    onProjectSelected: (project: Project) => void;
    onProjectRequestAccepted: () => void;
    onProjectRequestRejected: () => void;
    selectedProject: Project | null;
    showProjectModal: boolean;
    onProjectModalClose: () => void;
}

const DashboardHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showProjectInvitationModal, setShowProjectInvitationModal] =
        useState<boolean>(false);

    const [showActiveIncidentsModal, setShowActiveIncidentsModal] =
        useState<boolean>(false);

    const [projectCountRefreshToggle, setProjectCountRefreshToggle] =
        useState<boolean>(true);

    return (
        <>
            <Header
                leftComponents={
                    <>
                        {props.projects.length === 0 && (
                            <Logo onClick={() => {}} />
                        )}
                        <ProjectPicker
                            showProjectModal={props.showProjectModal}
                            onProjectModalClose={props.onProjectModalClose}
                            projects={props.projects}
                            onProjectSelected={props.onProjectSelected}
                        />
                        {/* <SearchBox
                            key={2}
                            selectedProject={props.selectedProject}
                            onChange={(_value: string) => {}}
                        /> */}
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
                                refreshToggle={projectCountRefreshToggle}
                                onClick={() => {
                                    setShowProjectInvitationModal(true);
                                }}
                            />
                            <CounterModelAlert<Incident>
                                alertType={AlertType.DANGER}
                                modelType={Incident}
                                query={{
                                    currentIncidentState: {
                                        order: 1,
                                    },
                                }}
                                singularName="Active Incident"
                                pluralName="Active Incidents"
                                requestOptions={{
                                    isMultiTenantRequest: true,
                                }}
                                onClick={() => {
                                    setShowActiveIncidentsModal(true);
                                }}
                            />
                        </div>
                    </>
                }
                rightComponents={
                    <>
                        {/* <Notifications /> */}
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
                    onRequestAccepted={() => {
                        props.onProjectRequestAccepted();
                        setProjectCountRefreshToggle(
                            !projectCountRefreshToggle
                        );
                    }}
                    onRequestRejected={() => {
                        props.onProjectRequestRejected();
                        setProjectCountRefreshToggle(
                            !projectCountRefreshToggle
                        );
                    }}
                />
            )}

            {showActiveIncidentsModal && (
                <ActiveIncidentsModal
                    onClose={() => {
                        setShowActiveIncidentsModal(false);
                    }}
                />
            )}
        </>
    );
};

export default DashboardHeader;
