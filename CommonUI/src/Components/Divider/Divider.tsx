import React, { ReactElement } from 'react';

const Divider: () => JSX.Element = (): ReactElement => {
    return (
        <div
            className="w-full border-t border-gray-100"
            style={{ borderColor: '#f9fafb' }}
        ></div>
    );
};

export default Divider;
