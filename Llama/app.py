import uuid
import transformers
import asyncio
import torch
from fastapi import FastAPI
from pydantic import BaseModel
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler

# TODO: Store this in redis down the line. 
items_pending = {}
queue = []
items_processed = {}

async def job():
    print("Processing queue...")

    while True: 

        if len(queue) == 0:
            # sleep for 5 seconds. 
            print("Queue is empty. Sleeping for 5 seconds.")
            await asyncio.sleep(5)
            continue

        try: 
        
            # process this item.
            random_id = queue.pop(0)
            print(f"Processing item {random_id}")
            messages = items_pending[random_id]
            print(f"Messages:")
            print(messages)
            outputs = pipe(messages)
            items_processed[random_id] = outputs
            del items_pending[random_id]
            print(f"Processed item {random_id}")
        except Exception as e:
            print(f"Error processing item {random_id}")
            # delete from items_pending
            if random_id in items_pending:
                del items_pending[random_id]
            print(e)

       


@asynccontextmanager
async def lifespan(app:FastAPI):
    asyncio.create_task(job())
    yield

# Declare a Pydantic model for the request body
class Prompt(BaseModel):
   messages: list

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

    messages = prompt.messages

    # Generate UUID
    random_id = str(uuid.uuid4())

    # add to queue

    items_pending[random_id] = messages
    queue.append(random_id)

    # Return response
    return {
        "id": random_id,
        "status": "queued"
    }

@app.get("/queue-status/")
async def queue_status():
    return {"pending": items_pending, "processed": items_processed, "queue": queue}

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




