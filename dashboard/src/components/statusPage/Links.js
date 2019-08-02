import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, FieldArray } from 'redux-form';
import { updateStatusPageLinks, updateStatusPageLinksRequest, updateStatusPageLinksSuccess, updateStatusPageLinksError, fetchProjectStatusPage } from '../../actions/statusPage';
import { RenderLinks } from '../basic/RenderLinks';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';

//Client side validation
function validate(values) {
    const errors = {};
    const linksArrayErrors = [];

    if (values.links) {
        for (var i = 0; i < values.links.length; i++) {
            const linkErrors = {}
            if (values.links[i].name) {

                if (!Validate.text(values.links[i].name)) {
                    linkErrors.name = 'Name is not in text format.'
                    linksArrayErrors[i] = linkErrors
                }
            }

            if (values.links[i].url) {

                if (!Validate.url(values.links[i].url)) {
                    linkErrors.url = 'Url is invalid.'
                    linksArrayErrors[i] = linkErrors
                }
            }
        }

        if (linksArrayErrors.length) {
            errors.links = linksArrayErrors
        }
    }

    return errors;
}

export class Links extends Component {

    submitForm = (values) => {
        const { _id, projectId } = this.props.statusPage.status
        if(_id) values._id = _id;
        this.props.updateStatusPageLinks(projectId._id || projectId, values).then(()=>{
            this.props.fetchProjectStatusPage(projectId._id || projectId, true);
        })
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Links Updated', values);
        }
    }

    render() {
        const { handleSubmit, statusPage } = this.props;

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Custom Footer Links</span>
                            </span>
                            <p>
                                <span>
                                    This section belongs to customizing your footer and adding links to external pages. You can add upto five links.
                                </span>
                            </p>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(this.submitForm)} >
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">

                                            <FieldArray name="links" component={RenderLinks} />

                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">

                            <div className="bs-Tail-copy">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
                                    <ShouldRender if={this.props.statusPage.links.error}>
                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                            </div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>
                                                {this.props.statusPage.links.error}
                                            </span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>

                            <div>
                                <button
                                    id="btnSaveLinks"
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={statusPage.links.requesting}
                                    type="submit"
                                >
                                    {!statusPage.links.requesting && <span>Save</span>}
                                    {statusPage.links.requesting && <FormLoader />}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

Links.displayName = 'Links'

Links.propTypes = {
    updateStatusPageLinks: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    statusPage: PropTypes.object.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
}

const mapDispatchToProps = dispatch => bindActionCreators(
    {
        updateStatusPageLinks,
        updateStatusPageLinksRequest,
        updateStatusPageLinksSuccess,
        updateStatusPageLinksError,
        fetchProjectStatusPage,
    }, dispatch
)

const mapStateToProps = state => {
    const status = state.statusPage.status || [];
    let links = [];

    status.links && status.links.forEach((link) => {
        links.push({
            name: link.name,
            url: link.url
        })
    });

    return {
        initialValues: { links },
        statusPage: state.statusPage,
        currentProject: state.project.currentProject,
    };
}

let LinksForm = reduxForm({
    form: 'Links', // a unique identifier for this form
    validate, // <--- validation function given to redux-for
    enableReinitialize: true
})(Links);

Links.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(LinksForm);