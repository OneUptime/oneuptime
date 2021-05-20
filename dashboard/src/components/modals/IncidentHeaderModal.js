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
        const componentSlug = incident.monitorId.componentId.slug;
        setTimeout(() => {
            history.push(
                '/dashboard/project/' +
                    data.currentProjectSlug +
                    '/component/' +
                    componentSlug +
                    '/incidents/' +
                    incident.idNumber
            );
            this.props.addIncident(incident.incident);
            this.props.animateSidebar(false);
        }, 200);
        this.props.markAsRead(data.currentProjectId, incident.notificationId);
        this.props.animateSidebar(true);
        this.props.closeThisDialog();
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
                                            <span>
                                                {data.incidents.length === 0
                                                    ? 'No incidents currently active'
                                                    : 'The following Incidents are currently Active.'}
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
                                                        <li key={incident._id}>
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
                                                            {
                                                                incident
                                                                    .monitorId
                                                                    .name
                                                            }{' '}
                                                            is{' '}
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
