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

### For Linux

```
docker run --gpus all -p 8547:8547 -it -v ./Llama/Models:/app/Models llama 
```

### For MacOS

```
docker run -p 8547:8547 -it -v ./Llama/Models:/app/Models llama 
```


## Run without a docker conatiner

uvicorn app:app --host 0.0.0.0 --port 8547 