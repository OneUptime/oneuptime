import React from 'react';
import PropTypes from 'prop-types';

const FeatureList = props => (
    <li className="Margin-vertical--4">
        <img
            alt="check"
            src="/dashboard/assets/img/icons/acceptance.svg"
            style={{
                height: '13px',
                width: '13px',
                marginRight: '5px',
            }}
        />
        {props.content}
    </li>
);

FeatureList.displayName = 'FeatureList';
FeatureList.propTypes = {
    content: PropTypes.string.isRequired,
};
export default FeatureList;
