import React from 'react';

const NotAuthorised = () => {
    return (
        <div
            id="notAuthorised"
            style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                flexDirection: 'column',
            }}
        >
            <div style={{ marginTop: 20, fontSize: 16 }}>
                You are not authorised to view this page because you are not an
                admin
            </div>
        </div>
    );
};

NotAuthorised.displayName = 'NotAuthorised';

export default NotAuthorised;
