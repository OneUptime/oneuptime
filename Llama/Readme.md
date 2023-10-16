# Llama 

## Prepare 

- Download models from meta
- Once the model is downloaded, place them in the `Llama/Models` folder. Please make sure you also place tokenizer.model and tokenizer_checklist.chk in the same folder.
- Edit `Dockerfile` to include the model name in the `MODEL_NAME` variable.
- Docker build 

```
docker build -t llama . -f ./Llama/Dockerfile
```

## Run

```
docker run -it llama
```


## Run without a docker conatiner

uvicorn app:app --host 0.0.0.0 --port 8547 