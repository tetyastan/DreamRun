class Character:
    """
    Core engine data model container representing a native scenario speaker.
    Stores the visible character name and wraps dynamic fallback object tracking.
    """
    def __init__(self, name: str, **kwargs):
        self.name = name
        for key, value in kwargs.items():
            setattr(self, key, value)

    def __getattr__(self, item):
        return None
