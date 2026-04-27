"""
Structure Classification Engine.

Classifies each swing point as:
  HH - Higher High  (swing high > previous swing high)
  HL - Higher Low   (swing low  > previous swing low)
  LH - Lower High   (swing high < previous swing high)
  LL - Lower Low    (swing low  < previous swing low)

Labels are only assigned at zig-zag swing points.
Requires at least 2 prior swings of the same kind to assign a label.
"""

from .zigzag_engine import SwingPoint


LABEL_HH = "HH"
LABEL_HL = "HL"
LABEL_LH = "LH"
LABEL_LL = "LL"


def classify_structure(swings: list[SwingPoint]) -> list[dict]:
    """
    Given a list of strictly alternating swing points, return
    classification labels for each swing point.
    """
    labels = []

    # Track last highs and lows separately
    prev_high: float | None = None
    prev_low:  float | None = None

    for swing in swings:
        label: str | None = None

        if swing["kind"] == "high":
            if prev_high is not None:
                label = LABEL_HH if swing["price"] > prev_high else LABEL_LH
            prev_high = swing["price"]

        else:  # "low"
            if prev_low is not None:
                label = LABEL_HL if swing["price"] > prev_low else LABEL_LL
            prev_low = swing["price"]

        if label:
            labels.append({
                "time": swing["time"],
                "price": swing["price"],
                "label": label,
                "kind": swing["kind"],
                "index": swing["index"],
            })

    return labels
