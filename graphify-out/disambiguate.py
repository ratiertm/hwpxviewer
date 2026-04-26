"""Post-process graphify output: disambiguate duplicate-label nodes.

Two passes:
  1. Relabel: prefix duplicate labels with parent class (for class methods)
     or filename stem (for module-level functions). IDs are already unique,
     this only fixes display labels so HTML viz + report read clearly.
  2. Audit INFERRED edges where either endpoint had an originally-ambiguous
     label: any non-EXTRACTED edge whose endpoint was in the duplicate-label
     pool gets downgraded to AMBIGUOUS with confidence_score *= 0.5 (capped
     at 0.1 floor). The semantic subagent picked one of N candidate nodes
     by label alone — we don't know if it picked the right one.

Output: rewrites graphify-out/graph.json in place after backing up to
graph.json.pre-disambiguate (only on first run).
"""
from __future__ import annotations

import json
import shutil
from collections import Counter
from pathlib import Path

OUT = Path("graphify-out")
GRAPH = OUT / "graph.json"
BACKUP = OUT / "graph.json.pre-disambiguate"


def main() -> None:
    # Restore from backup if it exists, so the script is idempotent across runs.
    if BACKUP.exists():
        shutil.copy(BACKUP, GRAPH)
    data = json.loads(GRAPH.read_text())
    nodes = data["nodes"]
    edges = data["links"]
    by_id = {n["id"]: n for n in nodes}

    # Build parent maps from structural edges.
    method_parent: dict[str, str] = {}
    contained_by: dict[str, str] = {}
    for e in edges:
        if e.get("relation") == "method":
            method_parent[e["target"]] = e["source"]
        elif e.get("relation") == "contains":
            contained_by[e["target"]] = e["source"]

    # ----- Pass 1: relabel duplicates --------------------------------------
    label_counts = Counter(n.get("label", "") for n in nodes)
    dup_labels = {lbl for lbl, c in label_counts.items() if c >= 2 and lbl}

    # Track which nodes had ambiguous labels (set of node ids).
    ambiguous_node_ids: set[str] = set()
    for n in nodes:
        if n.get("label", "") in dup_labels:
            ambiguous_node_ids.add(n["id"])

    relabeled = 0
    for n in nodes:
        nid = n["id"]
        if nid not in ambiguous_node_ids:
            continue
        lbl = n["label"]
        # Find the most informative prefix.
        parent_id = method_parent.get(nid) or contained_by.get(nid)
        parent = by_id.get(parent_id) if parent_id else None
        prefix = ""
        if parent:
            parent_lbl = parent.get("label", "").strip()
            if parent_lbl.endswith(".py"):
                parent_lbl = parent_lbl[:-3]
            prefix = parent_lbl
        if not prefix:
            sf = (n.get("source_file") or "").rsplit("/", 1)[-1].rsplit(".", 1)[0]
            prefix = sf or "?"
        # Method form: "ClassName.method()" / module form: "module::name()".
        if lbl.startswith("."):
            new_lbl = f"{prefix}{lbl}"
        else:
            new_lbl = f"{prefix}::{lbl}"
        n["label"] = new_lbl
        relabeled += 1

    # ----- Pass 2: audit edges with ambiguous endpoints --------------------
    edge_audited = 0
    edge_downgraded = 0
    for e in edges:
        conf = e.get("confidence", "EXTRACTED")
        if conf == "EXTRACTED":
            continue
        if e["source"] in ambiguous_node_ids or e["target"] in ambiguous_node_ids:
            edge_audited += 1
            old_score = float(e.get("confidence_score", 0.5))
            new_score = max(0.1, old_score * 0.5)
            e["confidence_score"] = round(new_score, 2)
            if conf == "INFERRED":
                e["confidence"] = "AMBIGUOUS"
                edge_downgraded += 1

    # ----- Pass 3: drop AMBIGUOUS edges from analytical graph --------------
    # AMBIGUOUS edges are kept ONLY in the audit JSON (graph.audit.json) for
    # transparency. The main graph.json used by HTML viz, queries, and
    # community detection drops them so god_nodes / betweenness / clustering
    # reflect real structure instead of label-collision noise.
    audit_path = OUT / "graph.audit.json"
    audit_data = {
        **{k: v for k, v in data.items() if k != "links"},
        "links": list(edges),  # full edge set
    }
    audit_path.write_text(json.dumps(audit_data, indent=2))

    kept_edges = [e for e in edges if e.get("confidence") != "AMBIGUOUS"]
    dropped = len(edges) - len(kept_edges)
    data["links"] = kept_edges

    # Backup once, then write the cleaned analytical graph.
    if not BACKUP.exists():
        shutil.copy(GRAPH, BACKUP)
    GRAPH.write_text(json.dumps(data, indent=2))

    # Stats summary.
    after_counts = Counter(e.get("confidence", "?") for e in edges)
    print(f"Relabeled: {relabeled} duplicate-label nodes")
    print(f"Audited non-EXTRACTED edges with ambiguous endpoint: {edge_audited}")
    print(f"  → downgraded INFERRED → AMBIGUOUS: {edge_downgraded}")
    print(f"Edge confidence (full): {dict(after_counts)}")
    print(f"Dropped AMBIGUOUS from analytical graph: {dropped} edges")
    print(f"  Full audit graph kept at: {audit_path}")
    print(f"Backup: {BACKUP}")


if __name__ == "__main__":
    main()
