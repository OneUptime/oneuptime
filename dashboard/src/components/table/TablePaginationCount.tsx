import React, { Component } from 'react';
import PropTypes from 'prop-types';
export default class TablePaginationCount extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        const {

            totalItemsCount,

            friendlyName,

            friendlyNamePlural,

            currentPageCount,

            noOfItemsInPage = 10,

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


TablePaginationCount.propTypes = {
    isLoading: PropTypes.bool.isRequired,
    totalItemsCount: PropTypes.number,
    friendlyName: PropTypes.string,
    friendlyNamePlural: PropTypes.string,
    currentPageCount: PropTypes.number,
    noOfItemsInPage: PropTypes.number,
};
