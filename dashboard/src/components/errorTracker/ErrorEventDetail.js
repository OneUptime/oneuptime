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
        const { errorEvent, navigationLink } = this.props;
        return (
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div>
                                <div className="Padding-all--20">
                                    <ErrorEventHeader
                                        errorEvent={errorEvent}
                                        navigationLink={navigationLink}
                                    />
                                    <ErrorEventDevice errorEvent={errorEvent} />
                                    <ErrorEventMiniTag
                                        errorEvent={errorEvent}
                                    />
                                    <ErrorEventStackTrace
                                        errorEvent={errorEvent}
                                    />
                                    <ErrorEventTimeline
                                        errorEvent={errorEvent}
                                    />
                                    <ErrorEventInfoSection
                                        errorEvent={errorEvent}
                                    />

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
    navigationLink: PropTypes.func,
};
ErrorEventDetail.displayName = 'ErrorEventDetail';
export default ErrorEventDetail;
