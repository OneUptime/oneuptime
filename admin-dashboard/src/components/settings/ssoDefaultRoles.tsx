import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { fetchSsoDefaultRoles, paginate } from '../../actions/ssoDefaultRoles';
import { fetchProjects } from '../../actions/project';
import Button from './ssoDefaultRoles/Button';
import BoxHeader from './ssoDefaultRoles/BoxHeader';
import BoxFooter from './ssoDefaultRoles/BoxFooter';
import Table from './ssoDefaultRoles/Table';
import { openModal } from '../../actions/modal';
import { CreateDefaultRoleModal } from './ssoDefaultRoles/DefaultRoleModal';

class Box extends React.Component {
    async previousClicked() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'ssoPaginate' does not exist on type 'Rea... Remove this comment to see the full error message
        const { skip, limit } = this.props.ssoPaginate;
        if (0 <= skip - limit) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSsoDefaultRoles' does not exist on ... Remove this comment to see the full error message
            await this.props.fetchSsoDefaultRoles(skip - limit, limit);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginate' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.paginate('prev');
        }
    }
    async nextClicked() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'ssoPaginate' does not exist on type 'Rea... Remove this comment to see the full error message
        const { skip, limit } = this.props.ssoPaginate;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { count, paginate } = this.props;
        if (skip + limit < count) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSsoDefaultRoles' does not exist on ... Remove this comment to see the full error message
            await this.props.fetchSsoDefaultRoles(skip + limit, limit);
            paginate('next');
        }
    }
    async componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjects' does not exist on type 'R... Remove this comment to see the full error message
        this.props.fetchProjects(0, 0);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSsoDefaultRoles' does not exist on ... Remove this comment to see the full error message
        await this.props.fetchSsoDefaultRoles(0, 10);
    }
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'ssoDefaultRoles' does not exist on type ... Remove this comment to see the full error message
        const { ssoDefaultRoles, openModal, count } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'ssoPaginate' does not exist on type 'Rea... Remove this comment to see the full error message
        const canPrev = this.props.ssoPaginate.skip > 0;
        const canNext =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ssoPaginate' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.ssoPaginate.skip + this.props.ssoPaginate.limit < count;
        const numberOfPages = Math.ceil(parseInt(count) / 10);
        return (
            <div
                className="bs-ContentSection Card-root Card-shadow--medium"
                style={{ marginTop: '1rem', marginBottom: '1rem' }}
            >
                <div className="Box-root">
                    <BoxHeader
                        title="SSO default roles "
                        description="Default roles of the members"
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'Element[]' is not assignable to type '(...ar... Remove this comment to see the full error message
                        buttons={[
                            <Button
                                text="Define new configurations"
                                key="config"
                                shortcut="M"
                                onClick={() =>
                                    openModal({
                                        content: CreateDefaultRoleModal,
                                    })
                                }
                            />,
                        ]}
                    />
                    <div style={{ overflow: 'auto hidden' }}>
                        <Table ssoDefaultRoles={ssoDefaultRoles} />
                        <BoxFooter
                            recordsCount={count}
                            // @ts-expect-error ts-migrate(2322) FIXME: Type 'boolean' is not assignable to type '((...arg... Remove this comment to see the full error message
                            canPrev={canPrev}
                            // @ts-expect-error ts-migrate(2322) FIXME: Type 'boolean' is not assignable to type '((...arg... Remove this comment to see the full error message
                            canNext={canNext}
                            previousClicked={() => this.previousClicked()}
                            nextClicked={() => this.nextClicked()}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                            page={this.props.page}
                            numberOfPages={numberOfPages}
                        />
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Box.displayName = 'ssoDefaultRoles';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Box.propTypes = {
    ssoDefaultRoles: PropTypes.array,
    fetchSsoDefaultRoles: PropTypes.func,
    openModal: PropTypes.func,
    count: PropTypes.number,
    fetchProjects: PropTypes.func,
    paginate: PropTypes.func,
    page: PropTypes.number,
    ssoPaginate: PropTypes.object,
};
const mapStateToProps = (state: $TSFixMe) => ({
    ssoDefaultRoles: state.ssoDefaultRoles.ssoDefaultRoles.ssoDefaultRoles,
    count: state.ssoDefaultRoles.ssoDefaultRoles.count,
    ssoPaginate: state.ssoDefaultRoles.ssoDefaultRoles,
    page: state.ssoDefaultRoles.page
});
const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        fetchSsoDefaultRoles,
        fetchProjects,
        openModal,
        paginate,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(Box);
