import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { withRouter, Link } from 'react-router-dom';
import MonitorInputs from './MonitorInputs';
import { FormLoader, Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { addMonitors } from '../../actions/schedule';

import { Field, reduxForm } from 'redux-form';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import IsAdminSubProject from '../basic/IsAdminSubProject';
import IsOwnerSubProject from '../basic/IsOwnerSubProject';

import Tooltip from '../basic/Tooltip';

function submitMonitorForm(values: $TSFixMe, dispatch: Dispatch, props: $TSFixMe) {
    const subProjectId: $TSFixMe = props && props.subProjectId;
    const scheduleId: $TSFixMe = props && props.scheduleId;
    const monitors: $TSFixMe = [];

    for (const id in values) {
        if (
            Object.prototype.hasOwnProperty.call(values, id) &&
            id !== 'isDefault'
        ) {
            values[id] && monitors.push(id);
        }
    }
    props.addMonitors(subProjectId, scheduleId, {
        monitorIds: monitors,
        isDefault: values.isDefault,
    });
}

export const MonitorBox: Function = (props: $TSFixMe) => {
    const { currentProject, subProjects, subProjectId, schedule }: $TSFixMe = props;
    const currentProjectId: $TSFixMe = currentProject ? currentProject._id : null;
    const slug: $TSFixMe = currentProject ? currentProject.slug : null;
    let subProject = currentProjectId === subProjectId ? currentProject : false;
    if (!subProject && subProjectId) {
        subProject = subProjects.find(
            (subProject: $TSFixMe) => subProject._id === subProjectId ||
                subProject._id === subProjectId._id
        );
    }
    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <form onSubmit={props.handleSubmit(submitMonitorForm)}>
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Monitors</span>
                                </span>
                                <p>
                                    {' '}
                                    <span>
                                        {IsAdminSubProject(subProject) ||
                                            IsOwnerSubProject(subProject)
                                            ? 'Check the boxes and save to attach more monitors.'
                                            : 'Here are the list of monitors that are attached to this schedule'}
                                    </span>
                                </p>
                            </div>
                        </div>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset
                                        data-test="RetrySettings-failedAndExpiring"
                                        className="bs-Fieldset"
                                    >
                                        <div className="bs-Fieldset-rows">
                                            <ShouldRender
                                                if={
                                                    props.monitors.length ===
                                                    0 && !props.isRequesting
                                                }
                                            >
                                                <div
                                                    style={{
                                                        textAlign: 'center',
                                                        padding: '10px',
                                                    }}
                                                >
                                                    <span>
                                                        There are no monitors in
                                                        this schedule.{' '}
                                                    </span>
                                                    <Link
                                                        to={`/dashboard/project/${slug}/components`}
                                                    >
                                                        <span className="Text-fontWeight--medium">
                                                            Please add one to
                                                            continue.
                                                        </span>
                                                    </Link>
                                                </div>
                                            </ShouldRender>

                                            <ShouldRender
                                                if={props.monitors.length > 0}
                                            >
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        <span>
                                                            Schedule Monitors
                                                        </span>
                                                    </label>

                                                    <Tooltip title="Moniors and Criteria Using Schedule">
                                                        <div>
                                                            <p>
                                                                These are the
                                                                list of monitors
                                                                and criteria in
                                                                a monitor using
                                                                the schedule.
                                                                Note that if an
                                                                incident matches
                                                                a criterion, the
                                                                schedules
                                                                associated with
                                                                that criterion
                                                                will be
                                                                executed. If the
                                                                criterion has no
                                                                schedules
                                                                associated, the
                                                                monitor&apos;s
                                                                schedules will
                                                                be used.
                                                            </p>
                                                        </div>
                                                    </Tooltip>

                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                        <div
                                                            className="Box-root"
                                                            style={{
                                                                height: '5px',
                                                            }}
                                                        ></div>
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                            {currentProjectId ===
                                                                subProjectId ? (
                                                                <MonitorInputs
                                                                    monitors={
                                                                        props.monitors
                                                                    }
                                                                    subProject={
                                                                        currentProject
                                                                    }
                                                                    schedule={
                                                                        schedule
                                                                    }
                                                                />
                                                            ) : (
                                                                false
                                                            )}
                                                            {props.subProjects.map(
                                                                (
                                                                    subProject: $TSFixMe,
                                                                    i: $TSFixMe
                                                                ) => {
                                                                    if (
                                                                        subProject._id ===
                                                                        props.subProjectId
                                                                    ) {
                                                                        return (
                                                                            <MonitorInputs
                                                                                monitors={
                                                                                    props.monitors
                                                                                }
                                                                                project={
                                                                                    props.currentProject
                                                                                }
                                                                                subProject={
                                                                                    subProject
                                                                                }
                                                                                key={
                                                                                    i
                                                                                }
                                                                            />
                                                                        );
                                                                    }
                                                                    return false;
                                                                }
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </ShouldRender>

                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    <span></span>
                                                </label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div
                                                        className="Box-root"
                                                        style={{
                                                            height: '5px',
                                                        }}
                                                    ></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <div className="Box-root Margin-bottom--12">
                                                            <div
                                                                data-test="RetrySettings-failedPaymentsRow"
                                                                className="Box-root"
                                                            >
                                                                <label
                                                                    className="Checkbox"
                                                                    htmlFor="isDefault"
                                                                    id="isDefaultLabel"
                                                                >
                                                                    <Field
                                                                        component="input"
                                                                        type="checkbox"
                                                                        name="isDefault"
                                                                        data-test="RetrySettings-failedPaymentsCheckbox"
                                                                        className="Checkbox-source"
                                                                        id="isDefault"
                                                                        disabled={
                                                                            props.isRequesting
                                                                        }
                                                                    />
                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                        <div className="Checkbox-target Box-root">
                                                                            <div className="Checkbox-color Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="Checkbox-label Box-root Margin-left--8">
                                                                        <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                            <span title="Set default on-call duty">
                                                                                Set
                                                                                as
                                                                                default
                                                                                on-call
                                                                                duty
                                                                            </span>
                                                                        </span>
                                                                        <p className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                Use
                                                                                this
                                                                                for
                                                                                monitors
                                                                                without
                                                                                on-call
                                                                                duty
                                                                                within
                                                                                a
                                                                                project
                                                                            </span>
                                                                        </p>
                                                                    </div>
                                                                </label>
                                                                <div className="Box-root Padding-left--24">
                                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                        <div className="Box-root">
                                                                            <div className="Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <ShouldRender
                                                if={
                                                    props.monitors.length ===
                                                    0 && props.isRequesting
                                                }
                                            >
                                                <div
                                                    style={{
                                                        textAlign: 'center',
                                                        padding: '10px',
                                                    }}
                                                >
                                                    <Spinner />
                                                </div>
                                            </ShouldRender>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div>
                                <RenderIfSubProjectAdmin>
                                    <button
                                        id="btnSaveMonitors"
                                        className="bs-Button bs-Button--blue"
                                        disabled={props.isRequesting}
                                        type="submit"
                                    >
                                        <ShouldRender if={!props.isRequesting}>
                                            <span>Save</span>
                                        </ShouldRender>
                                        <ShouldRender if={props.isRequesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </RenderIfSubProjectAdmin>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

MonitorBox.displayName = 'MonitorBox';

const AddMonitorsForm: $TSFixMe = new reduxForm({
    form: 'AddMonitorsForm',
    enableReinitialize: true,
})(MonitorBox);

const mapStateToProps: Function = (state: RootState, props: $TSFixMe) => {
    const { scheduleSlug }: $TSFixMe = props.match.params;
    const initialValues: $TSFixMe = {};
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
    const subProjectId: $TSFixMe = schedule && schedule.projectId._id;
    const monitors: $TSFixMe = state.monitor.monitorsList.monitors
        .map((monitor: $TSFixMe) => monitor.monitors)
        .flat();
    const isRequesting: $TSFixMe = state.schedule.addMonitor.requesting;
    const currentProject: $TSFixMe = state.project.currentProject;

    if (monitors.length > 0 && schedule) {
        const scheduleMonitorIds: $TSFixMe = schedule.monitorIds.map(({
            _id
        }: $TSFixMe) => _id);
        const monitorIds: $TSFixMe = monitors.map(({
            _id
        }: $TSFixMe) => _id);

        monitorIds.forEach((_id: $TSFixMe) => {

            initialValues[_id] = scheduleMonitorIds.includes(_id);
        });
    }
    if (schedule) {

        initialValues.isDefault = schedule.isDefault;
    }

    const subProjects: $TSFixMe = state.subProject.subProjects.subProjects;

    return {
        initialValues,
        monitors,
        isRequesting,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        subProjectId,
        currentProject,
        subProjects,
        scheduleId: schedule && schedule._id,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ addMonitors }, dispatch);

MonitorBox.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    monitors: PropTypes.array.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    currentProject: PropTypes.object,
    subProjectId: PropTypes.string,
    subProjects: PropTypes.array.isRequired,
    schedule: PropTypes.objectOf(PropTypes.any),
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(AddMonitorsForm)
);
