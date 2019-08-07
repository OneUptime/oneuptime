import * as types from '../constants/profile';

export function showProfileMenu() {

	return {
		type: types.SHOW_PROFILE_MENU,
	};
}

export function hideProfileMenu(error) {
	return {
		type: types.HIDE_PROFILE_MENU,
		payload: error
	};
}
