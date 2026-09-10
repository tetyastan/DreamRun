# Default scenario config module
# Instantiates actors and state frameworks for the current scene

from src.core import Character

# Instantiate the main protagonist character object node.
# Extra properties like money, HP, or stats can be modified 
# natively inside python blocks within .dreamrun scripts.
hero = Character("Hero")
