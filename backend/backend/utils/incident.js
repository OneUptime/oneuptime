module.exports = {
    calculateHumanReadableDownTime: function(comparedTime) {
        const downTime =
            (new Date().getTime() - new Date(comparedTime).getTime()) /
            (1000 * 60);
        let downTimeString = `${Math.ceil(downTime)} minutes`;
        if (downTime < 1) {
            downTimeString = 'less than a minute';
        } else if (downTime > 24 * 60) {
            downTimeString = `${Math.floor(
                downTime / (24 * 60)
            )} days ${Math.floor(
                (downTime % (24 * 60)) / 60
            )} hours ${Math.floor(downTime % 60)} minutes`;
        } else if (downTime > 60) {
            downTimeString = `${Math.floor(downTime / 60)} hours ${Math.floor(
                downTime % 60
            )} minutes`;
        }

        return downTimeString;
    },
};
