import React, { Component } from 'react';

import { v4 as uuidv4 } from 'uuid';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { blockProject } from '../../actions/project';
import ProjectBlockModal from './ProjectBlockModal';
import { openModal, closeModal } from 'CommonUI/actions/Modal';

export class ProjectBlockBox extends Component<ComponentProps> {
    public static displayName = '';
    public static propTypes = {};

    constructor(props: $TSFixMe) {
        super(props);
        this.state = { blockModalId: uuidv4() };
    }

    handleClick = () => {
        const { blockProject, project }: $TSFixMe = this.props;

        const { blockModalId }: $TSFixMe = this.state;

        this.props.openModal({
            id: blockModalId,
            onConfirm: () => {
                return blockProject(project._id);
            },
            content: ProjectBlockModal,
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.blockModalId });
            default:
                return false;
        }
    };

    override render() {
        const { isRequesting }: $TSFixMe = this.props;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="Box-root Margin-bottom--12"
            >
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Block This Project</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to block this project.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        id="block"
                                        className="bs-Button bs-Button--red Box-background--red"
                                        disabled={isRequesting}
                                        onClick={this.handleClick}
                                    >
                                        <ShouldRender if={!isRequesting}>
                                            <span>Block</span>
                                        </ShouldRender>
                                        <ShouldRender if={isRequesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ProjectBlockBox.displayName = 'ProjectBlockBox';

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        { blockProject, openModal, closeModal },
        dispatch
    );
};

const mapStateToProps: Function = (state: RootState) => {
    const project: $TSFixMe = state.project.project.project;
    return {
        project,
        isRequesting:
            state.project &&
            state.project.blockProject &&
            state.project.blockProject.requesting,
    };
};

ProjectBlockBox.propTypes = {
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    project: PropTypes.object.isRequired,
    blockProject: PropTypes.func.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
};

ProjectBlockBox.contextTypes = {};

export default connect(mapStateToProps, mapDispatchToProps)(ProjectBlockBox);
