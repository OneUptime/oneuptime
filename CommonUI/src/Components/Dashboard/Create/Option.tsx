import React, { ReactElement } from 'react';
import { faFileInvoice } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

const Option = (): ReactElement => {
    return (
        <div>
            <div className="name">
                <FontAwesomeIcon icon={faFileInvoice} />
                <p>Invoice</p>
            </div>
            <div className="shortcut">
                <code>c</code>
                <code>i</code>
            </div>
        </div>
    );
};

export default Option;
