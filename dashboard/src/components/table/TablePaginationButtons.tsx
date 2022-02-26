import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Button from '../basic/Button';

export default class TablePaginationButtons extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isLoading' does not exist on type 'Reado... Remove this comment to see the full error message
            isLoading,
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentPageCount' does not exist on type... Remove this comment to see the full error message
            currentPageCount,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noOfItemsInPage' does not exist on type ... Remove this comment to see the full error message
            noOfItemsInPage = 10,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalItemsCount' does not exist on type ... Remove this comment to see the full error message
            totalItemsCount,
        } = this.props;

        return (
            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                    <div className="Box-root">
                        <Button
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ title: any; onClick: any; disable: any; }'... Remove this comment to see the full error message
                            title={
                                previousButtonText
                                    ? previousButtonText
                                    : 'Previous'
                            }
                            onClick={onPreviousClicked}
                            disable={
                                forceDisableNextButton ||
                                isLoading ||
                                currentPageCount <= 1
                            }
                        />
                    </div>
                    <div className="Box-root">
                        <Button
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ title: any; onClick: any; disable: any; }'... Remove this comment to see the full error message
                            title={nextButtonText ? nextButtonText : 'Next'}
                            onClick={onNextClicked}
                            disable={
                                forceDisablePreviousButton ||
                                isLoading ||
                                currentPageCount <
                                    Math.ceil(totalItemsCount / noOfItemsInPage)
                            }
                        />
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TablePaginationButtons.propTypes = {
    isLoading: PropTypes.bool.isRequired,
    onNextClicked: PropTypes.func,
    onPreviousClicked: PropTypes.func,
    nextButtonText: PropTypes.string,
    previousButtonText: PropTypes.string,
    forceDisableNextButton: PropTypes.bool,
    forceDisablePreviousButton: PropTypes.bool,
    totalItemsCount: PropTypes.number,
    currentPageCount: PropTypes.number,
    noOfItemsInPage: PropTypes.number,
};
