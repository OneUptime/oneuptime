import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { deleteIncidentPriority as deleteIncidentPriorityAction } from '../../actions/incidentPriorities';

class RemoveIncidentPriority extends Component {
    handleSubmit() {
        this.props
            .deleteIncidentPriorityAction(this.props.currentProject._id, {
                _id: this.props.data.selectedIncidentPriority,
            })
            .then(() => this.props.closeThisDialog());
    }

    render() {
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
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
                                            this.props.deleteIncidentPriority
                                                .error
                                        }
                                    >
                                        <div className="bs-Tail-copy">
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{ marginTop: '10px' }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
                                                        {
                                                            this.props
                                                                .deleteIncidentPriority
                                                                .error
                                                        }
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>

                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                        type="button"
                                        onClick={this.props.closeThisDialog}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--red"
                                        type="button"
                                        onClick={() => this.handleSubmit()}
                                        disabled={
                                            this.props.deleteIncidentPriority
                                                .requesting
                                        }
                                        id='RemoveIncidentPriority'
                                    >
                                        <span>Delete</span>
                                        <ShouldRender
                                            if={
                                                this.props
                                                    .deleteIncidentPriority
                                                    .requesting
                                            }
                                        >
                                            <Spinner />
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

RemoveIncidentPriority.displayName = 'RemoveIncidentPriorityFormModal';

RemoveIncidentPriority.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    deleteIncidentPriorityAction: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    data: PropTypes.object.isRequired,
    deleteIncidentPriority: PropTypes.object.isRequired,
};

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
        deleteIncidentPriority: state.incidentPriorities.deleteIncidentPriority,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            deleteIncidentPriorityAction,
        },
        dispatch
    );

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RemoveIncidentPriority);
