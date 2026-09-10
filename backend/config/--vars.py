# Global game variables
# Automatically loaded into every unique session runtime context

from src.core import Character

# Expose any other global game flags or baseline settings here
# which should exist before any scenario file or config executes.
hero = Character("Hero")
hero.money = 0
hero.reputation = 0