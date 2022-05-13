import React from 'react';
function DataPathHoC(WrappedComponent, data) {
    var _a;
    return _a = class extends Component {
            render() {
                // Wraps the input component in a container, without mutating it. Good!
                return (React.createElement(WrappedComponent, Object.assign({}, this.props, { webhook: data, data: data })));
            }
        },
        _a.displayName = 'HocCom',
        _a;
}
DataPathHoC.displayName = 'DataPathHoC';
export default DataPathHoC;
