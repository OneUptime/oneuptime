import React, { Component } from 'react';
import { reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { PropTypes } from 'prop-types';
import Dropzone from 'react-dropzone';
import PapaParse from 'papaparse';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from '../../actions/modal';
import {
    downloadCsvTemplate,
    importSubscribersFromCsvFile,
} from '../../actions/subscriber';
import { Spinner } from '../basic/Loader';
import { fetchMonitorsSubscribers } from '../../actions/monitor';

class UploadFile extends Component {
    constructor(props) {
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
                transformHeader: header => header.replace(/\W/g, '_'),
            },
            isFileLoaded: false,
        };
    }

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
                            this.props.closeModal({
                                id: this.props.uploadSubscriberModalId,
                            });
                        }}
                    ></span>
                </div>
            </div>
        </div>
    );

    renderFormBody = () => {
        const { files, style } = this.state;
        const fileList =
            files.length > 0
                ? files.map(file => (
                      <li key={file.name} style={{ fontWeight: 'bold' }}>
                          {file.name}
                      </li>
                  ))
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
                        this.props.downloadCsvTemplate();
                    }}
                    disabled={this.props.csvDownload.requesting}
                >
                    <span>Download Template</span>
                </button>
                <button
                    id="importCsvButton"
                    className={`bs-Button bs-DeprecatedButton bs-Button--blue`}
                    type="submit"
                    disabled={
                        this.props.createSubscriber.requesting ||
                        !this.state.isFileLoaded
                    }
                >
                    <ShouldRender if={this.props.createSubscriber.requesting}>
                        <Spinner />
                    </ShouldRender>
                    <ShouldRender if={!this.props.createSubscriber.requesting}>
                        <span>Save</span>
                    </ShouldRender>
                </button>
            </div>
        </div>
    );

    renderErrors = () => (
        <ShouldRender
            if={
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
                            {this.props.createSubscriber.error}
                        </span>
                    </div>
                </div>
            </div>
        </ShouldRender>
    );

    onDrop = acceptedFiles => {
        this.setState(() => {
            const isLoaded = acceptedFiles.length > 0 ? true : false;
            return {
                files: acceptedFiles,
                isFileLoaded: isLoaded,
            };
        });
    };

    processCSVFile = () => {
        const { files, papaparseOptions } = this.state;
        const {
            data: { monitorId, subProjectId },
            importSubscribersFromCsvFile,
            closeThisDialog,
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
                                {this.renderFormHeader()}
                                {this.renderFormBody()}
                                {this.renderFormFooter()}
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

UploadFile.displayName = 'UploadFile';

const UploadFileForm = reduxForm({
    form: 'UploadFile',
})(UploadFile);

const mapStateToProps = state => {
    return {
        uploadSubscriberModalId: state.modal.modals[0].id,
        csvDownload: state.subscriber.csvDownload,
        createSubscriber: state.subscriber.newSubscriber,
    };
};

const mapDispatchToProps = dispatch => {
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
