import React from 'react';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import ResetPasswordForm from '../components/auth/ResetPasswordForm';

class ResetPasswordPage extends React.Component {
    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
    }

    render() {
        return (
            <div id="wrap" style={{ paddingTop: 0 }}>
                {/* Header */}
                <div id="header">
                    <h1>
                        <a href="/">Fyipe</a>
                    </h1>
                </div>
                {/* RESET PASSWORD BOX */}
                <ResetPasswordForm />
                <div className="below-box">
                    <p>
                        <Link to="/login">
                            Know your password? <strong>Sign in</strong>.
                        </Link>
                    </p>
                </div>
                {/* END CONTENT */}
                <div id="footer_spacer" />
                <div id="bottom">
                    <ul>
                        <li>
                            <Link to="/register">Sign Up</Link>
                        </li>
                        <li>
                            <a href="http://fyipe.com/legal/privacy">
                                Privacy Policy
                            </a>
                        </li>
                        <li>
                            <a href="http://fyipe.com/support">Support</a>
                        </li>
                        <li className="last">
                            <a href="https://hackerbay.io">© HackerBay, Inc.</a>
                        </li>
                    </ul>
                </div>
            </div>
        );
    }
}

ResetPasswordPage.displayName = 'ResetPasswordPage';

export default connect(null, null)(ResetPasswordPage);
