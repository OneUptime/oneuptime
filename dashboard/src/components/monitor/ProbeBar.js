import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';

const greenBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: '#24b47e'
};
const yellowBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: '#e39f48'
};
const redBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: '#e25950'
};
const greyBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgba(107, 124, 147, 0.2)'
};

function ProbeBar({ index, name, status, selectbutton, activeProbe, lastAlive }) {
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        setNow(Date.now());

        const nowHandler = setTimeout(() => {
            setNow(Date.now());
        }, 300000);

        return () => {
            clearTimeout(nowHandler);
        };
    }, [lastAlive]);

    return (
        <button
            key={`probes-btn${index}`}
            id={`probes-btn${index}`}
            disabled={false}
            onClick={() => selectbutton(index)}
            className={activeProbe === index ? 'icon-container selected' : 'icon-container'}>
            <span style={(lastAlive && moment(now).diff(moment(lastAlive), 'seconds') >= 300) || !lastAlive ?
                greyBackground
                :
                (status === 'offline' ? redBackground : (status === 'degraded' ? yellowBackground : greenBackground))
            }></span>
            <span>{name}</span>
        </button>
    )
}

ProbeBar.displayName = 'ProbeBar';

ProbeBar.propTypes = {
    index: PropTypes.number,
    name: PropTypes.string,
    status: PropTypes.string,
    selectbutton: PropTypes.func,
    activeProbe: PropTypes.number,
    lastAlive: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string])
};

export default ProbeBar;