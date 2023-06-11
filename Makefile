# Update this path to your obsidian vault directory
export OBSIDIAN_PATH = /Users/eugene/obsidian-vault/
export TRANSFORMER_CACHE = /Users/eugene/.cache/huggingface/hub

# These generally do not need to be changed
PWD_PATH = ${PWD}
DOCKER_OBSIDIAN_PATH = /obsidian-vault
NETWORK = obsidian-copilot
IMAGE_TAG = obsidian-copilot

docker-network:
	docker network create ${NETWORK} || true

opensearch: docker-network
	docker run -it --rm --network obsidian-copilot --network-alias opensearch -p 9200:9200 -p 9600:9600 -v "${PWD_PATH}/data:/usr/share/opensearch/data" -e "discovery.type=single-node" opensearchproject/opensearch:2.7.0

build:
	DOCKER_BUILDKIT=1 docker build -t ${IMAGE_TAG} -f Dockerfile .

build-artifacts: build
	docker run -it --rm --network ${NETWORK} -v "${PWD_PATH}/data:/obsidian-copilot/data" -v "$(OBSIDIAN_PATH):${DOCKER_OBSIDIAN_PATH}" -v "${TRANSFORMER_CACHE}:/root/.cache/huggingface/hub" ${IMAGE_TAG} /bin/bash -c "./build.sh ${DOCKER_OBSIDIAN_PATH}"

run:
	docker-compose up

install-plugin:
	cp plugin/main.ts plugin/main.js plugin/styles.css plugin/manifest.json ${OBSIDIAN_PATH}.obsidian/plugins/copilot/

# Development
dev: build
	docker run -it --rm --network ${NETWORK} -v "${PWD_PATH}:/obsidian-copilot" -v "$(OBSIDIAN_PATH):/obsidian-vault" ${IMAGE_TAG} /bin/bash

app: build
	docker run -it --rm --network ${NETWORK} -v "${PWD_PATH}:/obsidian-copilot" -v "$(OBSIDIAN_PATH):/obsidian-vault" -v "${TRANSFORMER_CACHE}:/root/.cache/huggingface/hub" -p 8000:8000 ${IMAGE_TAG} /bin/bash -c "python -m uvicorn src.app:app --reload --host 0.0.0.0 --port 8000"

build-local:
	./build.sh

app-local:
	uvicorn src.app:app --reload

sync-plugin:
	cp -R ${OBSIDIAN_PATH}.obsidian/plugins/copilot/* plugin