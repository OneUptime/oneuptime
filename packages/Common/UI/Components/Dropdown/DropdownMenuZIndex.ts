/*
 * Modal surfaces use z-50. Portalled menus and field popups must sit above that
 * stacking context so they are not painted underneath an anchored modal footer.
 */
const DROPDOWN_MENU_Z_INDEX: number = 60;

export default DROPDOWN_MENU_Z_INDEX;
