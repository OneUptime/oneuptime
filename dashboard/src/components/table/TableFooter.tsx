import React, { Component } from 'react';
import TablePaginationButtons from './TablePaginationButtons';
import TablePaginationCount from './TablePaginationCount';
import PropTypes from 'prop-types';

export default class TableFooter extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'onNextClicked' does not exist on type 'R... Remove this comment to see the full error message
            onNextClicked,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'onPreviousClicked' does not exist on typ... Remove this comment to see the full error message
            onPreviousClicked,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextButtonText' does not exist on type '... Remove this comment to see the full error message
            nextButtonText,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'previousButtonText' does not exist on ty... Remove this comment to see the full error message
            previousButtonText,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'forceDisableNextButton' does not exist o... Remove this comment to see the full error message
            forceDisableNextButton,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'forceDisablePreviousButton' does not exi... Remove this comment to see the full error message
            forceDisablePreviousButton,
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
            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                <TablePaginationCount
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ totalItemsCount: any; friendlyName: any; f... Remove this comment to see the full error message
                    totalItemsCount={totalItemsCount}
                    friendlyName={friendlyName}
                    friendlyNamePlural={friendlyNamePlural}
                    currentPageCount={currentPageCount}
                    noOfItemsInPage={noOfItemsInPage}
                    isLoading={isLoading}
                />
                <TablePaginationButtons
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ onNextClicked: any; onPreviousClicked: any... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
