import time
import transformers
import torch
from fastapi import FastAPI
from pydantic import BaseModel


# Declare a Pydantic model for the request body
class Prompt(BaseModel):
   prompt: str

model_path = "/app/Models/Meta-Llama-3-70B-Instruct"

pipe = transformers.pipeline(
    "text-generation", 
    model=model_path,
    # use gpu if available
    device="cuda" if torch.cuda.is_available() else "cpu",
    )

app = FastAPI()

@app.get("/")
async def root():
    return {"status": "ok"}

@app.post("/prompt/")
async def create_item(prompt: Prompt):

    # Calculate request time
    start_time = time.time()

    # Log prompt to console
    print(prompt)

    # If not prompt then return bad request error
    if not prompt:
        return {"error": "Prompt is required"}

    messages = [
        {"role": "user", "content": prompt.prompt},
    ]

    outputs = pipe(messages)

    # Log output to console
    print(outputs)

    end_time = time.time()

    responseTime = end_time - start_time

    # Print duration to console
    print("Request duration: ")
    print(responseTime)

    # return prompt response
    return {"response": outputs, "responseTime": responseTime}


