import React from 'react';
import PropTypes from 'prop-types';
import QuickTipBox from '../basic/QuickTipBox';
import FeatureList from '../basic/FeatureList';
import { tutorials } from '../../config';

import { v4 as uuidv4 } from 'uuid';
import RenderIfOwnerOrAdmin from '../basic/RenderIfOwnerOrAdmin';
import ShouldRender from '../basic/ShouldRender';

const getDescription = (type: $TSFixMe) => {
    return tutorials.getTutorials().filter(note => note.id === type);
};
const renderFeatures = (features: ExpressResponse) => {
    if (features) {
        return features.map((feature: $TSFixMe) => <FeatureList key={uuidv4()} content={feature} />);
    }
    return null;
};

interface CustomTutorialProps {
    components?: unknown[];
    tutorialStat?: object;
    monitors?: unknown[];
    currentProjectId?: string;
    slug?: string;
    projectTeamMembers?: unknown[];
    hideActionButton?: boolean;
}

const CustomTutorial = ({
    components,
    tutorialStat,
    monitors,
    currentProjectId,
    slug,
    projectTeamMembers,
    hideActionButton
}: CustomTutorialProps) => (

    <div tabIndex="0" className="Box-root Margin-vertical--12">
        {/* Here, component and monitor notifier */}

        {components &&
            components.length < 1 &&
            tutorialStat.componentCustom.show ? (
            <div>
                {/* No Component Notifier */}
                <QuickTipBox
                    id={getDescription('component')[0].id}
                    title="Create your first Component"
                    icon={getDescription('component')[0].icon}
                    projectId={currentProjectId}
                    content={
                        <div>
                            {getDescription('component')[0].description}

                            <div>
                                <br />
                                <p>Components help you to: </p>
                                <ul>
                                    {renderFeatures(
                                        getDescription('component')[0].features
                                    )}
                                </ul>
                            </div>
                        </div>
                    }
                    callToActionLink={`/dashboard/project/${slug}/components`}
                    callToAction="Create Component"
                    hideActionButton={hideActionButton}
                />
            </div>
        ) : monitors &&
            monitors.length < 1 &&
            tutorialStat.monitorCustom.show ? (
            <div>
                {/* No Monitor Notifier */}
                <QuickTipBox
                    id={getDescription('monitor')[0].id}
                    title="Create a Monitor"
                    icon={getDescription('monitor')[0].icon}
                    projectId={currentProjectId}
                    content={
                        <div>
                            {getDescription('monitor')[0].description}

                            <div>
                                <br />
                                <p>Monitors help you to: </p>
                                <ul>
                                    {renderFeatures(
                                        getDescription('monitor')[0].features
                                    )}
                                </ul>
                            </div>
                        </div>
                    }
                    callToActionLink={`/dashboard/project/${slug}/components`}
                    callToAction="Create Monitor"
                    hideActionButton={hideActionButton}
                />
            </div>
        ) : null}

        {/* Here, check if atleast organization has just 1 member before rendering */}

        <RenderIfOwnerOrAdmin>
            <ShouldRender
                if={
                    projectTeamMembers &&
                    projectTeamMembers.length === 1 &&
                    tutorialStat.teamMemberCustom.show
                }
            >
                <QuickTipBox
                    id={getDescription('teamMember')[0].id}
                    title="Invite your Team"
                    icon={getDescription('teamMember')[0].icon}
                    projectId={currentProjectId}
                    content={
                        <div>
                            {getDescription('teamMember')[0].description}

                            <div>
                                <br />
                                <p>
                                    Inviting your team members would help you
                                    to:{' '}
                                </p>
                                <ul>
                                    {renderFeatures(
                                        getDescription('teamMember')[0].features
                                    )}
                                </ul>
                            </div>
                        </div>
                    }
                    callToActionLink={`/dashboard/project/${slug}/team`}
                    callToAction="Invite Team Member"
                />
            </ShouldRender>
        </RenderIfOwnerOrAdmin>
    </div>
);

CustomTutorial.displayName = 'TutorialBox';

CustomTutorial.propTypes = {
    components: PropTypes.array,
    tutorialStat: PropTypes.object,
    monitors: PropTypes.array,
    currentProjectId: PropTypes.string,
    slug: PropTypes.string,
    projectTeamMembers: PropTypes.array,
    hideActionButton: PropTypes.bool,
};

export default CustomTutorial;
