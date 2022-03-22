import React from 'react';

import { PropTypes } from 'prop-types';

function ErrorWarning({
    message
}: $TSFixMe) {
    return (
        <div className="Box-root Margin-vertical--12">
            <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                <div className="Box-root Box-background--red4 Card-shadow--medium Border-radius--4">
                    <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                        <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                            <span id="warningMessage">{message}</span>
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

ErrorWarning.displayName = 'ErrorWarning';

ErrorWarning.propTypes = {
    message: PropTypes.string,
};

export default ErrorWarning;
