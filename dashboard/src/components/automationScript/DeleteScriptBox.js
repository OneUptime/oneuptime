import React, { useEffect, useState } from 'react';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { deleteAutomatedScript } from '../../actions/automatedScript';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

const DeleteScriptBox = props => {
    const { scripts, name, parentRoute, history } = props;
    const [loading, setLoading] = useState(false);
    const [script, setScript] = useState(false);
    const pathName = history.location.pathname;
    const scripSlug = pathName.split('automateScript/')[1];

    const deleteScrip = async () => {
        setLoading(true);
        const res = await props.deleteAutomatedScript(script._id);
        if (res) {
            setLoading(false);
            history.push(parentRoute);
        } else {
            setLoading(false);
        }
    };

    useEffect(() => {
        const selectedScript = scripts.find(x => {
            return x.slug == scripSlug;
        });
        setScript(selectedScript);
    }, []);

    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Delete {name} script</span>
                            </span>
                            <p>
                                <span>
                                    Click the button to permanantly delete this
                                    script.
                                </span>
                            </p>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div>
                                <button
                                    id="delete"
                                    className="bs-Button bs-Button--red Box-background--red"
                                    disabled={false}
                                    onClick={deleteScrip}
                                >
                                    <ShouldRender if={!loading}>
                                        <span>Delete</span>
                                    </ShouldRender>
                                    <ShouldRender if={loading}>
                                        <FormLoader />
                                    </ShouldRender>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

DeleteScriptBox.propTypes = {
    scripts: PropTypes.array.isRequired,
    history: PropTypes.object.isRequired,
    deleteAutomatedScript: PropTypes.func.isRequired,
    name: PropTypes.string.isRequired,
    parentRoute: PropTypes.string,
};

const mapStateToProps = state => {
    return {
        scripts: state.automatedScripts.scripts,
    };
};

export default connect(mapStateToProps, { deleteAutomatedScript })(
    DeleteScriptBox
);
