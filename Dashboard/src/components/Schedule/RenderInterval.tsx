import React from 'react';
import PropTypes from 'prop-types';

export interface ComponentProps {
    input?: {
        onChange: Function,
        value?: number
    };
}

const RenderInterval: Function = ({
    input: { onChange, value }
}: RenderIntervalProps) => {
    const handleChange: Function = ({
        target: { value }
    }: $TSFixMe) => {
        onChange(value);
    };

    return (
        <input
            type="number"
            placeholder="Interval"
            className="db-BusinessSettings-input TextInput bs-TextInput"
            min="0"
            onChange={handleChange}
            value={value}
            style={{ width: '250px' }}
        />
    );
};

RenderInterval.displayName = 'RenderInterval';

RenderInterval.propTypes = {
    input: PropTypes.shape({
        onChange: PropTypes.func.isRequired,
        value: PropTypes.number,
    }),
};

export { RenderInterval };
