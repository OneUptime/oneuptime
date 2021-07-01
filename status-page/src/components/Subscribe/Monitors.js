import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    subscribeUser,
    validationError,
    openSubscribeMenu,
    userDataReset,
} from '../../actions/subscribe';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../ShouldRender';

class Monitors extends Component {
    constructor(props) {
        super(props);
        this.state = {
            announcement: false,
            incident: false,
            scheduledEvent: false,
        };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    handleChange = event => {
        const value = event.target.checked;
        const name = event.target.name;

        this.setState({
            [name]: value,
        });
    };
    componentDidMount() {
        const monitors = {};
        this.props.monitors &&
            this.props.monitors.map(m => {
                if (m && m.name && m._id) {
                    monitors[m.name] = true;
                }
                return m;
            });
        this.setState(monitors);
    }
    handleSubmit = event => {
        event.preventDefault();
        const { announcement, incident, scheduledEvent } = this.state;
        const notificationType = { announcement, incident, scheduledEvent };
        const projectId =
            this.props.statuspage &&
            this.props.statuspage.projectId &&
            this.props.statuspage.projectId._id;
        const statusPageId = this.props.statuspage._id;
        if (this.state) {
            let monitors = Object.keys(this.state).filter(
                key => this.state[key]
            );
            monitors = monitors.map(monitor =>
                this.props.monitors.find(el => el.name === monitor)
            );
            monitors = monitors
                .map(monitor => monitor && monitor._id)
                .filter(monitor => monitor);
            if (monitors && monitors.length) {
                this.props.subscribeUser(
                    this.props.userDetails,
                    monitors,
                    projectId,
                    statusPageId,
                    notificationType
                );
            } else {
                this.props.validationError('please select a monitor');
            }
        }
    };

    handleClose = () => {
        this.props.userDataReset();
        this.props.openSubscribeMenu();
    };
    render() {
        const multipleNotifications =
            this.props.statuspage &&
            this.props.statuspage.multipleNotifications;
        return (
            <div>
                {this.props.subscribed.success ? (
                    <div style={{ textAlign: 'center', margin: '15px 0' }}>
                        <span
                            className="subscriber-success"
                            id="monitor-subscribe-success-message"
                        >
                            You have subscribed to this status page successfully
                        </span>
                    </div>
                ) : (
                    <div className="directions">
                        Select the monitors to get updates.
                    </div>
                )}
                <form
                    id="subscribe-form-webhook"
                    onSubmit={
                        this.props.subscribed && this.props.subscribed.success
                            ? this.handleClose
                            : this.handleSubmit
                    }
                >
                    {this.props.subscribed.success
                        ? null
                        : this.state &&
                          Object.keys(this.state).map((monitor, i) => {
                              return (
                                  <>
                                      <ShouldRender
                                          if={
                                              monitor !== 'announcement' &&
                                              monitor !== 'scheduledEvent' &&
                                              monitor !== 'incident'
                                          }
                                      >
                                          <label
                                              className="container-checkbox"
                                              key={i}
                                          >
                                              <span className="check-label">
                                                  {monitor}
                                              </span>
                                              <input
                                                  type="checkbox"
                                                  name={monitor}
                                                  onChange={this.handleChange}
                                                  checked={this.state[monitor]}
                                              />
                                              <span className="checkmark"></span>
                                          </label>
                                      </ShouldRender>
                                  </>
                              );
                          })}
                    {this.props.subscribed.success
                        ? null
                        : multipleNotifications &&
                          this.state && (
                              <>
                                  <div className="bs-notificationType">
                                      <div style={{ marginBottom: '10px' }}>
                                          Select notification type.
                                      </div>
                                      {Object.keys(this.state).map(
                                          (value, i) => {
                                              return (
                                                  <>
                                                      <ShouldRender
                                                          if={
                                                              value ===
                                                                  'announcement' ||
                                                              value ===
                                                                  'scheduledEvent' ||
                                                              value ===
                                                                  'incident'
                                                          }
                                                      >
                                                          <label
                                                              className="container-checkbox"
                                                              key={i}
                                                          >
                                                              <span className="check-label">
                                                                  {value ===
                                                                  'scheduledEvent'
                                                                      ? 'Schedule Event'
                                                                      : value
                                                                            .charAt(
                                                                                0
                                                                            )
                                                                            .toUpperCase() +
                                                                        value.slice(
                                                                            1
                                                                        )}
                                                              </span>
                                                              <input
                                                                  type="checkbox"
                                                                  name={value}
                                                                  onChange={
                                                                      this
                                                                          .handleChange
                                                                  }
                                                                  checked={
                                                                      this
                                                                          .state[
                                                                          value
                                                                      ]
                                                                  }
                                                              />
                                                              <span className="checkmark"></span>
                                                          </label>
                                                      </ShouldRender>
                                                  </>
                                              );
                                          }
                                      )}
                                  </div>
                              </>
                          )}
                    <button
                        type="submit"
                        className="subscribe-btn-full"
                        disabled={this.props.subscribed.requesting}
                    >
                        <ShouldRender if={!this.props.subscribed.requesting}>
                            <span>
                                {this.props.subscribed.success
                                    ? 'Close'
                                    : 'Subscribe'}
                            </span>
                        </ShouldRender>
                        <ShouldRender
                            if={
                                !this.props.subscribed.error &&
                                this.props.subscribed.requesting
                            }
                        >
                            <FormLoader />
                        </ShouldRender>
                    </button>
                    <ShouldRender
                        if={
                            this.props.subscribed && this.props.subscribed.error
                        }
                    >
                        <div className="validation-error">
                            <span className="validation-error-icon"></span>
                            <span className="error-text">
                                {this.props.subscribed &&
                                    this.props.subscribed.error}
                            </span>
                        </div>
                    </ShouldRender>
                </form>
            </div>
        );
    }
}

Monitors.displayName = 'Monitors';

const mapStateToProps = state => ({
    userDetails: state.subscribe.userDetails,
    statuspage: state.status.statusPage,
    subscribed: state.subscribe.subscribed,
    monitors: state.status.statusPage && state.status.statusPage.monitorsData,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { subscribeUser, validationError, openSubscribeMenu, userDataReset },
        dispatch
    );

Monitors.propTypes = {
    userDetails: PropTypes.object,
    subscribeUser: PropTypes.func,
    validationError: PropTypes.func,
    statuspage: PropTypes.object,
    monitors: PropTypes.array,
    map: PropTypes.func,
    subscribed: PropTypes.object,
    requesting: PropTypes.bool,
    error: PropTypes.string,
    openSubscribeMenu: PropTypes.func,
    userDataReset: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(Monitors);
