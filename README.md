# Obsidian-copilot

## How would a copilot for writing and thinking look like?

Here's a possible implementation: You write a section header and the copilot retrieves relevant notes and documents and drafts that section for you. This pattern of [retrieval-augmented generation](https://arxiv.org/abs/2005.11401) can also be extended to other use cases. Here's an example where the copilot helps you reflect on your week based on your daily journal entries.

![](https://github.com/eugeneyan/obsidian-copilot/assets/6831355/88bf32dd-f83a-4041-90be-44c681ad49d8)

Currently, copilot helps you:
- Draft sections based on your notes
- Reflect on your week based on your daily journal entries

![](assets/features.png)

More technical details on how it works here: [Obsidian-Copilot: A Prototype Assistant for Writing & Thinking](https://eugeneyan.com/writing/obsidian-copilot/)

## Quick start

Clone and update the path to your obsidian-vault and huggingface hub cache

```
git clone https://github.com/eugeneyan/obsidian-copilot.git

# Open Makefile and update the following paths
export OBSIDIAN_PATH = /Users/eugene/obsidian-vault/
export TRANSFORMER_CACHE = /Users/eugene/.cache/huggingface/hub
```

Build the necessary artifacts and start the retrieval app
```
# Build the docker image
make build

# Start the opensearch container and wait for it to start. 
# You should see something like this: [c6587bf83572] Node 'c6587bf83572' initialized
make opensearch

# In ANOTHER terminal, build your artifacts (this can take a while)
make build-artifacts

# Start the app. You should see this: Uvicorn running on http://0.0.0.0:8000
make run
```

Install the copilot-plugin, enable it in community plugin settings, and update the API key in copilot

```
make install-plugin
```

![](assets/enable-copilot.png)
![](assets/provide-api-key.png)

## How does it work?

At a high level, when you type a section header, it'll:
- Retrieve relevant documents/snippets from the your obsidian vault via:
    - [Keyword search](https://github.com/eugeneyan/obsidian-copilot/blob/main/src/prep/build_opensearch_index.py#L141) (opensearch)
    - [Semantic search](https://github.com/eugeneyan/obsidian-copilot/blob/main/src/prep/build_semantic_index.py#L119) (semantic retrieval)
- The retrieved context is then used to generate paragraphs for the section
- It is also displayed in a new tab for info

## TODOs

- [ ] Add support for using anthrophic claude (100k context)
- [ ] Assess sending in entire documents instead of chunks
