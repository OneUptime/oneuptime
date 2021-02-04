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
                <div className="ContentHeader Box-root Box-background--white Box-divider--border-top-1 Flex-flex Flex-direction--column Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Tags</span>
                            </span>
                        </div>
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
