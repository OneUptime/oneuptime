const _this = {
    getExceptionColor: function(type: $TSFixMe) {
        let indicator = '#ff0000';
        if (type === 'exception') {
            indicator = '#ffa500';
        }
        if (type === 'message') {
            indicator = '#b7a718';
        }
        return indicator;
    },
    generateFilterOption: function(unformattedFilters: $TSFixMe) {
        const option = {};
        if (!unformattedFilters) {
            return option;
        }
        for (let index = 0; index < unformattedFilters.length; index++) {
            const element = unformattedFilters[index];
            switch (element.value) {
                case 'is:resolved':
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolved' does not exist on type '{}'.
                    option.resolved = true;
                    break;
                case 'is:unresolved':
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolved' does not exist on type '{}'.
                    option.resolved = false;
                    break;
                case 'is:assigned':
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'assigned' does not exist on type '{}'.
                    option.assigned = true;
                    break;
                case 'is:unassigned':
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'assigned' does not exist on type '{}'.
                    option.assigned = false;
                    break;
                case 'is:ignored':
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'ignored' does not exist on type '{}'.
                    option.ignored = true;
                    break;
                default:
                    break;
            }
        }
        return option;
    },
};

export default _this;
