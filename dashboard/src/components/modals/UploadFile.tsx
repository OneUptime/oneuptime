import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';
import Dropzone from 'react-dropzone';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'papa... Remove this comment to see the full error message
import PapaParse from 'papaparse';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from '../../actions/modal';
import {
    downloadCsvTemplate,
    importSubscribersFromCsvFile,
} from '../../actions/subscriber';
import { Spinner } from '../basic/Loader';
import { fetchMonitorsSubscribers } from '../../actions/monitor';

class UploadFile extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            files: [],
            style: {
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                alignItems: 'center',
                padding: '20px',
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: '#eeeeee',
                backgroundColor: '#fafafa',
                margin: '20px',
                cursor: 'pointer',
            },
            papaparseOptions: {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                transformHeader: (header: $TSFixMe) => header.replace(/\W/g, '_'),
            },
            isFileLoaded: false,
        };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                this.setState({ files: [], isFileLoaded: false });
                return this.handleCloseModal();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'uploadSubscriberModalId' does not exist ... Remove this comment to see the full error message
            id: this.props.uploadSubscriberModalId,
        });
    };

    renderFormHeader = () => (
        <div className="bs-Modal-header Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
            <div className="bs-Modal-header-copy">
                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                    <span>Upload Subscribers</span>
                </span>
            </div>
            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                <div className="Box-root">
                    <span
                        className="incident-close-button"
                        onClick={() => {
                            this.setState({ files: [], isFileLoaded: false });
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                            this.props.closeModal({
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'uploadSubscriberModalId' does not exist ... Remove this comment to see the full error message
                                id: this.props.uploadSubscriberModalId,
                            });
                        }}
                    ></span>
                </div>
            </div>
        </div>
    );

    renderFormBody = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'files' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { files, style } = this.state;
        const fileList =
            files.length > 0
                ? files.map((file: $TSFixMe) => <li key={file.name} style={{ fontWeight: 'bold' }}>
                {file.name}
            </li>)
                : [];

        return (
            <div className="bs-Modal-body">
                <Dropzone
                    onDrop={acceptedFiles => this.onDrop(acceptedFiles)}
                    accept={'.csv'}
                >
                    {({ getRootProps, getInputProps }) => (
                        <section>
                            <div {...getRootProps({ style })} id="dropZone">
                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ id: string; refKey?: string | undefined; a... Remove this comment to see the full error message
                                <input {...getInputProps()} id="fileInput" />
                                <p>
                                    Drag &#39;n&#39; drop some files here, or
                                    click to select files
                                </p>
                            </div>
                            <aside style={{ margin: '20px' }}>
                                <ul>{fileList}</ul>
                            </aside>
                        </section>
                    )}
                </Dropzone>
            </div>
        );
    };

    renderFormFooter = () => (
        <div className="bs-Modal-footer">
            <div className="bs-Modal-footer-actions">
                {this.renderErrors()}
                <button
                    className={`bs-Button bs-DeprecatedButton`}
                    type="button"
                    onClick={() => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'downloadCsvTemplate' does not exist on t... Remove this comment to see the full error message
                        this.props.downloadCsvTemplate();
                    }}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'csvDownload' does not exist on type 'Rea... Remove this comment to see the full error message
                    disabled={this.props.csvDownload.requesting}
                    autoFocus={true}
                >
                    <span>Download Template</span>
                </button>
                <button
                    id="importCsvButton"
                    className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal`}
                    type="submit"
                    disabled={
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSubscriber' does not exist on type... Remove this comment to see the full error message
                        this.props.createSubscriber.requesting ||
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isFileLoaded' does not exist on type 'Re... Remove this comment to see the full error message
                        !this.state.isFileLoaded
                    }
                >
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSubscriber' does not exist on type... Remove this comment to see the full error message
                    <ShouldRender if={this.props.createSubscriber.requesting}>
                        <Spinner />
                    </ShouldRender>
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSubscriber' does not exist on type... Remove this comment to see the full error message
                    <ShouldRender if={!this.props.createSubscriber.requesting}>
                        <span>Save</span>
                        <span className="create-btn__keycode">
                            <span className="keycode__icon keycode__icon--enter" />
                        </span>
                    </ShouldRender>
                </button>
            </div>
        </div>
    );

    renderErrors = () => (
        <ShouldRender
            if={
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSubscriber' does not exist on type... Remove this comment to see the full error message
                this.props.createSubscriber && this.props.createSubscriber.error
            }
        >
            <div className="bs-Tail-copy">
                <div
                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                    style={{ marginTop: '10px' }}
                >
                    <div className="Box-root Margin-right--8">
                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                    </div>
                    <div className="Box-root">
                        <span style={{ color: 'red' }} id="errorMsg">
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSubscriber' does not exist on type... Remove this comment to see the full error message
                            {this.props.createSubscriber.error}
                        </span>
                    </div>
                </div>
            </div>
        </ShouldRender>
    );

    onDrop = (acceptedFiles: $TSFixMe) => {
        this.setState(() => {
            const isLoaded = acceptedFiles.length > 0 ? true : false;
            return {
                files: acceptedFiles,
                isFileLoaded: isLoaded,
            };
        });
    };

    processCSVFile = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'files' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { files, papaparseOptions } = this.state;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data: { monitorId, subProjectId },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'importSubscribersFromCsvFile' does not e... Remove this comment to see the full error message
            importSubscribersFromCsvFile,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsSubscribers' does not exist... Remove this comment to see the full error message
            fetchMonitorsSubscribers,
        } = this.props;
        const reader = new FileReader();
        reader.onload = function() {
            const csvData = PapaParse.parse(
                reader.result,
                Object.assign(papaparseOptions, {
                    error: 'Error',
                    encoding: 'UTF-8',
                })
            );
            const { data } = csvData;
            importSubscribersFromCsvFile(
                { data },
                subProjectId,
                monitorId
            ).then(function() {
                fetchMonitorsSubscribers(subProjectId, monitorId, 0, 5);
                closeThisDialog();
            });
        };
        reader.readAsText(files[0], 'UTF-8');
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit } = this.props;

        return (
            <form onSubmit={handleSubmit(this.processCSVFile)}>
                <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                    <div
                        className="ModalLayer-contents"
                        tabIndex={-1}
                        style={{ marginTop: 40 }}
                    >
                        <div className="bs-BIM">
                            <div className="bs-Modal bs-Modal--large">
                                <ClickOutside
                                    onClickOutside={this.handleCloseModal}
                                >
                                    {this.renderFormHeader()}
                                    {this.renderFormBody()}
                                    {this.renderFormFooter()}
                                </ClickOutside>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
UploadFile.displayName = 'UploadFile';

const UploadFileForm = reduxForm({
    form: 'UploadFile',
})(UploadFile);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        uploadSubscriberModalId: state.modal.modals[0].id,
        csvDownload: state.subscriber.csvDownload,
        createSubscriber: state.subscriber.newSubscriber,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            closeModal,
            downloadCsvTemplate,
            importSubscribersFromCsvFile,
            fetchMonitorsSubscribers,
        },
        dispatch
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
UploadFile.propTypes = {
    closeModal: PropTypes.func.isRequired,
    downloadCsvTemplate: PropTypes.func,
    importSubscribersFromCsvFile: PropTypes.func,
    uploadSubscriberModalId: PropTypes.string,
    csvDownload: PropTypes.shape({ requesting: PropTypes.bool }),
    data: PropTypes.shape({
        monitorId: PropTypes.string,
        subProjectId: PropTypes.string,
    }),
    createSubscriber: PropTypes.shape({
        requesting: PropTypes.bool,
        error: PropTypes.string,
    }),
    closeThisDialog: PropTypes.func,
    fetchMonitorsSubscribers: PropTypes.func,
    handleSubmit: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(UploadFileForm);
