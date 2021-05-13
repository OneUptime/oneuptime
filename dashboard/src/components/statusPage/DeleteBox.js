import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { deleteStatusPage } from '../../actions/statusPage';
import DeleteStatusPageModal from './DeleteStatusPageModal';
import { openModal, closeModal } from '../../actions/modal';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

export class DeleteStatusPageBox extends Component {
    constructor(props) {
        super(props);
        this.state = { deleteModalId: uuidv4() };
    }

    handleClick = () => {
        const {
            deleteStatusPage,
            statusPageSlug,
            history,
            subProjectId,
        } = this.props;
        const { deleteModalId } = this.state;
        this.props.openModal({
            id: deleteModalId,
            onConfirm: () => {
                return deleteStatusPage(subProjectId, statusPageSlug).then(
                    () => {
                        if (SHOULD_LOG_ANALYTICS) {
                            logEvent(
                                'EVENT: DASHBOARD > PROJECT > STATUS PAGES > STATUS PAGE > STATUS PAGE DELETED'
                            );
                        }
                        history.push(
                            `/dashboard/project/${this.props.slug}/status-pages`
                        );
                    }
                );
            },
            content: DeleteStatusPageModal,
        });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.deleteModalId });
            default:
                return false;
        }
    };

    render() {
        const { isRequesting } = this.props;

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
                                    <span>Delete Status Page</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to permanantly delete
                                        this status page.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        id="delete"
                                        className="bs-Button bs-Button--red Box-background--red"
                                        disabled={isRequesting}
                                        onClick={this.handleClick}
                                    >
                                        <ShouldRender if={!isRequesting}>
                                            <span>Delete</span>
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

DeleteStatusPageBox.displayName = 'DeleteStatusPageBox';

const mapDispatchToProps = dispatch =>
    bindActionCreators({ deleteStatusPage, openModal, closeModal }, dispatch);

const mapStateToProps = (state, props) => {
    const { statusPageSlug } = props.match.params;

    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        slug: state.project.currentProject && state.project.currentProject.slug,
        statusPageSlug,
        isRequesting:
            state.statusPage &&
            state.statusPage.deleteStatusPage &&
            state.statusPage.deleteStatusPage.requesting,
    };
};

DeleteStatusPageBox.propTypes = {
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    history: PropTypes.object.isRequired,
    statusPageSlug: PropTypes.string,
    deleteStatusPage: PropTypes.func.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    slug: PropTypes.string,
    subProjectId: PropTypes.string,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(DeleteStatusPageBox)
);
