/**
 * @param {string} vulnerability : An object containing the issue level
 * @description Analyse vulnerability object and returns the maximum threat level
 * @returns {string} critical, high, moderate or low
 */

const threatLevel = vulnerability => {
    if (vulnerability.critical > 0) {
        return 'critical';
    }
    if (vulnerability.high > 0) {
        return 'high';
    }
    if (vulnerability.moderate > 0) {
        return 'moderate';
    }
    if (vulnerability.low > 0) {
        return 'low';
    }
    return 'low';
};

export default threatLevel;
