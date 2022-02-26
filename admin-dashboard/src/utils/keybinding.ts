import { history } from '../store';

// This is an array of the available first key characters for the shortcut
const initKeys = ['f'];

/**
 * @description creates keybinding for side nav
 * @param {object} event keyboard event
 * @param {array} route individual route in the application
 * @param {array} keys array of keys typed in
 * @param {function} resetKeys function to reset the keys array
 */

const keyBind = (event: $TSFixMe, route: $TSFixMe, keys: $TSFixMe, resetKeys: $TSFixMe) => {
    let shortcut = [];
    // ensure the target is always body and not inside any other element (input, textarea, etc)
    if (route.shortcut && event.target.localName === 'body' && event.key) {
        shortcut = route.shortcut.split('+');
        keys.push(event.key.toLowerCase());

        if (keys.length === 1 && !initKeys.includes(keys[0])) resetKeys();
        if (keys.length === 2) {
            if (keys[0] === shortcut[0] && keys[1] === shortcut[1]) {
                resetKeys();
                if (route.path.includes('dashboard')) {
                    return window.location.replace(route.path);
                }
                return history.push(route.path);
            }
            resetKeys();
        }
    }
};

export const navKeyBind = (route: $TSFixMe) => {
    let keys: $TSFixMe = [];
    const resetKeys = () => (keys = []);
    // reasons to use keydown
    // 1 --> gives the user impression that they can press and hold two keys simultaneously
    // 2 --> accommodate users that don't like pressing and holding two keys simultaneously (which is the actual behaviour, (^-^))
    window.addEventListener('keydown', e => keyBind(e, route, keys, resetKeys));
};

export const cleanBind = (route: $TSFixMe) => {
    let keys: $TSFixMe = [];
    const resetKeys = () => (keys = []);
    window.removeEventListener('keydown', e =>
        keyBind(e, route, keys, resetKeys)
    );
};
