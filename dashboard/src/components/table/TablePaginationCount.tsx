import React, { Component } from 'react';
import PropTypes from 'prop-types';
export default class TablePaginationCount extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalItemsCount' does not exist on type ... Remove this comment to see the full error message
            totalItemsCount,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'friendlyName' does not exist on type 'Re... Remove this comment to see the full error message
            friendlyName,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'friendlyNamePlural' does not exist on ty... Remove this comment to see the full error message
            friendlyNamePlural,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentPageCount' does not exist on type... Remove this comment to see the full error message
            currentPageCount,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noOfItemsInPage' does not exist on type ... Remove this comment to see the full error message
            noOfItemsInPage = 10,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isLoading' does not exist on type 'Reado... Remove this comment to see the full error message
            isLoading,
        } = this.props;

        return (
            <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                    <span>
                        {!isLoading && (
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                Page {currentPageCount} of{' '}
                                {Math.ceil(totalItemsCount / noOfItemsInPage)}
                                <span>
                                    {totalItemsCount}{' '}
                                    {totalItemsCount > 1
                                        ? friendlyNamePlural
                                        : friendlyName}
                                </span>
                            </span>
                        )}
                    </span>
                </span>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TablePaginationCount.propTypes = {
    isLoading: PropTypes.bool.isRequired,
    totalItemsCount: PropTypes.number,
    friendlyName: PropTypes.string,
    friendlyNamePlural: PropTypes.string,
    currentPageCount: PropTypes.number,
    noOfItemsInPage: PropTypes.number,
};
