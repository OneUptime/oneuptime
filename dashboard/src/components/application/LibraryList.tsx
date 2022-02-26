import React from 'react';
import { logLibraries } from '../../config';
import PropTypes from 'prop-types';
import { RenderSelect } from '../basic/RenderSelect';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import AceCodeEditor from '../basic/AceCodeEditor';

function renderLibraries() {
    const list = logLibraries.getLibraries().map(library => {
        return (
            <a
                target="_blank"
                key={library.id}
                href={library.link}
                rel="noreferrer noopener"
            >
                <img
                    style={{
                        width: '30px',
                        height: '30px',
                        margin: '10px',
                    }}
                    src={library.icon}
                    alt={library.iconText}
                />
            </a>
        );
    });
    return list;
}
function renderLanguageQuickStart(
    library: $TSFixMe,
    type: $TSFixMe,
    errorTracker: $TSFixMe,
    applicationLog: $TSFixMe,
    setShow: $TSFixMe
) {
    const currentLibrary = logLibraries
        .getQuickStarts(errorTracker, applicationLog)
        .filter(quickStart => quickStart.id === library);
    const libraryDoc = currentLibrary[0]
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        ? currentLibrary[0][type]
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            ? currentLibrary[0][type]
            : ''
        : '';
    if (libraryDoc === '') {
        return (
            <div className="Padding-all--20">
                {' '}
                Please select a library to see quickstart docs.
            </div>
        );
    } else if (!libraryDoc.installation) {
        return <div className="Padding-all--20"> {libraryDoc} </div>;
    } else {
        return (
            <div>
                <span className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-lineHeight--28 Padding-horizontal--20">
                    <span>
                        {' '}
                        {libraryDoc.installation
                            ? libraryDoc.installation.package
                            : ''}
                    </span>
                </span>

                <div>
                    <AceCodeEditor
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                        value={
                            libraryDoc.installation
                                ? libraryDoc.installation.command
                                : ''
                        }
                        name={`quickstart-command-${type}`}
                        readOnly={true}
                        language={type === 'java' ? 'xml' : ' markdown'}
                        height={currentLibrary[0].height.install}
                    />
                </div>
                <span className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-lineHeight--28 Padding-horizontal--20">
                    <span>{'Usage'}</span>
                </span>
                <div>
                    <AceCodeEditor
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                        value={libraryDoc.usage ? libraryDoc.usage : ''}
                        name={`quickstart-${type}`}
                        readOnly={true}
                        mode="javascript"
                        height={currentLibrary[0].height.usage}
                    />
                </div>
                <div className="bs-cancel-box">
                    <button
                        id={'cancel-help'}
                        className="bs-Button bs-DeprecatedButton"
                        type="button"
                        onClick={setShow}
                    >
                        <span className="bs-list-flex">
                            <span
                                style={{
                                    marginLeft: '5px',
                                }}
                            >
                                Cancel
                            </span>
                        </span>
                    </button>
                </div>
            </div>
        );
    }
}
const LibraryList = ({
    title,
    type,
    library,
    errorTracker,
    applicationLog,
    close,
    setShow
}: $TSFixMe) => (
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
    <div tabIndex="0" className="Box-root Margin-vertical--12">
        <div className="db-Trends bs-ContentSection Card-root Card-shadow--medium">
            <div
                className="Box-root"
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                }}
            >
                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root">
                        <span className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-lineHeight--28">
                            <span> {title} Libraries</span>
                        </span>
                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"></span>
                    </div>
                    <div>{renderLibraries()}</div>
                </div>
                <div className="bs-ContentSection-content Box-root Padding-horizontal--20 Padding-vertical--16">
                    <span
                        className="incident-close-button"
                        onClick={close}
                    ></span>
                </div>
            </div>
            <div className="Box-root">
                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-direction--column ">
                    <div className="Box-root">
                        <span className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-lineHeight--28 Padding-horizontal--20">
                            <span> Quick Start</span>
                        </span>
                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"></span>
                    </div>
                    <form id="form-quick-start">
                        <div
                            className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                            style={{ boxShadow: 'none' }}
                        >
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Available Libraries
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-select-nw"
                                                        component={RenderSelect}
                                                        name="library"
                                                        id="library"
                                                        placeholder="Choose Library"
                                                        options={[
                                                            {
                                                                value: '',
                                                                label:
                                                                    'Select library',
                                                            },
                                                            // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 0.
                                                            ...(logLibraries.getQuickStarts() &&
                                                            // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 0.
                                                            logLibraries.getQuickStarts()
                                                                .length > 0
                                                                ? logLibraries
                                                                      // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 0.
                                                                      .getQuickStarts()
                                                                      .map(
                                                                          library => ({
                                                                              value:
                                                                                  library.id,
                                                                              label:
                                                                                  library.language,
                                                                          })
                                                                      )
                                                                : []),
                                                        ]}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                    </form>
                    {renderLanguageQuickStart(
                        library,
                        type,
                        errorTracker,
                        applicationLog,
                        setShow
                    )}
                </div>
            </div>
        </div>
    </div>
);

LibraryList.displayName = 'LibraryList';
const LibraryListForm = new reduxForm({
    form: 'QuickStart',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(LibraryList);
LibraryList.propTypes = {
    title: PropTypes.string,
    library: PropTypes.string,
    type: PropTypes.string,
    errorTracker: PropTypes.object,
    applicationLog: PropTypes.object,
    close: PropTypes.func,
    setShow: PropTypes.func,
};

const mapStateToProps = (state: $TSFixMe) => {
    const initialValues = {
        library: 'js',
    };
    return {
        initialValues,
        library: state.form.QuickStart
            ? state.form.QuickStart.values.library
            : '',
    };
};
export default connect(mapStateToProps)(LibraryListForm);
