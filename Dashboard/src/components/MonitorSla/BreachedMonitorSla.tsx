import React, { useState } from 'react';
import PropTypes from 'prop-types';

import { withRouter } from 'react-router-dom';
import { Spinner } from '../basic/Loader';

interface BreachedMonitorSlaProps {
    monitor?: object;
    sla?: object;
    closingSla?: boolean;
    projectId?: string;
    userId?: string;
    closeSla?: Function;
}

const BreachedMonitorSla: Function = ({
    monitor,
    sla,
    userId,
    closeSla,
    closingSla
}: BreachedMonitorSlaProps) => {
    const [isClosing, setIsClosing] = useState(false);
    const projectId = monitor.projectId._id || monitor.projectId;

    if (monitor.breachClosedBy && monitor.breachClosedBy.includes(userId)) {
        return null;
    }

    return (
        <div
            className="Box-root Margin-bottom--12 box Box-background--red"
            style={{
                width: '100%',
                color: '#fff',
            }}
        >
            <div
                className="box-inner"
                style={{ position: 'relative', padding: 20 }}
            >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span
                        className="db-SideNav-icon db-SideNav-icon--info db-SideNav-icon--selected"
                        style={{
                            filter: 'brightness(0) invert(1)',
                            marginTop: 1,
                            marginRight: 10,
                            display: 'block',
                        }}
                    ></span>
                    <div
                        style={{
                            textTransform: 'uppercase',
                            fontSize: 11,
                            fontWeight: 900,
                        }}
                    >
                        Monitor SLA Breached
                    </div>
                </div>

                <span
                    style={{
                        display: 'inline-block',
                        fontSize: 14,
                        fontWeight: 'lighter',
                        marginTop: 20,
                    }}
                >
                    In the last {sla.frequency} days, the monitor {monitor.name}{' '}
                    breached the {sla.monitorUptime}% monitor uptime set on{' '}
                    {sla.name} monitor SLA
                </span>
                {isClosing && closingSla ? (
                    <div style={{ position: 'absolute', top: 18, right: 18 }}>
                        <Spinner />
                    </div>
                ) : (
                    <span
                        className="bm__icon bm__icon--close"
                        onClick={() => {
                            setIsClosing(true);
                            closeSla(projectId, monitor._id);
                        }}
                    ></span>
                )}
            </div>
        </div>
    );
};

BreachedMonitorSla.displayName = 'BreachedMonitorSla';

BreachedMonitorSla.propTypes = {
    monitor: PropTypes.object,
    sla: PropTypes.object,
    closingSla: PropTypes.bool,
    projectId: PropTypes.string,
    userId: PropTypes.string,
    closeSla: PropTypes.func,
};

export default withRouter(BreachedMonitorSla);
