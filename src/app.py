"""
Simple FastAPI app that queries opensearch and a semantic index for retrieval-augmented generation.
"""
import os
import pickle
from typing import Dict, List

import numpy as np
import pandas as pd
import tiktoken
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from transformers import AutoModel, AutoTokenizer

from src.logger import logger
from src.prep.build_opensearch_index import (INDEX_NAME, get_opensearch,
                                             query_opensearch)
from src.prep.build_semantic_index import query_semantic

# Load vault dictionary
vault = pickle.load(open('data/vault_dict.pickle', 'rb'))
logger.info(f'Vault loaded with {len(vault)} documents')

# Create opensearch client
try:
    os_client = get_opensearch('opensearch')
except ConnectionRefusedError:
    os_client = get_opensearch('localhost')  # Change to 'localhost' if running locally
logger.info(f'OS client initialized: {os_client.info()}')

# Load semantic index
doc_embeddings_array = np.load('data/doc_embeddings_array.npy')
with open('data/embedding_index.pickle', 'rb') as f:
    embedding_index = pickle.load(f)
tokenizer = AutoTokenizer.from_pretrained('intfloat/e5-small-v2')  # Max token length is 512
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
model = AutoModel.from_pretrained('intfloat/e5-small-v2')
logger.info(f'Semantic index loaded with {len(embedding_index)} documents')


# Create app
app = FastAPI()

# List of allowed origins. You can also allow all by using ["*"]
origins = [
    "app://obsidian.md",  # Allow obsidian app
    "http://localhost",  # or whatever hosts you want to allow
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def parse_os_response(response: dict) -> List[dict]:
    """Parse response from opensearch index.

    Args:
        response: Response from opensearch query.

    Returns:
        List of hits with chunkID and rank
    """
    hits = []

    for rank, hit in enumerate(response['hits']['hits']):
        hits.append({'id': hit['_id'], 'rank': rank})

    return hits


def parse_semantic_response(indices: np.ndarray, embedding_index: Dict[int, str]) -> List[dict]:
    """Parse response from semantic index.

    Args:
        indices: Response from semantic query, an array of ints.

    Returns:
        List of hits with chunkID and rank
    """
    hits = []

    for rank, idx in enumerate(indices):
        hits.append({'id': embedding_index[idx], 'rank': rank})

    return hits


def num_tokens_from_string(string: str, model_name: str) -> int:
    """Returns the number of tokens in a string based on tiktoken encoding.

    Args:
        string: String to count tokens for
        model_name: Tokenizer model type

    Returns:
        Number of tokens in the string
    """
    encoding = tiktoken.encoding_for_model(model_name)
    num_tokens = len(encoding.encode(string))
    return num_tokens


def get_chunks_from_hits(hits: List[dict], model_name: str = 'gpt-3.5-turbo', max_tokens: int = 3200) -> List[dict]:
    """Deduplicates and scores a list of chunks. (There may be duplicate chunks as we query multiple indices.)

    Args:
        hits: List of hits from opensearch, semantic index, etc.
        model_name: Downstream model for retrieval-augmented generation. Used to tokenize chunks and limit the size of
            input based on LLM context window size. Defaults to 'gpt-3.5-turbo'.
        max_tokens: Maximum tokens to allow in chunks. Defaults to 3,200.

    Returns:
        List of chunks for retrieval-augmented generation.
    """
    # Combine os and semantic hits and rank them
    df = pd.DataFrame(hits)
    df['score'] = df['rank'].apply(lambda x: 10 - x)
    # deduplicate chunks by ID, summing their OS and semantic scores
    ranked = df.groupby('id').agg({'score': 'sum'}).sort_values('score', ascending=False).reset_index()

    # Get context based on ranked IDs
    chunks = []
    token_count = 0

    for id in ranked['id'].tolist():
        chunk = vault[id]['chunk']
        title = vault[id]['title']

        # Check if token count exceeds max_tokens
        token_count += num_tokens_from_string(chunk, model_name)
        if token_count > max_tokens:
            break

        chunks.append({'title': title, 'chunk': chunk})

    return chunks


@app.get('/get_chunks')
def get_chunks(query: str):
    # Get hits from opensearch
    os_response = query_opensearch(query, os_client, INDEX_NAME)
    os_hits = parse_os_response(os_response)
    logger.debug(f'OS hits: {os_hits}')

    # Get hits from semantic index
    semantic_response = query_semantic(query, tokenizer, model, doc_embeddings_array)
    semantic_hits = parse_semantic_response(semantic_response, embedding_index)
    logger.debug(f'Semantic hits: {semantic_hits}')

    # Get context
    context = get_chunks_from_hits(os_hits + semantic_hits)
    return context


if __name__ == '__main__':
    logger.info(f'Environment variables loaded: {os.getenv("OPENAI_API_KEY")}')
    test_query = 'Examples of bandits in industry'
    os_response = query_opensearch(test_query, os_client, INDEX_NAME)
    os_hits = parse_os_response(os_response)
    logger.debug(f'OS hits: {os_hits}')
    semantic_response = query_semantic(f'query: {test_query}', tokenizer, model, doc_embeddings_array)
    semantic_hits = parse_semantic_response(semantic_response, embedding_index)
    logger.debug(f'Semantic hits: {semantic_hits}')

    # Combine os and semantic hits and rank them
    context = get_chunks_from_hits(os_hits + semantic_hits)
    logger.info(f'Context: {context}')
