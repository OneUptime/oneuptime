import React from 'react';

function DataPathHoC(WrappedComponent: $TSFixMe, data: $TSFixMe) {
    return class extends Component<ComponentProps> {
        static displayName = 'HocCom';
        override render() {
            // Wraps the input component in a container, without mutating it. Good!
            return (
                <WrappedComponent {...this.props} webhook={data} data={data} />
            );
        }
    };
}
DataPathHoC.displayName = 'DataPathHoC';

export default DataPathHoC;
