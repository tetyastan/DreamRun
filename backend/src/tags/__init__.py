from src.tags.base import BaseTag

# ---- Registry storage ----
PARSERS: list[BaseTag] = []
EXECUTORS: list[BaseTag] = []


def register_parser(tag: BaseTag) -> None:
    """Register a tag's parse() method. Order defines priority."""
    PARSERS.append(tag)


def register_executor(tag: BaseTag) -> None:
    """Register a tag's execute() method. Order defines priority."""
    EXECUTORS.append(tag)


def _bootstrap() -> None:
    """
    Import and register all built-in tags.

    The order here is deliberate:
      - Scope tags ([ref], [choice], [answer], [if]) must come before
        generic dialogue matching, because their opening/closing
        brackets could otherwise be mistaken for dialogue text.
      - Flow tags ([next], [jump], [goto], [pass]) come before generic
        dialogue for the same reason.
      - Dialogue tags come last, as they match the loosest patterns.
    """
    from src.tags.python_tag import PythonTag
    from src.tags.config_tag import ConfigTag
    from src.tags.visual import BackgroundTag
    from src.tags.audio import AudioTag
    from src.tags.flow import PassTag, NextTag, JumpTag, GotoTag
    from src.tags.scope import RefTag, ChoiceTag, AnswerTag
    from src.tags.conditional import ConditionalTag
    from src.tags.dialogue import (
        VariableSpeakerTag,
        LiteralSpeakerTag,
        NarratorTag,
    )

    parser_tags = [
        PythonTag(),
        ConfigTag(),
        BackgroundTag(),
        AudioTag(),
        PassTag(),
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
    for t in parser_tags:
        register_parser(t)

    # Executors are independent of parser order; any tag that has
    # non-trivial runtime behaviour registers here.
    executor_tags = [
        PythonTag(),
        ConfigTag(),
        BackgroundTag(),
        AudioTag(),
        PassTag(),
        NextTag(),
        JumpTag(),
        GotoTag(),
        ConditionalTag(),
        VariableSpeakerTag(),
        LiteralSpeakerTag(),
        NarratorTag(),
    ]
    for t in executor_tags:
        register_executor(t)


_bootstrap()