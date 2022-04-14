import React from 'react';
import PropTypes from 'prop-types';

const BoxFooter: Function = ({
    recordsCount,
    canPrev,
    canNext,
    previousClicked,
    nextClicked,
    page,
    numberOfPages
}: $TSFixMe) => (
    <div className="bs-Tail bs-Tail--separated bs-Tail--short">
        <div className="bs-Tail-copy">
            <span>
                {numberOfPages > 0
                    ? `Page ${page} of ${numberOfPages} (${recordsCount} record${
                          recordsCount === 1 ? '' : 's'
                      })`
                    : `${recordsCount} record${recordsCount === 1 ? '' : 's'}`}
            </span>
        </div>
        <div className="bs-Tail-actions">
            <div className="ButtonGroup Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                <div className="Box-root Margin-right--8">
                    <button
                        onClick={previousClicked}
                        className={
                            'Button bs-ButtonLegacy' +
                            (canPrev ? '' : 'Is--disabled')
                        }
                        disabled={!canPrev}
                        data-db-analytics-name="list_view.pagination.previous"
                        type="button"
                    >
                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                <span>Previous</span>
                            </span>
                        </div>
                    </button>
                </div>
                <div className="Box-root">
                    <button
                        onClick={nextClicked}
                        className={
                            'Button bs-ButtonLegacy' +
                            (canNext ? '' : 'Is--disabled')
                        }
                        disabled={!canNext}
                        data-db-analytics-name="list_view.pagination.next"
                        type="button"
                    >
                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                <span>Next</span>
                            </span>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    </div>
);
BoxFooter.displayName = 'ssoDefaultRoles';

BoxFooter.propTypes = {
    recordsCount: PropTypes.number,
    canPrev: PropTypes.func,
    canNext: PropTypes.func,
    previousClicked: PropTypes.func,
    nextClicked: PropTypes.func,
    page: PropTypes.number,
    numberOfPages: PropTypes.number,
};
export default BoxFooter;
