import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { fetchExternalStatusPages } from '../../actions/statusPage';
import ExternalStatusPagesTable from '../basic/ExternalStatusPagesTable';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';

import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import AddExternalStatusPagesModal from '../modals/AddExternalStatusPagesModal';
import { openModal } from 'CommonUI/actions/modal';

interface ExternalStatusPagesProps {
    openModal?: Function;
    statusPage: object;
    fetchExternalStatusPages: Function;
    subProjectId?: string;
    statusPageId?: string;
}

export class ExternalStatusPages extends Component<ExternalStatusPagesProps>{
    public static displayName = '';
    public static propTypes = {};
    handleKeyBoard: $TSFixMe;
    state = {
        externalStatusPageModalId: uuidv4(),
    };

    override componentDidMount() {

        this.props.fetchExternalStatusPages(

            this.props.subProjectId,

            this.props.statusPageId
        );
    }

    override render() {

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


ExternalStatusPages.displayName = 'ExternalStatusPages';


ExternalStatusPages.propTypes = {
    openModal: PropTypes.func,
    statusPage: PropTypes.object.isRequired,
    fetchExternalStatusPages: PropTypes.func.isRequired,
    subProjectId: PropTypes.string,
    statusPageId: PropTypes.string,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        fetchExternalStatusPages,
        openModal,
    },
    dispatch
);

const mapStateToProps = (state: RootState) => {
    return {
        statusPage: state.statusPage,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ExternalStatusPages);
