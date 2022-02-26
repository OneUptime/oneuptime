import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { deleteIncidentPriority as deleteIncidentPriorityAction } from '../../actions/incidentPriorities';

class RemoveIncidentPriority extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleSubmit() {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteIncidentPriorityAction' does not e... Remove this comment to see the full error message
            .deleteIncidentPriorityAction(this.props.currentProject._id, {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                _id: this.props.data.selectedIncidentPriority,
            })
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
        const { closeThisDialog } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Delete</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to delete this
                                        incident priority ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={
                                                this.props
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteIncidentPriority' does not exist o... Remove this comment to see the full error message
                                                    .deleteIncidentPriority
                                                    .error
                                            }
                                        >
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {
                                                                this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteIncidentPriority' does not exist o... Remove this comment to see the full error message
                                                                    .deleteIncidentPriority
                                                                    .error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>

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
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={() => this.handleSubmit()}
                                            disabled={
                                                this.props
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteIncidentPriority' does not exist o... Remove this comment to see the full error message
                                                    .deleteIncidentPriority
                                                    .requesting
                                            }
                                            id="RemoveIncidentPriority"
                                            autoFocus={true}
                                        >
                                            <span>Delete</span>
                                            <span className="delete-btn__keycode">
                                                <span className="keycode__icon keycode__icon--enter" />
                                            </span>
                                            <ShouldRender
                                                if={
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteIncidentPriority' does not exist o... Remove this comment to see the full error message
                                                        .deleteIncidentPriority
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
RemoveIncidentPriority.displayName = 'RemoveIncidentPriorityFormModal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
RemoveIncidentPriority.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    deleteIncidentPriorityAction: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    data: PropTypes.object.isRequired,
    deleteIncidentPriority: PropTypes.object.isRequired,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        deleteIncidentPriority: state.incidentPriorities.deleteIncidentPriority,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        deleteIncidentPriorityAction,
    },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RemoveIncidentPriority);
