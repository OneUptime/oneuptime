This trigger lets you start the workflow with the incoming HTTP request. 


**URL of this trigger:** 


```
{{serverUrl}}workflow/trigger/{{workflowId}}
```


This can be a GET or POST request. You can send request headers, and body to the Webhook trigger and that can be accessed by any other components downstream.