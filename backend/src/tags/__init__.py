from src.tags.base import BaseTag

# Unified registry storage
ALL_TAGS: list[BaseTag] = []

def register_tag(tag: BaseTag) -> None:
    """Register a tag into the global unified engine ecosystem."""
    ALL_TAGS.append(tag)

def _bootstrap() -> None:
    """
    Import and register all built-in tags in strict prioritization order.
    The order here is deliberate: Scope tags and strict tags match first,
    loosest dialogue tags match last.
    """
    from src.tags.python_tag import PythonTag
    from src.tags.config_tag import ConfigTag
    from src.tags.visual import BackgroundTag
    from src.tags.audio import AudioTag
    from src.tags.flow import PassTag, NextTag, JumpTag, GotoTag, PauseTag
    from src.tags.scope import RefTag, ChoiceTag, AnswerTag
    from src.tags.conditional import ConditionalTag
    from src.tags.dialogue import (
        VariableSpeakerTag,
        LiteralSpeakerTag,
        NarratorTag,
    )

    # Single source of truth for all syntax and runtime layers
    tags_list = [
        PythonTag(),
        ConfigTag(),
        BackgroundTag(),
        AudioTag(),
        PassTag(),
        PauseTag(),
        NextTag(),
        JumpTag(),
        GotoTag(),
        RefTag(),
        ChoiceTag(),
        AnswerTag(),
        ConditionalTag(),
        VariableSpeakerTag(),
        LiteralSpeakerTag(),
        NarratorTag(),
    ]
    
    for t in tags_list:
        register_tag(t)

_bootstrap()