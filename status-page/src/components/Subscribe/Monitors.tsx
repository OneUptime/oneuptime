import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
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
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            announcement: false,
            incident: false,
            scheduledEvent: false,
        };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    handleChange = (event: $TSFixMe) => {
        const value = event.target.checked;
        const name = event.target.name;

        this.setState({
            [name]: value,
        });
    };
    componentDidMount() {
        const monitors = {};
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
        this.props.monitors &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.monitors.map((m: $TSFixMe) => {
                if (m && m.name && m._id) {
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    monitors[m.name] = true;
                }
                return m;
            });
        this.setState(monitors);
    }
    handleSubmit = (event: $TSFixMe) => {
        event.preventDefault();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'announcement' does not exist on type 'Re... Remove this comment to see the full error message
        const { announcement, incident, scheduledEvent } = this.state;
        let notificationType = { announcement, incident, scheduledEvent };

        // if multiple notificaiton types is not selected then set everything to true.
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statuspage &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
            !this.props.statuspage.multipleNotificationTypes
        ) {
            notificationType = {
                announcement: true,
                incident: true,
                scheduledEvent: true,
            };
        }

        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statuspage &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statuspage.projectId &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statuspage.projectId._id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
        const statusPageId = this.props.statuspage._id;
        if (this.state) {
            let monitors = Object.keys(this.state).filter(
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                key => this.state[key]
            );
            monitors = monitors.map(monitor =>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.monitors.find((el: $TSFixMe) => el.name === monitor)
            );
            monitors = monitors
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'string'.
                .map(monitor => monitor && monitor._id)
                .filter(monitor => monitor);
            if (monitors && monitors.length) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribeUser' does not exist on type 'R... Remove this comment to see the full error message
                this.props.subscribeUser(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'userDetails' does not exist on type 'Rea... Remove this comment to see the full error message
                    this.props.userDetails,
                    monitors,
                    projectId,
                    statusPageId,
                    notificationType
                );
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'validationError' does not exist on type ... Remove this comment to see the full error message
                this.props.validationError('please select a monitor');
            }
        }
    };

    handleClose = (event: $TSFixMe) => {
        event.preventDefault();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userDataReset' does not exist on type 'R... Remove this comment to see the full error message
        this.props.userDataReset();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSubscribeMenu' does not exist on typ... Remove this comment to see the full error message
        this.props.openSubscribeMenu();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleCloseButtonClick' does not exist o... Remove this comment to see the full error message
        this.props.handleCloseButtonClick();
    };
    render() {
        const multipleNotificationTypes =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statuspage &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statuspage' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statuspage.multipleNotificationTypes;
        return (
            <div>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                        this.props.subscribed && this.props.subscribed.success
                            ? this.handleClose
                            : this.handleSubmit
                    }
                >
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                  // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                                  checked={this.state[monitor]}
                                              />
                                              <span className="checkmark"></span>
                                          </label>
                                      </ShouldRender>
                                  </>
                              );
                          })}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                      // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
                            this.props.theme
                                ? 'subscribe-btn-full bs-theme-btn'
                                : 'subscribe-btn-full'
                        }
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                        disabled={this.props.subscribed.requesting}
                    >
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                        <ShouldRender if={!this.props.subscribed.requesting}>
                            <span>
                                <Translate>
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                    {this.props.subscribed.success
                                        ? 'Close'
                                        : 'Subscribe'}
                                </Translate>
                            </span>
                        </ShouldRender>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                !this.props.subscribed.error &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                this.props.subscribed.requesting
                            }
                        >
                            <FormLoader />
                        </ShouldRender>
                    </button>
                    <ShouldRender
                        if={
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                            this.props.subscribed && this.props.subscribed.error
                        }
                    >
                        <div className="validation-error">
                            <span className="validation-error-icon"></span>
                            <span className="error-text">
                                <Translate>
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                    {this.props.subscribed &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Monitors.displayName = 'Monitors';

const mapStateToProps = (state: $TSFixMe) => ({
    userDetails: state.subscribe.userDetails,
    statuspage: state.status.statusPage,
    subscribed: state.subscribe.subscribed,
    monitors: state.status.statusPage && state.status.statusPage.monitorsData
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { subscribeUser, validationError, openSubscribeMenu, userDataReset },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
