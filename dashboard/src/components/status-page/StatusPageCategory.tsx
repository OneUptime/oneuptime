import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import ShouldRender from '../basic/ShouldRender';
import { fetchStatusPageCategories } from '../../actions/statusPageCategory';
import CreateStatusPageCategory from '../modals/CreateStatusPageCategory';
import RemoveStatusPageCategory from '../modals/RemoveStatusPageCategory';
import EditStatusPageCategory from '../modals/EditStatusPageCategory';
import { openModal } from '../../actions/modal';
import DataPathHoC from '../DataPathHoC';

export class StatusPageCategory extends Component {
    handleKeyboard: $TSFixMe;
    state = {
        page: 1,
    };

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
        const {

            fetchStatusPageCategories,

            projectId,

            skip,

            statusPageId,
        } = this.props;
        fetchStatusPageCategories({ projectId, skip, limit: 10, statusPageId });
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    prevClicked = () => {
        const {

            fetchStatusPageCategories,

            projectId,

            skip,

            statusPageId,
        } = this.props;
        fetchStatusPageCategories({
            projectId,
            skip: skip ? parseInt(skip, 10) - 10 : 10,
            limit: 10,
            statusPageId,
        });
        this.setState({
            page: this.state.page === 1 ? 1 : this.state.page - 1,
        });
    };

    nextClicked = () => {
        const {

            fetchStatusPageCategories,

            projectId,

            skip,

            statusPageId,
        } = this.props;
        fetchStatusPageCategories({
            projectId,
            skip: skip ? parseInt(skip, 10) + 10 : 10,
            limit: 10,
            statusPageId,
        });
        this.setState({ page: this.state.page + 1 });
    };

    handleCreateResourceCategory = (projectId: $TSFixMe, statusPageId: $TSFixMe) => {

        const { openModal } = this.props;
        openModal({
            content: DataPathHoC(CreateStatusPageCategory, {
                projectId,
                statusPageId,
            }),
        });
    };

    handleEdit = ({
        projectId,
        statusPageCategoryName,
        statusPageCategoryId
    }: $TSFixMe) => {

        const { openModal } = this.props;
        openModal({
            content: DataPathHoC(EditStatusPageCategory, {
                projectId,
                statusPageCategoryName,
                statusPageCategoryId,
            }),
        });
    };

    handleDelete = ({
        projectId,
        statusPageCategoryId
    }: $TSFixMe) => {

        const { openModal, statusPageId } = this.props;
        openModal({
            content: DataPathHoC(RemoveStatusPageCategory, {
                projectId,
                statusPageCategoryId,
                statusPageId,
            }),
        });
    };

    render() {
        const footerBorderTopStyle = { margin: 0, padding: 0 };
        let canNext =

            this.props.count >

                parseInt(this.props.skip) + parseInt(this.props.limit)
                ? true
                : false;

        let canPrev = parseInt(this.props.skip) <= 0 ? false : true;
        const {

            isRequesting,

            error,

            statusPageCategories,

            projectId,

            statusPageId,
        } = this.props;

        if (isRequesting || !statusPageCategories) {
            canNext = false;
            canPrev = false;
        }

        const numberOfPages = Math.ceil(parseInt(this.props.count) / 10);

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Status Page Categories</span>
                                </span>
                                <p>
                                    <span>
                                        {
                                            'Status Page Categories lets you group resources by categories on Status Page.'
                                        }
                                    </span>
                                </p>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div className="Box-root">
                                    <button
                                        onClick={() => {
                                            this.handleCreateResourceCategory(
                                                projectId,
                                                statusPageId
                                            );
                                        }}
                                        className="Button bs-ButtonLegacy ActionIconParent"
                                        type="button"
                                    >
                                        <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                            <div className="Box-root Margin-right--8">
                                                <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                            </div>
                                            <span
                                                id="createResourceCategoryButton"
                                                className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                            >
                                                <span>
                                                    Create Status Page Category
                                                </span>
                                            </span>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div
                            id="resourceCategoryList"
                            className="bs-ContentSection-content Box-root"
                        >
                            <div className="bs-ObjectList db-UserList">
                                <div
                                    style={{
                                        overflow: 'hidden',
                                        overflowX: 'auto',
                                    }}
                                >
                                    <div className="bs-ObjectList-rows">
                                        <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                            <div className="bs-ObjectList-cell">
                                                Status Page Category
                                            </div>
                                            <div className="bs-ObjectList-cell">
                                                Created
                                            </div>
                                            <div
                                                className="bs-ObjectList-cell"
                                                style={{
                                                    float: 'right',
                                                    paddingRight: '29px',
                                                }}
                                            >
                                                Action
                                            </div>
                                        </header>
                                        {statusPageCategories.map(
                                            ({
                                                createdAt,
                                                name,
                                                _id
                                            }: $TSFixMe) => (
                                                <div
                                                    key={_id}
                                                    className="bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                                >
                                                    <div className="bs-ObjectList-cell bs-u-v-middle">
                                                        <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">

                                                            {this.props.name}
                                                        </div>
                                                        <div
                                                            id="resource-category-name"
                                                            className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted"
                                                        >
                                                            {name}
                                                        </div>
                                                    </div>
                                                    <div className="bs-ObjectList-cell bs-u-v-middle">
                                                        <div className="bs-ObjectList-cell-row">
                                                            {moment(
                                                                createdAt
                                                            ).fromNow()}
                                                        </div>
                                                    </div>
                                                    <div className="bs-ObjectList-cell bs-u-v-middle">
                                                        <div
                                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                            style={{
                                                                float: 'right',
                                                                paddingRight:
                                                                    '8px',
                                                            }}
                                                        >
                                                            <div className="Box-root">
                                                                <button
                                                                    onClick={() => {
                                                                        this.handleEdit(
                                                                            {
                                                                                projectId,
                                                                                statusPageCategoryId: _id,
                                                                                statusPageCategoryName: name,
                                                                            }
                                                                        );
                                                                    }}
                                                                    className="Button bs-ButtonLegacy"
                                                                    type="button"
                                                                    id={`edit_${name}`}
                                                                >
                                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                            <span>
                                                                                Edit
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                            </div>
                                                            <div
                                                                className="Box-root Margin-left--8"
                                                                id="deleteResourceCategoryBtn"
                                                            >
                                                                <button
                                                                    onClick={() => {
                                                                        this.handleDelete(
                                                                            {
                                                                                projectId,
                                                                                statusPageCategoryId: _id,
                                                                            }
                                                                        );
                                                                    }}
                                                                    className="Button bs-ButtonLegacy"
                                                                    type="button"
                                                                    id={`delete_${name}`}
                                                                >
                                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                            <span>
                                                                                Delete
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        )}
                                        <ShouldRender
                                            if={
                                                !(
                                                    (!statusPageCategories ||
                                                        statusPageCategories.length ===
                                                        0) &&
                                                    !isRequesting &&
                                                    !error
                                                )
                                            }
                                        >
                                            <div
                                                style={footerBorderTopStyle}
                                            ></div>
                                        </ShouldRender>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <ShouldRender
                            if={
                                (!statusPageCategories ||
                                    statusPageCategories.length === 0) &&
                                !isRequesting &&
                                !error
                            }
                        >
                            <div
                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                style={{
                                    textAlign: 'center',
                                    marginTop: '20px',
                                    padding: '0 10px',
                                }}
                            >
                                {(!statusPageCategories ||
                                    statusPageCategories.length === 0) &&
                                    !isRequesting &&
                                    !error
                                    ? 'You have no status page category at this time'
                                    : null}
                                {error ? error : null}
                            </div>
                        </ShouldRender>
                        <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                            <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        <span
                                            id="resourceCategoryCount"
                                            className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                        >
                                            {numberOfPages > 0
                                                ? `Page ${this.state.page
                                                } of ${numberOfPages} (${this.props.count
                                                } Status Page Categor${this.props.count < 2 // This will cater for '0 Category'
                                                    ? 'y'
                                                    : 'ies'
                                                })`
                                                : `${this.props.count
                                                } Status Page Categor${this.props.count < 2 // This will cater for '0 Category'
                                                    ? 'y'
                                                    : 'ies'
                                                }`}
                                        </span>
                                    </span>
                                </span>
                            </div>
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            onClick={() => this.prevClicked()}
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
                                            onClick={() => this.nextClicked()}
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


StatusPageCategory.displayName = 'StatusPageCategory';


StatusPageCategory.propTypes = {
    projectId: PropTypes.string,
    statusPageId: PropTypes.string,
    isRequesting: PropTypes.bool,
    fetchStatusPageCategories: PropTypes.func.isRequired,
    skip: PropTypes.number,
    count: PropTypes.number,
    limit: PropTypes.number,
    name: PropTypes.string,
    openModal: PropTypes.func.isRequired,
    error: PropTypes.object,
    statusPageCategories: PropTypes.array,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        fetchStatusPageCategories,
        openModal,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => ({
    statusPageCategories:
        state.statusPageCategory.fetchStatusPageCategories.categories,

    skip: state.statusPageCategory.fetchStatusPageCategories.skip,
    limit: state.statusPageCategory.fetchStatusPageCategories.limit,
    count: state.statusPageCategory.fetchStatusPageCategories.count,
    isRequesting: state.statusPageCategory.fetchStatusPageCategories.requesting,
    error: state.statusPageCategory.fetchStatusPageCategories.error
});

export default connect(mapStateToProps, mapDispatchToProps)(StatusPageCategory);
