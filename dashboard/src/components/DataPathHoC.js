import React from 'react';

function DataPathHoC(WrappedComponent, data) {
    return class extends React.Component {
        static displayName = 'HocCom';
        render() {
            // Wraps the input component in a container, without mutating it. Good!
            return (
                <WrappedComponent {...this.props} webhook={data} data={data} />
            );
        }
    };
}
DataPathHoC.displayName = 'DataPathHoC';

export default DataPathHoC;
