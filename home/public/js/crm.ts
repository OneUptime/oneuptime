//eslint-disable-next-line
function openTab(evt, tabName) {
    // Declare all variables
    let i;

    // Get all elements with class="tabcontent" and hide them
    const tabcontent = document.getElementsByClassName('tabcontent');
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].className = tabcontent[i].className.replace(' active', '');
    }

    // Get all elements with class="tablinks" and remove the class "active"
    const tablinks = document.getElementsByClassName('tablinks');
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(' active', '');
    }

    // Show the current tab, and add an "active" class to the link that opened the tab
    document.getElementById(tabName).className += ' active';
    evt.currentTarget.className += ' active';
    setTimeout(() => document.getElementById(tabName + '1').parentNode.click(), 200);
}
//eslint-disable-next-line
function openTooltip(name) {
    // Declare all variables
    let i;
    const element = document.getElementById(name);
    const elclass = element.className;

    const tooltip = document.getElementsByClassName('tooltiptext');
    for (i = 0; i < tooltip.length; i++) {
        tooltip[i].className = tooltip[i].className.replace(' active', '');
    }
    if (elclass.indexOf('active') > -1) {
        element.className = element.className.replace(' active', '');
    }
    else {
        element.classList.add('active');
    }
}

window.onload = function () {
    animateHTML().init();
    const tooltext = document.getElementsByClassName('tooltiptext');
    for (let i = 0; i < tooltext.length; i++) {
        tooltext[i].onclick = function (e) {
            e.stopPropagation();
        }
    }

    document.getElementsByTagName('body')[0].onclick = function (e) {
        if (e.target.className !== 'popover-dot' && e.target.className !== 'tooltiptext' && e.target.className !== 'tablinks active') {
            const tooltip = document.getElementsByClassName('tooltiptext');
            for (let i = 0; i < tooltip.length; i++) {
                tooltip[i].className = tooltip[i].className.replace(' active', '');
            }
        }
    }
}

const animateHTML = function () {
    let elem, windowHeight;
    const init = function () {
        elem = document.getElementById('Statuspage');
        windowHeight = window.innerHeight;
        _addEventHandlers();
    }
    const _addEventHandlers = function () {
        window.addEventListener('scroll', _checkPosition)
        window.addEventListener('resize', init)
    }
    const _checkPosition = function () {
        if(!elem){
            return;
        }
        const posFromTop = elem.getBoundingClientRect().top;

        if (posFromTop - windowHeight <= -400) {
            document.getElementById('Statuspage1').parentNode.click();
            window.removeEventListener('scroll', _checkPosition);
            window.removeEventListener('resize', init);
            return;
        }
    }
    return {
        init: init
    }
}
