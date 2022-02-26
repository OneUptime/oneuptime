import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { User } from '../../config';
import moment from 'moment';

class NotificationMenu extends Component {
    render() {
        const userId = User.getUserId();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'Readonl... Remove this comment to see the full error message
        return this.props.visible ? (
            <div
                className="notifications ContextualLayer-layer--topright ContextualLayer-layer--anytop ContextualLayer-layer--anyright ContextualLayer-context--bottom ContextualLayer-context--anybottom ContextualLayer-container ContextualLayer--pointerEvents"
                style={{
                    top: '49px',
                    width: '450px',
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'Readon... Remove this comment to see the full error message
                    left: this.props.position
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'Readon... Remove this comment to see the full error message
                        ? `${this.props.position - 391.5}px`
                        : 'unset',
                    right: '40px',
                }}
            >
                <div className="ContextualPopover-animate ContextualPopover-animate-entered">
                    <div
                        className="ContextualPopover"
                        style={{ transformOrigin: '100% 0px 0px' }}
                    >
                        <div
                            className="ContextualPopover-arrowContainer"
                            style={{ position: 'relative', right: '40px' }}
                        >
                            <div className="ContextualPopover-arrow"></div>
                        </div>
                        <div className="ContextualPopover-contents">
                            <div
                                className="Box-root"
                                id="notificationscroll"
                                style={{
                                    width: '450px',
                                    maxHeight: '300px',
                                    overflowX: 'scroll',
                                }}
                            >
                                <div
                                    className="Box-root Box-divider--surface-bottom-1 Padding-all--12"
                                    style={{
                                        boxShadow:
                                            '1px 1px rgba(188,188,188,0.5)',
                                    }}
                                >
                                    <div>
                                        <span
                                            style={{
                                                color: '#24b47e',
                                                paddingLeft: '15px',
                                                fontSize: '14px',
                                                fontWeight: 'medium',
                                            }}
                                        >
                                            NOTIFICATIONS
                                        </span>
                                    </div>
                                </div>
                                <div className="Box-root Padding-vertical--8">
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
                                    {this.props.notifications &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
                                    this.props.notifications.notifications &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
                                    this.props.notifications.notifications
                                        .length ? (
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
                                        this.props.notifications.notifications.map(
                                            (notification: $TSFixMe, key: $TSFixMe) => {
                                                return (
                                                    <div
                                                        className={
                                                            notification.read.indexOf(
                                                                userId
                                                            ) > -1
                                                                ? 'Box-root'
                                                                : 'Box-root unread'
                                                        }
                                                        style={{
                                                            padding:
                                                                '10px 10px',
                                                            fontWeight: '400',
                                                            fontSize: '1em',
                                                            borderBottom:
                                                                '1px solid rgba(188,188,188,0.5)',
                                                            borderRadius: '2px',
                                                        }}
                                                        key={key}
                                                    >
                                                        <div className="Notify-oneuptime">
                                                            <img
                                                                src={`/dashboard/assets/img/${
                                                                    notification.icon
                                                                        ? notification.icon
                                                                        : 'information'
                                                                }.svg`}
                                                                className="Notify-oneuptime-row-primary"
                                                                style={{
                                                                    height:
                                                                        '20px',
                                                                    width:
                                                                        '20px',
                                                                }}
                                                                alt="notify"
                                                            />
                                                            <span
                                                                className="Notify-oneuptime-row-secondary"
                                                                style={{
                                                                    cursor:
                                                                        'default',
                                                                }}
                                                            >
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
                                                    </div>
                                                );
                                            }
                                        )
                                    ) : (
                                        <div
                                            className="Box-root"
                                            style={{
                                                padding: '10px',
                                                fontWeight: '500',
                                                marginTop: '-12px',
                                            }}
                                        >
                                            <span>
                                                No notifications at this time
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        ) : null;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
NotificationMenu.displayName = 'NotificationMenu';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        notifications: state.notifications.notifications,
        position: state.notifications.notificationsPosition,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({}, dispatch);
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
NotificationMenu.propTypes = {
    visible: PropTypes.bool,
    notifications: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    length: PropTypes.number,
    map: PropTypes.func,
    position: PropTypes.number,
};

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
NotificationMenu.contextTypes = {};

export default connect(mapStateToProps, mapDispatchToProps)(NotificationMenu);
