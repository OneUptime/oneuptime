import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Slide from 'react-reveal/Slide';

class IncidentCreated extends Component {
    render() {
        return (
            <Slide bottom>
                <div
                    className="notifications ContextualLayer-layer--anyright ContextualLayer-context--bottom ContextualLayer-context--anybottom ContextualLayer-container ContextualLayer--pointerEvents"
                    style={{
                        position: 'absolute',
                        bottom: 0,
                        right: 0,
                        zIndex: 1,
                        margin: '20px',
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
                                                NEW INCIDENT CREATED
                                            </span>
                                        </div>
                                    </div>
                                    <div className="Box-root Padding-vertical--8">
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
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Slide>
        );
    }
}

IncidentCreated.displayName = 'IncidentCreated';

const mapStateToProps = state => {
    return {
        notifiableIncidents: state.incident.notifiableIncidents,
        notifications: state.notifications.notifications,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({}, dispatch);
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentCreated);
