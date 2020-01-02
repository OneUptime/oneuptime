import momentTz from 'moment-timezone'
const TimeZoneNames = momentTz.tz.names();
var offsetTmz=[];
TimeZoneNames.map(tzName => {
    return offsetTmz.push({
        name: ` (GMT ${momentTz.tz(tzName).format('Z')}) ${tzName}`,
        value:tzName
    })
})
export const Zones = offsetTmz;
export var currentTimeZone = momentTz.tz.guess();
export const GMT = name => momentTz.tz(name).format('Z');