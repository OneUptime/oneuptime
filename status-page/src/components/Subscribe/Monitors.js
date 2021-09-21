import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Translate } from 'react-auto-translate';
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
        let notificationType = { announcement, incident, scheduledEvent };

        // if multiple notificaiton types is not selected then set everything to true.
        if (
            this.props.statuspage &&
            !this.props.statuspage.multipleNotificationTypes
        ) {
            notificationType = {
                announcement: true,
                incident: true,
                scheduledEvent: true,
            };
        }

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

    handleClose = event => {
        event.preventDefault();
        this.props.userDataReset();
        this.props.openSubscribeMenu();
        this.props.handleCloseButtonClick();
    };
    render() {
        const multipleNotificationTypes =
            this.props.statuspage &&
            this.props.statuspage.multipleNotificationTypes;
        return (
            <div>
                {this.props.subscribed.success ? (
                    <div style={{ textAlign: 'center', margin: '15px 0' }}>
                        <span
                            className="subscriber-success"
                            id="monitor-subscribe-success-message"
                        >
                            <Translate>
                                {' '}
                                You have subscribed to this status page
                                successfully
                            </Translate>
                        </span>
                    </div>
                ) : (
                    <div className="directions">
                        <Translate>
                            Select the monitors to get updates.
                        </Translate>
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
                        : multipleNotificationTypes &&
                          this.state && (
                              <>
                                  <div className="bs-notificationType">
                                      <div style={{ marginBottom: '10px' }}>
                                          <Translate>
                                              Select notification type.
                                          </Translate>
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
                        className={
                            this.props.theme
                                ? 'subscribe-btn-full bs-theme-btn'
                                : 'subscribe-btn-full'
                        }
                        disabled={this.props.subscribed.requesting}
                    >
                        <ShouldRender if={!this.props.subscribed.requesting}>
                            <span>
                                <Translate>
                                    {this.props.subscribed.success
                                        ? 'Close'
                                        : 'Subscribe'}
                                </Translate>
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
                                <Translate>
                                    {this.props.subscribed &&
                                        this.props.subscribed.error}
                                </Translate>
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
    theme: PropTypes.bool,
    handleCloseButtonClick: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(Monitors);
