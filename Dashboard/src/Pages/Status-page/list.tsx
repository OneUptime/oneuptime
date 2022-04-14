import React from 'react';
import Page, {
    defaultMapDispatchToProps,
    defaultMapStateToProps,
} from '../base/index';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import Table from '../../components/table/Table';
import StatusPageActions from '../../actions/StatusPage';

const listActions = new StatusPageActions().getListActions();

interface StatusPagesProps { }

class StatusPages extends Page<StatusPagesProps> {
    constructor(props: $TSFixMe) {
        super({
            pageName: 'StatusPages',
            friendlyPageName: 'Status Pages',
            pagePath: '/StatusPages',
            showTutorial: true,
            ...props,
        });
    }

    override componentDidMount() { }

    override render() {
        return this.renderCommon(
            <>
                <Table

                    id="StatusPage-table"
                    title="Status Page"
                    description="Status Pages helps your team and your customers to view real-time status and health of your monitors. Status Page helps improve transparency and trust in your organization and with your customers."
                    columns={[]}
                    isLoading={false}
                    items={[]}
                    noItemsMessage="No status pages in this project."
                    headerButtons={[
                        {
                            id: 'create-StatusPage-btn',
                            title: 'Create Status Page',
                            shortcutKey: 'N',
                            onClick: () => {
                                // open modal here.
                            },
                            visibleForOwner: true,
                            visibleForAdmin: true,
                            visibleForViewer: false,
                            visibleForMember: true,
                            visibleForAll: false,
                        },
                    ]}
                    onNextClicked={() => { }}
                    onPreviousClicked={() => { }}
                    totalItemsCount={0}
                    friendlyName="Status Page"
                    friendlyNamePlural="Status Pages"
                    noOfItemsInPage={10}
                    actionButtons={[
                        {
                            id: 'edit-StatusPage-btn',
                            title: 'Edit',
                            onClick: (id: $TSFixMe) => {
                                this.goToPageInProject(`/StatusPage/${id}`);
                            },
                            visibleForOwner: true,
                            visibleForAdmin: true,
                            visibleForViewer: false,
                            visibleForMember: true,
                            visibleForAll: false,
                        },
                        {
                            id: 'view-StatusPage-btn',
                            title: 'View Status Page',
                            onClick: (id: $TSFixMe) => {
                                this.goToPageInProject(`/StatusPage/${id}`);
                            },
                            visibleForOwner: true,
                            visibleForAdmin: true,
                            visibleForViewer: true,
                            visibleForMember: true,
                            visibleForAll: true,
                        },
                    ]}
                    onClickTableRow={(id: $TSFixMe) => this.goToPageInProject(`/StatusPage/${id}`)
                    }
                />
            </>
        );
    }
}

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            ...defaultMapDispatchToProps(),
            ...listActions,
        },
        dispatch
    );
};

function mapStateToProps(state: RootState) {
    return {
        ...defaultMapStateToProps(state),
    };
}


StatusPages.propTypes = {

    ...Page.defaultPropTypes,
};


StatusPages.displayName = 'StatusPages';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPages);
