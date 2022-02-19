import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { deleteSchedule, fetchUserSchedule } from '../../actions/schedule';
import DeleteScheduleModal from './DeleteScheduleModal';
import { openModal } from '../../actions/modal';



export class DeleteScheduleBox extends Component {
    constructor(props) {
        super(props);
        this.state = { deleteModalId: uuidv4() };
    }

    handleClick = () => {
        const {
            subProjectId,
            projectId,
            deleteSchedule,
            scheduleId,
            history,
            userId,
        } = this.props;
        const { deleteModalId } = this.state;
        this.props.openModal({
            id: deleteModalId,
            onConfirm: () => {
                return deleteSchedule(subProjectId, scheduleId).then(() => {
                    
                    this.props.fetchUserSchedule(projectId, userId);
                    history.push(
                        `/dashboard/project/${this.props.slug}/on-call`
                    );
                });
            },
            content: DeleteScheduleModal,
        });
    };

    render() {
        const { isRequesting } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Delete Duty</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to permanently delete
                                        this duty.
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

DeleteScheduleBox.displayName = 'DeleteScheduleBox';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            deleteSchedule,
            openModal,
            fetchUserSchedule,
        },
        dispatch
    );

const mapStateToProps = (state, props) => {
    const { scheduleSlug, userId } = props.match.params;

    let schedule = state.schedule.subProjectSchedules.map(
        subProjectSchedule => {
            return subProjectSchedule.schedules.find(
                schedule => schedule.slug === scheduleSlug
            );
        }
    );

    schedule = schedule.find(
        schedule => schedule && schedule.slug === scheduleSlug
    );

    const scheduleName = schedule && schedule.name;

    return {
        scheduleName,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        subProjectId: schedule && schedule.projectId._id,
        scheduleId: schedule && schedule._id,
        slug: state.project.currentProject && state.project.currentProject.slug,
        userId,
        isRequesting: state.schedule.deleteSchedule.requesting,
    };
};

DeleteScheduleBox.propTypes = {
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    history: PropTypes.object.isRequired,
    slug: PropTypes.string,
    subProjectId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    projectId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    scheduleId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    deleteSchedule: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    fetchUserSchedule: PropTypes.func.isRequired,
    userId: PropTypes.object.isRequired,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(DeleteScheduleBox)
);
