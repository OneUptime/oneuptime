import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { showDeleteModal } from '../../actions/project';
import { IS_SAAS_SERVICE } from '../../config';

export class DeleteProjectBox extends Component {
    handleClick = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showDeleteModal' does not exist on type ... Remove this comment to see the full error message
        this.props.showDeleteModal();
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
        const { isRequesting, currentProject } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        {IS_SAAS_SERVICE &&
                                            'Cancel Subscription and'}{' '}
                                        Delete Project
                                    </span>
                                </span>
                                <p>
                                    <span>
                                        This project will be deleted PERMANENTLY
                                        and will no longer be recoverable.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--red"
                                        onClick={this.handleClick}
                                        disabled={
                                            currentProject.deleted &&
                                            currentProject.deleted
                                        }
                                        id={`delete-${currentProject.name}`}
                                    >
                                        <ShouldRender if={!isRequesting}>
                                            <span>Delete Project</span>
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DeleteProjectBox.displayName = 'DeleteProjectBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
DeleteProjectBox.propTypes = {
    currentProject: PropTypes.object,
    isRequesting: PropTypes.oneOf([null, undefined, false, true]),
    showDeleteModal: PropTypes.func.isRequired,
};

const mapStateToProps = (state: $TSFixMe) => ({
    currentProject: state.project.currentProject
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        showDeleteModal,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(DeleteProjectBox);
