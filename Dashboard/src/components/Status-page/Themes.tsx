import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { reduxForm, Field } from 'redux-form';
import { ValidateField } from '../../config';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { updateTheme } from '../../actions/statusPage';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

interface ThemesProps {
    statusPage: object;
    handleSubmit: Function;
    data: object;
    updateTheme: Function;
    initialValues?: {
        theme?: string
    };
}

export class Themes extends Component<ThemesProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            type: props.data.theme,
        };
    }

    changeBox = (e: $TSFixMe, value: $TSFixMe) => {
        this.setState({ type: value });
    };
    submitForm = (value: $TSFixMe) => {

        const { statusPageId, projectId } = this.props.data;
        const data = {
            ...value,
            statusPageId,
        };

        this.props.updateTheme(projectId, data);
    };

    override render() {

        const { handleSubmit, statusPage } = this.props;
        const requesting = statusPage.theme.requesting;
        const error = statusPage.theme.error;
        const themes = [
            {
                value: 'Clean Theme',
                screenshot: '/dashboard/assets/img/clean.png',
                id: 'Clean',
            },
            {
                value: 'Classic Theme',
                screenshot: '/dashboard/assets/img/classic.png',
                id: 'Classic',
            },
        ];
        return (
            <form onSubmit={handleSubmit(this.submitForm)}>
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                        <span>Select a theme</span>
                                    </span>
                                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            By default, Custom theme is
                                            selected. Select the preferred theme
                                            you want to be displayed.
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows theme-list-3c">
                                            <div className="price-list-3c rm-auto Margin-all--16">
                                                {themes.map((theme, i) => {
                                                    return (
                                                        <label
                                                            key={i}
                                                            htmlFor={`type_${theme.value}`}
                                                            style={{
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                            id={theme.id}
                                                        >
                                                            <div
                                                                className={`radio-field monitor-type-item Box-background--white bs-theme-block`}
                                                                style={{
                                                                    border: `1px solid ${this
                                                                        .state

                                                                        .type ===
                                                                        theme.value
                                                                        ? 'black'
                                                                        : 'rgba(0,0,0,0.2)'
                                                                        }`,
                                                                }}
                                                            >
                                                                <div className="bs-radio-input">
                                                                    <div className="radioButtonStyle">
                                                                        <Field
                                                                            required={
                                                                                true
                                                                            }
                                                                            component="input"
                                                                            type="radio"
                                                                            data-testId={`type_${theme.value}`}
                                                                            id={`type_${theme.value}`}
                                                                            name={`theme`}
                                                                            className="Margin-left--4 Margin-top--4"
                                                                            validate={
                                                                                ValidateField.select
                                                                            }
                                                                            disabled={
                                                                                requesting
                                                                            }
                                                                            onChange={(
                                                                                e: $TSFixMe,
                                                                                v: $TSFixMe
                                                                            ) => {
                                                                                this.changeBox(
                                                                                    e,
                                                                                    v
                                                                                );
                                                                            }}
                                                                            value={
                                                                                theme.value
                                                                            }
                                                                        />
                                                                    </div>
                                                                    <div className="themelabel">
                                                                        <div
                                                                            style={{
                                                                                fontWeight:
                                                                                    this
                                                                                        .state

                                                                                        .type ===
                                                                                        theme.value
                                                                                        ? '600'
                                                                                        : '400',
                                                                                marginLeft:
                                                                                    '7px',
                                                                            }}
                                                                        >
                                                                            {
                                                                                theme.value
                                                                            }
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="bs-screenshot">
                                                                    <img
                                                                        alt="theme"
                                                                        src={
                                                                            theme.screenshot
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage">
                                <ShouldRender if={error}>
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
                                                    {error}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                            </span>
                            <div>
                                <button
                                    className="bs-Button bs-Button--blue"
                                    type="submit"
                                    id="changePlanBtn"
                                >
                                    {!requesting && <span>Save</span>}
                                    {requesting && <FormLoader />}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}


Themes.displayName = 'Themes';

const ThemesForm = new reduxForm({
    form: 'Themes',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(Themes);

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        updateTheme,
    },
    dispatch
);


Themes.propTypes = {
    statusPage: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    data: PropTypes.object.isRequired,
    updateTheme: PropTypes.func.isRequired,
    initialValues: PropTypes.shape({ theme: PropTypes.string }),
};

const mapStateToProps: Function = (state: RootState, ownProps: $TSFixMe) => {
    const { theme } = ownProps.data;
    return {
        statusPage: state.statusPage,
        initialValues: { theme },
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(ThemesForm);
