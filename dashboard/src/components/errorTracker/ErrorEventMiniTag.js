import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';

class ErrorEventMiniTag extends Component {
    render() {
        const { errorEvent } = this.props;
        const errorEventDetails = errorEvent.errorEvent;
        return (
            <ShouldRender
                if={
                    !errorEvent.requesting &&
                    errorEventDetails &&
                    errorEventDetails.tags
                }
            >
                <div className="Box-divider--border-top-1 Padding-vertical--20">
                    <div>
                        <p className="SubHeader">Tags</p>
                    </div>
                    <div className="Flex-flex Flex-wrap--wrap">
                        {errorEventDetails &&
                        errorEventDetails.tags &&
                        errorEventDetails.tags.length > 0 ? (
                            errorEventDetails.tags.map((tag, i) => {
                                return (
                                    <div key={i} className="Tag-Pill">
                                        <div className="Tag-Title">
                                            {tag.key}
                                        </div>
                                        <div className="Tag-Content">
                                            {tag.value}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div> No Tags</div>
                        )}
                    </div>
                </div>
            </ShouldRender>
        );
    }
}

ErrorEventMiniTag.propTypes = {
    errorEvent: PropTypes.object,
};
ErrorEventMiniTag.displayName = 'ErrorEventMiniTag';
export default ErrorEventMiniTag;
