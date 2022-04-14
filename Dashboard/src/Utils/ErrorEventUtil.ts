const _this: $TSFixMe = {
    getExceptionColor: function (type: $TSFixMe): void {
        let indicator = '#ff0000';
        if (type === 'exception') {
            indicator = '#ffa500';
        }
        if (type === 'message') {
            indicator = '#b7a718';
        }
        return indicator;
    },
    generateFilterOption: function (unformattedFilters: $TSFixMe): void {
        const option: $TSFixMe = {};
        if (!unformattedFilters) {
            return option;
        }
        for (let index = 0; index < unformattedFilters.length; index++) {
            const element: $TSFixMe = unformattedFilters[index];
            switch (element.value) {
                case 'is:resolved':
                    option.resolved = true;
                    break;
                case 'is:unresolved':
                    option.resolved = false;
                    break;
                case 'is:assigned':
                    option.assigned = true;
                    break;
                case 'is:unassigned':
                    option.assigned = false;
                    break;
                case 'is:ignored':
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
