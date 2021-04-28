import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { fetchProjectDomains } from '../../actions/project';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { openModal } from '../../actions/modal';
import DeleteDomain from './DeleteDomain';
import DataPathHoC from '../DataPathHoC';
import uuid from 'uuid';
import { ListLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import ProjectVerifyDomain from './ProjectVerifyDomain';
import ProjectUnverifyDomain from './ProjectUnverifyDomain';
import ProjectResetDomain from './ProjectResetDomain';

class ProjectDomain extends Component {
    constructor() {
        super();
        this.limit = 10;
        this.state = {
            removeUserModalId: uuid.v4(),
        };
    }

    componentDidMount() {
        const projectId = this.props.projectId;
        if (projectId) {
            this.props.fetchProjectDomains(this.props.projectId, 0, this.limit);
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
            projectDomain: { domains },
            projectId,
            openModal,
            limit,
            skip,
            count,
            error,
            requesting,
        } = this.props;
        const footerBorderTopStyle = { margin: 0, padding: 0 };

        const canNext = count > Number(skip) + Number(limit) ? true : false;
        const canPrev = Number(skip) <= 0 ? false : true;

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Domain Settings</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>List of domains in this project</span>
                            </span>
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
                                {domains.length > 0 &&
                                    domains.map((eachDomain, index) => (
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
                                                        className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                    >
                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span>
                                                                Unverified
                                                            </span>
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <div className="Box-root Flex-flex Flex-justifyContent--flexEnd">
                                                    {!eachDomain.verified && (
                                                        <button
                                                            id={`verifyProjectDomain_${index}`}
                                                            title="verify"
                                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                                            style={{
                                                                marginLeft: 20,
                                                            }}
                                                            type="button"
                                                            onClick={() => {
                                                                openModal({
                                                                    id:
                                                                        eachDomain._id,
                                                                    content: ProjectVerifyDomain,
                                                                    projectId,
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
                                                    {eachDomain.verified && (
                                                        <button
                                                            id={`unVerifyProjectDomain_${index}`}
                                                            title="unverify"
                                                            className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--edit"
                                                            style={{
                                                                marginLeft: 20,
                                                            }}
                                                            type="button"
                                                            onClick={() => {
                                                                openModal({
                                                                    id:
                                                                        eachDomain._id,
                                                                    content: ProjectUnverifyDomain,
                                                                    projectId,
                                                                    verificationToken:
                                                                        eachDomain.verificationToken,
                                                                    domain:
                                                                        eachDomain.domain,
                                                                });
                                                            }}
                                                        >
                                                            <span>
                                                                Unverify
                                                            </span>
                                                        </button>
                                                    )}
                                                    <button
                                                        id={`unVerifyProjectDomain_${index}`}
                                                        title="reset"
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings"
                                                        style={{
                                                            marginLeft: 20,
                                                        }}
                                                        type="button"
                                                        onClick={() => {
                                                            openModal({
                                                                id:
                                                                    eachDomain._id,
                                                                content: ProjectResetDomain,
                                                                projectId,
                                                                verificationToken:
                                                                    eachDomain.verificationToken,
                                                                domain:
                                                                    eachDomain.domain,
                                                            });
                                                        }}
                                                    >
                                                        <span>Reset</span>
                                                    </button>
                                                    <button
                                                        id={`deleteProjectDomain_${index}`}
                                                        title="remove"
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete"
                                                        style={{
                                                            marginLeft: 20,
                                                        }}
                                                        type="button"
                                                        onClick={() => {
                                                            openModal({
                                                                content: DataPathHoC(
                                                                    DeleteDomain,
                                                                    {
                                                                        removeUserModalId: this
                                                                            .state
                                                                            .removeUserModalId,
                                                                        domainId:
                                                                            eachDomain._id,
                                                                        projectId,
                                                                    }
                                                                ),
                                                            });
                                                        }}
                                                    >
                                                        <span>Remove</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                <ShouldRender
                                    if={
                                        !(
                                            (!domains ||
                                                domains.length === 0) &&
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
                                (!domains || domains.length === 0) &&
                                !requesting &&
                                !error
                            }
                        >
                            <div
                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                style={{
                                    textAlign: 'center',
                                    backgroundColor: 'white',
                                    padding: '15px 0 15px 0',
                                }}
                                id="noprojectDomain"
                            >
                                <span>
                                    {(!domains || domains.length === 0) &&
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
                                                    projectId,
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
                                                    projectId,
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

ProjectDomain.displayName = 'ProjectDomain';

const mapStateToProps = state => ({
    projectDomain: state.project.projectDomain,
    requesting: state.project.projectDomain.requesting,
    error: state.project.projectDomain.error,
    count: state.project.projectDomain.count,
    limit: state.project.projectDomain.limit,
    skip: state.project.projectDomain.skip,
});

ProjectDomain.propTypes = {
    projectId: PropTypes.string,
    fetchProjectDomains: PropTypes.func,
    openModal: PropTypes.func,
    projectDomain: PropTypes.object,
    count: PropTypes.number,
    limit: PropTypes.number,
    skip: PropTypes.number,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    requesting: PropTypes.bool,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ fetchProjectDomains, openModal }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(ProjectDomain);
