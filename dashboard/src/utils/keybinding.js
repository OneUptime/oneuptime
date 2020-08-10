import { history } from '../store';

// This is an array of the available first key characters for the shortcut
const initKeys = ['c', 'p', 's', 'u', 't', 'm', 'a', 'o'];

/**
 * @description creates keybinding for side nav
 * @param {object} event keyboard event
 * @param {array} route individual route in the application
 * @param {string} path actual path to navigate to
 * @param {array} keys array of keys typed in
 * @param {function} resetKeys function to reset the keys array
 */

const keyBind = (event, route, path, keys, resetKeys) => {
    let shortcut = [];
    if (route.shortcut && event.key) {
        shortcut = route.shortcut.split('+');
        keys.push(event.key.toLowerCase());

        if (keys.length === 1 && keys[0] !== 'control') resetKeys();
        if (keys.length === 2 && !initKeys.includes(keys[1])) resetKeys();

        if (keys.length === 3) {
            if (
                keys[0] === 'control' &&
                keys[1] === shortcut[1] &&
                keys[2] === shortcut[2]
            ) {
                resetKeys();
                return history.push(path);
            }
            resetKeys();
        }
    }
};

export const navKeyBind = (route, path) => {
    let keys = [];
    const resetKeys = () => (keys = []);
    // reasons to use keydown
    // 1 --> gives the user impression that they can press and hold two keys simultaneously
    // 2 --> accommodate users that don't like pressing and holding two keys simultaneously (which is the actual behaviour, (^-^))
    window.addEventListener('keydown', e =>
        keyBind(e, route, path, keys, resetKeys)
    );
};

export const cleanBind = (route, path) => {
    let keys = [];
    const resetKeys = () => (keys = []);
    window.removeEventListener('keydown', e =>
        keyBind(e, route, path, keys, resetKeys)
    );
};
