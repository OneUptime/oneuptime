import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { reduxForm, Field } from 'redux-form';
import { ValidateField } from '../../config';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { updateTheme } from '../../actions/statusPage';
import { FormLoader } from '../basic/Loader';

export class Themes extends Component {
    constructor(props) {
        super(props);
        this.state = {
            type: props.data.theme,
        };
    }

    changeBox = (e, value) => {
        this.setState({ type: value });
    };
    submitForm = value => {
        const { statusPageId, projectId } = this.props.data;
        const data = {
            ...value,
            statusPageId,
        };
        this.props.updateTheme(projectId, data);
    };

    render() {
        const { handleSubmit, statusPage } = this.props;
        const requesting = statusPage.theme.requesting;
        const error = statusPage.theme.error;
        const themes = [
            {
                value: 'Clean Theme',
                screenshot: '/dashboard/assets/img/clean.png',
            },
            {
                value: 'Classic Theme',
                screenshot: '/dashboard/assets/img/classic.png',
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
                                        <span
                                            style={{
                                                textTransform: 'capitalize',
                                            }}
                                        >
                                            Select a theme
                                        </span>
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
                                                        >
                                                            <div
                                                                className={`radio-field monitor-type-item Box-background--white`}
                                                                style={{
                                                                    border: `1px solid ${
                                                                        this
                                                                            .state
                                                                            .type ===
                                                                        theme.value
                                                                            ? 'black'
                                                                            : 'rgba(0,0,0,0.2)'
                                                                    }`,
                                                                }}
                                                            >
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
                                                                            e,
                                                                            v
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
                                                                        }}
                                                                    >
                                                                        {
                                                                            theme.value
                                                                        }
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
                                {error && error}
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

const mapDispatchToProps = dispatch =>
    bindActionCreators(
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

const mapStateToProps = (state, ownProps) => {
    const { theme } = ownProps.data;
    return {
        statusPage: state.statusPage,
        initialValues: { theme },
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(ThemesForm);
