# Update this path to your obsidian vault directory
# now you can also plugin the path in yoru make argument or as a env variable
# echo "export OBSIDIAN_PATH=/path/to/obsidian" >> ~/.bashrc and source ~/.profile 
export OBSIDIAN_PATH ?= /Users/eugene/obsidian-vault/
export TRANSFORMER_CACHE ?= /Users/eugene/.cache/huggingface/hub

# These generally do not need to be changed
PWD_PATH = ${PWD}
DOCKER_OBSIDIAN_PATH = /obsidian-vault
NETWORK = obsidian-copilot
IMAGE_TAG = obsidian-copilot

# Choose your container runtime: docker or podman. Default is docker.
# echo "export RUNTIME=podman" >> ~/.bashrc and source ~/.profile 
# if you dont want to keep typing it for each make or change it here
RUNTIME ?= podman

# if podman use podman else use docker with ${RUNTIME} command

ifeq ($(RUNTIME), docker) 
docker-network:
	${RUNTIME}  network create ${NETWORK} || true
else ifeq ($(RUNTIME), podman)
podman-network:
	${RUNTIME}  network create ${NETWORK} || true
else
	@echo "Invalid runtime, please use 'docker' or 'podman'"
	exit 1
endif

ifeq ($(RUNTIME), docker) 
opensearch: docker-network
	${RUNTIME}  run -it --rm --network obsidian-copilot --network-alias opensearch -p 9200:9200 -p 9600:9600 -v "${PWD_PATH}/data:/usr/share/opensearch/data" -e "discovery.type=single-node" opensearchproject/opensearch:2.7.0
else ifeq ($(RUNTIME), podman)
opensearch: podman-network
	${RUNTIME}  run -it --rm --network obsidian-copilot --network-alias opensearch -p 9200:9200 -p 9600:9600 -v "${PWD_PATH}/data:/usr/share/opensearch/data" -e "discovery.type=single-node" opensearchproject/opensearch:2.7.0
else
	@echo "Invalid runtime, please use 'docker' or 'podman'"
	exit 1
endif

ifeq ($(RUNTIME), docker) 
build:
	DOCKER_BUILDKIT=1 ${RUNTIME} build -t ${IMAGE_TAG} -f Dockerfile .
else ifeq ($(RUNTIME), podman)
build:
	${RUNTIME} build --format docker -t ${IMAGE_TAG} -f Dockerfile .
else
	@echo "Invalid runtime, please use 'docker' or 'podman'"
	exit 1
endif

build-artifacts: build
	${RUNTIME} run -it --rm --network ${NETWORK} -v "${PWD_PATH}/data:/obsidian-copilot/data" -v "$(OBSIDIAN_PATH):${DOCKER_OBSIDIAN_PATH}" -v "${TRANSFORMER_CACHE}:/root/.cache/huggingface/hub" ${IMAGE_TAG} /bin/bash -c "./build.sh ${DOCKER_OBSIDIAN_PATH}"

# pip install podman-compose if you don't have it
ifeq ($(RUNTIME), docker) 
run:
	docker-compose up
else ifeq ($(RUNTIME), podman)
run:
	podman-compose up 
else
	@echo "Invalid runtime, please use 'docker' or 'podman'"
	exit 1
endif

install-plugin:
	cp plugin/main.ts plugin/main.js plugin/styles.css plugin/manifest.json ${OBSIDIAN_PATH}.obsidian/plugins/copilot/

# Development
dev: build
	${RUNTIME} run -it --rm --network ${NETWORK} -v "${PWD_PATH}:/obsidian-copilot" -v "$(OBSIDIAN_PATH):/obsidian-vault" ${IMAGE_TAG} /bin/bash

app: build
	${RUNTIME} run -it --rm --network ${NETWORK} -v "${PWD_PATH}:/obsidian-copilot" -v "$(OBSIDIAN_PATH):/obsidian-vault" -v "${TRANSFORMER_CACHE}:/root/.cache/huggingface/hub" -p 8000:8000 ${IMAGE_TAG} /bin/bash -c "python -m uvicorn src.app:app --reload --host 0.0.0.0 --port 8000"


build-local:
	./build.sh

app-local:
	uvicorn src.app:app --reload

sync-plugin:
	cp -R ${OBSIDIAN_PATH}.obsidian/plugins/copilot/* plugin
