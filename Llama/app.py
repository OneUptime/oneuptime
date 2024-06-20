import time
import transformers
import torch
from fastapi import FastAPI
from pydantic import BaseModel
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler

# TODO: Store this in redis down the line. 
items_pending = {}
queue = []
items_processed = {}

def job():
    print("Processing queue...")

    while len(queue) > 0:
        # process this item. 
        random_id = queue.pop(0)
        messages = items_pending[random_id]
        outputs = pipe(messages)
        items_processed[random_id] = outputs

@asynccontextmanager
async def lifespan(app:FastAPI):
    scheduler = BackgroundScheduler()
    scheduler.add_job(job,'cron', second='*/5')
    scheduler.start()
    yield

# Declare a Pydantic model for the request body
class Prompt(BaseModel):
   prompt: str

# Declare a Pydantic model for the request body
class PromptResult(BaseModel):
   id: str

model_path = "/app/Models/Meta-Llama-3-8B-Instruct"

pipe = transformers.pipeline(
    "text-generation", 
    model=model_path,
    # use gpu if available
    device="cuda" if torch.cuda.is_available() else "cpu",
    )

app = FastAPI(lifespan=lifespan)

@app.get("/")
async def root():
    return {"status": "ok"}

@app.post("/prompt/")
async def create_item(prompt: Prompt):

    # Log prompt to console
    print(prompt)

    # If not prompt then return bad request error
    if not prompt:
        return {"error": "Prompt is required"}

    messages = [
        {"role": "user", "content": prompt.prompt},
    ]

    # Generate random id 
    random_id = str(time.time())

    # add to queue

    items_pending[random_id] = messages
    queue.append(random_id)

    # Return response
    return {
        "id": random_id,
        "status": "queued"
    }

@app.post("/prompt-result/")
async def prompt_status(prompt_status: PromptResult):
    
        # Log prompt status to console
        print(prompt_status)
    
        # If not prompt status then return bad request error
        if not prompt_status:
            return {"error": "Prompt status is required"}
    
        # check if item is processed. 
        if prompt_status.id in items_processed:

           
            return_value =  {
                "id": prompt_status.id,
                "status": "processed",
                "output": items_processed[prompt_status.id]
            }

            # delete from item_processed
            del items_processed[prompt_status.id]

            return return_value
        else:

            status = "not found" 

            if prompt_status.id in items_pending:
                status = "pending"

            return {
                "id": prompt_status.id,
                "status": status
            }




