This trigger lets you run custom JavaScrip[t in your workflow. 

```

// You can access any arguments by

args['your-argument']

```

**Things to note:** 

- Code Executionn timeout is set to 5 seconds. If your code takes longer than this, we recommend using your own server. Send request from this workflow to your server. 
- You can use axios module. If you need access to more modules, please create an issue on GitHub and we will look into it.  
