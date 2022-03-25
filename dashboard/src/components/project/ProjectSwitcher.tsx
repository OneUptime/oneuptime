import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ReactHoverObserver from 'react-hover-observer';
import {
    switchProject,
    hideProjectSwitcher,
    showForm,
    switchToProjectViewerNav,
} from '../../actions/project';

import { User } from '../../config';
import { getSubProjects } from '../../actions/subProject';

interface ProjectSwitcherProps {
    showForm: Function;
    hideProjectSwitcher: Function;
    switchProject: Function;
    dispatch: Function;
    project: object;
    currentProject?: object;
    visible?: boolean;
    switchToProjectViewerNav?: Function;
    getSubProjects?: Function;
}

export class ProjectSwitcher extends Component<ProjectSwitcherProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.selectProject = this.selectProject.bind(this);
        this.handleClick = this.handleClick.bind(this);
    }

    handleClick = () => {

        this.props.showForm();

        this.props.hideProjectSwitcher();
    };

    selectProject(project: $TSFixMe) {
        const {

            switchProject,

            hideProjectSwitcher,

            currentProject,

            dispatch,
        } = this.props;

        if (project._id !== currentProject._id) {

            this.props.getSubProjects(project._id).then((res: Response) => {
                const { data: subProjects } = res.data;
                switchProject(dispatch, project, subProjects);

                this.props.switchToProjectViewerNav(
                    User.getUserId(),
                    subProjects,
                    project
                );
            });
        }

        hideProjectSwitcher();
    }

    override render() {
        let projectOptions = null;
        let isHovering = false;

        const { projects } = this.props.project.projects;
        if (projects && projects.length > 0) {
            projectOptions = projects.map(
                (project: $TSFixMe) => <div
                    key={project._id}
                    id={project.name}
                    title={project.name}
                >
                    {/* <ReactHoverObserver>
                        {({
                            isHovering
                        }: $TSFixMe) => ( */}
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
                    {/* )}
                    </ReactHoverObserver> */}
                </div>,
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
                                {({
                                    isHovering
                                }: $TSFixMe) => (
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

const mapStateToProps = (state: $TSFixMe) => ({
    project: state.project,
    currentProject: state.project.currentProject
});

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        switchProject,
        hideProjectSwitcher,
        dispatch,
        showForm,
        switchToProjectViewerNav,
        getSubProjects,
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
    switchToProjectViewerNav: PropTypes.func,
    getSubProjects: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(ProjectSwitcher);
