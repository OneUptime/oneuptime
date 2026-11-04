/*
 * The stated size past which a cloud's map stops trying to draw everything: parts it
 * would draw, of every kind. Up to here a map reads the whole cloud and folds what it
 * draws. Past it the first view opens on what has failed and what that affects, because
 * a drawing of the rest answers nothing and reading it costs a browser seconds.
 */
export const OPENSTACK_TOPOLOGY_FULL_PART_LIMIT: number = 5000;
