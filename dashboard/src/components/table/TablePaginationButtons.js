import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Button from '../basic/Button';

export default class TablePaginationButtons extends Component {
    constructor(props) {
        super(props);
    }

    render() {
        const {
            isLoading,
            onNextClicked,
            onPreviousClicked,
            nextButtonText,
            previousButtonText,
            forceDisableNextButton,
            forceDisablePreviousButton,
            currentPageCount,
            noOfItemsInPage = 10,
            totalItemsCount,
        } = this.props;

        return (
            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                    <div className="Box-root">
                        <Button
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
