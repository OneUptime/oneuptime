import React from 'react';
import PropTypes from 'prop-types';

interface EmptyCategoryProps {
    tabSelected?: Function;
}

function EmptyCategory({
    tabSelected
}: EmptyCategoryProps) {
    return (
        <div className="bs-ContentSection Card-root Card-shadow--medium">
            <div className="Box-root">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    Status Page Category
                                </span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    What monitors do you want to show on the
                                    status page?
                                </span>
                            </span>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                    <div>
                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                            <div
                                id="app-loading"
                                style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    flexDirection: 'column',
                                }}
                            >
                                <div
                                    style={{
                                        marginTop: '20px',
                                        marginBottom: '20px',
                                    }}
                                >
                                    No category added yet to this status page.{' '}
                                    <span
                                        style={{
                                            textDecoration: 'underline',
                                            cursor: 'pointer',
                                        }}
                                        onClick={() => tabSelected(6)}
                                    >
                                        {' '}
                                        Please create one.{' '}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

EmptyCategory.displayName = 'EmptyCategory';

EmptyCategory.propTypes = {
    tabSelected: PropTypes.func,
};

export default EmptyCategory;
