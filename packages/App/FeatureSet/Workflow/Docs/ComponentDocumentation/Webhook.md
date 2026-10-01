This trigger starts the workflow when another app or service calls its URL. The URL, the methods it accepts and a request to try it with are at the top of this dialog.

The call is answered straight away with `{"status": "Scheduled"}`, and the workflow runs in the background. While the workflow is disabled, calls are refused with "This workflow is not enabled".

The request's headers, query parameters and body are passed to the next steps. **Returns** lists the reference for each. To read one field of a JSON body, add the field's name to the end of the reference, as in `request-body.message`.
