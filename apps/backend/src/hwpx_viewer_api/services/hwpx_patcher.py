"""Surgical HWPX-XML text patcher.

Design: rhwp holds authoritative in-memory edits for rendering; for persistence
we re-open the original HWPX ZIP and apply the same edits directly to the
section XML files. This preserves **all** HWPX fidelity (embedded images,
custom metadata, per-run styles outside the edited runs, namespace ordering)
because we touch only the ``<hp:t>`` text values inside the targeted runs —
never structural XML.

Why this beats the hwp2hwpx round-trip we used before:
  - hwp2hwpx re-synthesizes the entire HWPX from HWP 5.x, which can lose
    HWPX-only metadata (bindata, meta, custom shapes) and re-order fonts.
  - This patcher keeps every unedited byte intact.

Scope (v0.3):
  - Body paragraph runs.
  - Single-level table cell paragraphs (no nested tables).
Edits that cross multiple runs within one paragraph are supported; edits that
cross paragraph boundaries are rejected upstream by the hook layer.
"""

from __future__ import annotations

import io
import logging
import re
import zipfile
from typing import Any, Iterable

from lxml import etree

logger = logging.getLogger(__name__)

# HWPX namespaces. We keep a local map purely for XPath; the patched output
# reuses the document's own declarations via lxml's round-trip.
_NS = {
    "hs": "http://www.hancom.co.kr/hwpml/2011/section",
    "hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
}

_SECTION_RE = re.compile(r"^Contents/section(\d+)\.xml$")


def apply_edits_to_hwpx(original_bytes: bytes, edits: Iterable[dict[str, Any]]) -> bytes:
    """Return a new HWPX byte-buffer with every non-undone edit applied.

    Parameters
    ----------
    original_bytes
        The untouched HWPX ZIP bytes as originally uploaded.
    edits
        Iterable of edit dicts in rhwp's in-memory shape:
        ``{id, sec, para, charOffset, oldText, newText, undone, cell?}``.
        ``undone=True`` edits are skipped.

    The patcher is idempotent with respect to the edit history: each call
    replays *all* live edits from scratch against the original document, so
    toggling ``undone`` on a history entry is reflected on the next download.
    """
    # Group live edits by section index; the output ZIP preserves everything
    # else byte-for-byte.
    live = [e for e in edits if not e.get("undone", False)]
    edits_by_sec: dict[int, list[dict[str, Any]]] = {}
    for e in live:
        edits_by_sec.setdefault(int(e["sec"]), []).append(e)

    buf_in = io.BytesIO(original_bytes)
    buf_out = io.BytesIO()

    with zipfile.ZipFile(buf_in, "r") as zin, zipfile.ZipFile(
        buf_out, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            m = _SECTION_RE.match(item.filename)
            if m:
                sec_idx = int(m.group(1))
                sec_edits = edits_by_sec.get(sec_idx)
                if sec_edits:
                    data = _patch_section_xml(data, sec_edits)
            # Preserve original ZipInfo metadata (modification time, flags).
            zout.writestr(item, data)

    return buf_out.getvalue()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _patch_section_xml(xml_bytes: bytes, edits: list[dict[str, Any]]) -> bytes:
    """Apply every edit in ``edits`` to a single section XML and return bytes.

    Edits are applied IN ORDER because cross-paragraph edits mutate the
    paragraph count, and subsequent edits' ``para`` indices refer to the
    post-collapse state that rhwp saw at the time of that edit. We re-query
    ``body_paragraphs`` after each cross-para apply so later edits index
    into the same paragraph list rhwp was using.
    """
    parser = etree.XMLParser(remove_blank_text=False)
    root = etree.fromstring(xml_bytes, parser=parser)

    for edit in edits:
        try:
            body_paragraphs = root.findall("hp:p", _NS)
            _apply_single_edit(body_paragraphs, edit)
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "hwpx_patch.skip_edit",
                extra={"edit": edit, "error": str(e)},
            )
            # Best-effort: keep going; other edits should still apply.

    return etree.tostring(
        root,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )


def _apply_single_edit(body_paragraphs: list, edit: dict[str, Any]) -> None:
    """Locate the target paragraph(s) and splice the edit in.

    Two forms handled:
      - single paragraph (no ``endPara``): splice ``oldText`` worth of chars
        at ``(para, charOffset)`` with ``newText``.
      - cross paragraph (``endPara`` set): truncate start paragraph at
        ``charOffset``, drop paragraphs ``(para+1 .. endPara-1)`` entirely,
        merge the remainder of the end paragraph (from ``endCharOffset``)
        into the start paragraph. ``newText`` is spliced in between.
    """
    cell = edit.get("cell")
    char_offset = int(edit["charOffset"])
    new_text = edit.get("newText", "")
    end_para_idx = edit.get("endPara")

    # --- cross-paragraph branch ----------------------------------------------
    if end_para_idx is not None:
        end_char_offset = int(edit.get("endCharOffset", 0))
        if cell is None:
            _apply_cross_para_body_edit(
                body_paragraphs,
                start_para=int(edit["para"]),
                start_off=char_offset,
                end_para=int(end_para_idx),
                end_off=end_char_offset,
                new_text=new_text,
            )
        else:
            _apply_cross_para_cell_edit(
                body_paragraphs,
                cell=cell,
                start_para=int(edit["para"]),
                start_off=char_offset,
                end_para=int(end_para_idx),
                end_off=end_char_offset,
                new_text=new_text,
            )
        return

    # --- single-paragraph branch (original path) -----------------------------
    length = len(edit.get("oldText", ""))
    if cell is None:
        para = body_paragraphs[int(edit["para"])]
    else:
        parent_para = body_paragraphs[int(cell["parentParaIndex"])]
        para = _resolve_cell_paragraph(
            parent_para,
            control_index=int(cell["controlIndex"]),
            cell_index=int(cell["cellIndex"]),
            cell_para_index=int(edit["para"]),
        )
    _splice_paragraph_text(para, char_offset, length, new_text)


def _concat_para_text(paragraph) -> str:
    """Full visible text of a paragraph (concat all ``<hp:t>`` contents)."""
    return "".join(
        (t.text or "")
        for run in paragraph.findall("hp:run", _NS)
        for t in run.findall("hp:t", _NS)
    )


def _apply_cross_para_body_edit(
    body_paragraphs: list,
    *,
    start_para: int,
    start_off: int,
    end_para: int,
    end_off: int,
    new_text: str,
) -> None:
    """Apply a cross-paragraph edit while **preserving paragraph structure**.

    Previous implementation collapsed [start..end] into one paragraph, which
    discarded the styling of the end paragraph (and every middle one) —
    users saw headings flip into body style. v0.3.1 changed rhwp-side to
    per-paragraph deletes; the XML side mirrors that:

      - start paragraph: truncate at ``start_off``, append ``new_text``
        (keeps start's ``paraPrIDRef`` + first-run charPrIDRef).
      - middle paragraphs: empty their text but keep the ``<hp:p>`` element
        so paragraph indices (rhwp + XML) stay in sync for subsequent edits.
      - end paragraph: delete the ``[0:end_off]`` prefix, keep the rest
        (preserves end's own styling and trailing content).
    """
    start = body_paragraphs[start_para]
    end = body_paragraphs[end_para]

    # 1. Start paragraph: delete tail + append new_text.
    start_full_len = len(_concat_para_text(start))
    _splice_paragraph_text(start, start_off, start_full_len - start_off, new_text)

    # 2. Middle paragraphs: empty out all <hp:t> text nodes, keep structure.
    for p in body_paragraphs[start_para + 1 : end_para]:
        _empty_paragraph_text(p)

    # 3. End paragraph: delete head prefix.
    if end_off > 0:
        _splice_paragraph_text(end, 0, end_off, "")


def _apply_cross_para_cell_edit(
    body_paragraphs: list,
    *,
    cell: dict[str, Any],
    start_para: int,
    start_off: int,
    end_para: int,
    end_off: int,
    new_text: str,
) -> None:
    """Same per-paragraph split as the body variant, inside a table cell."""
    parent_para = body_paragraphs[int(cell["parentParaIndex"])]
    start = _resolve_cell_paragraph(
        parent_para,
        control_index=int(cell["controlIndex"]),
        cell_index=int(cell["cellIndex"]),
        cell_para_index=start_para,
    )
    end = _resolve_cell_paragraph(
        parent_para,
        control_index=int(cell["controlIndex"]),
        cell_index=int(cell["cellIndex"]),
        cell_para_index=end_para,
    )
    start_full_len = len(_concat_para_text(start))
    _splice_paragraph_text(start, start_off, start_full_len - start_off, new_text)

    sub_list = start.getparent()
    if sub_list is not None:
        cell_paragraphs = sub_list.findall("hp:p", _NS)
        for p in cell_paragraphs[start_para + 1 : end_para]:
            _empty_paragraph_text(p)
    if end_off > 0:
        _splice_paragraph_text(end, 0, end_off, "")


def _empty_paragraph_text(paragraph) -> None:
    """Clear the visible text of every ``<hp:t>`` inside ``paragraph``
    without removing the element itself. Structural children (runs, ctrls,
    tables, etc.) stay intact so paragraph / control indices in rhwp and
    the XML remain aligned across subsequent edits."""
    for run in paragraph.findall("hp:run", _NS):
        for t in run.findall("hp:t", _NS):
            t.text = ""


def _resolve_cell_paragraph(
    parent_para,
    *,
    control_index: int,
    cell_index: int,
    cell_para_index: int,
):
    """Walk a parent body paragraph down to the cell's target sub-paragraph.

    rhwp's ``controlIndex`` counts **every** inline control in the paragraph
    in document order — not just tables. In HWPX XML that means every child
    of every ``<hp:run>`` other than plain ``<hp:t>`` text / ``<hp:markpenBegin``
    markers: ``<hp:ctrl>`` (pageNum, header/footer, colPr, ...) and direct
    ``<hp:tbl>`` both count. We enumerate them in order and pick the N-th,
    then descend into the table cells.
    """
    # Children that identify "text-flow" / metadata nodes and thus should NOT
    # count as controls. Everything else under an <hp:run> is a control.
    # ``secPr`` (section properties) is metadata — rhwp's controlIndex skips it.
    text_like = {"t", "markpenBegin", "markpenEnd", "linesegarray", "secPr"}
    controls = []  # (element, kind) where kind='tbl' | 'other'
    for run in parent_para.findall("hp:run", _NS):
        for child in run:
            tag = etree.QName(child).localname
            if tag in text_like:
                continue
            if tag == "tbl":
                controls.append(("tbl", child))
            elif tag == "ctrl":
                # Look for table nested inside an <hp:ctrl>; otherwise record as non-table.
                tbl = child.find("hp:tbl", _NS)
                controls.append(("tbl", tbl) if tbl is not None else ("other", child))
            else:
                controls.append(("other", child))
    if control_index >= len(controls):
        raise IndexError(
            f"control_index={control_index} out of range ({len(controls)} controls)"
        )
    kind, element = controls[control_index]
    if kind != "tbl":
        raise ValueError(
            f"control_index={control_index} does not point to a <hp:tbl> (kind={kind})"
        )
    tbl = element
    # Cells in row-major order.
    cells = []
    for tr in tbl.findall("hp:tr", _NS):
        for tc in tr.findall("hp:tc", _NS):
            cells.append(tc)
    if cell_index >= len(cells):
        raise IndexError(
            f"cell_index={cell_index} out of range ({len(cells)} cells)"
        )
    tc = cells[cell_index]
    sub_list = tc.find("hp:subList", _NS)
    if sub_list is None:
        raise ValueError("cell has no <hp:subList>")
    paragraphs = sub_list.findall("hp:p", _NS)
    if cell_para_index >= len(paragraphs):
        raise IndexError(
            f"cell_para_index={cell_para_index} out of range "
            f"({len(paragraphs)} cell paragraphs)"
        )
    return paragraphs[cell_para_index]


def _splice_paragraph_text(paragraph, char_offset: int, length: int, new_text: str) -> None:
    """Replace a substring of a paragraph's concatenated ``<hp:t>`` text.

    The paragraph's visible text is the ordered concatenation of every direct
    ``<hp:run>/<hp:t>`` child. We figure out which ``<hp:t>`` elements the
    edit overlaps, keep the unaffected prefix/suffix, drop the interior, and
    insert ``new_text`` into the first overlapped ``<hp:t>`` — style of that
    first run is preserved for the replacement.
    """
    t_elems = []  # list of (element, text_before_this_elem, elem_text)
    running_offset = 0
    for run in paragraph.findall("hp:run", _NS):
        for t in run.findall("hp:t", _NS):
            text = t.text or ""
            t_elems.append((t, running_offset, text))
            running_offset += len(text)

    if not t_elems:
        return

    edit_start = char_offset
    edit_end = char_offset + length

    # Walk t-elems and compute the new text for each.
    first_touched_idx: int | None = None
    for i, (t, base, text) in enumerate(t_elems):
        elem_start = base
        elem_end = base + len(text)
        if elem_end <= edit_start or elem_start >= edit_end:
            continue  # unaffected
        # Overlap with [edit_start, edit_end)
        keep_prefix = text[: max(0, edit_start - elem_start)]
        keep_suffix = text[max(0, edit_end - elem_start):]
        if first_touched_idx is None:
            first_touched_idx = i
            t.text = keep_prefix + new_text + keep_suffix
        else:
            # Subsequent touched elems: drop the interior portion.
            t.text = keep_prefix + keep_suffix

    if first_touched_idx is None and length == 0 and new_text:
        # Pure insertion at a position that falls at an element boundary —
        # attach to the element whose end equals the insert offset (last
        # prior), or the first element if offset==0.
        for i, (t, base, text) in enumerate(t_elems):
            if base + len(text) >= edit_start:
                t.text = (text[: edit_start - base]) + new_text + (text[edit_start - base:])
                break
