"""
Reads markdown files and returns a vault dictionary in the format below.

# Note: chunk_id is either <title-id> or <title>. The former is a chunk while the latter is the entire doc.
chunk_id: {
    title: md_file_title,
    type: full or chunk,  # The former is the entire doc (for long context) while the latter is just a chunk
    path: md_file_path,
    chunk: chunk  # If type = full, then the entire doc.
}
"""
import argparse
import os
import pickle
from collections import defaultdict
from pathlib import Path
from typing import List

from src.logger import logger


def get_file_paths(vault_path: str, min_lines: int = 5) -> List[str]:
    """Get all file paths in a vault

    Args:
        vault_path: Path to obsidian vault.
        min_lines: Minimum number of lines in a file before being discarded. Defaults to 5.

    Returns:
        List of document paths.
    """
    paths = []

    for filename in Path(vault_path).rglob("*.md"):
        # exclude files in hidden directories
        if os.path.relpath(filename, start=vault_path).startswith("."):
            continue
        with open(filename, 'r', encoding='latin-1') as f:
            lines = f.readlines()
            if len(lines) > min_lines:
                relative_path = os.path.relpath(filename, start=vault_path)
                paths.append(relative_path)

    return paths


def chunk_doc_to_dict(lines: List[str], min_chunk_lines=3) -> dict[str, List[str]]:
    """Chunk the text into a doc into a dictionary, where each new paragraph / top-level bullet in a new chunk.

    Args:
        lines: Lines in a document
        min_chunk_lines: Minimum number of lines in a chunk before being discarded. Defaults to 3.

    Returns:
        Dictionary of paragraph/top-level bullet based chunks.
    """

    chunks = defaultdict()
    current_chunk = []
    chunk_idx = 0
    current_header = None

    for line in lines:
        if line.startswith('\n'):  # Skip empty lines
            continue
        if line.startswith('- tag'):  # Skip tags
            continue
        if line.startswith('- source'):  # Skip sources
            continue
        if '![](assets' in line:  # Skip lines that are images
            continue

        if line.startswith("#"):  # Chunk header = Section header
            current_header = line

        if line.startswith('- '):  # Top-level bullet
            if current_chunk:  # If chunks accumulated, add it to chunks
                if len(current_chunk) >= min_chunk_lines:
                    chunks[chunk_idx] = current_chunk
                    chunk_idx += 1
                current_chunk = []  # Reset current chunk
                if current_header:
                    current_chunk.append(current_header)

        current_chunk.append(line)

    # Check for the last chunk
    if current_chunk:
        if len(current_chunk) > min_chunk_lines:
            chunks[chunk_idx] = current_chunk

    return chunks


def create_vault_dict(vault_path: str, paths: List[str]) -> dict[str, dict[str, str]]:
    """Iterate through all paths and create a vault dictionary

    Args:
        vault_path: Path to obsidian vault
        paths: Relative path of docus in obsidian vault

    Returns:
        Dictionary of full docs and chunks in a vault
    """
    vault = dict()

    for filename in paths:
        with open(os.path.join(vault_path, filename), 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()
            chunks = chunk_doc_to_dict(lines)

            if len(chunks) > 0:  # Only add docs with chunks to dict
                # Add full document to vault dict (for retrieving the entire doc + longer context)
                vault[filename] = {'title': filename,
                                   'type': 'doc',  # This is a full document
                                   'path': str(filename),
                                   'chunk': ''.join(lines)}

                for chunk_id, chunk in chunks.items():
                    chunk_id = f'{filename}-{chunk_id}'

                    # Add chunk to vault dict (for shorter context length)
                    vault[chunk_id] = {'title': filename,
                                       'type': 'chunk',  # This is a chunk
                                       'path': str(filename),
                                       'chunk': ''.join(chunk)}

    return vault


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Create vault dictionary')
    parser.add_argument('--vault_path', type=str, help='Path to obsidian vault')  # /Users/eugene/obsidian-vault/
    args = parser.parse_args()

    paths = get_file_paths(args.vault_path)
    vault = create_vault_dict(args.vault_path, paths)
    logger.info(f'Number of docs in vault: {len(vault):,}')
    with open('data/vault_dict.pickle', 'wb') as f:
        pickle.dump(vault, f, protocol=pickle.HIGHEST_PROTOCOL)
