from pydantic import BaseModel


class ChoiceSelection(BaseModel):
    """
    Payload model ensuring safe network transmission of player selection indices.

    Used by the POST /api/game/choice endpoint.
    Expected JSON body:
        { "choice_index": 0 }

    The index must point to a valid option inside the currently active
    [choice] block. Out-of-range indices are rejected by the endpoint
    with HTTP 420 OUT_OF_BOUNDS.
    """
    choice_index: int