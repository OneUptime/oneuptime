import React, { Component } from 'react';
import PropTypes from 'prop-types';
import TableLoader from './TableLoader';
import NoItemsMessage from './NoItemsMessage';
import TableHeader from './TableHeader';
import TableFooter from './TableFooter';
import TableItems from './TableItems';
import TableColumns from './TableColumns';

class Table extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'id' does not exist on type 'Readonly<{}>... Remove this comment to see the full error message
            id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type 'Readonly<... Remove this comment to see the full error message
            title,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'description' does not exist on type 'Rea... Remove this comment to see the full error message
            description,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'columns' does not exist on type 'Readonl... Remove this comment to see the full error message
            columns = [], // this contains props like [{name, id, onClick, itemPropertyKey, itemPropertyNullText, itemPropertyDescriptionKey, itemPropertyDescriptionNullText, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }]
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isLoading' does not exist on type 'Reado... Remove this comment to see the full error message
            isLoading = false,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'items' does not exist on type 'Readonly<... Remove this comment to see the full error message
            items = [],
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayNoItemsMessageWhenThereAreNoItems... Remove this comment to see the full error message
            displayNoItemsMessageWhenThereAreNoItems = true,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noItemsMessage' does not exist on type '... Remove this comment to see the full error message
            noItemsMessage = 'No items in this table.', // Message that should be displayed if there are no items,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'headerButtons' does not exist on type 'R... Remove this comment to see the full error message
            headerButtons = [], // [{id, title, shortcutKey, onClick, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }]
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'actionButtons' does not exist on type 'R... Remove this comment to see the full error message
            actionButtons = [],
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'onClickTableRow' does not exist on type ... Remove this comment to see the full error message
            onClickTableRow,
        } = this.props;

        return (
            <div id={id} className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <TableHeader
                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ title: any; description: any; headerButton... Remove this comment to see the full error message
                                title={title}
                                description={description}
                                headerButtons={headerButtons}
                            />
                            <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                                <table className="Table">
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ columns: any; }' is not assignable to type... Remove this comment to see the full error message
                                    <TableColumns columns={columns} />
                                    <TableItems
                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ items: any; columns: any; actionButtons: a... Remove this comment to see the full error message
                                        items={items}
                                        columns={columns}
                                        actionButtons={actionButtons}
                                        onClickTableRow={onClickTableRow}
                                    />
                                </table>
                            </div>
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ isLoading: any; }' is not assignable to ty... Remove this comment to see the full error message
                            <TableLoader isLoading={isLoading} />
                            {displayNoItemsMessageWhenThereAreNoItems && (
                                <NoItemsMessage
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ noItemsMessage: any; isLoading: any; items... Remove this comment to see the full error message
                                    noItemsMessage={noItemsMessage}
                                    isLoading={isLoading}
                                    itemsCount={items ? items.length : 0}
                                />
                            )}
                            <TableFooter
                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ onNextClicked: any; onPreviousClicked: any... Remove this comment to see the full error message
                                onNextClicked={onNextClicked}
                                onPreviousClicked={onPreviousClicked}
                                nextButtonText={nextButtonText}
                                previousButtonText={previousButtonText}
                                forceDisableNextButton={forceDisableNextButton}
                                forceDisablePreviousButton={
                                    forceDisablePreviousButton
                                }
                                totalItemsCount={totalItemsCount}
                                friendlyName={friendlyName}
                                friendlyNamePlural={friendlyNamePlural}
                                currentPageCount={currentPageCount}
                                noOfItemsInPage={noOfItemsInPage}
                                isLoading={isLoading}
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Table.propTypes = {
    id: PropTypes.string,
    title: PropTypes.string.isRequired,
    description: PropTypes.string.isRequired,
    columns: PropTypes.array.isRequired, // this contains props like [{name, id, onClick, itemPropertyKey, itemPropertyNullText, itemPropertyDescriptionKey, itemPropertyDescriptionNullText, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }]
    isLoading: PropTypes.bool.isRequired,
    items: PropTypes.array.isRequired,
    displayNoItemsMessageWhenThereAreNoItems: PropTypes.bool,
    noItemsMessage: PropTypes.string, // Message that should be displayed if there are no items,
    headerButtons: PropTypes.string, // [{id, title, shortcutKey, onClick, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }]
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
    actionButtons: PropTypes.array,
    onClickTableRow: PropTypes.func,
};

export default Table;
