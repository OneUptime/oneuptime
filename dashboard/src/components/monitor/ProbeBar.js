import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';

let greenBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgb(117, 211, 128)'// "green-status"
};
let yellowBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgb(255, 222, 36)'// "yellow-status"
};
let redBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgb(250, 117, 90)'// "red-status"
};
let greyBackground = {
    display: 'inline-block',
    borderRadius: '50%',
    height: '8px',
    width: '8px',
    margin: '0 8px 1px 0',
    backgroundColor: 'rgba(107, 124, 147, 0.2)'// "grey-status"
};

function ProbeBar({ index, name, status, selectbutton, activeProbe, lastAlive }) {
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
        <button
            key={`probes-btn${index}`}
            id={`probes-btn${index}`}
            disabled={false}
            onClick={() => selectbutton(index)}
            className={activeProbe === index ? 'icon-container selected' : 'icon-container'}>
            <span style={lastAlive && moment(now).diff(moment(lastAlive), 'minutes') > 1 ?
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
    lastAlive: PropTypes.instanceOf(Date)
};

export default ProbeBar;