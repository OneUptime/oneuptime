import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { history } from '../../store';
import ClickOutside from 'react-click-outside';
import { addIncident } from '../../actions/incident';
import { animateSidebar } from '../../actions/animateSidebar';
import { markAsRead } from '../../actions/notification';

class IncidentHeaderModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
            case 'Enter':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    navigatToIncident = incident => {
        const { data } = this.props;
        const componentSlug =
            incident &&
            incident.monitors[0] &&
            incident.monitors[0].monitorId.componentId.slug;
        setTimeout(() => {
            history.push(
                '/dashboard/project/' +
                    data.currentProjectSlug +
                    '/component/' +
                    componentSlug +
                    '/incidents/' +
                    incident.slug
            );
            this.props.addIncident(incident.incident);
            this.props.animateSidebar(false);
        }, 200);
        this.props.markAsRead(data.currentProjectId, incident.notificationId);
        this.props.animateSidebar(true);
        this.props.closeThisDialog();
    };

    handleMonitorList = monitors => {
        if (monitors.length === 1) {
            return `${monitors[0].monitorId.name} is`;
        }
        if (monitors.length === 2) {
            return `${monitors[0].monitorId.name} and ${monitors[1].monitorId.name} are`;
        }
        if (monitors.length === 3) {
            return `${monitors[0].monitorId.name}, ${monitors[1].monitorId.name} and ${monitors[2].monitorId.name} are`;
        }
        if (monitors.length > 3) {
            return `${monitors[0].monitorId.name}, ${
                monitors[1].monitorId.name
            } and ${monitors.length - 2} others are`;
        }
    };

    render() {
        const { closeThisDialog, data } = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--default Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span id="incident_header_modal">
                                                {data.incidents.length === 0
                                                    ? 'No incidents currently active'
                                                    : 'These incidents are currently active.'}
                                            </span>
                                        </span>
                                    </div>
                                </div>

                                <div className="bs-Modal-content">
                                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        {data.incidents.length > 0 ? (
                                            <ul>
                                                {data.incidents.map(
                                                    incident => (
                                                        <li
                                                            key={incident._id}
                                                            className="activeIncidentList"
                                                        >
                                                            <span
                                                                style={{
                                                                    fontWeight:
                                                                        '500',
                                                                    cursor:
                                                                        'pointer',
                                                                    textDecoration:
                                                                        'underline',
                                                                }}
                                                                onClick={() => {
                                                                    this.navigatToIncident(
                                                                        incident
                                                                    );
                                                                }}
                                                            >
                                                                Incident #
                                                                {
                                                                    incident.idNumber
                                                                }
                                                            </span>
                                                            :{' '}
                                                            {this.handleMonitorList(
                                                                incident.monitors
                                                            )}{' '}
                                                            {
                                                                incident.incidentType
                                                            }
                                                        </li>
                                                    )
                                                )}
                                            </ul>
                                        ) : (
                                            <span>
                                                No incident is currently active
                                            </span>
                                        )}
                                    </span>
                                </div>

                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={this.props.closeThisDialog}
                                            autoFocus={true}
                                        >
                                            <span>Close</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

IncidentHeaderModal.displayName = 'IncidentHeaderModal';

IncidentHeaderModal.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    currentProjectSlug: PropTypes.string,
    data: PropTypes.object,
    animateSidebar: PropTypes.func,
    markAsRead: PropTypes.func,
    addIncident: PropTypes.func,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            addIncident,
            animateSidebar,
            markAsRead,
        },
        dispatch
    );
};
export default connect(null, mapDispatchToProps)(IncidentHeaderModal);
