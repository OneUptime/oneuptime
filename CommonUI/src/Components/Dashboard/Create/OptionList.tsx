import React, { ReactElement } from 'react';
import Option from './Option';

const OptionList = (): ReactElement => {
    return (
        <div className="lists">
            <p className="legend">Online Payments</p>
            <Option />
            <Option />
            <Option />
        </div>
    );
};

export default OptionList;
