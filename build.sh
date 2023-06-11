python -m src.prep.build_vault_dict --vault_path $1
python -m src.prep.build_opensearch_index
python -m src.prep.build_semantic_index