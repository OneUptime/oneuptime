/*
 * "?create=1": a list page's address that asks for the list's create form
 * (#7035). Search's Create Status Page, Create On-Call Policy, Create On-Call
 * Schedule, Create Dashboard, Create Workflow and Invite User, and Ask AI's
 * buttons to them, open their list with it; the list's table opens the form
 * (Common/UI/Utils/CreateFormAddress, BaseModelTable's
 * opensCreateFormFromAddress).
 *
 * Pure: the Dashboard's page catalogs and the server's tests read it too.
 */

export const CREATE_FORM_ADDRESS_PARAM: string = "create";
export const CREATE_FORM_ADDRESS_VALUE: string = "1";

// What a link appends to a list's address to open its create form.
export const CREATE_FORM_QUERY_STRING: string = `?${CREATE_FORM_ADDRESS_PARAM}=${CREATE_FORM_ADDRESS_VALUE}`;
