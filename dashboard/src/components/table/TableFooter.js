import React, { Component } from 'react';
import Button from '../basic/Button';
import TablePaginationButtons from './TablePaginationButtons';

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
            isLoading
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
        )
    }
}
