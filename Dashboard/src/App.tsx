import React, { ReactElement } from 'react';
import TopBar from 'CommonUI/src/Components/Dashboard/TopBar/TopBar';
import './App.scss';

function App(): ReactElement {
    return (
        <div className="App">
            <TopBar />
        </div>
    );
}

export default App;
