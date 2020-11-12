import React, { Component } from 'react';
import ErrorEventHeader from './ErrorEventHeader';
import ErrorEventDevice from './ErrorEventDevice';
import ErrorEventMiniTag from './ErrorEventMiniTag';
import ErrorEventStackTrace from './ErrorEventStackTrace';
import ErrorEventTimeline from './ErrorEventTimeline';
import ErrorEventInfoSection from './ErrorEventInfoSection';
import ErrorEventTagDetail from './ErrorEventTagDetail';
import ErrorEventList from './ErrorEventList';
import PropTypes from 'prop-types';

class ErrorEventDetail extends Component {
    render() {
        const {
            errorEvent,
            componentId,
            projectId,
            errorTrackerId,
            navigationLink,
        } = this.props;
        return (
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div>
                                <div className="Padding-all--20">
                                    <ErrorEventHeader
                                        errorEvent={errorEvent}
                                        componentId={componentId}
                                        projectId={projectId}
                                        errorTrackerId={errorTrackerId}
                                        navigationLink={navigationLink}
                                    />
                                    <ErrorEventDevice />
                                    <ErrorEventMiniTag />
                                    <ErrorEventStackTrace />
                                    <ErrorEventTimeline />
                                    <ErrorEventInfoSection />
                                    <div className="Box-divider--border-top-1 Padding-vertical--20">
                                        <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                            <p className="SubHeader">
                                                Operating System
                                            </p>
                                        </div>
                                        <div className="Margin-vertical--8">
                                            <div className="Flex-flex Margin-vertical--4 ">
                                                <span
                                                    className="Flex-flex Flex-alignItems--center"
                                                    style={{ width: '25%' }}
                                                >
                                                    Brand
                                                </span>
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            '#F7F8F9',
                                                        padding: '15px',
                                                        width: '75%',
                                                    }}
                                                >
                                                    {' '}
                                                    Nexus 5
                                                </span>
                                            </div>
                                            <div className="Flex-flex Margin-vertical--4">
                                                <span
                                                    className="Flex-flex Flex-alignItems--center"
                                                    style={{ width: '25%' }}
                                                >
                                                    Family
                                                </span>
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            '#F7F8F9',
                                                        padding: '15px',
                                                        width: '75%',
                                                    }}
                                                >
                                                    {' '}
                                                    Nexus 5
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Box-divider--border-top-1 Padding-vertical--20">
                                        <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                            <p className="SubHeader">SDK</p>
                                        </div>
                                        <div className="Margin-vertical--8">
                                            <div className="Flex-flex Margin-vertical--4 ">
                                                <span
                                                    className="Flex-flex Flex-alignItems--center"
                                                    style={{ width: '25%' }}
                                                >
                                                    Name
                                                </span>
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            '#F7F8F9',
                                                        padding: '15px',
                                                        width: '75%',
                                                    }}
                                                >
                                                    {' '}
                                                    Fyipe.Tracker.JavaScript
                                                </span>
                                            </div>
                                            <div className="Flex-flex Margin-vertical--4">
                                                <span
                                                    className="Flex-flex Flex-alignItems--center"
                                                    style={{ width: '25%' }}
                                                >
                                                    Version
                                                </span>
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            '#F7F8F9',
                                                        padding: '15px',
                                                        width: '75%',
                                                    }}
                                                >
                                                    {' '}
                                                    3.0.165
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <ErrorEventTagDetail />
                                    <ErrorEventList />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
ErrorEventDetail.propTypes = {
    errorEvent: PropTypes.object,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    errorTrackerId: PropTypes.string,
    navigationLink: PropTypes.func,
};
ErrorEventDetail.displayName = 'ErrorEventDetail';
export default ErrorEventDetail;
