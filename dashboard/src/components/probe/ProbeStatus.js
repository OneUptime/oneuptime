import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';

function ProbeStatus({ lastAlive }) {
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        let nowHandler = setTimeout(() => {
            setNow(Date.now());
        }, 65000);

        return () => {
            clearTimeout(nowHandler);
        };
    });

    return (
        lastAlive && moment(now).diff(moment(lastAlive), 'minutes') > 1 ?
            (<div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                    <span>OFFLINE</span>
                </span>
            </div>)
            : (<div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                    <span>ONLINE</span>
                </span>
            </div>)
    );
}

ProbeStatus.displayName = 'ProbeStatus';

ProbeStatus.propTypes = {
    lastAlive: PropTypes.instanceOf(Date)
};

export default ProbeStatus;