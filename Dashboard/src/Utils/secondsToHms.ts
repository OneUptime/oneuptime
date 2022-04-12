/**
 * @description converts seconds to human readable hr min sec format
 * @param {*} value a string or number representing time in seconds
 * @returns a string in the formatted style
 * @example secondsToHms(3600) will return 1hr
 */
const secondsToHms = (value: $TSFixMe): void => {
    if (!isNaN(value)) {
        value = Number(value);
        const hr = Math.floor(value / 3600),
            min = Math.floor((value % 3600) / 60),
            sec = Math.floor((value % 3600) % 60);

        const formattedValue = `${hr > 0 ? `${hr} hr` : ''} ${
            min > 0
                ? min < 10
                    ? `0${min} min`
                    : `${min} min`
                : `${hr > 0 ? '0 min' : ''}`
        } ${
            sec < 10
                ? `${sec > 0 ? `0${sec} sec` : `${min > 0 ? '' : '0 sec'}`}`
                : `${sec} sec`
        }`;
        return formattedValue.trim();
    }

    return '0 sec';
};

export default secondsToHms;
