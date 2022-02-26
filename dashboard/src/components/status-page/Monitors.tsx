import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    reduxForm,
    FieldArray,
    arrayPush,
    formValueSelector,
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
} from 'redux-form';
import {
    updateStatusPageMonitors,
    updateStatusPageMonitorsRequest,
    updateStatusPageMonitorsSuccess,
    updateStatusPageMonitorsError,
    fetchProjectStatusPage,
} from '../../actions/statusPage';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';

import { RenderMonitors } from './RenderMonitors';
import IsAdminSubProject from '../basic/IsAdminSubProject';
import IsOwnerSubProject from '../basic/IsOwnerSubProject';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { DragDropContext, Droppable } from 'react-beautiful-dnd';

const grid = 8;

const getListStyle = (isDraggingOver: $TSFixMe) => ({
    background: isDraggingOver ? 'lightblue' : 'transparent',
    padding: grid,
    width: '100%',
    height: '90%'
});

const validate = (values: $TSFixMe) => {
    const errors = {};
    const { monitors = [] } = values;
    const monitorsArrayErrors = {};
    const selectedMonitor = {};
    for (let i = 0; i < monitors.length; i++) {
        const monitorErrors = {};
        const monitor = monitors[i];
        if (!monitor.monitor)
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type '{}'.
            monitorErrors.monitor = 'A monitor must be selected.';
        else {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            if (selectedMonitor[monitor.monitor])
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type '{}'.
                monitorErrors.monitor = 'This monitor is already selected.';
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            selectedMonitor[monitor.monitor] = true;
        }
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        monitorsArrayErrors[i] = monitorErrors;
    }
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
    errors.monitors = monitorsArrayErrors;
    return errors;
};

export class Monitors extends Component {
    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { status } = this.props.statusPage;
        const { projectId } = status;
        const { monitors } = values;

        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateStatusPageMonitors' does not exist... Remove this comment to see the full error message
            .updateStatusPageMonitors(projectId._id || projectId, {
                _id: status._id,
                monitors,
            })
            .then(() => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectStatusPage' does not exist o... Remove this comment to see the full error message
                this.props.fetchProjectStatusPage(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    true,
                    0,
                    10
                );
            });
    };

    renderAddMonitorButton = (subProject: $TSFixMe) => <ShouldRender
        if={
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.monitors.length > 0 &&
            (IsAdminSubProject(subProject) || IsOwnerSubProject(subProject))
        }
    >
        <button
            id="addMoreMonitors"
            className="bs-Button bs-Button--icon bs-Button--new"
            type="button"
            onClick={() =>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'pushArray' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.pushArray('StatuspageMonitors', 'monitors', {
                    monitor: null,
                    description: '',
                    uptime: false,
                    memory: false,
                    cpu: false,
                    storage: false,
                    responseTime: false,
                    temperature: false,
                    runtime: false,
                })
            }
        >
            <span>Add Monitor</span>
        </button>
    </ShouldRender>;

    onDragEnd = (result: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageMonitors' does not exist on ty... Remove this comment to see the full error message
        const { statusPageMonitors, change } = this.props;
        const { destination, source } = result;

        if (!destination) {
            return;
        }

        if (
            destination.droppableId === source.droppableId &&
            destination.index === source.index
        ) {
            return;
        }

        const start = source.droppableId;
        const finish = destination.droppableId;

        if (start === finish) {
            const result = Array.from(statusPageMonitors);
            const [removed] = result.splice(source.index, 1);
            result.splice(destination.index, 0, removed);

            change('monitors', result);

            return;
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit, subProjects } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { status } = this.props.statusPage;
        const subProject = !status.projectId
            ? null
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            : this.props.currentProject._id === status.projectId._id ||
              // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
              this.props.currentProject._id === status.projectId
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? this.props.currentProject
            : subProjects.filter(
                  (subProject: $TSFixMe) => subProject._id === status.projectId._id ||
                  subProject._id === status.projectId
              )[0];

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Monitors
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        What monitors do you want to show on the
                                        status page?
                                    </span>
                                </span>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div className="Box-root">
                                    {this.renderAddMonitorButton(subProject)}
                                </div>
                            </div>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                this.props.monitors.length > 0 &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                !this.props.monitors.requesting &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsInForm' does not exist on type '... Remove this comment to see the full error message
                                this.props.monitorsInForm
                            }
                        >
                            <DragDropContext onDragEnd={this.onDragEnd}>
                                <div className="bs-ContentSection-content Box-root">
                                    <div>
                                        <div className="bs-Fieldset-wrapper Box-root">
                                            <Droppable droppableId="visible_monitor">
                                                {(provided: $TSFixMe, snapshot: $TSFixMe) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        style={getListStyle(
                                                            snapshot.isDraggingOver
                                                        )}
                                                        className="layoutContainer"
                                                        {...provided.droppableProps}
                                                    >
                                                        <fieldset
                                                            className="bs-Fieldset"
                                                            style={{
                                                                paddingTop:
                                                                    '0px',
                                                                backgroundColor:
                                                                    'unset',
                                                            }}
                                                        >
                                                            <FieldArray
                                                                name="monitors"
                                                                component={
                                                                    RenderMonitors
                                                                }
                                                                subProject={
                                                                    subProject
                                                                }
                                                                form="StatuspageMonitors"
                                                            />
                                                        </fieldset>
                                                        {provided.placeholder}
                                                    </div>
                                                )}
                                            </Droppable>
                                        </div>
                                    </div>
                                </div>
                            </DragDropContext>
                        </ShouldRender>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2365) FIXME: Operator '>' cannot be applied to types 'boolean' ... Remove this comment to see the full error message
                                (!this.props.monitors.length > 0 &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                    !this.props.monitors.requesting) ||
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsInForm' does not exist on type '... Remove this comment to see the full error message
                                !this.props.monitorsInForm
                            }
                        >
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <div
                                            id="app-loading"
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'center',
                                                alignItems: 'center',
                                                flexDirection: 'column',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    marginTop: '20px',
                                                    marginBottom: '20px',
                                                }}
                                            >
                                                // @ts-expect-error ts-migrate(2365) FIXME: Operator '>' cannot be applied to types 'boolean' ... Remove this comment to see the full error message
                                                {!this.props.monitors.length >
                                                    0 &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                                !this.props.monitors
                                                    .requesting ? (
                                                    <>
                                                        No monitors are added to
                                                        this project.{' '}
                                                        <Link
                                                            to={
                                                                '/dashboard/project/' +
                                                                this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                                    .currentProject
                                                                    .slug +
                                                                '/components'
                                                            }
                                                        >
                                                            {' '}
                                                            Please create one.{' '}
                                                        </Link>
                                                    </>
                                                ) : !this.props
                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsInForm' does not exist on type '... Remove this comment to see the full error message
                                                      .monitorsInForm ? (
                                                    <>
                                                        No monitors are added to
                                                        this status page.
                                                    </>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </ShouldRender>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div className="bs-Tail-copy">
                                <div
                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                    style={{ marginTop: '10px' }}
                                >
                                    <ShouldRender
                                        if={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                            this.props.statusPage.monitors.error
                                        }
                                    >
                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>
                                                {
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                                    this.props.statusPage
                                                        .monitors.error
                                                }
                                            </span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                {this.renderAddMonitorButton(subProject)}
                                <ShouldRender
                                    if={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                        this.props.monitors.length > 0 &&
                                        (IsAdminSubProject(subProject) ||
                                            IsOwnerSubProject(subProject))
                                    }
                                >
                                    <button
                                        id="btnAddStatusPageMonitors"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                            this.props.statusPage.monitors
                                                .requesting
                                        }
                                        type="submit"
                                    >
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                        {!this.props.statusPage.monitors
                                            .requesting && (
                                            <span>Save Changes </span>
                                        )}
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                                        {this.props.statusPage.monitors
                                            .requesting && <FormLoader />}
                                    </button>
                                </ShouldRender>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Monitors.displayName = 'Monitors';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Monitors.propTypes = {
    updateStatusPageMonitors: PropTypes.func.isRequired,
    statusPage: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    pushArray: PropTypes.func.isRequired,
    currentProject: PropTypes.oneOfType([
        PropTypes.object.isRequired,
        PropTypes.oneOf([null, undefined]),
    ]),
    monitors: PropTypes.array.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    subProjects: PropTypes.array.isRequired,
    monitorsInForm: PropTypes.array,
    selectedMonitors: PropTypes.array,
    statusPageMonitors: PropTypes.array,
    change: PropTypes.func,
};

const MonitorsForm = reduxForm({
    form: 'StatuspageMonitors', // a unique identifier for this form
    enableReinitialize: true,
    validate,
})(Monitors);

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        updateStatusPageMonitors,
        updateStatusPageMonitorsRequest,
        updateStatusPageMonitorsSuccess,
        updateStatusPageMonitorsError,
        fetchProjectStatusPage,
        pushArray: arrayPush,
    },
    dispatch
);

const selector = formValueSelector('StatuspageMonitors');

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { subProjectId } = ownProps;
    const { currentProject } = state.project;

    const monitors = state.monitor.monitorsList.monitors
        .filter((monitor: $TSFixMe) => String(monitor._id) === String(subProjectId))
        .map((monitor: $TSFixMe) => monitor.monitors)
        .flat();
    const {
        statusPage,
        statusPage: {
            status: { monitors: selectedMonitors },
        },
    } = state;
    const initialValues = { monitors: selectedMonitors || [] };
    //Description field rendering becomes slow if the array is assigned to monitorsInForm instead of the array's lenght.
    const monitorsInForm =
        selector(state, 'monitors') && selector(state, 'monitors').length;
    const subProjects = state.subProject.subProjects.subProjects;

    return {
        initialValues,
        monitors,
        statusPage,
        currentProject,
        subProjects,
        monitorsInForm,
        selectedMonitors,
        statusPageMonitors:
            state.form.StatuspageMonitors &&
            state.form.StatuspageMonitors.values &&
            state.form.StatuspageMonitors.values.monitors,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorsForm);
