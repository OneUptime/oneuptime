// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { deleteSchedule, fetchUserSchedule } from '../../actions/schedule';
import DeleteScheduleModal from './DeleteScheduleModal';
import { openModal } from '../../actions/modal';

export class DeleteScheduleBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { deleteModalId: uuidv4() };
    }

    handleClick = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
            subProjectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteSchedule' does not exist on type '... Remove this comment to see the full error message
            deleteSchedule,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduleId' does not exist on type 'Read... Remove this comment to see the full error message
            scheduleId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'history' does not exist on type 'Readonl... Remove this comment to see the full error message
            history,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
            userId,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteModalId' does not exist on type 'R... Remove this comment to see the full error message
        const { deleteModalId } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            id: deleteModalId,
            onConfirm: () => {
                return deleteSchedule(subProjectId, scheduleId).then(() => {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUserSchedule' does not exist on typ... Remove this comment to see the full error message
                    this.props.fetchUserSchedule(projectId, userId);
                    history.push(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        `/dashboard/project/${this.props.slug}/on-call`
                    );
                });
            },
            content: DeleteScheduleModal,
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DeleteScheduleBox.displayName = 'DeleteScheduleBox';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        deleteSchedule,
        openModal,
        fetchUserSchedule,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const { scheduleSlug, userId } = props.match.params;

    let schedule = state.schedule.subProjectSchedules.map(
        (subProjectSchedule: $TSFixMe) => {
            return subProjectSchedule.schedules.find(
                (schedule: $TSFixMe) => schedule.slug === scheduleSlug
            );
        }
    );

    schedule = schedule.find(
        (schedule: $TSFixMe) => schedule && schedule.slug === scheduleSlug
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
DeleteScheduleBox.propTypes = {
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    history: PropTypes.object.isRequired,
    slug: PropTypes.string,
    subProjectId: PropTypes.string,
    deleteSchedule: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    fetchUserSchedule: PropTypes.func.isRequired,
    userId: PropTypes.object.isRequired,
    projectId: PropTypes.string,
    scheduleId: PropTypes.string,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(DeleteScheduleBox)
);
