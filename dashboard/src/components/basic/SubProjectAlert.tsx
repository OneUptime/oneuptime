import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';

class SubProjectAlert extends Component {
    render() {
        const { currentProject, subProjects, activeSubProjectId } = this.props;

        const isSubProject = currentProject?._id !== activeSubProjectId;
        let subProjectName;
        if (isSubProject) {
            subProjectName = subProjects.find(
                obj => obj._id === activeSubProjectId
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

SubProjectAlert.displayName = 'SubProjectAlert';

SubProjectAlert.propTypes = {
    currentProject: PropTypes.object,
    activeSubProjectId: PropTypes.string,
    subProjects: PropTypes.array,
};

const mapStateToProps = state => {
    let subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames =
        subProjects && subProjects.map(subProject => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects =
        subProjectNames &&
        subProjectNames.map(name =>
            subProjects.find(subProject => subProject.name === name)
        );

    return {
        currentProject: state.project.currentProject,
        activeSubProjectId: state.subProject.activeSubProject,
        subProjects,
    };
};

export default connect(mapStateToProps)(SubProjectAlert);
