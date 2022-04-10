import React, { Component } from 'react';
import PropTypes from 'prop-types';
import TableLoader from './TableLoader';
import NoItemsMessage from './NoItemsMessage';
import TableHeader from './TableHeader';
import TableFooter from './TableFooter';
import TableItems from './TableItems';
import TableColumns from './TableColumns';

interface TableProps {
    id?: string;
    title: string;
    description: string;
    columns: unknown[];
    isLoading: boolean // this contains props like [{name, id, onClick, itemPropertyKey, itemPropertyNullText, itemPropertyDescriptionKey, itemPropertyDescriptionNullText, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }];
    items: unknown[];
    displayNoItemsMessageWhenThereAreNoItems?: boolean;
    noItemsMessage?: string;
    headerButtons?: string // Message that should be displayed if there are no items,;
    onNextClicked?: Function // [{id, title, shortcutKey, onClick, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }];
    onPreviousClicked?: Function;
    nextButtonText?: string;
    previousButtonText?: string;
    forceDisableNextButton?: boolean;
    forceDisablePreviousButton?: boolean;
    totalItemsCount?: number;
    friendlyName?: string;
    friendlyNamePlural?: string;
    currentPageCount?: number;
    noOfItemsInPage?: number;
    actionButtons?: unknown[];
    onClickTableRow?: Function;
}

class Table extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
    }

    override render() {
        const {

            id,

            title,

            description,

            columns = [], // this contains props like [{name, id, onClick, itemPropertyKey, itemPropertyNullText, itemPropertyDescriptionKey, itemPropertyDescriptionNullText, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }]

            isLoading = false,

            items = [],

            displayNoItemsMessageWhenThereAreNoItems = true,

            noItemsMessage = 'No items in this table.', // Message that should be displayed if there are no items,

            headerButtons = [], // [{id, title, shortcutKey, onClick, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }]

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

            actionButtons = [],

            onClickTableRow,
        } = this.props;

        return (
            <div id={id} className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <TableHeader

                                title={title}
                                description={description}
                                headerButtons={headerButtons}
                            />
                            <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                                <table className="Table">

                                    <TableColumns columns={columns} />
                                    <TableItems

                                        items={items}
                                        columns={columns}
                                        actionButtons={actionButtons}
                                        onClickTableRow={onClickTableRow}
                                    />
                                </table>
                            </div>

                            <TableLoader isLoading={isLoading} />
                            {displayNoItemsMessageWhenThereAreNoItems && (
                                <NoItemsMessage

                                    noItemsMessage={noItemsMessage}
                                    isLoading={isLoading}
                                    itemsCount={items ? items.length : 0}
                                />
                            )}
                            <TableFooter

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
