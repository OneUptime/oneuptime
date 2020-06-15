import React, { Fragment } from 'react';
import { Field, formValueSelector, change } from 'redux-form';
import { connect } from 'react-redux';
import { RenderSelect } from '../basic/RenderSelect';

const Checkbox = ({
  label,
  name,
}) =>
  <div
    className="bs-Fieldset-fields"
    style={{ maxHeight: '20px' }}
  >
    <div
      className="Box-root"
      style={{ height: '5px' }}
    >
    </div>
    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
      <label className="Checkbox">
        <Field
          component="input"
          type="checkbox"
          data-test="RetrySettings-failedPaymentsCheckbox"
          name={name}
          className="Checkbox-source"
        />
        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
          <div className="Checkbox-target Box-root">
            <div className="Checkbox-color Box-root"></div>
          </div>
        </div>
        <div className="Checkbox-label Box-root Margin-left--8">
          <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
            <span>{label}</span>
          </span>
        </div>
      </label>
    </div>
  </div>


let RenderMonitor = ({
  monitorIndex,
  monitor,
  monitors,
  allMonitors,
  allComponents,
  fields,
  dispatch,
  errors
}) => {
  const currentMonitorForm = monitors[monitorIndex];
  const { id: currentMonitorID } = currentMonitorForm;
  const getParentComponent = (monitor) =>
    allComponents.filter(component => component._id === monitor.componentId)[0]

  const selectedMonitor = allMonitors.filter(monitor => monitor._id === currentMonitorID)[0];
  const { type = null } = !!selectedMonitor && selectedMonitor;

  const resetSelectedCharts = () => {
    dispatch(change('StatuspageMonitors', `${monitor}.uptime`, true))
    dispatch(change('StatuspageMonitors', `${monitor}.memory`, false))
    dispatch(change('StatuspageMonitors', `${monitor}.cpu`, false))
    dispatch(change('StatuspageMonitors', `${monitor}.storage`, false))
    dispatch(change('StatuspageMonitors', `${monitor}.responseTime`, false))
    dispatch(change('StatuspageMonitors', `${monitor}.temperature`, false))
    dispatch(change('StatuspageMonitors', `${monitor}.runtime`, false))
  }
  return (
    <li style={{ margin: '5px 0px' }}>
      <div className="Card-root">
        <div className="Box-root">
          {monitorIndex > 0 &&
            (<div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
              <div className="Box-root">
                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                  <span>Monitor {monitorIndex + 1}</span>
                </span>
                <p>
                  <span></span>
                </p>
              </div>
            </div>)
          }
          <div
            className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2"
            style={{ backgroundColor: '#f7f7f7' }}
          >
            <div
              className="bs-Fieldset-row"
            >
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
              <Field
                className="db-select-nw"
                name={`${monitor}.id`}
                component={RenderSelect}
                options={[
                  ...(
                    allMonitors.map(
                      m => ({
                        value: m._id,
                        label: `${getParentComponent(m).name} / ${m.name}`,
                      })
                    )
                  )
                ]}
                onChange={() => resetSelectedCharts()}
              />
            </div>
            {
              !!currentMonitorID && (
                <div className="bs-Fieldset-row">
                  <label
                    className="bs-Fieldset-label"
                    style={{
                      flex: '35% 0 0',
                    }}
                  >
                    <span>
                      Description
                      </span>
                  </label>
                  <Field
                    className="db-BusinessSettings-input TextInput bs-TextInput"
                    component='input'
                    name={`${monitor}.description`}
                  />
                </div>
              )
            }
            {
              !!currentMonitorID && (
                <div className="bs-Fieldset-row">
                  <label
                    className="bs-Fieldset-label"
                    style={{
                      flex: '35% 0 0',
                    }}
                  >
                    <span>
                      Chart type
                  </span>
                  </label>
                  <div className="Flex-flex Flex-direction--column Flex-justifyContent--flexEnd">
                    {
                      type === 'url' &&
                      (
                        <Fragment>
                          <Checkbox
                            label='Uptime'
                            name={`${monitor}.uptime`}
                          />
                          <Checkbox
                            label='Response Time'
                            name={`${monitor}.responseTime`}
                          />
                        </Fragment>
                      )
                    }
                    {
                      type === 'script' &&
                      (
                        <Fragment>
                          <Checkbox
                            label='Uptime'
                            name={`${monitor}.uptime`}
                          />
                          <Checkbox
                            label='Script running time'
                            name={`${monitor}.runtime`}
                          />
                        </Fragment>
                      )
                    }
                    {
                      type === 'manual' &&
                      (
                        <Checkbox
                          label='Uptime'
                          name={`${monitor}.uptime`}
                        />
                      )
                    }
                    {
                      type === 'server-monitor' &&
                      (
                        <Fragment>
                          <Checkbox
                            label='Uptime'
                            name={`${monitor}.uptime`}
                          />
                          <Checkbox
                            label='Memory'
                            name={`${monitor}.memory`}
                          />
                          <Checkbox
                            label='CPU'
                            name={`${monitor}.cpu`}
                          />
                          <Checkbox
                            label='Storage'
                            name={`${monitor}.storage`}
                          />
                          <Checkbox
                            label='Temperature'
                            name={`${monitor}.temperature`}
                          />
                        </Fragment>
                      )
                    }
                    {
                      type === 'device' &&
                      (
                        <Checkbox
                          label='Uptime'
                          name={`${monitor}.uptime`}
                        />
                      )
                    }
                    {
                      type === 'api' &&
                      (
                        <Fragment>
                          <Checkbox
                            label='Uptime'
                            name={`${monitor}.uptime`}
                          />
                          <Checkbox
                            label='Response Time'
                            name={`${monitor}.responseTime`}
                          />
                        </Fragment>
                      )
                    }
                    {
                      errors.monitors[monitorIndex] &&
                      errors.monitors[monitorIndex].error &&
                      <div style={{ color: 'red' }}>
                        {errors.monitors[monitorIndex].error}
                      </div>
                    }
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
      <div
        className="bs-ContentSection-footer bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12"
        style={{ backgroundColor: '#f7f7f7' }}
      >
        <div>
          <button
            className="bs-Button bs-DeprecatedButton"
            onClick={() => fields.remove(monitorIndex)}
            type="button"
          >
            Remove Monitor
          </button>
        </div>
      </div>

    </li>

  );
}

const selector = formValueSelector('StatuspageMonitors');

RenderMonitor = connect(state => {
  const allComponents = state.component.componentList.components
    .map(component => component.components)
    .flat();
  const allMonitors = state.monitor.monitorsList.monitors
    .map(monitor => monitor.monitors)
    .flat();
  const monitors = selector(state, 'monitors');
  const { form: { StatuspageMonitors: { syncErrors: errors } } } = state
  return { allComponents, allMonitors, monitors, errors, };
}
)(RenderMonitor);

export { RenderMonitor }