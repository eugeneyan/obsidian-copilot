import logging

# Set up a specific logger with our desired output level
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)  # Set the threshold for this logger to DEBUG or above

# Add the log message handler to the logger
handler = logging.StreamHandler()  # Writes logging output to streams like sys.stdout, sys.stderr or any file-like object

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
handler.setFormatter(formatter)

logger.addHandler(handler)
