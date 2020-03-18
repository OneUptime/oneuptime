import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import ReactHoverObserver from 'react-hover-observer';
import {
    switchProject,
    hideProjectSwitcher,
    showForm,
} from '../../actions/project';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

export class ProjectSwitcher extends Component {
    constructor(props) {
        super(props);
        this.selectProject = this.selectProject.bind(this);
        this.handleClick = this.handleClick.bind(this);
    }

    handleClick = () => {
        this.props.showForm();
        this.props.hideProjectSwitcher();
    };

    selectProject(project) {
        const {
            switchProject,
            hideProjectSwitcher,
            currentProject,
            dispatch,
        } = this.props;

        if (project._id !== currentProject._id) {
            switchProject(dispatch, project);
            if (!SHOULD_LOG_ANALYTICS) {
                logEvent('Project Switched', project);
            }
        }

        hideProjectSwitcher();
    }

    render() {
        let projectOptions = null;
        const { projects } = this.props.project.projects;
        if (projects && projects.length > 0) {
            projectOptions = projects.map(
                project => (
                    <div key={project._id} title={project.name}>
                        <ReactHoverObserver>
                            {({ isHovering }) => (
                                <div
                                    aria-selected="false"
                                    role="option"
                                    onClick={() => this.selectProject(project)}
                                >
                                    <div>
                                        <div
                                            className={
                                                isHovering
                                                    ? 'Box-root Box-background--blue Flex-flex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--4'
                                                    : 'Box-root Box-background--white Flex-flex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--4'
                                            }
                                            style={{
                                                cursor: 'pointer',
                                                userSelect: 'none',
                                            }}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="db-AccountSwitcherX-activeImage">
                                                    <div
                                                        className={
                                                            'db-AccountSwitcherX-accountImage Box-root Box-background--white'
                                                        }
                                                    >
                                                        <div className="db-AccountSwitcherX-accountImage--content db-AccountSwitcherX-accountImage--fallback" />
                                                    </div>
                                                </div>
                                            </div>
                                            <div
                                                style={{
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                <span
                                                    id={`span_${project.name}`}
                                                    className={
                                                        isHovering
                                                            ? 'Text-color--white Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap'
                                                            : 'Text-color--default Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap'
                                                    }
                                                >
                                                    {project.name}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </ReactHoverObserver>
                    </div>
                ),
                this
            );
        }

        return (
            <div
                className="ContextualLayer-layer--topleft ContextualLayer-layer--anytop ContextualLayer-layer--anyleft ContextualLayer-context--topleft ContextualLayer-context--anytop ContextualLayer-context--anyleft ContextualLayer-container ContextualLayer--pointerEvents"
                style={{
                    left: '0px',
                    top: '12px',
                    width: 'calc(100% - 5px)',
                    visibility: !this.props.visible ? 'collapse' : 'visible',
                }}
            >
                <span>
                    <div
                        id="selector"
                        className="db-AccountSwitcher Card-root Card-shadow--medium"
                    >
                        <div
                            className="ScrollableMenu db-AccountSwitcher-menu"
                            id="accountSwitcher"
                            role="listbox"
                        >
                            {projectOptions}

                            <ReactHoverObserver>
                                {({ isHovering }) => (
                                    <div
                                        aria-selected="false"
                                        role="option"
                                        onClick={this.handleClick}
                                    >
                                        <div>
                                            <div
                                                className={
                                                    isHovering
                                                        ? 'Box-root Box-background--blue Flex-flex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--8'
                                                        : 'Box-root Box-background--white Flex-flex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--8'
                                                }
                                                style={{
                                                    cursor: 'pointer',
                                                    userSelect: 'none',
                                                }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="db-AccountSwitcherX-activeImage">
                                                        <div className="db-AccountSwitcherX-accountImage Box-root Box-background--white">
                                                            <div className="db-AccountSwitcherX-accountImage--content db-AccountSwitcherX-accountImage--newAccount" />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div
                                                    style={{
                                                        overflow: 'hidden',
                                                        textOverflow:
                                                            'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    <span
                                                        id="create-project"
                                                        className={
                                                            isHovering
                                                                ? 'Text-color--white Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap'
                                                                : 'Text-color--default Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap'
                                                        }
                                                    >
                                                        Create New Project
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </ReactHoverObserver>
                        </div>
                    </div>
                </span>
            </div>
        );
    }
}

ProjectSwitcher.displayName = 'ProjectSwitcher';

const mapStateToProps = state => ({
    project: state.project,
    currentProject: state.project.currentProject,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            switchProject,
            hideProjectSwitcher,
            dispatch,
            showForm,
        },
        dispatch
    );

ProjectSwitcher.propTypes = {
    showForm: PropTypes.func.isRequired,
    hideProjectSwitcher: PropTypes.func.isRequired,
    switchProject: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
    project: PropTypes.object.isRequired,
    currentProject: PropTypes.object,
    visible: PropTypes.bool,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ProjectSwitcher)
);
