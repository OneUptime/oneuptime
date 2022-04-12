export const formatMonitorResponseTime = (time: $TSFixMe): void => {
    return time > 1000
        ? (time / 1000).toFixed(2) +
              ` second${(time / 1000).toFixed(2) > 1 ? 's' : ''}`
        : Math.trunc(time) + ' ms';
};
