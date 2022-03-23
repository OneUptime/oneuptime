import React from 'react';
import PropTypes from 'prop-types';

interface CheckboxHeaderProps {
    text: string;
}

const CheckboxHeader = ({
    text
}: CheckboxHeaderProps) => {
    return (
        <div className="bs-Fieldset-row">
            <label
                className="bs-Fieldset-label"
                style={{
                    flex: '30% 0 0',
                }}
            >
                <span></span>
            </label>
            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                <div
                    className="Box-root"
                    style={{
                        height: '5px',
                    }}
                ></div>
                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                    <label className="Checkbox">
                        <p
                            style={{
                                fontSize: '16px',
                                marginTop: '15px',
                                fontWeight: 500,
                            }}
                        >
                            {text}
                        </p>
                    </label>
                </div>
            </div>
        </div>
    );
};

CheckboxHeader.displayName = 'CheckboxHeader';

CheckboxHeader.propTypes = {
    text: PropTypes.string.isRequired,
};

export default CheckboxHeader;
