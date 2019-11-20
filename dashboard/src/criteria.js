export const defaultCriteria = {
    url: {
        up_1000: [
            { match: 'all', responseType: 'statusCode', filter: 'gtEqualTo', field1: '200', field2: '', field3: false },
            { responseType: 'statusCode', filter: 'lessThan', field1: '300', field2: '', field3: false },
            { responseType: 'doesRespond', filter: 'isUp', field1: '', field2: '', field3: false },
            { responseType: 'responseTime', filter: 'ltEqualTo', field1: '5000', field2: '', field3: false }
        ], up_1000_createAlert: false, up_1000_autoAcknowledge: false, up_1000_autoResolve: false,
        down_1000: [
            { match: 'any', responseType: 'doesRespond', filter: 'isDown', field1: '', field2: '', field3: false },
            { responseType: 'statusCode', filter: 'gtEqualTo', field1: '400', field2: '', field3: false }
        ], down_1000_createAlert: true, down_1000_autoAcknowledge: true, down_1000_autoResolve: true,
        degraded_1000: [
            { match: 'all', responseType: 'responseTime', filter: 'greaterThan', field1: '5000', field2: '', field3: false }
        ], degraded_1000_createAlert: true, degraded_1000_autoAcknowledge: true, degraded_1000_autoResolve: true,
        type_1000: 'url'
    },
    default: {
        up_1000: [{ match: '', responseType: '', filter: '', field1: '', field2: '', field3: false }], up_1000_createAlert: false, up_1000_autoAcknowledge: false, up_1000_autoResolve: false,
        down_1000: [{ match: '', responseType: '', filter: '', field1: '', field2: '', field3: false }], down_1000_createAlert: true, down_1000_autoAcknowledge: true, down_1000_autoResolve: true,
        degraded_1000: [{ match: '', responseType: '', filter: '', field1: '', field2: '', field3: false }], degraded_1000_createAlert: true, degraded_1000_autoAcknowledge: true, degraded_1000_autoResolve: true,
        type_1000: ''
    }
};