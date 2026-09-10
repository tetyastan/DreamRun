class Character:
    """
    Core engine data model container representing a native scenario speaker.
    Stores the visible character name and wraps dynamic fallback object tracking.
    """

    def __init__(self, name: str, **kwargs):
        # `name` is the string shown inside the name box on the client side.
        self.name = name
        # Arbitrary extra attributes can be attached at construction time,
        # e.g. Character("Hero", hp=100, mood="calm").
        # These become accessible inside .dreamrun scripts as `hero.hp`.
        for key, value in kwargs.items():
            setattr(self, key, value)

    def __getattr__(self, item):
        # Graceful fallback: reading an undefined attribute returns None
        # instead of raising AttributeError. This keeps dialogue templates
        # like "{hero.level}" from crashing the runtime when the field
        # was never explicitly set.
        return None