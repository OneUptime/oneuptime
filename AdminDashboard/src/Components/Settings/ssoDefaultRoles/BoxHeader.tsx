import React from 'react';
import PropTypes from 'prop-types';

const BoxHeader: Function = ({
    title,
    description,
    buttons = [],
}: $TSFixMe) => {
    return (
        <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                    <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                        <span
                            style={{
                                textTransform: 'capitalize',
                            }}
                        >
                            {title}
                        </span>
                    </span>
                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span>{description}</span>
                    </span>
                </div>
                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                    <div className="Box-root">
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div>
                                {buttons.map(button => {
                                    return button;
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

BoxHeader.displayName = 'BoxHeader';

BoxHeader.propTypes = {
    title: PropTypes.string,
    description: PropTypes.string,
    buttons: PropTypes.func,
};

export default BoxHeader;
