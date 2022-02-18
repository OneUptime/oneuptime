import Page, {
    defaultMapDispatchToProps,
    defaultMapStateToProps,
} from './base/index';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Table from '../components/basic/table';
import StatusPageActions from '../actions/Application';

class StatusPages extends Page {
    constructor(props) {
        super({
            pageName: 'StatusPages',
            friendlyPageName: 'Status Pages',
            pagePath: '/status-pages',
            showTutorial: true,
            ...props,
        });
    }

    componentDidMount() {}

    render() {
        const {
            location: { pathname },
        } = this.props;

        return this.renderCommon(
            <>
                <Table
                    id="status-page-table"
                    title="Status Page"
                    description="Status Pages helps your team and your customers to view real-time status and health of your monitors. Status Page helps improve transparency and trust in your organization and with your customers."
                    columns={[]}
                    isLoading={false}
                    items={[]}
                    noItemsMessage="No status pages in this project."
                    headerButtons={[
                        {
                            id: 'create-status-page-btn',
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
                    onNextClicked={() => {}}
                    onPreviousClicked={() => {}}
                    totalItemsCount={0}
                    friendlyName="Status Page"
                    friendlyNamePlural="Status Pages"
                    noOfItemsInPage={10}
                    actionButtons={[{
                        id: 'edit-status-page-btn',
                        title: 'Edit',
                        onClick: (id) => {
                            this.goToPageInProject(`/status-page/${id}`)
                        },
                        visibleForOwner: true,
                        visibleForAdmin: true,
                        visibleForViewer: false,
                        visibleForMember: true,
                        visibleForAll: false,
                    },{
                        id: 'view-status-page-btn',
                        title: 'View Status Page',
                        onClick: (id) => {
                            this.goToPageInProject(`/status-page/${id}`)
                        },
                        visibleForOwner: true,
                        visibleForAdmin: true,
                        visibleForViewer: true,
                        visibleForMember: true,
                        visibleForAll: true,
                    }]}
                    onClickTableRow={id =>
                        this.goToPageInProject(`/status-page/${id}`)
                    }
                />
            </>
        );
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            ...defaultMapDispatchToProps(),
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        ...defaultMapStateToProps(state),
    };
}

StatusPages.propTypes = {
    ...Page.defaultPropTypes,
};

StatusPages.displayName = 'StatusPages';

export default connect(mapStateToProps, mapDispatchToProps)(StatusPages);
