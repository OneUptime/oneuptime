import React, { Component } from 'react';
import moment from 'moment';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';

import { bindActionCreators } from 'redux';
import { markAsRead, closeNotification } from '../../actions/notification';
import { connect } from 'react-redux';
import { history } from '../../store';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';

class IncidentCreated extends Component {
    markAsRead = (notification: $TSFixMe) => {
        const {
            projectId,
            _id: notificationId,
            meta: {
                componentId: { slug },
                incidentId: { slug: incidentSlug },
            },
        } = notification;
        const project_Id =
            typeof projectId === 'object' ? projectId._id : projectId;

        const notifications = [{ notificationId }];
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'markAsRead' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.markAsRead(project_Id, notifications);

        history.push(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            `/dashboard/project/${this.props.slug}/component/${slug}/incidents/${incidentSlug}`
        );
    };

    handleCloseNotification = (notification: $TSFixMe) => {
        const { projectId, _id: notificationId } = notification;
        const project_Id =
            typeof projectId === 'object' ? projectId._id : projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeNotification' does not exist on typ... Remove this comment to see the full error message
        this.props.closeNotification(project_Id, notificationId);
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
        const { notifications } = this.props;

        return (
            <Fade>
                <div
                    style={{
                        position: 'absolute',
                        bottom: 0,
                        right: 0,
                        zIndex: 1,
                        margin: '0 30px 20px 0',
                    }}
                >
                    <div
                        className="Box-root"
                        id="notificationscroll"
                        style={{
                            width: '450px',
                            maxHeight: '350px',
                            overflowX: 'scroll',
                        }}
                    >
                        <div className="Box-root Padding-all--4">
                            <div
                                className="Box-root"
                                style={{
                                    fontWeight: '500',
                                }}
                            >
                                {notifications && notifications.length > 0
                                    ? notifications.map(
                                          (notification: $TSFixMe, index: $TSFixMe) => {
                                              return (
                                                  <div
                                                      className="Box-root Box-background--red4"
                                                      style={{
                                                          padding: '10px 10px',
                                                          fontWeight: '400',
                                                          fontSize: '1em',
                                                          marginBottom: '4px',
                                                          borderRadius: '4px',
                                                      }}
                                                      key={notification._id}
                                                  >
                                                      <div className="Notify-oneuptime">
                                                          <span></span>
                                                          <span>
                                                              <span
                                                                  id={`closeIncident_${index}`}
                                                                  className="incident-close-button"
                                                                  style={{
                                                                      opacity: 1,
                                                                      filter:
                                                                          'brightness(0) invert(1)',
                                                                      float:
                                                                          'right',
                                                                      marginBottom:
                                                                          '10px',
                                                                  }}
                                                                  onClick={() =>
                                                                      this.handleCloseNotification(
                                                                          notification
                                                                      )
                                                                  }
                                                              />
                                                          </span>
                                                      </div>
                                                      <div className="Notify-oneuptime">
                                                          <div className="Notify-oneuptime-container-row-primary db-SideNav-icon--danger" />
                                                          <span className="Notify-oneuptime-container-row-secondary Text-color--white">
                                                              <span>
                                                                  #
                                                                  {notification &&
                                                                      notification.meta &&
                                                                      notification
                                                                          .meta
                                                                          .incidentId &&
                                                                      notification
                                                                          .meta
                                                                          .incidentId
                                                                          .idNumber}
                                                              </span>{' '}
                                                              {
                                                                  notification.message
                                                              }{' '}
                                                              on{' '}
                                                              {moment(
                                                                  notification.createdAt
                                                              ).format(
                                                                  'MMMM Do YYYY, h:mm a'
                                                              )}
                                                          </span>
                                                      </div>
                                                      <div className="Notify-oneuptime">
                                                          <span></span>
                                                          <span>
                                                              <button
                                                                  id={`viewIncident-${index}`}
                                                                  className="bs-Button bs-Button--red Box-background--red border-white"
                                                                  style={{
                                                                      height:
                                                                          '30px',
                                                                      width:
                                                                          '105px',
                                                                      boxShadow:
                                                                          '0 0 0 1px #ffffff, 0 1.5px 1px 0 rgba(158, 33, 70, 0.15), 0 2px 5px 0 rgba(50, 50, 93, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.08), 0 0 0 0 transparent',
                                                                      float:
                                                                          'right',
                                                                      marginRight:
                                                                          '5px',
                                                                      marginTop:
                                                                          '10px',
                                                                  }}
                                                                  onClick={() =>
                                                                      this.markAsRead(
                                                                          notification
                                                                      )
                                                                  }
                                                                  type="button"
                                                              >
                                                                  <span>
                                                                      View
                                                                      Incident
                                                                  </span>
                                                              </button>
                                                          </span>
                                                      </div>
                                                  </div>
                                              );
                                          }
                                      )
                                    : null}
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
IncidentCreated.displayName = 'IncidentCreated';

const mapStateToProps = () => {
    return {};
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ markAsRead, closeNotification }, dispatch);
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
IncidentCreated.propTypes = {
    notifications: PropTypes.array,
    markAsRead: PropTypes.func,
    closeNotification: PropTypes.func,
    slug: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentCreated);
