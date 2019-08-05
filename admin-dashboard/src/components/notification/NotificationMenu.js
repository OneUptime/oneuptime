import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {markAsRead} from '../../actions/notification';
import {User } from '../../config';
import moment from 'moment';

class NotificationMenu extends Component {
    markAsRead(notification) {
        this.props.markAsRead(notification.projectId,notification._id);
        if(window.location.href.indexOf('localhost') <= -1){
            this.context.mixpanel.track('Notification Marked As Read', {
                projectId:notification.projectId,
                notificationId:notification._id
            });
        }
        }

    render() {
        var userId = User.getUserId();
        return this.props.visible ?
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
                                                return <div className={notification.read.indexOf(userId) > -1 ? 'Box-root' : 'Box-root unread'} style={{ padding: '10px 10px', fontWeight: '400', fontSize:'1em',borderBottom: '1px solid rgba(188,188,188,0.5)',borderRadius:'2px' }} key={key} onClick={() => notification.read.indexOf(userId) > -1 ? null : this.markAsRead(notification)}>
                                                    <div className="Notify-fyipe">
                                                        <img src={`/assets/img/${notification.icon ? notification.icon : 'information'}.svg`} className="Notify-fyipe-row-primary" style={{ height: '20px', width: '20px'}} alt="notify"/>
                                                        <span className="Notify-fyipe-row-secondary" style={{cursor: 'default'}}>{notification.message} on {moment(notification.createdAt).format('MMMM Do YYYY, h:mm a')}</span>
                                                    </div>
                                                </div>
                                            })
                                            :
                                            <div className="Box-root" style={{ padding: '10px', fontWeight: '500', marginTop: '-12px' }}>
                                                <span>No notifications at this time</span>
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

NotificationMenu.displayName = 'NotificationMenu'

const mapStateToProps = (state) => {
    return {
        notifications: state.notifications.notifications
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators({markAsRead }, dispatch);
};

NotificationMenu.propTypes = {
    visible: PropTypes.bool,
    markAsRead: PropTypes.func,
    notifications : PropTypes.oneOfType([
		PropTypes.object,
		PropTypes.oneOf([null,undefined])
	]),
    length : PropTypes.number,
    map : PropTypes.func
}

NotificationMenu.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(NotificationMenu);