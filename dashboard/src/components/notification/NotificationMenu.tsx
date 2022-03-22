import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    markAsRead,
    markAllAsRead,
    billingActionTaken,
} from '../../actions/notification';
import { User, IS_SAAS_SERVICE } from '../../config';
import moment from 'moment';

import { StripeProvider, injectStripe, Elements } from '@stripe/react-stripe-js';
import { openModal } from '../../actions/modal';
import MessageBox from '../modals/MessageBox';

import { v4 as uuidv4 } from 'uuid';
import { env } from '../../config';

class NotificationMenu extends Component {
    state = {
        MessageBoxId: uuidv4(),
    };

    markAllAsRead(projectId: $TSFixMe) {

        this.props.markAllAsRead(projectId);
    }

    markAsRead(notification: $TSFixMe) {
        const notificationIds = [{ notificationId: notification._id }];

        this.props.markAsRead(notification.projectId._id, notificationIds);
    }

    handlePaymentIntent = (notification: $TSFixMe) => {
        const { client_secret } = notification.meta;
        const { projectId, _id } = notification;

        const { stripe, billingActionTaken, openModal, balance } = this.props;
        const { MessageBoxId } = this.state;
        stripe.handleCardPayment(client_secret).then((result: $TSFixMe) => {
            if (
                result.paymentIntent &&
                result.paymentIntent.status === 'succeeded'
            ) {
                const creditedBalance = result.paymentIntent.amount / 100;
                billingActionTaken(projectId, _id, {
                    meta: {},
                    icon: 'success',
                    message: `Transaction successful, your balance is now ${(
                        balance + creditedBalance
                    ).toFixed(2)}$`,
                });
                openModal({
                    id: MessageBoxId,
                    content: MessageBox,
                    title: 'Message',
                    message: `Transaction successful, your balance is now ${(
                        balance + creditedBalance
                    ).toFixed(2)}$`,
                });
            } else {
                billingActionTaken(projectId, _id, {
                    meta: {},
                    icon: 'error',
                    message:
                        'Transaction failed, try again later or use a different card.',
                });
                openModal({
                    id: MessageBoxId,
                    content: MessageBox,
                    title: 'Message',
                    message:
                        'Transaction failed, try again later or use a different card.',
                });
            }
        });
    };

    render() {
        const userId = User.getUserId();
        const allRead =

            this.props.notifications &&

                this.props.notifications.notifications &&

                this.props.notifications.notifications.length

                ? this.props.notifications.notifications.filter(
                    (notification: $TSFixMe) => notification &&
                        notification.read &&
                        notification.read.indexOf(userId) <= -1
                ).length
                : null;

        return this.props.notificationsVisible ? (
            <div
                className="notifications ContextualLayer-layer--topright ContextualLayer-layer--anytop ContextualLayer-layer--anyright ContextualLayer-context--bottom ContextualLayer-context--anybottom ContextualLayer-container ContextualLayer--pointerEvents"
                style={{
                    top: '49px',
                    width: '450px',

                    left: this.props.position

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
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <span
                                            style={{
                                                color: '#24b47e',
                                                paddingLeft: '15px',
                                                fontSize: '14px',
                                                fontWeight: 'bold',
                                            }}
                                        >
                                            NOTIFICATIONS
                                        </span>
                                        {allRead ? (
                                            <span
                                                style={{ cursor: 'pointer' }}
                                                onClick={() =>
                                                    this.markAllAsRead(

                                                        this.props.projectId
                                                    )
                                                }
                                            >
                                                Mark All As Read
                                            </span>
                                        ) : (
                                            ''
                                        )}
                                    </div>
                                </div>
                                <div className="Box-root Padding-vertical--8">

                                    {this.props.notifications &&

                                        this.props.notifications.notifications &&

                                        this.props.notifications.notifications
                                            .length ? (

                                        this.props.notifications.notifications.map(
                                            (notification: $TSFixMe, key: $TSFixMe) => {
                                                if (
                                                    notification.meta &&
                                                    notification.meta
                                                        .client_secret &&
                                                    IS_SAAS_SERVICE
                                                ) {
                                                    return (
                                                        <div
                                                            className="Box-root db-ListViewItem--hasLink"
                                                            style={{
                                                                padding:
                                                                    '10px 10px',
                                                                fontWeight:
                                                                    '400',
                                                                fontSize: '1em',
                                                                borderBottom:
                                                                    '1px solid rgba(188,188,188,0.5)',
                                                                borderRadius:
                                                                    '2px',
                                                            }}
                                                            key={key}
                                                            onClick={() =>
                                                                this.handlePaymentIntent(
                                                                    notification
                                                                )
                                                            }
                                                        >
                                                            <div className="Notify-oneuptime">
                                                                <img
                                                                    src={`/dashboard/assets/img/${notification.icon
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
                                                                            'pointer',
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
                                                        onClick={() =>
                                                            notification.read.indexOf(
                                                                userId
                                                            ) > -1
                                                                ? null
                                                                : this.markAsRead(
                                                                    notification
                                                                )
                                                        }
                                                    >
                                                        <div className="Notify-oneuptime">
                                                            <img
                                                                src={`/dashboard/assets/img/${notification.icon
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
                                            <span
                                                style={{ paddingLeft: '15px' }}
                                            >
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


NotificationMenu.displayName = 'NotificationMenu';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        notifications: state.notifications.notifications,
        notificationsVisible: state.notifications.notificationsVisible,
        balance:
            state.project.currentProject &&
            state.project.currentProject.balance,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        position: state.notifications.notificationsPosition,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        { markAsRead, markAllAsRead, billingActionTaken, openModal },
        dispatch
    );
};


NotificationMenu.propTypes = {
    markAsRead: PropTypes.func,
    markAllAsRead: PropTypes.func,
    billingActionTaken: PropTypes.func,
    notifications: PropTypes.object,
    length: PropTypes.number,
    map: PropTypes.func,
    stripe: PropTypes.object,
    notificationsVisible: PropTypes.bool,
    openModal: PropTypes.func,
    balance: PropTypes.number,
    projectId: PropTypes.string,
    position: PropTypes.number,
};

const NotificationMenuStripe = injectStripe(
    connect(mapStateToProps, mapDispatchToProps)(NotificationMenu)
);

export default class NotificationWithCheckout extends Component {
    render() {
        return (
            <StripeProvider apiKey={env('STRIPE_PUBLIC_KEY')}>
                <Elements>
                    <NotificationMenuStripe />
                </Elements>
            </StripeProvider>
        );
    }
}

NotificationWithCheckout.displayName = 'NotificationWithCheckout';
