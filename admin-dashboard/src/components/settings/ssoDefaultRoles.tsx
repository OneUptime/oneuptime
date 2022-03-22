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

        const { skip, limit } = this.props.ssoPaginate;
        if (0 <= skip - limit) {

            await this.props.fetchSsoDefaultRoles(skip - limit, limit);

            this.props.paginate('prev');
        }
    }
    async nextClicked() {

        const { skip, limit } = this.props.ssoPaginate;

        const { count, paginate } = this.props;
        if (skip + limit < count) {

            await this.props.fetchSsoDefaultRoles(skip + limit, limit);
            paginate('next');
        }
    }
    async componentDidMount() {

        this.props.fetchProjects(0, 0);

        await this.props.fetchSsoDefaultRoles(0, 10);
    }
    render() {

        const { ssoDefaultRoles, openModal, count } = this.props;

        const canPrev = this.props.ssoPaginate.skip > 0;
        const canNext =

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

                            canPrev={canPrev}

                            canNext={canNext}
                            previousClicked={() => this.previousClicked()}
                            nextClicked={() => this.nextClicked()}

                            page={this.props.page}
                            numberOfPages={numberOfPages}
                        />
                    </div>
                </div>
            </div>
        );
    }
}


Box.displayName = 'ssoDefaultRoles';

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
