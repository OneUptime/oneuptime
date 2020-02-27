import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm } from 'redux-form';
import {
    updateStatusPageMonitors,
    updateStatusPageMonitorsRequest,
    updateStatusPageMonitorsSuccess,
    updateStatusPageMonitorsError,
    fetchProjectStatusPage,
} from '../../actions/statusPage';
import { FormLoader } from '../basic/Loader';
import MonitorInputs from '../schedule/MonitorInputs';
import ShouldRender from '../basic/ShouldRender';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

export class Monitors extends Component {
    submitForm = values => {
        const { status } = this.props.statusPage;
        const { projectId } = status;
        const monitorIds = [];
        /* eslint-disable no-unused-vars */
        for (const id in values) {
            if (Object.prototype.hasOwnProperty.call(values, id)) {
                values[id] && monitorIds.push(id);
            }
        }

        this.props
            .updateStatusPageMonitors(projectId._id || projectId, {
                _id: status._id,
                monitorIds,
            })
            .then(() => {
                this.props.fetchProjectStatusPage(
                    this.props.currentProject._id,
                    true,
                    0,
                    10
                );
            });
        if (!IS_DEV) {
            logEvent('StatusPage Monitors Updated', values);
        }
    };

    render() {
        const { handleSubmit, subProjects } = this.props;
        const { status } = this.props.statusPage;

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Monitors</span>
                            </span>
                            <p>
                                <span>
                                    What monitors do you want to show on the
                                    status page?
                                </span>
                            </p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <ShouldRender if={this.props.monitors.length > 0}>
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset
                                            data-test="RetrySettings-failedAndExpiring"
                                            className="bs-Fieldset"
                                        >
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            flex: '35% 0 0',
                                                        }}
                                                    >
                                                        <span>
                                                            Add these to my
                                                            status page
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                        <div
                                                            className="Box-root"
                                                            style={{
                                                                height: '5px',
                                                            }}
                                                        ></div>
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                            {status.projectId &&
                                                            (this.props
                                                                .currentProject
                                                                ._id ===
                                                                status.projectId
                                                                    ._id ||
                                                                this.props
                                                                    .currentProject
                                                                    ._id ===
                                                                    status.projectId) ? (
                                                                <MonitorInputs
                                                                    monitors={
                                                                        this
                                                                            .props
                                                                            .monitors
                                                                    }
                                                                    subProject={
                                                                        this
                                                                            .props
                                                                            .currentProject
                                                                    }
                                                                />
                                                            ) : (
                                                                false
                                                            )}
                                                            {status.projectId &&
                                                                subProjects.map(
                                                                    (
                                                                        subProject,
                                                                        i
                                                                    ) => {
                                                                        if (
                                                                            subProject._id ===
                                                                                status
                                                                                    .projectId
                                                                                    ._id ||
                                                                            subProject._id ===
                                                                                status.projectId
                                                                        ) {
                                                                            return (
                                                                                <MonitorInputs
                                                                                    monitors={
                                                                                        this
                                                                                            .props
                                                                                            .monitors
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
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>
                        </ShouldRender>
                        <ShouldRender
                            if={
                                !this.props.monitors.length > 0 &&
                                !this.props.monitors.requesting
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
                                                No monitors are added to this
                                                project.{' '}
                                                <Link
                                                    to={
                                                        '/project/' +
                                                        this.props
                                                            .currentProject
                                                            ._id +
                                                        '/monitoring'
                                                    }
                                                >
                                                    {' '}
                                                    Please create one.{' '}
                                                </Link>
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
                                            this.props.statusPage.monitors.error
                                        }
                                    >
                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>
                                                {
                                                    this.props.statusPage
                                                        .monitors.error
                                                }
                                            </span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <ShouldRender
                                    if={this.props.monitors.length > 0}
                                >
                                    <button
                                        id="btnAddStatusPageMonitors"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={
                                            this.props.statusPage.monitors
                                                .requesting
                                        }
                                        type="submit"
                                    >
                                        {!this.props.statusPage.monitors
                                            .requesting && (
                                            <span>Save Changes </span>
                                        )}
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

Monitors.displayName = 'Monitors';

Monitors.propTypes = {
    updateStatusPageMonitors: PropTypes.func.isRequired,
    statusPage: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    currentProject: PropTypes.oneOfType([
        PropTypes.object.isRequired,
        PropTypes.oneOf([null, undefined]),
    ]),
    monitors: PropTypes.array.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
    subProjects: PropTypes.array.isRequired,
};

const MonitorsForm = reduxForm({
    form: 'StatuspageMonitors', // a unique identifier for this form
    enableReinitialize: true,
})(Monitors);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            updateStatusPageMonitors,
            updateStatusPageMonitorsRequest,
            updateStatusPageMonitorsSuccess,
            updateStatusPageMonitorsError,
            fetchProjectStatusPage,
        },
        dispatch
    );

const mapStateToProps = state => {
    const initialValues = {};
    const { currentProject } = state.project;

    const monitors = state.monitor.monitorsList.monitors
        .map(monitor => monitor.monitors)
        .flat();
    const {
        statusPage,
        statusPage: { status },
    } = state;

    if (
        status &&
        status.monitorIds &&
        status.monitorIds.length > 0 &&
        monitors.length > 0
    ) {
        monitors.forEach(({ _id }) => {
            initialValues[_id] = status.monitorIds.some(
                id => _id === id._id || _id === id
            );
        });
    }
    const subProjects = state.subProject.subProjects.subProjects;
    return { initialValues, monitors, statusPage, currentProject, subProjects };
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorsForm);
