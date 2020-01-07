import uuid from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { deleteSchedule } from '../../actions/schedule';
import DeleteScheduleModal from './DeleteScheduleModal';
import { openModal, closeModal } from '../../actions/modal';
import { IS_DEV } from '../../config';
import { logEvent } from '../../analytics';

export class DeleteScheduleBox extends Component {

    constructor(props) {
        super(props);
        this.state = { deleteModalId: uuid.v4() }
    }

    handleClick = () => {
        const { subProjectId, projectId, deleteSchedule, scheduleId, history } = this.props;
        const { deleteModalId } = this.state
        this.props.openModal({
            id: deleteModalId,
            onConfirm: () => {
                return deleteSchedule(subProjectId, scheduleId)
                .then(() =>{
                if (!IS_DEV) {
                    logEvent('Schedule Deleted', { subProjectId, scheduleId });
                }
                history.push(`/project/${projectId}/on-call`);
            })
            },
            content: DeleteScheduleModal
        })

    }

    handleKeyBoard = (e) => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.deleteModalId })
            default:
                return false;
        }
    }

    render() {

        const { isRequesting } = this.props;

        return (
            <div onKeyDown={this.handleKeyBoard} className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Delete This Schedule
                                    </span>
                                </span>
                                <p>
                                    <span>Click the button to permanantly delete this schedule.</span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button id="delete" className="bs-Button bs-Button--red Box-background--red" disabled={isRequesting} onClick={this.handleClick}>
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
        )
    }
}

DeleteScheduleBox.displayName = 'DeleteScheduleBox'

const mapDispatchToProps = dispatch => (
    bindActionCreators({ deleteSchedule, openModal, closeModal }, dispatch)
)

const mapStateToProps = (state, props) => {
    const { scheduleId, projectId, subProjectId } = props.match.params;

    var schedule = state.schedule.subProjectSchedules.map((subProjectSchedule)=>{
        return subProjectSchedule.schedules.find(schedule => schedule._id === scheduleId)
    });
    
    schedule = schedule.find(schedule => schedule && schedule._id === scheduleId)

    const scheduleName = schedule && schedule.name;

    return {
        scheduleName,
        projectId,
        subProjectId,
        scheduleId,
        isRequesting: state.schedule.deleteSchedule.requesting,
    }
}

DeleteScheduleBox.propTypes = {
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    history: PropTypes.object.isRequired,
    subProjectId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    projectId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    scheduleId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    deleteSchedule: PropTypes.func.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired

}

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(DeleteScheduleBox));