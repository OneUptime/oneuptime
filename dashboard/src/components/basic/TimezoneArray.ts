import momentTz from 'moment-timezone';
const TimeZoneNames = momentTz.tz.names();
const offsetTmz = [];
TimeZoneNames.map(tzName => {
    return offsetTmz.push({
        name: ` (GMT ${momentTz.tz(tzName).format('Z')}) ${tzName}`,
        value: tzName,
    });
});
export const Zones = offsetTmz;
export const currentTimeZone = momentTz.tz.guess();
export const GMT = name => momentTz.tz(name).format('Z');
