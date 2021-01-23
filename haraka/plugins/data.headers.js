exports.register = function() {
    this.logerror(
        this,
        "data.headers is deprecated, remove it from config/plugins. See 'haraka -h headers'"
    );
};
