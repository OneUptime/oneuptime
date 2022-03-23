import React, { Fragment } from 'react';

import { Field, formValueSelector, change } from 'redux-form';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { RenderSelect } from '../basic/RenderSelect';
import ShouldRender from '../basic/ShouldRender';
import IsOwnerSubProject from '../basic/IsOwnerSubProject';
import IsAdminSubProject from '../basic/IsAdminSubProject';

interface CheckboxProps {
    label: string;
    name: string;
    disabled: boolean;
    id?: string;
}

const Checkbox = ({
    label,
    name,
    disabled,
    id
}: CheckboxProps) => (
    <div className="bs-Fieldset-fields" style={{ maxHeight: '20px' }}>
        <div className="Box-root" style={{ height: '5px' }}></div>
        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
            <label className="Checkbox">
                <Field
                    component="input"
                    type="checkbox"
                    data-test="RetrySettings-failedPaymentsCheckbox"
                    name={name}
                    className="Checkbox-source"
                    disabled={disabled}
                />
                <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                    <div className="Checkbox-target Box-root">
                        <div className="Checkbox-color Box-root"></div>
                    </div>
                </div>
                <div className="Checkbox-label Box-root Margin-left--8">
                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span id={id}>{label}</span>
                    </span>
                </div>
            </label>
        </div>
    </div>
);

Checkbox.displayName = 'Checkbox';
Checkbox.propTypes = {
    label: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    disabled: PropTypes.bool.isRequired,
    id: PropTypes.string,
};

interface RenderMonitorProps {
    subProject: object;
    monitorIndex: number;
    monitor: string;
    monitors: unknown[];
    allMonitors: unknown[];
    allComponents: unknown[];
    fields: object;
    dispatch: Function;
    errors: object;
    form?: string;
    statusPageCategory?: string;
}

let RenderMonitor = ({
    subProject,
    monitorIndex,
    monitor,
    monitors,
    allMonitors,
    allComponents,
    fields,
    dispatch,
    errors,
    form = 'StatuspageMonitors',
    statusPageCategory
}: RenderMonitorProps) => {
    const currentMonitorForm = monitors[monitorIndex];
    const { monitor: currentMonitorID } = currentMonitorForm;
    const getParentComponent = (monitor: $TSFixMe) => allComponents.filter(
        (component: $TSFixMe) => component._id === monitor.componentId._id || monitor.componentId
    )[0];

    const selectedMonitor = allMonitors.filter(
        (monitor: $TSFixMe) => monitor._id === currentMonitorID
    )[0];
    const { type = null } = !!selectedMonitor && selectedMonitor;

    const resetSelectedCharts = () => {
        dispatch(change(form, `${monitor}.uptime`, false));
        dispatch(change(form, `${monitor}.memory`, false));
        dispatch(change(form, `${monitor}.cpu`, false));
        dispatch(change(form, `${monitor}.storage`, false));
        dispatch(change(form, `${monitor}.responseTime`, false));
        dispatch(change(form, `${monitor}.temperature`, false));
        dispatch(change(form, `${monitor}.runtime`, false));
        dispatch(
            change(form, `${monitor}.statusPageCategory`, statusPageCategory)
        );
    };

    const shouldEdit =
        IsAdminSubProject(subProject) || IsOwnerSubProject(subProject);

    return (
        <li
            id={`monitor-${monitorIndex}`}
            style={{ margin: '5px 0px', width: '100%' }}
        >
            <div className="Card-root">
                <div className="Box-root">
                    <div
                        className="bs-ContentSection-content Box-root Box-background--offset Padding-horizontal--8 Padding-vertical--2 drag-n-drop"
                        style={{ backgroundColor: '#f7f7f7' }}
                    >
                        <div className="bs-Fieldset-row Margin-bottom--12">
                            <label
                                className="bs-Fieldset-label"
                                style={{
                                    flex: '35% 0 0',
                                }}
                            >
                                <span>
                                    Add these to my status page category
                                </span>
                            </label>
                            <Field
                                className="db-select-nw"
                                name={`${monitor}.monitor`}
                                id={`monitor-name-${monitorIndex}`}
                                component={RenderSelect}
                                options={[
                                    ...allMonitors
                                        .filter((m: $TSFixMe) => getParentComponent(m))
                                        .map((m: $TSFixMe) => ({
                                            value: m._id,

                                            label: `${getParentComponent(m).name
                                                } / ${m.name}`
                                        })),
                                ]}
                                onChange={() => resetSelectedCharts()}
                            />
                        </div>
                        {!!currentMonitorID && (
                            <div className="bs-Fieldset-row">
                                <label
                                    className="bs-Fieldset-label"
                                    style={{
                                        flex: '35% 0 0',
                                    }}
                                >
                                    <span>Description</span>
                                </label>
                                <Field
                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                    component="input"
                                    name={`${monitor}.description`}
                                    id={`monitor-description-${monitorIndex}`}
                                />
                            </div>
                        )}
                        {!!currentMonitorID && (
                            <div className="bs-Fieldset-row">
                                <label
                                    className="bs-Fieldset-label"
                                    style={{
                                        flex: '35% 0 0',
                                    }}
                                >
                                    <span>Chart type</span>
                                </label>
                                <div className="Flex-flex Flex-direction--column Flex-justifyContent--flexEnd">
                                    {type === 'url' && (
                                        <Fragment>
                                            <Checkbox
                                                label="Uptime"
                                                name={`${monitor}.uptime`}
                                                disabled={!shouldEdit}
                                            />
                                            <Checkbox
                                                label="Response Time"
                                                name={`${monitor}.responseTime`}
                                                disabled={!shouldEdit}
                                            />
                                        </Fragment>
                                    )}
                                    {type === 'script' && (
                                        <Fragment>
                                            <Checkbox
                                                label="Uptime"
                                                name={`${monitor}.uptime`}
                                                disabled={!shouldEdit}
                                            />
                                            <Checkbox
                                                label="Script running time"
                                                name={`${monitor}.runtime`}
                                                disabled={!shouldEdit}
                                            />
                                        </Fragment>
                                    )}
                                    {type === 'manual' && (
                                        <Checkbox
                                            label="Uptime"
                                            name={`${monitor}.uptime`}
                                            disabled={!shouldEdit}
                                            id={`manual-monitor-checkbox-${monitorIndex}`}
                                        />
                                    )}
                                    {type === 'incomingHttpRequest' && (
                                        <Checkbox
                                            label="Uptime"
                                            name={`${monitor}.uptime`}
                                            disabled={!shouldEdit}
                                        />
                                    )}
                                    {type === 'ip' && (
                                        <Fragment>
                                            <Checkbox
                                                label="Uptime"
                                                name={`${monitor}.uptime`}
                                                disabled={!shouldEdit}
                                            />
                                            <Checkbox
                                                label="Response Time"
                                                name={`${monitor}.responseTime`}
                                                disabled={!shouldEdit}
                                            />
                                        </Fragment>
                                    )}
                                    {type === 'server-monitor' && (
                                        <Fragment>
                                            <Checkbox
                                                label="Uptime"
                                                name={`${monitor}.uptime`}
                                                disabled={!shouldEdit}
                                            />
                                            <Checkbox
                                                label="Memory"
                                                name={`${monitor}.memory`}
                                                disabled={!shouldEdit}
                                            />
                                            <Checkbox
                                                label="CPU"
                                                name={`${monitor}.cpu`}
                                                disabled={!shouldEdit}
                                            />
                                            <Checkbox
                                                label="Storage"
                                                name={`${monitor}.storage`}
                                                disabled={!shouldEdit}
                                            />
                                            <Checkbox
                                                label="Temperature"
                                                name={`${monitor}.temperature`}
                                                disabled={!shouldEdit}
                                            />
                                        </Fragment>
                                    )}
                                    {type === 'api' && (
                                        <Fragment>
                                            <Checkbox
                                                label="Uptime"
                                                name={`${monitor}.uptime`}
                                                disabled={!shouldEdit}
                                            />
                                            <Checkbox
                                                label="Response Time"
                                                name={`${monitor}.responseTime`}
                                                disabled={!shouldEdit}
                                            />
                                        </Fragment>
                                    )}
                                    {errors &&
                                        errors.monitors[monitorIndex] &&
                                        errors.monitors[monitorIndex].error && (
                                            <div
                                                className="errors"
                                                style={{ color: 'red' }}
                                            >
                                                {
                                                    errors.monitors[
                                                        monitorIndex
                                                    ].error
                                                }
                                            </div>
                                        )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <ShouldRender if={shouldEdit}>
                <div
                    className="bs-ContentSection-footer bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12"
                    style={{ backgroundColor: '#f7f7f7' }}
                >
                    <div>
                        <button
                            id={`delete-monitor-${monitorIndex}`}
                            className="bs-Button bs-DeprecatedButton"
                            onClick={() => fields.remove(monitorIndex)}
                            type="button"
                        >
                            Remove Monitor
                        </button>
                    </div>
                </div>
            </ShouldRender>
        </li>
    );
};

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const selector = formValueSelector(ownProps.form);
    const { subProject } = ownProps;
    const subProjectId = subProject?._id;

    const allComponents = state.component.componentList.components
        .filter(
            (component: $TSFixMe) => String(component._id._id || component._id) ===
                String(subProjectId)
        )
        .map((component: $TSFixMe) => component.components)
        .flat();
    const allMonitors = state.monitor.monitorsList.monitors
        .map((monitor: $TSFixMe) => monitor.monitors)
        .flat();
    const monitors = selector(state, 'monitors');

    /** On Theme change, the updated monitors state becomes a monitor nested object within an array
     * This monitor nested object(monitor.monitor._id) is then extracted and used to update 'monitor.monitor'.
     * monitor.monitor is the required id used in setting the initial values by default.
     */
    monitors &&
        monitors.map((monitor: $TSFixMe) => {
            if (monitor.monitor && typeof monitor.monitor === 'object') {
                monitor.monitor = monitor.monitor._id;
            }
            return monitor;
        });

    const {
        form: {
            [ownProps.form]: { syncErrors: errors },
        },
    } = state;
    return {
        allComponents,
        allMonitors,
        monitors,
        errors,
    };
};


RenderMonitor = connect(mapStateToProps)(RenderMonitor);


RenderMonitor.displayName = 'RenderMonitor';

RenderMonitor.propTypes = {
    subProject: PropTypes.object.isRequired,
    monitorIndex: PropTypes.number.isRequired,
    monitor: PropTypes.string.isRequired,
    monitors: PropTypes.array.isRequired,
    allMonitors: PropTypes.array.isRequired,
    allComponents: PropTypes.array.isRequired,
    fields: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
    errors: PropTypes.object.isRequired,
    form: PropTypes.string,
    statusPageCategory: PropTypes.string,
};

export { RenderMonitor };
