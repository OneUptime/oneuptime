import momentTz from 'moment-timezone';
const TimeZoneNames: $TSFixMe = momentTz.tz.names();
const offsetTmz: $TSFixMe = [];
TimeZoneNames.map(tzName => {
    return offsetTmz.push({
        name: ` (GMT ${momentTz.tz(tzName).format('Z')}) ${tzName}`,
        value: tzName,
    });
});
export const Zones: $TSFixMe = offsetTmz;
export const currentTimeZone: $TSFixMe = momentTz.tz.guess();
export const GMT: Function = (name: $TSFixMe): void =>
    momentTz.tz(name).format('Z');
