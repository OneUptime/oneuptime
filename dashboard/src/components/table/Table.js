import React, { Component } from 'react';


import TableLoader from './TableLoader'
import NoItemsMessage from './NoItemsMessage';
import TableButton from './TableButton';
import TableHeader from './TableHeader';

class Table extends Component {

    constructor(props) {
        super(props);
    }

    render() {

        const {
            title,
            description,
            columns = [], // this contains props like [{name, id, onClick, itemPropertyKey visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }]
            isLoading = false,
            items = [],
            displayNoItemsMessageWhenThereAreNoItems = true,
            noItemsMessage = 'No items in this table.', // Message that should be displayed if there are no items,
            headerButtons = [], // [{id, title, shortcutKey, onClick, visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember }]
        } = this.props;



        return (
            <div className="Box-root">
               <TableHeader 
                    title={title}
                    description={description}
                    headerButtons={headerButtons}
               />
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                {columns && columns.map((column) => {
                                    return (<td>
                                        <div className="bs-ObjectList-cell Text-typeface--upper Text-fontWeight--medium">
                                            {column.name}
                                        </div>
                                    </td>)
                                })}

                                <ShouldRender if={!props.switchToProjectViewerNav}>
                                    <td>
                                        <div className="bs-ObjectList-cell Text-typeface--upper Text-fontWeight--medium">
                                            Monitors
                                        </div>
                                    </td>
                                </ShouldRender>

                                <td
                                    colSpan="6"
                                    style={{ float: 'right' }}
                                    className="status-page-btn-action-col"
                                >
                                    <div
                                        className="bs-ObjectList-cell table-row-cell Text-typeface--upper Text-fontWeight--medium"
                                        style={{
                                            paddingLeft: '124px',
                                            paddingRight: '24px',
                                        }}
                                    >
                                        Actions
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody id="statusPagesListContainer">
                            {statusPages.map((o, i) => {
                                return (
                                    <StatusPage
                                        projectId={props.currentProjectId}
                                        switchStatusPages={props.switchStatusPages}
                                        key={i}
                                        statusPage={o}
                                        project={props.project}
                                        switchToProjectViewerNav={
                                            props.switchToProjectViewerNav
                                        }
                                    />
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <TableLoader isLoading={isLoading}/>
                {displayNoItemsMessageWhenThereAreNoItems && <NoItemsMessage noItemsMessage={noItemsMessage} isLoading={isLoading} itemsCount={items ? items.length : 0} />}
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <ShouldRender
                                        if={
                                            props.subProjectStatusPage &&
                                            props.subProjectStatusPage.count
                                        }
                                    >
                                        Page {props.pages} of {numberOfPages} (
                                        <span
                                            id={`status_page_count_${props.subProjectName}`}
                                        >
                                            {props.subProjectStatusPage.count}
                                        </span>{' '}
                                        Status Page
                                        <ShouldRender
                                            if={
                                                props.subProjectStatusPage.count > 1 //E.g 2 Logs
                                            }
                                        >
                                            s
                                        </ShouldRender>
                                        )
                                    </ShouldRender>
                                    <ShouldRender
                                        if={
                                            props.subProjectStatusPage &&
                                            props.subProjectStatusPage.count === 0
                                        }
                                    >
                                        <span
                                            id={`status_page_count_${props.subProjectName}`}
                                        >
                                            0 Status Page
                                        </span>
                                    </ShouldRender>
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div
                                className="Box-root Margin-right--8"
                                id={`btnPrev-${props.subProjectName}`}
                            >
                                {' '}
                                {/** Needed to identify sub-project */}
                                <button
                                    id="btnPrev"
                                    className={`Button bs-ButtonLegacy ${!props.canPaginateBackward
                                        ? 'Is--disabled'
                                        : ''
                                        }`}
                                    data-db-analytics-name="list_view.pagination.previous"
                                    disabled={!props.canPaginateBackward}
                                    type="button"
                                    onClick={() =>
                                        props.prevClicked(
                                            props.subProjectStatusPage._id,
                                            props.skip,
                                            props.limit
                                        )
                                    }
                                >
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                            <span>Previous</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                            <div
                                className="Box-root"
                                id={`btnNext-${props.subProjectName}`}
                            >
                                {' '}
                                {/** Needed to identify sub-project */}
                                <button
                                    id="btnNext"
                                    className={`Button bs-ButtonLegacy ${!props.canPaginateForward
                                        ? 'Is--disabled'
                                        : ''
                                        }`}
                                    data-db-analytics-name="list_view.pagination.next"
                                    disabled={!props.canPaginateForward}
                                    type="button"
                                    onClick={() =>
                                        props.nextClicked(
                                            props.subProjectStatusPage._id,
                                            props.skip,
                                            props.limit
                                        )
                                    }
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
            </div>
        );
    }
}


Themes.propTypes = {
    statusPage: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    data: PropTypes.object.isRequired,
    updateTheme: PropTypes.func.isRequired,
    initialValues: PropTypes.shape({ theme: PropTypes.string }),
};

export default Table;