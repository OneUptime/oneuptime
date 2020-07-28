import { history } from '../store';

/**
 * @description creates keybinding for fyipe side nav
 * @param {array} route individual route in the application
 * @param {object} path actual path to navigate to
 */

export const navKeyBind = (route, path) => {
    let shortcut = [];
    if (route.shortcut) {
        shortcut = route.shortcut.split('+');
        // remember all the keys and ensure it's in sequence as the key binding
        let keys = [];
        // reasons to use keydown
        // 1 --> gives the user impression that they can press and hold two keys simultaneously
        // 2 --> accommodate users that don't like pressing and holding two keys simultaneously (which is the actual behaviour, (^-^))
        const func = e => {
            keys.push(e.key);
            if (keys.length === 2) {
                if (keys[0] === shortcut[0] && keys[1] === shortcut[1]) {
                    keys = [];
                    return history.push(path);
                }
                keys = [];
            }
        };
        window.addEventListener('keydown', func);
    }
};

export const cleanBind = (route, path) => {
    let shortcut = [];
    if (route.shortcut) {
        shortcut = route.shortcut.split('+');
        let keys = [];
        const func = e => {
            keys.push(e.key);
            if (keys.length === 2) {
                if (keys[0] === shortcut[0] && keys[1] === shortcut[1]) {
                    keys = [];
                    return history.push(path);
                }
                keys = [];
            }
        };
        window.removeEventListener('keydown', func);
    }
};
