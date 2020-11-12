const _this = {
    getExceptionColor: function(type) {
        let indicator = '#ff0000';
        if (type === 'exception') {
            indicator = '#ffa500';
        }
        if (type === 'message') {
            indicator = '#b7a718';
        }
        return indicator;
    },
};

export default _this;
