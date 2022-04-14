(() => {
    const source: $TSFixMe = document.getElementsByClassName(
        'prettyprint source linenums'
    );
    let i: $TSFixMe = 0;
    let lineNumber: $TSFixMe = 0;
    let lineId: $TSFixMe;
    let lines: $TSFixMe;
    let totalLines: $TSFixMe;
    let anchorHash: $TSFixMe;

    if (source && source[0]) {
        anchorHash = document.location.hash.substring(1);
        lines = source[0].getElementsByTagName('li');
        totalLines = lines.length;

        for (; i < totalLines; i++) {
            lineNumber++;
            lineId = `line${lineNumber}`;
            lines[i].id = lineId;
            if (lineId === anchorHash) {
                lines[i].className += ' selected';
            }
        }
    }
})();
