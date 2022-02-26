import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';

class SubProjectAlert extends Component {
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, subProjects, activeSubProjectId } = this.props;

        const isSubProject = currentProject?._id !== activeSubProjectId;
        let subProjectName;
        if (isSubProject) {
            subProjectName = subProjects.find(
                (obj: $TSFixMe) => obj._id === activeSubProjectId
            )?.name;
        }

        return (
            <ShouldRender if={isSubProject}>
                <div id="alertWarning" className="Box-root Margin-vertical--12">
                    <div className="db-Trends bs-ContentSection Card-root">
                        <div className="Box-root Box-background--blue Border-radius--4">
                            <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                    <span>
                                        <span
                                            style={{
                                                textTransform: 'capitalize',
                                            }}
                                        >
                                            {subProjectName}
                                        </span>
                                        : You are currently viewing{' '}
                                        <span
                                            style={{
                                                textTransform: 'capitalize',
                                            }}
                                        >
                                            {subProjectName}
                                        </span>{' '}
                                        sub-projects.
                                    </span>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </ShouldRender>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SubProjectAlert.displayName = 'SubProjectAlert';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SubProjectAlert.propTypes = {
    currentProject: PropTypes.object,
    activeSubProjectId: PropTypes.string,
    subProjects: PropTypes.array,
};

const mapStateToProps = (state: $TSFixMe) => {
    let subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames =
        subProjects && subProjects.map((subProject: $TSFixMe) => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects =
        subProjectNames &&
        subProjectNames.map((name: $TSFixMe) => subProjects.find((subProject: $TSFixMe) => subProject.name === name)
        );

    return {
        currentProject: state.project.currentProject,
        activeSubProjectId: state.subProject.activeSubProject,
        subProjects,
    };
};

export default connect(mapStateToProps)(SubProjectAlert);
