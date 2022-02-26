import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { fetchExternalStatusPages } from '../../actions/statusPage';
import ExternalStatusPagesTable from '../basic/ExternalStatusPagesTable';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import AddExternalStatusPagesModal from '../modals/AddExternalStatusPagesModal';
import { openModal } from '../../actions/modal';

export class ExternalStatusPages extends Component {
    handleKeyBoard: $TSFixMe;
    state = {
        externalStatusPageModalId: uuidv4(),
    };

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchExternalStatusPages' does not exist... Remove this comment to see the full error message
        this.props.fetchExternalStatusPages(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.subProjectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageId' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.statusPageId
        );
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { statusPage, openModal } = this.props;
        const { externalStatusPageModalId } = this.state;
        return (
            <div
                className="bs-ContentSection Card-root Card-shadow--medium"
                onKeyDown={this.handleKeyBoard}
            >
                <div className="Box-root">
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span
                                        style={{ textTransform: 'capitalize' }}
                                    >
                                        External Status Pages
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        This is a service for adding external
                                        status pages.
                                    </span>
                                </span>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div>
                                    <button
                                        id="addExternalStatusPage"
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                        onClick={() =>
                                            openModal({
                                                id: externalStatusPageModalId,
                                                content: DataPathHoC(
                                                    AddExternalStatusPagesModal,
                                                    {
                                                        statusPage: statusPage,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        Add External Status Pages
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <form>
                        <div
                            className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1"
                            style={{ overflow: 'hidden', overflowX: 'auto' }}
                        >
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root">
                                    <fieldset className="Box-background--white">
                                        <ExternalStatusPagesTable
                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ statusPage: any; }' is not assignable to t... Remove this comment to see the full error message
                                            statusPage={statusPage}
                                        />
                                        <ShouldRender
                                            if={
                                                statusPage.externalStatusPages
                                                    .externalStatusPagesList
                                                    .length === 0
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
                                                You don&#39;t have any external
                                                status page.
                                            </div>
                                        </ShouldRender>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root">
                                        <ShouldRender
                                            if={
                                                statusPage.externalStatusPages
                                                    .externalStatusPagesList
                                                    .length > 0
                                            }
                                        >
                                            <span>
                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    {
                                                        statusPage
                                                            .externalStatusPages
                                                            .externalStatusPagesList
                                                            .length
                                                    }{' '}
                                                    External Status{' '}
                                                    {statusPage
                                                        .externalStatusPages
                                                        .externalStatusPagesList
                                                        .length > 1
                                                        ? 'Pages'
                                                        : 'Page'}
                                                </span>
                                            </span>
                                        </ShouldRender>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ExternalStatusPages.displayName = 'ExternalStatusPages';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ExternalStatusPages.propTypes = {
    openModal: PropTypes.func,
    statusPage: PropTypes.object.isRequired,
    fetchExternalStatusPages: PropTypes.func.isRequired,
    subProjectId: PropTypes.string,
    statusPageId: PropTypes.string,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        fetchExternalStatusPages,
        openModal,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        statusPage: state.statusPage,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ExternalStatusPages);
