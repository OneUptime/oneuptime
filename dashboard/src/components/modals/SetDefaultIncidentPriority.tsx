import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"../../actions/incidentBasicsSettings"' ha... Remove this comment to see the full error message
import { updateDefaultIncidentSettings } from '../../actions/incidentBasicsSettings';

class SetDefaultIncidentPriority extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleSubmit() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { data } = this.props;
        const incidentPriorityId = data.incidentPriorityId;
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateDefaultIncidentSettings' does not ... Remove this comment to see the full error message
            .updateDefaultIncidentSettings(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id,
                incidentPriorityId
            )
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            .then(() => this.props.closeThisDialog());
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            case 'Enter':
                return this.handleSubmit();
            default:
                return false;
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
        const { closeThisDialog, data } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM" id="priorityDefaultModal">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Set Default Priority</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        You’re setting{' '}
                                        {data.incidentPriorityName} as default
                                        priority. What this means is, all new
                                        incidents when created will have a{' '}
                                        {data.incidentPriorityName} priority set
                                        to them.
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                                            onClick={this.props.closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--white btn__modal"
                                            type="button"
                                            onClick={() => this.handleSubmit()}
                                            id="SetDefaultIncidentPriority"
                                            autoFocus={true}
                                        >
                                            <span>OK</span>
                                            <span className="create-btn__keycode">
                                                <span className="keycode__icon keycode__icon--enter" />
                                            </span>
                                            <ShouldRender
                                                if={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatedIncident' does not exist on type ... Remove this comment to see the full error message
                                                    this.props.updatedIncident
                                                        .requesting
                                                }
                                            >
                                                <Spinner />
                                            </ShouldRender>
                                        </button>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SetDefaultIncidentPriority.displayName = 'SetDefaultIncidentPriorityFormModal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SetDefaultIncidentPriority.propTypes = {
    updateDefaultIncidentSettings: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    updatedIncident: PropTypes.object,
    data: PropTypes.object.isRequired,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        updatedIncident:
            state.incidentBasicSettings.updateIncidentBasicSettings,
        currentProject: state.project.currentProject,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        updateDefaultIncidentSettings,
    },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(SetDefaultIncidentPriority);
