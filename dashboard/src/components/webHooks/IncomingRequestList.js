import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import {
    fetchAllIncomingRequest,
    setActiveIncomingRequest,
} from '../../actions/incomingRequest';
import { openModal } from '../../actions/modal';
import EditIncomingRequest from '../modals/EditIncomingRequest';
import DeleteIncomingRequest from '../modals/DeleteIncomingRequest';
import copyToClipboard from '../../utils/copyToClipboard';
import { fetchIncidentPriorities } from '../../actions/incidentPriorities';
import { fetchBasicIncidentSettings } from '../../actions/incidentBasicsSettings';

class IncomingRequestList extends React.Component {
    state = {
        copied: false,
    };

    handleCopyToClipboard = (requestId, text) => {
        const { setActiveIncomingRequest } = this.props;
        setActiveIncomingRequest(requestId);

        copyToClipboard(text);

        this.setState({ copied: true });
        // reset it after 0.5 secs
        setTimeout(() => this.setState({ copied: false }), 500);
    };

    ready() {
        const {
            fetchAllIncomingRequest,
            fetchIncidentPriorities,
            fetchBasicIncidentSettings,
        } = this.props;
        const { projectId } = this.props;

        fetchAllIncomingRequest(projectId, 0, 10);
        fetchIncidentPriorities(projectId, 0, 0);
        fetchBasicIncidentSettings(projectId);

        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > INCOMING REQUEST');
        }
    }

    componentDidMount() {
        this.ready();
    }

    componentDidUpdate(prevProps) {
        if (String(prevProps.projectId) !== String(this.props.projectId)) {
            this.props.fetchAllIncomingRequest(this.props.projectId, 0, 10);
        }
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'ArrowRight':
                return this.nextClicked();
            case 'ArrowLeft':
                return this.prevClicked();
            default:
                return false;
        }
    };

    prevClicked = (projectId, skip, limit) => {
        const { fetchAllIncomingRequest } = this.props;

        fetchAllIncomingRequest(
            projectId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            limit
        );
    };

    nextClicked = (projectId, skip, limit) => {
        const { fetchAllIncomingRequest } = this.props;

        fetchAllIncomingRequest(projectId, skip + limit, limit);
    };

    handleIncomingRequests = () => {
        const { projectId, openModal, incomingRequestList } = this.props;

        return (
            incomingRequestList &&
            incomingRequestList.length > 0 &&
            incomingRequestList.map((incomingRequest, index) => {
                return (
                    <div
                        key={incomingRequest._id}
                        className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                        style={{
                            backgroundColor: 'white',
                            cursor: 'pointer',
                        }}
                        id={`incomingRequest_${incomingRequest.name}`}
                    >
                        {incomingRequest.isDefault ? (
                            <div
                                className="bs-ObjectList-cell bs-u-v-middle"
                                style={{
                                    display: 'flex',
                                    width: '10vw',
                                    whiteSpace: 'normal',
                                }}
                            >
                                <div className="bs-ObjectList-cell-row">
                                    {incomingRequest.name}
                                </div>
                                <div
                                    style={{
                                        marginLeft: 5,
                                    }}
                                    className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                >
                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                        <span>Default</span>
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div
                                className="bs-ObjectList-cell bs-u-v-middle"
                                style={{
                                    display: 'flex',
                                    width: '15vw',
                                    whiteSpace: 'normal',
                                }}
                            >
                                <div className="bs-ObjectList-cell-row">
                                    {incomingRequest.name}
                                </div>
                            </div>
                        )}
                        <div
                            className="bs-ObjectList-cell bs-u-v-middle"
                            style={{ width: '40vw', whiteSpace: 'normal' }}
                        >
                            <div className="bs-ObjectList-cell-row">
                                {incomingRequest.url}
                            </div>
                        </div>
                        <div
                            className="bs-ObjectList-cell bs-u-v-middle"
                            style={{ width: '25vw', whiteSpace: 'normal' }}
                        >
                            <div
                                className="bs-ObjectList-cell-row"
                                style={{
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    marginRight: 15,
                                }}
                            >
                                <button
                                    id={`editIncomingRequestBtn_${index}`}
                                    title="edit"
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--clipboard"
                                    style={{
                                        marginLeft: 20,
                                    }}
                                    type="button"
                                    onClick={() =>
                                        this.handleCopyToClipboard(
                                            incomingRequest._id,
                                            incomingRequest.url
                                        )
                                    }
                                    disabled={
                                        String(
                                            this.props.activeIncomingRequest
                                        ) === String(incomingRequest._id) &&
                                        this.state.copied
                                    }
                                >
                                    {String(
                                        this.props.activeIncomingRequest
                                    ) === String(incomingRequest._id) &&
                                    this.state.copied ? (
                                        <span>Copied!</span>
                                    ) : (
                                        <span>Copy Url</span>
                                    )}
                                </button>
                                <button
                                    id={`editIncomingRequestBtn_${index}`}
                                    title="edit"
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                    style={{
                                        marginLeft: 20,
                                    }}
                                    type="button"
                                    onClick={() => {
                                        openModal({
                                            id: projectId,
                                            content: EditIncomingRequest,
                                            incomingRequest,
                                            projectId,
                                        });
                                    }}
                                >
                                    <span>Edit</span>
                                </button>
                                <button
                                    id={`deleteIncomingRequestBtn_${index}`}
                                    title="delete"
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                    style={{
                                        marginLeft: 20,
                                    }}
                                    type="button"
                                    onClick={() => {
                                        openModal({
                                            id: projectId,
                                            content: DeleteIncomingRequest,
                                            projectId,
                                            requestId: incomingRequest._id,
                                        });
                                    }}
                                >
                                    <span>Delete</span>
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })
        );
    };

    render() {
        const {
            isRequesting,
            limit,
            count,
            skip,
            fetchError,
            incomingRequestList,
            projectId,
        } = this.props;
        const footerBorderTopStyle = { margin: 0, padding: 0 };

        const canNext = count > Number(skip) + Number(limit) ? true : false;
        const canPrev = Number(skip) <= 0 ? false : true;

        return (
            <div className="bs-ContentSection-content Box-root">
                <div className="bs-ObjectList db-UserList">
                    <div
                        style={{
                            overflow: 'hidden',
                            overflowX: 'auto',
                        }}
                    >
                        <div
                            id="incomingRequestList"
                            className="bs-ObjectList-rows"
                        >
                            <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                <div className="bs-ObjectList-cell">Name</div>
                                <div className="bs-ObjectList-cell">
                                    Incoming HTTP Request URL
                                </div>
                                <div
                                    className="bs-ObjectList-cell"
                                    style={{
                                        float: 'right',
                                        marginRight: '10px',
                                    }}
                                >
                                    Action
                                </div>
                            </header>
                            {this.handleIncomingRequests()}
                            <ShouldRender
                                if={
                                    !(
                                        (!incomingRequestList ||
                                            incomingRequestList.length === 0) &&
                                        !isRequesting &&
                                        !fetchError
                                    )
                                }
                            >
                                <div style={footerBorderTopStyle}></div>
                            </ShouldRender>
                        </div>
                    </div>
                    <ShouldRender if={isRequesting}>
                        <ListLoader />
                    </ShouldRender>
                    <ShouldRender
                        if={
                            (!incomingRequestList ||
                                incomingRequestList.length === 0) &&
                            !isRequesting &&
                            !fetchError
                        }
                    >
                        <div
                            className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                            style={{
                                textAlign: 'center',
                                backgroundColor: 'white',
                                padding: '20px 10px 0',
                            }}
                        >
                            <span>
                                {(!incomingRequestList ||
                                    incomingRequestList.length === 0) &&
                                !isRequesting &&
                                !fetchError
                                    ? 'You have no incoming request'
                                    : null}
                                {fetchError ? fetchError : null}
                            </span>
                        </div>
                    </ShouldRender>
                    <div
                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween"
                        style={{ backgroundColor: 'white' }}
                    >
                        <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    <span
                                        id="requestCount"
                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                    >
                                        {this.props.count +
                                            (this.props.count > 1
                                                ? '  Requests'
                                                : ' Request')}
                                    </span>
                                </span>
                            </span>
                        </div>
                        <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                <div className="Box-root Margin-right--8">
                                    <button
                                        id="btnPrevIncomingRequest"
                                        onClick={() =>
                                            this.prevClicked(
                                                projectId,
                                                skip,
                                                limit
                                            )
                                        }
                                        className={
                                            'Button bs-ButtonLegacy' +
                                            (canPrev ? '' : 'Is--disabled')
                                        }
                                        disabled={!canPrev}
                                        data-db-analytics-name="list_view.pagination.previous"
                                        type="button"
                                    >
                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                <span>Previous</span>
                                            </span>
                                        </div>
                                    </button>
                                </div>
                                <div className="Box-root">
                                    <button
                                        id="btnNextIncomingRequest"
                                        onClick={() =>
                                            this.nextClicked(
                                                projectId,
                                                skip,
                                                limit
                                            )
                                        }
                                        className={
                                            'Button bs-ButtonLegacy' +
                                            (canNext ? '' : 'Is--disabled')
                                        }
                                        disabled={!canNext}
                                        data-db-analytics-name="list_view.pagination.next"
                                        type="button"
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
            </div>
        );
    }
}

IncomingRequestList.displayName = 'IncomingRequestList';

const mapStateToProps = state => {
    let monitors = [];
    state.monitor.monitorsList.monitors.forEach(monitor => {
        monitors = [...monitors, ...monitor.monitors];
    });

    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        monitors,
        incomingRequestList:
            state.incomingRequest.incomingRequests.incomingRequests,
        count: state.incomingRequest.incomingRequests.count,
        skip: state.incomingRequest.incomingRequests.skip,
        limit: state.incomingRequest.incomingRequests.limit,
        isRequesting: state.incomingRequest.incomingRequests.requesting,
        fetchError: state.incomingRequest.incomingRequests.error,
        activeIncomingRequest: state.incomingRequest.activeIncomingRequest,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchAllIncomingRequest,
            openModal,
            setActiveIncomingRequest,
            fetchIncidentPriorities,
            fetchBasicIncidentSettings,
        },
        dispatch
    );

IncomingRequestList.propTypes = {
    projectId: PropTypes.string,
    isRequesting: PropTypes.bool,
    fetchAllIncomingRequest: PropTypes.func,
    setActiveIncomingRequest: PropTypes.func,
    openModal: PropTypes.func,
    incomingRequestList: PropTypes.array,
    count: PropTypes.number,
    skip: PropTypes.number,
    limit: PropTypes.number,
    fetchError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    activeIncomingRequest: PropTypes.string,
    fetchIncidentPriorities: PropTypes.func,
    fetchBasicIncidentSettings: PropTypes.func,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncomingRequestList);
