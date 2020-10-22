export const formatMonitorResponseTime = time => {
    return time > 1000 ? (time / 1000).toFixed(2) + ' s' : time + ' ms';
};
