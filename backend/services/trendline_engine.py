"""
Trendline Engine.

Uptrend   → connect Higher Low (HL) points with a trendline
Downtrend → connect Lower High (LH) points with a trendline

Returns line endpoints for chart rendering.
"""


def compute_trendlines(structure_labels: list[dict]) -> dict:
    """
    Build trendline segments from structure labels.
    Returns {bullish: [...lines], bearish: [...lines]}
    """
    hl_points = [s for s in structure_labels if s["label"] == "HL"]
    lh_points = [s for s in structure_labels if s["label"] == "LH"]

    bullish_lines = []
    if len(hl_points) >= 2:
        for i in range(len(hl_points) - 1):
            bullish_lines.append({
                "from_time": hl_points[i]["time"],
                "from_price": hl_points[i]["price"],
                "to_time": hl_points[i + 1]["time"],
                "to_price": hl_points[i + 1]["price"],
                "kind": "bullish",
            })

    bearish_lines = []
    if len(lh_points) >= 2:
        for i in range(len(lh_points) - 1):
            bearish_lines.append({
                "from_time": lh_points[i]["time"],
                "from_price": lh_points[i]["price"],
                "to_time": lh_points[i + 1]["time"],
                "to_price": lh_points[i + 1]["price"],
                "kind": "bearish",
            })

    return {
        "bullish": bullish_lines,
        "bearish": bearish_lines,
    }
