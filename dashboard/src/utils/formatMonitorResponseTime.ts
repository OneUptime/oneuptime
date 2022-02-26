export const formatMonitorResponseTime = (time: $TSFixMe) => {
    return time > 1000
        ? (time / 1000).toFixed(2) +
              // @ts-expect-error ts-migrate(2365) FIXME: Operator '>' cannot be applied to types 'string' a... Remove this comment to see the full error message
              ` second${(time / 1000).toFixed(2) > 1 ? 's' : ''}`
        : Math.trunc(time) + ' ms';
};
