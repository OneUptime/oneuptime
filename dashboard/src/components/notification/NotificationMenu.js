import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { markAsRead, billingActionTaken } from '../../actions/notification';
import { User } from '../../config';
import moment from 'moment';
import {
    StripeProvider,
    injectStripe,
    Elements
} from 'react-stripe-elements';
import { openModal } from '../../actions/modal';
import MessageBox from '../modals/MessageBox';
import uuid from 'uuid';

class NotificationMenu extends Component {

    state = {
        MessageBoxId: uuid.v4()
    }

    markAsRead(notification) {
        this.props.markAsRead(notification.projectId, notification._id);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Notification Marked As Read', {
                projectId: notification.projectId,
                notificationId: notification._id
            });
        }
    }

    handlePaymentIntent = (notification) => {
        var { client_secret } = notification.meta;
        var { projectId, _id } = notification;
        var { stripe, billingActionTaken, openModal, balance } = this.props;
        var { MessageBoxId } = this.state;
        stripe.handleCardPayment(client_secret)
            .then(result => {
                if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
                    var creditedBalance = result.paymentIntent.amount / 100;
                    billingActionTaken(projectId, _id, {
                        meta: {},
                        icon: 'success',
                        message: `Transaction successful, your balance is now ${balance + creditedBalance}$`
                    })
                    openModal({
                        id: MessageBoxId,
                        content: MessageBox,
                        title: 'Message',
                        message: `Transaction successful, your balance is now ${balance + creditedBalance}$`
                    })
                }
                else {
                    billingActionTaken(projectId, _id, {
                        meta: {},
                        icon: 'error',
                        message: 'Transaction failed, try again later or use a different card.'
                    })
                    openModal({
                        id: MessageBoxId,
                        content: MessageBox,
                        title: 'Message',
                        message: 'Transaction failed, try again later or use a different card.'
                    })
                }
            })
    }

    render() {
        var userId = User.getUserId();
        return this.props.notificationsVisible ?
            (
                <div className="ContextualLayer-layer--topright ContextualLayer-layer--anytop ContextualLayer-layer--anyright ContextualLayer-context--bottom ContextualLayer-context--anybottom ContextualLayer-container ContextualLayer--pointerEvents"
                    style={{ top: '49px', width: '450px', right: '20px' }}>
                    <div className="ContextualPopover-animate ContextualPopover-animate-entered">
                        <div className="ContextualPopover" style={{ transformOrigin: '100% 0px 0px' }}>
                            <div className="ContextualPopover-arrowContainer" style={{ position: 'relative', right: '40px' }}>
                                <div className="ContextualPopover-arrow"></div>
                            </div>
                            <div className="ContextualPopover-contents">
                                <div className="Box-root" id="notificationscroll" style={{ width: '450px', maxHeight: '300px', overflowX: 'scroll' }}>
                                    <div className="Box-root Box-divider--surface-bottom-1 Padding-all--12" style={{ boxShadow: '1px 1px rgba(188,188,188,0.5)' }}>
                                        <div>
                                            <span style={{ color: '#24b47e', paddingLeft: '15px', fontSize: '14px', fontWeight: 'medium' }}>NOTIFICATIONS</span>
                                        </div>
                                    </div>
                                    <div className="Box-root Padding-vertical--8">
                                        {(this.props.notifications && this.props.notifications.notifications && this.props.notifications.notifications.length) ?
                                            this.props.notifications.notifications.map((notification, key) => {
                                                if (notification.meta && notification.meta.client_secret) {
                                                    return (
                                                        <div className="Box-root db-ListViewItem--hasLink"
                                                            style={{ padding: '10px 10px', fontWeight: '400', fontSize: '1em', borderBottom: '1px solid rgba(188,188,188,0.5)', borderRadius: '2px' }}
                                                            key={key}
                                                            onClick={() => this.handlePaymentIntent(notification)}>
                                                            <div className="Notify-fyipe">
                                                                <img src={`/assets/img/${notification.icon ? notification.icon : 'information'}.svg`} className="Notify-fyipe-row-primary" style={{ height: '20px', width: '20px' }} alt="notify" />
                                                                <span className="Notify-fyipe-row-secondary" style={{ cursor: 'pointer' }}>{notification.message} on {moment(notification.createdAt).format('MMMM Do YYYY, h:mm a')}</span>
                                                            </div>
                                                        </div>
                                                    )
                                                }
                                                return (
                                                    <div className={notification.read.indexOf(userId) > -1 ? 'Box-root' : 'Box-root unread'} style={{ padding: '10px 10px', fontWeight: '400', fontSize: '1em', borderBottom: '1px solid rgba(188,188,188,0.5)', borderRadius: '2px' }} key={key} onClick={() => notification.read.indexOf(userId) > -1 ? null : this.markAsRead(notification)}>
                                                        <div className="Notify-fyipe">
                                                            <img src={`/assets/img/${notification.icon ? notification.icon : 'information'}.svg`} className="Notify-fyipe-row-primary" style={{ height: '20px', width: '20px' }} alt="notify" />
                                                            <span className="Notify-fyipe-row-secondary" style={{ cursor: 'default' }}>{notification.message} on {moment(notification.createdAt).format('MMMM Do YYYY, h:mm a')}</span>
                                                        </div>
                                                    </div>
                                                )
                                            })
                                            :
                                            <div className="Box-root" style={{ padding: '10px', fontWeight: '500', marginTop: '-12px' }}>
                                                <span style={{ paddingLeft: '15px' }}>No notifications at this time</span>
                                            </div>
                                        }
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

const mapStateToProps = (state) => {
    return {
        notifications: state.notifications.notifications,
        notificationsVisible: state.notifications.notificationsVisible,
        balance: state.project.currentProject && state.project.currentProject.balance
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ markAsRead, billingActionTaken, openModal }, dispatch);
};

NotificationMenu.propTypes = {
    markAsRead: PropTypes.func,
    billingActionTaken: PropTypes.func,
    notifications: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined])
    ]),
    length: PropTypes.number,
    map: PropTypes.func,
    stripe: PropTypes.object,
    notificationsVisible: PropTypes.bool,
    openModal: PropTypes.func,
    balance: PropTypes.number
}

NotificationMenu.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

const NotificationMenuStripe = injectStripe(connect(mapStateToProps, mapDispatchToProps)(NotificationMenu));

export default class NotificationWithCheckout extends Component {
    render() {
        return (
            <StripeProvider apiKey="pk_test_UynUDrFmbBmFVgJXd9EZCvBj00QAVpdwPv">
                <Elements>
                    <NotificationMenuStripe />
                </Elements>
            </StripeProvider>
        )
    }
}
NotificationWithCheckout.displayName = 'NotificationWithCheckout';