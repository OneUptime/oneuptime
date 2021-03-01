import React, { Component } from 'react';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from '../../actions/modal';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import DeleteSchedule from '../modals/DeleteSchedule';
import DataPathHoC from '../DataPathHoC';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';

class ScheduleEventDeleteBox extends Component {
    constructor(props) {
        super(props);
        this.state = { deleteModalId: uuidv4() };
    }
    deleteScheduleEvent = () => {
        alert('im to delete');
    };
    render() {
        const { deleteModalId } = this.state;
        const { projectId, scheduledEventId, openModal, deleting } = this.props;
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
                                    <span>
                                        Delete Scheduled Maintenance Event
                                    </span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to permanently delete
                                        this scheduled maintenance event.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--red Box-background--red"
                                        id={`deleteScheduleEvent`}
                                        onClick={() =>
                                            openModal({
                                                id: deleteModalId,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    this.deleteScheduleEvent(),
                                                content: DataPathHoC(
                                                    DeleteSchedule,
                                                    {
                                                        projectId,
                                                        eventId: scheduledEventId,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <ShouldRender if={!deleting}>
                                            <span>Delete</span>
                                        </ShouldRender>
                                        <ShouldRender if={deleting}>
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

const mapDispatchToProps = dispatch =>
    bindActionCreators({ openModal }, dispatch);
const mapStateToProps = state => {
    return {
        deleting: state.scheduledEvent.deletedScheduledEvent.requesting,
    };
};

ScheduleEventDeleteBox.propTypes = {
    projectId: PropTypes.string.isRequired,
    scheduledEventId: PropTypes.string.isRequired,
    deleting: PropTypes.bool,
    openModal: PropTypes.func.isRequired,
};
ScheduleEventDeleteBox.displayName = 'ScheduleEventDeleteBox';
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ScheduleEventDeleteBox);
