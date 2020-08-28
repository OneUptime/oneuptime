import React from 'react';
import { PropTypes } from 'prop-types';

const Icon = props => {
    return (
        <div className={props.className} style={{ marginTop: '3px' }}>
            {props.flags[props.country]({ title: props.country })}
        </div>
    );
};

Icon.displayName = 'Icon';

Icon.propTypes = {
    className: PropTypes.string,
    flags: PropTypes.object,
    country: PropTypes.string,
};

export default Icon;
