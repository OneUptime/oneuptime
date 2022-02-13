import React, { Component } from 'react';
import TablePaginationButtons from './TablePaginationButtons';
import TablePaginationCount from './TablePaginationCount';
import PropTypes from 'prop-types';

export default class TableFooter extends Component {
    constructor(props) {
        super(props);
    }

    render() {
        const {
            onNextClicked,
            onPreviousClicked,
            nextButtonText,
            previousButtonText,
            forceDisableNextButton,
            forceDisablePreviousButton,
            totalItemsCount,
            friendlyName,
            friendlyNamePlural,
            currentPageCount,
            noOfItemsInPage = 10,
            isLoading,
        } = this.props;

        return (
            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                <TablePaginationCount
                    totalItemsCount={totalItemsCount}
                    friendlyName={friendlyName}
                    friendlyNamePlural={friendlyNamePlural}
                    currentPageCount={currentPageCount}
                    noOfItemsInPage={noOfItemsInPage}
                    isLoading={isLoading}
                />
                <TablePaginationButtons
                    onNextClicked={onNextClicked}
                    onPreviousClicked={onPreviousClicked}
                    nextButtonText={nextButtonText}
                    previousButtonText={previousButtonText}
                    forceDisableNextButton={forceDisableNextButton}
                    forceDisablePreviousButton={forceDisablePreviousButton}
                    currentPageCount={currentPageCount}
                    noOfItemsInPage={noOfItemsInPage}
                    totalItemsCount={totalItemsCount}
                />
            </div>
        );
    }
}

TableFooter.propTypes = {
    isLoading: PropTypes.bool.isRequired,
    onNextClicked: PropTypes.func,
    onPreviousClicked: PropTypes.func,
    nextButtonText: PropTypes.string,
    previousButtonText: PropTypes.string,
    forceDisableNextButton: PropTypes.bool,
    forceDisablePreviousButton: PropTypes.bool,
    totalItemsCount: PropTypes.number,
    friendlyName: PropTypes.string,
    friendlyNamePlural: PropTypes.string,
    currentPageCount: PropTypes.number,
    noOfItemsInPage: PropTypes.number,
};
