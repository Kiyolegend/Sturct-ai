"""
Trend Engine.

Determines the current trend based on the MOST RECENTLY CONFIRMED structure labels.

Professional market structure definition:
  Bullish  → last confirmed HIGH label is HH  AND last confirmed LOW label is HL
  Bearish  → last confirmed HIGH label is LH   AND last confirmed LOW label is LL
  Neutral  → mixed signals (e.g. HH + LL, or LH + HL — a transition/flip is forming)

This is the textbook ICT / Wyckoff / Smart Money definition of trend based on
swing structure. It uses only the most recent confirmed swing of each kind,
giving zero weight to older labels, which ensures the bias reflects the current
market state rather than a lagging average.
"""


def detect_trend(structure_labels: list[dict]) -> dict:
    """
    Analyse structure labels to determine trend direction.

    Returns:
      {
        "trend":        "bullish" | "bearish" | "neutral",
        "confidence":   int (0-100),
        "last_high_label": "HH" | "LH" | None,
        "last_low_label":  "HL" | "LL" | None,
        "last_labels":  list[str]  -- last 6 labels for transparency
      }

    Confidence scoring:
      - Both labels agree (e.g. HH + HL)  → 100
        BUT if the agreeing pair is recent within the last 4 labels → 100
        AND if the agreeing pair is from older labels (5-6 back) → 75
        This rewards fresh structure over stale structure.
      - Mixed signals                       → 50 (neutral)
    """
    if len(structure_labels) < 2:
        return {
            "trend": "neutral",
            "confidence": 0,
            "last_high_label": None,
            "last_low_label": None,
            "last_labels": [],
        }

    # Walk backwards to find the most recently confirmed high-type and low-type labels
    last_high_label: str | None = None
    last_high_pos: int | None = None
    last_low_label: str | None = None
    last_low_pos: int | None = None

    total = len(structure_labels)

    for i in range(total - 1, -1, -1):
        item = structure_labels[i]
        lbl = item["label"]

        if lbl in ("HH", "LH") and last_high_label is None:
            last_high_label = lbl
            last_high_pos = i

        if lbl in ("HL", "LL") and last_low_label is None:
            last_low_label = lbl
            last_low_pos = i

        if last_high_label is not None and last_low_label is not None:
            break

    last_labels = [x["label"] for x in structure_labels[-6:]]

    # Determine trend from the two most recent labels of each kind
    if last_high_label == "HH" and last_low_label == "HL":
        trend = "bullish"
        # Higher confidence if both are from the last 4 labels
        recency_threshold = total - 4
        if (last_high_pos is not None and last_high_pos >= recency_threshold and
                last_low_pos is not None and last_low_pos >= recency_threshold):
            confidence = 100
        else:
            confidence = 75

    elif last_high_label == "LH" and last_low_label == "LL":
        trend = "bearish"
        recency_threshold = total - 4
        if (last_high_pos is not None and last_high_pos >= recency_threshold and
                last_low_pos is not None and last_low_pos >= recency_threshold):
            confidence = 100
        else:
            confidence = 75

    else:
        # Mixed: one side says bullish, the other says bearish
        # e.g. HH + LL (transition — highs still rising but lows starting to drop)
        #  or  LH + HL (consolidation — highs dropping but lows still rising)
        trend = "neutral"
        confidence = 50

    return {
        "trend": trend,
        "confidence": confidence,
        "last_high_label": last_high_label,
        "last_low_label": last_low_label,
        "last_labels": last_labels,
    }
