This trigger lets you start the workflow with the incoming HTTP request.


**URL of this trigger:**


```text
{{serverUrl}}workflow/trigger/{{webhookSecretKey}}
```


This URL uses a secret key unique to this workflow. You can reset this secret key from the Workflow Settings page if it is compromised.

This can be a GET or POST request. You can send request headers, and body to the Webhook trigger and that can be accessed by any other components downstream.