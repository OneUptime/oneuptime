import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { ListLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from '../../actions/modal';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { logEvent } from '../../analytics';
import { fetchProjectDomains } from '../../actions/project';
import CreateDomain from './CreateDomain';
import EditDomain from './EditDomain';
import DeleteDomain from './DeleteDomain';
import VerifyDomain from './VerifyDomain';

class Domains extends Component {
    constructor() {
        super();
        this.limit = 10;
    }

    componentDidMount() {
        const { fetchProjectDomains, currentProject } = this.props;
        if (currentProject) {
            const projectId = currentProject._id;
            fetchProjectDomains(projectId, 0, this.limit);
        }

        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT SETTINGS > DOMAINS > DOMAIN SETTINGS'
            );
        }
    }

    componentDidUpdate(prevProps) {
        if (
            JSON.stringify(prevProps.currentProject) !==
            JSON.stringify(this.props.currentProject)
        ) {
            this.props.fetchProjectDomains(
                this.props.currentProject._id,
                0,
                this.limit
            );
        }
    }

    prevClicked = (projectId, skip) => {
        const { fetchProjectDomains } = this.props;
        fetchProjectDomains(
            projectId,
            skip ? Number(skip) - this.limit : this.limit,
            this.limit
        );
    };

    nextClicked = (projectId, skip) => {
        const { fetchProjectDomains } = this.props;
        fetchProjectDomains(
            projectId,
            skip ? Number(skip) + this.limit : this.limit,
            this.limit
        );
    };

    render() {
        const {
            limit,
            count,
            skip,
            openModal,
            currentProject,
            projectDomains,
            error,
            requesting,
        } = this.props;
        const footerBorderTopStyle = { margin: 0, padding: 0 };

        const canNext = count > Number(skip) + Number(limit) ? true : false;
        const canPrev = Number(skip) <= 0 ? false : true;
        const projectName = currentProject ? currentProject.name : '';

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Domain Settings</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Setup domains for {projectName} project that
                                    can be used as custom domains on status page
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <button
                                    id="addCustomField"
                                    onClick={() => {
                                        this.props.openModal({
                                            id: currentProject._id,
                                            content: CreateDomain,
                                        });
                                    }}
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    type="button"
                                >
                                    <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <div className="Box-root Margin-right--8">
                                            <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                        </div>
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                            <span>Add Domains</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection-content Box-root">
                    <div className="bs-ObjectList db-UserList">
                        <div
                            style={{
                                overflow: 'hidden',
                                overflowX: 'auto',
                            }}
                        >
                            <div
                                id="scheduledEventsList"
                                className="bs-ObjectList-rows"
                            >
                                <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                    <div className="bs-ObjectList-cell">
                                        Domain
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
                                {projectDomains.length > 0 &&
                                    projectDomains.map((eachDomain, index) => (
                                        <div
                                            key={eachDomain._id}
                                            className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                            style={{
                                                backgroundColor: 'white',
                                                cursor: 'pointer',
                                            }}
                                            id={`projectdomain_${index}`}
                                        >
                                            {eachDomain.verified ? (
                                                <div
                                                    className="bs-ObjectList-cell bs-u-v-middle"
                                                    style={{
                                                        display: 'flex',
                                                        width: '10vw',
                                                        whiteSpace: 'normal',
                                                    }}
                                                >
                                                    <div className="bs-ObjectList-cell-row">
                                                        {eachDomain.domain}
                                                    </div>
                                                    <div
                                                        style={{
                                                            marginLeft: 5,
                                                        }}
                                                        className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                    >
                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span>
                                                                Verified
                                                            </span>
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
                                                        {eachDomain.domain}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <div className="Box-root Flex-flex Flex-justifyContent--flexEnd">
                                                    {!eachDomain.verified && (
                                                        <button
                                                            id={`verifyProjectDomain_${index}`}
                                                            title="edit"
                                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                                            style={{
                                                                marginLeft: 20,
                                                            }}
                                                            type="button"
                                                            onClick={() => {
                                                                openModal({
                                                                    id:
                                                                        eachDomain._id,
                                                                    content: VerifyDomain,
                                                                    projectId:
                                                                        currentProject._id,
                                                                    verificationToken:
                                                                        eachDomain.verificationToken,
                                                                    domain:
                                                                        eachDomain.domain,
                                                                });
                                                            }}
                                                        >
                                                            <span>Verify</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        id={`editProjectDomain_${index}`}
                                                        title="edit"
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                                        style={{
                                                            marginLeft: 20,
                                                        }}
                                                        type="button"
                                                        onClick={() => {
                                                            openModal({
                                                                id:
                                                                    eachDomain._id,
                                                                content: EditDomain,
                                                                domain:
                                                                    eachDomain.domain,
                                                                projectId:
                                                                    currentProject._id,
                                                            });
                                                        }}
                                                    >
                                                        <span>Edit</span>
                                                    </button>
                                                    <button
                                                        id={`deleteProjectDomain_${index}`}
                                                        title="delete"
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                                        style={{
                                                            marginLeft: 20,
                                                        }}
                                                        type="button"
                                                        onClick={() => {
                                                            openModal({
                                                                id:
                                                                    eachDomain._id,
                                                                projectId:
                                                                    currentProject._id,
                                                                content: DeleteDomain,
                                                            });
                                                        }}
                                                    >
                                                        <span>Delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                <ShouldRender
                                    if={
                                        !(
                                            (!projectDomains ||
                                                projectDomains.length === 0) &&
                                            !requesting &&
                                            !error
                                        )
                                    }
                                >
                                    <div style={footerBorderTopStyle}></div>
                                </ShouldRender>
                            </div>
                        </div>
                        <ShouldRender if={requesting}>
                            <ListLoader />
                        </ShouldRender>
                        <ShouldRender
                            if={
                                (!projectDomains ||
                                    projectDomains.length === 0) &&
                                !requesting &&
                                !error
                            }
                        >
                            <div
                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                style={{
                                    textAlign: 'center',
                                    backgroundColor: 'white',
                                    padding: '20px 10px 0',
                                }}
                                id="noprojectDomains"
                            >
                                <span>
                                    {(!projectDomains ||
                                        projectDomains.length === 0) &&
                                    !requesting &&
                                    !error
                                        ? 'You have no domain at this time'
                                        : null}
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
                                            id="customFieldCount"
                                            className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                        >
                                            {this.props.count
                                                ? this.props.count +
                                                  (this.props.count > 1
                                                      ? '  Domains'
                                                      : ' Domain')
                                                : '0 Domain'}
                                        </span>
                                    </span>
                                </span>
                            </div>
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnPrevProjectDomains"
                                            onClick={() =>
                                                this.prevClicked(
                                                    currentProject._id,
                                                    skip
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
                                            id="btnNextProjectDomains"
                                            onClick={() =>
                                                this.nextClicked(
                                                    currentProject._id,
                                                    skip
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
            </div>
        );
    }
}

Domains.displayName = 'Domains';

Domains.propTypes = {
    currentProject: PropTypes.object,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    requesting: PropTypes.bool,
    projectDomains: PropTypes.array,
    count: PropTypes.number,
    limit: PropTypes.number,
    skip: PropTypes.number,
    openModal: PropTypes.func.isRequired,
    fetchProjectDomains: PropTypes.func.isRequired,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            fetchProjectDomains,
        },
        dispatch
    );

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
        projectDomains: state.project.fetchDomains.domains,
        requesting: state.project.fetchDomains.requesting,
        error: state.project.fetchDomains.error,
        count: state.project.fetchDomains.count,
        limit: state.project.fetchDomains.limit,
        skip: state.project.fetchDomains.skip,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(withRouter(Domains));
