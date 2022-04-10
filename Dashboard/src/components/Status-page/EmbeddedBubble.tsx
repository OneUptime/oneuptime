import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { CopyToClipboard } from 'react-copy-to-clipboard';

import { v4 as uuidv4 } from 'uuid';
import ShouldRender from '../basic/ShouldRender';
import {
    resetStatusBubbleId,
    updateStatusPageEmbeddedCss,
    resetStatusPageEmbeddedCss,
} from '../../actions/statusPage';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';

import { Field, reduxForm, formValueSelector, change } from 'redux-form';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import { API_URL } from '../../config';
import ResetStatusBubbleIdModal from '../modals/ResetStatusBubbleIdModal';
import ResetCssModal from '../modals/ResetCssModal';
import { openModal, closeModal } from 'Common-ui/actions/modal';

const selector = formValueSelector('EmbeddedBubble');

const css = (colors: $TSFixMe) => `<style>
    .all {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 5px;
        background-color: rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b});
    }
    .some {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 5px;
        background-color: rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b});
    },
    .none {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 5px;
        background-color: rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b});
    }
    .degraded {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 5px;
        background-color: rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b});
    }
    .text {
        color: rgb(76, 76, 76);
        font-size: 14px;
        font-weight: 400;
        font-family: Camphor, Segoe UI, Open Sans, sans-serif;
    }
    .bubble-box {
        display:flex;
        flex-direction: row;
      }
    </style>`;

const createScript = (url: URL, css: $TSFixMe) => {
    return `<div class='bubble-box'>
    <div id="oneuptime-status-bubble"></div>
    <div id='oneuptime-bubble-text'></div>
  </div>
    ${css}
        <script language="javascript" type="text/javascript">
        function initializeBubble() {
            var placeholderDiv = document.getElementById("oneuptime-status-bubble");
            var placeholderTitleDiv = document.getElementById("oneuptime-bubble-text");
            var bubble = 'all';
            var statusMessage = '';
            var url = '${url}';
            fetch(url,{
                method: 'GET',
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    Accept: 'application/json',
                    'Content-Type': 'application/json;charset=UTF-8',
                }})
                .then(response => response.json())
            .then(json => {
                bubble = json && json.bubble ? json.bubble : null;
                statusMessage = json && json.statusMessage ? json.statusMessage : null;
                if (bubble === 'all') {
                    placeholderDiv.className = 'all';
            } else if (bubble === 'some') {
              placeholderDiv.className = 'some';
            } else if (bubble === 'none') {
                placeholderDiv.className = 'none';
            } else if (bubble === 'some-degraded') {
                placeholderDiv.className = 'degraded';
            }
            placeholderTitleDiv.className = 'text';
            placeholderTitleDiv.innerHTML = statusMessage;
            })
            .catch(err => logger.error(err));
        };window.onload = function (){initializeBubble()};
        </script>`;
};

interface EmbeddedBubbleProps {
    change?: Function;
    customCodeValue?: any;
    embeddedCss?: {
        error?: any,
        requesting?: any
    };
    handleSubmit?: Function;
    openModal?: Function;
    projectId?: any;
    resetEmbeddedCss?: {
        error?: any,
        requesting?: any
    };
    resetStatusBubbleId?: Function;
    resetStatusPageEmbeddedCss?: Function;
    statusBubble?: {
        error?: any,
        requesting?: any
    };
    statusBubbleId?: any;
    statusPage?: {
        status?: {
            _id?: any,
            colors?: any,
            projectId?: {
                _id?: any
            }
        }
    };
    statusPageId?: any;
    updateStatusPageEmbeddedCss?: Function;
}

export class EmbeddedBubble extends Component<EmbeddedBubbleProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            showMoreOptions: false,
            copied: false,
            resetModalId: uuidv4(),
            resetCssModalId: uuidv4(),
        };
    }
    submitForm = (values: $TSFixMe) => {

        const { status } = this.props.statusPage;
        const { projectId } = status;
        const { embeddedCustomCSS } = values;

        this.props.updateStatusPageEmbeddedCss(projectId._id || projectId, {
            _id: status._id,
            embeddedCss: embeddedCustomCSS,
        });
    };
    changecss = (event: $TSFixMe, css: $TSFixMe) => {

        const url = `${API_URL}/status-page/statusBubble?statusPageId=${this.props.statusPageId}&statusBubbleId=${this.props.statusBubbleId}`;
        const value = createScript(url, css);

        this.props.change('embeddedcode', value);
    };
    resetcss = () => {

        const { status } = this.props.statusPage;
        const { projectId, colors } = status;
        const customCss = css(colors);


        return this.props.resetStatusPageEmbeddedCss(
            projectId._id || projectId,
            {
                _id: status._id,
                embeddedCss: customCss,
            }
        );
    };
    showMoreOptionsToggle = () =>
        this.setState(prevState => ({

            showMoreOptions: !prevState.showMoreOptions,
        }));

    override render() {
        const {

            handleSubmit,

            statusBubbleId,

            statusBubble,

            resetStatusBubbleId,

            statusPageId,

            projectId,

            customCodeValue,

            resetEmbeddedCss,

            embeddedCss,
        } = this.props;

        const { showMoreOptions, resetModalId, resetCssModalId } = this.state;
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Embedded Status Bubble</span>
                            </span>
                            <p>
                                <span>
                                    Add embedded status bubble to your website.
                                </span>
                            </p>
                        </div>
                        <div
                            className="bs-Fieldset-row"
                            style={{
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                            }}
                        >
                            <label style={{ marginRight: 10 }}>
                                Advanced Options
                            </label>
                            <div>
                                <label className="Toggler-wrap">
                                    <input
                                        className="btn-toggler"
                                        type="checkbox"
                                        onChange={() =>
                                            this.showMoreOptionsToggle()
                                        }
                                        name="moreOptions"
                                        id="moreOptions"
                                        checked={showMoreOptions}
                                    />
                                    <span className="TogglerBtn-slider round"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <div
                            className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1"
                            style={{ overflow: 'hidden', overflowX: 'auto' }}
                        >
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root">
                                    <fieldset className="Box-background--offset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label script-label">
                                                    Preview
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields script-editor-wrapper"
                                                    style={{
                                                        height: '50px',
                                                        width: '80%',
                                                        position: 'relative',
                                                    }}
                                                >
                                                    <iframe
                                                        id="bubbleDisplay"
                                                        title="script status display"
                                                        srcDoc={
                                                            customCodeValue
                                                                ? customCodeValue
                                                                : ''
                                                        }
                                                        style={{
                                                            position:
                                                                'absolute',
                                                            top: 0,
                                                            left: 0,
                                                            bottom: 0,
                                                            right: 0,
                                                            height: '100%',
                                                            width: '100%',
                                                            border: 'none',
                                                        }}
                                                    ></iframe>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label script-label">
                                                    Embedded Code
                                                </label>
                                                <div className="bs-Fieldset-fields script-editor-wrapper">
                                                    <Field
                                                        id="embeddedcode"
                                                        name="embeddedcode"
                                                        component={
                                                            RenderCodeEditor
                                                        }
                                                        readOnly={true}
                                                        mode="html"
                                                        theme="github"
                                                        height="180px"
                                                        width="100%"
                                                    />
                                                    <p className="bs-Fieldset-explanation">
                                                        <span>
                                                            Copy the code above
                                                            and paste it into
                                                            any html file or web
                                                            project to add
                                                            status bubble to
                                                            your website.
                                                        </span>
                                                        <CopyToClipboard
                                                            text={
                                                                customCodeValue
                                                            }
                                                            onCopy={() =>
                                                                this.setState({
                                                                    copied: true,
                                                                })
                                                            }
                                                        >
                                                            <span
                                                                style={{
                                                                    textDecoration:
                                                                        'underline',
                                                                    margin:
                                                                        '0px 5px',
                                                                    cursor:
                                                                        'copy',
                                                                }}
                                                            >
                                                                Click here to
                                                                copy to
                                                                clipboard
                                                            </span>
                                                        </CopyToClipboard>

                                                        {this.state.copied ? (
                                                            <span
                                                                style={{
                                                                    color:
                                                                        'red',
                                                                }}
                                                            >
                                                                Copied.
                                                            </span>
                                                        ) : null}
                                                    </p>
                                                </div>
                                            </div>

                                            <ShouldRender if={showMoreOptions}>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label script-label">
                                                        Embedded Custom CSS
                                                    </label>
                                                    <div className="bs-Fieldset-fields script-editor-wrapper">
                                                        <Field
                                                            id="embeddedCustomCSS"
                                                            name="embeddedCustomCSS"
                                                            component={
                                                                RenderCodeEditor
                                                            }
                                                            onChange={
                                                                this.changecss
                                                            }
                                                            mode="css"
                                                            theme="github"
                                                            height="150px"
                                                            width="100%"
                                                        />
                                                        <p className="bs-Fieldset-explanation">
                                                            <span>
                                                                Change css
                                                                inside the box
                                                                to change the
                                                                look and feel of
                                                                status bubble
                                                                and status text.
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label script-label">
                                                        Auth ID :
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                paddingTop:
                                                                    '7px',
                                                                flexDirection:
                                                                    'row',
                                                            }}
                                                        >
                                                            <span>
                                                                {statusBubbleId}
                                                            </span>
                                                            <button
                                                                style={{
                                                                    border:
                                                                        'none',
                                                                    background:
                                                                        'none',
                                                                }}
                                                                disabled={
                                                                    statusBubble.requesting
                                                                }
                                                                type="button"
                                                                id="btnreset"
                                                                onClick={() =>

                                                                    this.props.openModal(
                                                                        {
                                                                            id: resetModalId,
                                                                            onConfirm: () => {
                                                                                return resetStatusBubbleId(
                                                                                    projectId,
                                                                                    statusPageId
                                                                                );
                                                                            },
                                                                            content: ResetStatusBubbleIdModal,
                                                                        }
                                                                    )
                                                                }
                                                            >
                                                                <ShouldRender
                                                                    if={
                                                                        !statusBubble.requesting
                                                                    }
                                                                >
                                                                    <span>
                                                                        <img
                                                                            src="/dashboard/assets/img/refresh.svg"
                                                                            alt="refresh"
                                                                            style={{
                                                                                height:
                                                                                    'inherit',
                                                                                width:
                                                                                    '15px',
                                                                                marginLeft:
                                                                                    '20px',
                                                                                marginTop:
                                                                                    '1px',
                                                                            }}
                                                                        />
                                                                    </span>
                                                                </ShouldRender>
                                                                <ShouldRender
                                                                    if={
                                                                        statusBubble.requesting
                                                                    }
                                                                >
                                                                    <FormLoader />
                                                                </ShouldRender>
                                                            </button>
                                                        </div>
                                                        <p
                                                            className="bs-Fieldset-explanation"
                                                            style={{
                                                                marginTop:
                                                                    '0px',
                                                            }}
                                                        >
                                                            <span>
                                                                This is a unique
                                                                id required to
                                                                fetch status
                                                                data inside
                                                                embedded script.
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                            </ShouldRender>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage">
                                <ShouldRender
                                    if={
                                        statusBubble.error ||
                                        resetEmbeddedCss.error ||
                                        embeddedCss.error
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
                                                <span style={{ color: 'red' }}>
                                                    {statusBubble.error
                                                        ? statusBubble.error
                                                        : ''}
                                                    {resetEmbeddedCss.error
                                                        ? resetEmbeddedCss.error
                                                        : ''}
                                                    {embeddedCss.error
                                                        ? embeddedCss.error
                                                        : ''}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                            </span>
                            <div>
                                <button
                                    className="bs-Button bs-DeprecatedButton bs-Button--new"
                                    disabled={resetEmbeddedCss.requesting}
                                    type="button"
                                    id="btnresetcss"
                                    onClick={() => {

                                        this.props.openModal({
                                            id: resetCssModalId,
                                            onConfirm: () => {
                                                return this.resetcss();
                                            },
                                            content: ResetCssModal,
                                        });
                                    }}
                                >
                                    {!resetEmbeddedCss.requesting && (
                                        <span>Reset CSS</span>
                                    )}
                                    {resetEmbeddedCss.requesting && (
                                        <FormLoader />
                                    )}
                                </button>
                                <button
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={embeddedCss.requesting}
                                    type="submit"
                                    id="btnsavecss"
                                >
                                    {!embeddedCss.requesting && (
                                        <span>Save Changes </span>
                                    )}
                                    {embeddedCss.requesting && <FormLoader />}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}


EmbeddedBubble.displayName = 'Embedded Bubble';


EmbeddedBubble.propTypes = {
    change: PropTypes.func,
    customCodeValue: PropTypes.any,
    embeddedCss: PropTypes.shape({
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
    handleSubmit: PropTypes.func,
    openModal: PropTypes.func,
    projectId: PropTypes.any,
    resetEmbeddedCss: PropTypes.shape({
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
    resetStatusBubbleId: PropTypes.func,
    resetStatusPageEmbeddedCss: PropTypes.func,
    statusBubble: PropTypes.shape({
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
    statusBubbleId: PropTypes.any,
    statusPage: PropTypes.shape({
        status: PropTypes.shape({
            _id: PropTypes.any,
            colors: PropTypes.any,
            projectId: PropTypes.shape({
                _id: PropTypes.any,
            }),
        }),
    }),
    statusPageId: PropTypes.any,
    updateStatusPageEmbeddedCss: PropTypes.func,
};

const EmbeddedBubbleForm = reduxForm({
    form: 'EmbeddedBubble', // a unique identifier for this form
    enableReinitialize: true,
})(EmbeddedBubble);

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        resetStatusBubbleId,
        change,
        openModal,
        closeModal,
        updateStatusPageEmbeddedCss,
        resetStatusPageEmbeddedCss,
    },
    dispatch
);

const mapStateToProps = (state: RootState) => {
    const customCodeValue = selector(state, 'embeddedcode');
    const {
        statusBubbleId,
        _id,
        projectId,
        colors,
        embeddedCss,
    } = state.statusPage.status;
    const url = `${API_URL}/status-page/statusBubble?statusPageId=${_id}&statusBubbleId=${statusBubbleId}`;
    const customCss =
        embeddedCss && embeddedCss.length ? embeddedCss : css(colors);
    const script = createScript(url, customCss);
    return {
        initialValues: { embeddedcode: script, embeddedCustomCSS: customCss },
        statusBubbleId,
        statusPageId: _id,
        statusBubble: state.statusPage.statusBubble,
        projectId: projectId._id,
        customCodeValue,
        embeddedCss: state.statusPage.embeddedCss,
        resetEmbeddedCss: state.statusPage.resetEmbeddedCss,
        statusPage: state.statusPage,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(EmbeddedBubbleForm);
