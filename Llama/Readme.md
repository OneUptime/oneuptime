# Llama 

### Development Guide

#### Step 1: Downloading Model from Hugging Face 

Please make sure you have git lfs installed before cloning the model. 

```bash
git lfs install
```

```bash
cd ./Llama/Models
# Here we are downloading the Meta-Llama-3-8B-Instruct model
git clone https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct
```

You will be asked for username and password. 
Please use Hugging Face Username as Username and, 
Hugging Face API Token as Password. 

#### Step 2: Install Docker. 

Install Docker and Docker Compose 

```bash
sudo apt-get update
sudo curl -sSL https://get.docker.com/ | sh  
```

Install Rootless Docker

```bash
sudo apt-get install -y uidmap
dockerd-rootless-setuptool.sh install
```

See if the installation works

```bash
docker --version
docker ps 

# You should see no containers running, but you should not see any errors. 
```

#### Step 3: Insall nvidia drivers on the machine to use GPU

- Install Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html#installing-the-nvidia-container-toolkit
- Install CUDA: https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=Ubuntu&target_version=22.04&target_type=deb_network
- Restart the machine
- You should now see GPU when you run `nvidia-smi`

#### Step 4: Run the test workload to see if GPU is connected to Docker. 

```bash
docker run --rm -it --gpus=all nvcr.io/nvidia/k8s/cuda-sample:nbody nbody -gpu -benchmark
```

You have configured the machine to use GPU with Docker.


### Build 

- Download models from meta
- Once the model is downloaded, place them in the `Llama/Models` folder. Please make sure you also place tokenizer.model and tokenizer_checklist.chk in the same folder.
- Edit `Dockerfile` to include the model name in the `MODEL_NAME` variable.
- Docker build 

```
npm run build-ai
```

### Run

```
npm run start-ai    
```