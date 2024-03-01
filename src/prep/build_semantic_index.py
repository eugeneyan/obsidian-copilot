"""
Reads vault dictionary, creates embeddings for each chunk, and creates a semantic index.
"""

import pickle
from typing import List

import numpy as np
import torch
import torch.nn.functional as F
from torch import Tensor
from transformers import AutoModel, AutoTokenizer

from src.logger import logger

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def average_pool(last_hidden_states: Tensor, attention_mask: Tensor) -> Tensor:
    """
    Average pool last hidden states, ignoring padding tokens.
    """
    last_hidden = last_hidden_states.masked_fill(~attention_mask[..., None].bool(), 0.0)
    return last_hidden.sum(dim=1) / attention_mask.sum(dim=1)[..., None]


def get_batch_embeddings(
    document_batch: List[str], tokenizer, model
) -> List[np.ndarray]:
    """
    Embed a batch of documents.

    Args:
        document_batch: List of documents to embed
        tokenizer: Tokenizer to tokenize documents; should be compatible with model
        model: Model to embed documents

    Returns:
        List of document embeddings
    """

    docs_tokenized = tokenizer(
        document_batch,
        max_length=512,
        padding=True,
        truncation=True,
        return_tensors="pt",
    )
    docs_tokenized = {key: val.to(DEVICE) for key, val in docs_tokenized.items()}
    outputs = model(**docs_tokenized)
    embeddings = average_pool(
        outputs.last_hidden_state, docs_tokenized["attention_mask"]
    )
    embeddings_normed = F.normalize(
        embeddings, p=2, dim=1
    )  # Normalize embeddings for downstream cosine similarity

    return embeddings_normed.detach().cpu().numpy()


def build_embedding_index(vault: dict) -> dict[int, str]:
    """
    Build an index that maps document embedding row index to document chunk-id. Used to retrieve document id after ANN
    on document embeddings.

    Args:
        vault: Dictionary of vault documents

    Returns:
        Mapping of document embedding row index to document chunk-id
    """
    embedding_index = dict()
    embedding_idx = 0

    for chunk_id, doc in vault.items():
        if doc["type"] == "doc":
            continue  # Skip embedding full docs as they are too long for semantic search and take a long time

        embedding_index[embedding_idx] = chunk_id
        embedding_idx += 1

    return embedding_index


def build_embedding_array(vault: dict, tokenizer, model, batch_size=4) -> np.ndarray:
    """
    Embedding all document chunks and return embedding array.

    Args:
        vault: Dictionary of vault documents
        tokenizer: Tokenizer to tokenize documents; should be compatible with model
        model: Model to embed documents
        batch_size: Size of document batch to embed each time. Defaults to 4.

    Returns:
        Numpy array of n_chunks x embedding-dim document embeddings
    """
    docs_embedded = 0
    chunk_batch = []
    chunks_batched = 0
    embedding_list = []

    for chunk_id, doc in vault.items():
        if doc["type"] == "doc":
            continue  # Skip embedding full docs as they are too long for semantic search and take a long time

        # Get path and chunks
        if docs_embedded % 100 == 0:
            logger.info(
                f"Embedding document: {chunk_id} (progress: {docs_embedded:,} docs embedded)"
            )
        docs_embedded += 1
        processed_chunk = "passage: " + " ".join(
            doc["chunk"].split()
        )  # Remove extra whitespace and add prefix

        # logger.info(f'Chunk: {processed_chunk}')
        chunk_batch.append(processed_chunk)  # Add chunk to batch
        chunks_batched += 1

        if chunks_batched % batch_size == 0:
            # Compute embeddings in batch and append to list of embeddings
            chunk_embeddings = get_batch_embeddings(chunk_batch, tokenizer, model)
            embedding_list.append(chunk_embeddings)

            # Reset batch
            chunks_batched = 0
            chunk_batch = []

    # Add any remaining chunks to batch
    if chunks_batched > 0:
        chunk_embeddings = get_batch_embeddings(chunk_batch, tokenizer, model)
        embedding_list.append(chunk_embeddings)

    doc_embeddings_array = np.concatenate(embedding_list, axis=0)
    # Reshape to 2D array where embedding dim is 2nd dim
    doc_embeddings_array = np.reshape(
        doc_embeddings_array, (-1, doc_embeddings_array.shape[-1])
    )
    return doc_embeddings_array


def query_semantic(query, tokenizer, model, doc_embeddings_array, n_results=10):
    query_tokenized = tokenizer(
        f"query: {query}",
        max_length=512,
        padding=False,
        truncation=True,
        return_tensors="pt",
    ).to(DEVICE)
    outputs = model(**query_tokenized)
    query_embedding = average_pool(
        outputs.last_hidden_state, query_tokenized["attention_mask"]
    )
    query_embedding = F.normalize(query_embedding, p=2, dim=1).detach().cpu().numpy()

    cos_sims = np.dot(doc_embeddings_array, query_embedding.T)
    cos_sims = cos_sims.flatten()

    top_indices = np.argsort(cos_sims)[-n_results:][::-1]

    return top_indices


if __name__ == "__main__":
    # Load docs
    vault = pickle.load(open("data/vault_dict.pickle", "rb"))
    logger.info(f"Vault length: {len(vault):,}")

    # Load tokenizer and model
    tokenizer = AutoTokenizer.from_pretrained(
        "intfloat/e5-small-v2"
    )  # Max token length is 512
    model = AutoModel.from_pretrained("intfloat/e5-small-v2")
    model.to(DEVICE)

    # Build and save embedding index and array
    embedding_index = build_embedding_index(vault)
    logger.info(f"Embedding index length: {len(embedding_index):,}")
    doc_embeddings_array = build_embedding_array(vault, tokenizer, model)
    assert (
        len(embedding_index) == doc_embeddings_array.shape[0]
    ), "Length of embedding index != embedding count"

    with open("data/embedding_index.pickle", "wb") as f:
        pickle.dump(embedding_index, f, protocol=pickle.HIGHEST_PROTOCOL)
    np.save("data/doc_embeddings_array.npy", doc_embeddings_array)

    assert (
        len(embedding_index) == doc_embeddings_array.shape[0]
    ), "Length of embedding index != number of embeddings"

    # Test query
    test_query = "Examples of bandits in industry"
    top_indices = query_semantic(test_query, tokenizer, model, doc_embeddings_array)
    logger.info(f"Test query: {test_query}, top indices: {top_indices}")
    for idx in top_indices:
        logger.info(f'Path: {vault[embedding_index[idx]]["path"]}')
