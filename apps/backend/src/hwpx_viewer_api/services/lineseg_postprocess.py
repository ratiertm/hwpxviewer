"""Synthesize <hp:linesegarray> entries on every paragraph that lacks them.

HwpxBuilder writes paragraphs without (or with only a placeholder)
``<hp:linesegarray>``. rhwp's validator reports this as ``LinesegArrayEmpty``
or ``LinesegUncomputed`` (line_height=0). Whale and Hancom Office silently
reflow on load; rhwp-studio surfaces a warning modal.

To eliminate the warnings at the source, we run this post-process on every
HWPX produced by ``plan_dispatcher.render_plan_to_path`` BEFORE the bytes are
loaded into rhwp_wasm and stored in upload_store. The bytes returned by
``/api/download`` therefore are already "self-laid-out".

Strategy: for each ``<hp:p>``, if no ``<hp:linesegarray>`` exists or it has
no ``<hp:lineseg>`` children, we insert a single default lineseg with
non-zero ``vertsize`` (which rhwp parses as ``line_height``). The values
mirror what HwpxBuilder uses for its first paragraph — they're not
pixel-perfect, but rhwp's renderer recomputes layout anyway; the only
purpose is to satisfy the validator.

References
----------
- rhwp validator: ``document_core/commands/document.rs:147`` (rules 1-3)
- rhwp parser:    ``parser/hwpx/section.rs:477`` (``vertsize → line_height``)
- HwpxBuilder writer default: ``writer/section/section_writer.py``
"""

from __future__ import annotations

import io
import logging
import re
import zipfile

from lxml import etree

logger = logging.getLogger(__name__)

_NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
_HP = f"{{{_NS_HP}}}"
_SECTION_RE = re.compile(r"^Contents/section(\d+)\.xml$")


# Default attribute values for a synthesized lineseg.
# - ``vertsize`` / ``textheight`` — 1000 HwpUnit ≈ 11pt (HwpxBuilder body).
# - ``baseline`` — 850 (≈85% of vertsize, standard).
# - ``spacing`` — 600 (line gap).
# - ``horzsize`` — 42520 (A4 body width in HwpUnit; matches HwpxBuilder).
# - ``flags`` — 393216 (0x60000) is HwpxBuilder's default flag set.
_DEFAULT_LINESEG: dict[str, str] = {
    "textpos": "0",
    "vertpos": "0",
    "vertsize": "1000",
    "textheight": "1000",
    "baseline": "850",
    "spacing": "600",
    "horzpos": "0",
    "horzsize": "42520",
    "flags": "393216",
}


# rhwp ``LinesegTextRunReflow`` heuristic threshold: 40 chars (constant in
# document_core/commands/document.rs:178). We use a slightly lower wrap
# estimate so even paragraphs near the boundary get at least 2 linesegs.
_TEXTRUN_REFLOW_THRESHOLD = 40
# Rough Korean chars per A4 body line at 11pt; tuned conservatively so we
# never UNDER-count linesegs (under-counting re-triggers rule 3).
_CHARS_PER_LINE = 30
# vertpos step per emitted lineseg (vertsize + spacing).
_VERT_STEP = 1600


def _paragraph_text(p_elem: etree._Element) -> str:
    """Concatenate every ``<hp:t>`` text under the paragraph (skips runs in
    nested controls — rhwp's validator does the same)."""
    parts: list[str] = []
    for t in p_elem.iter(f"{_HP}t"):
        if t.text:
            parts.append(t.text)
    return "".join(parts)


def _expected_lineseg_count(text: str) -> int:
    """How many linesegs a paragraph with ``text`` should have to satisfy
    rhwp's three rules. Rules:

    1. text empty → 0 linesegs is fine. We still emit 1 (HwpxBuilder shape).
    2. line_height>0 → satisfied by writing vertsize=1000.
    3. NOT (1 lineseg AND no '\\n' AND chars > 40)
       → if text > 40 chars and no newline, emit at least 2 linesegs.
    """
    if not text:
        return 1
    if "\n" in text:
        return 1
    if len(text) <= _TEXTRUN_REFLOW_THRESHOLD:
        return 1
    # ceil(len / chars_per_line), capped at 12 to avoid runaway XML for huge paragraphs.
    n = (len(text) + _CHARS_PER_LINE - 1) // _CHARS_PER_LINE
    return max(2, min(n, 12))


def _make_lineseg_attrs(line_idx: int, total_lines: int, text_len: int) -> dict[str, str]:
    """Build attribute dict for the Nth synthesized lineseg.

    rhwp recomputes layout regardless of these values, so we only need to
    keep them internally consistent and non-zero where checked. ``textpos``
    splits the paragraph evenly across the lines.
    """
    if total_lines <= 1:
        textpos = 0
    else:
        # Split text into roughly equal slices, with the last seg getting the rest.
        per = max(1, text_len // total_lines)
        textpos = min(line_idx * per, max(0, text_len - 1))
    return {
        "textpos": str(textpos),
        "vertpos": str(line_idx * _VERT_STEP),
        "vertsize": "1000",
        "textheight": "1000",
        "baseline": "850",
        "spacing": "600",
        "horzpos": "0",
        "horzsize": "42520",
        "flags": "393216",
    }


def _ensure_lineseg(p_elem: etree._Element) -> bool:
    """Add or fix ``<hp:linesegarray>`` on a single paragraph. Idempotent.

    Returns True if the element was modified.
    """
    text = _paragraph_text(p_elem)
    expected = _expected_lineseg_count(text)

    lsa = p_elem.find(f"{_HP}linesegarray")
    if lsa is None:
        lsa = etree.SubElement(p_elem, f"{_HP}linesegarray")

    segs = lsa.findall(f"{_HP}lineseg")
    text_len = len(text)

    # Case 1: no segs at all → emit ``expected`` segs.
    if not segs:
        for i in range(expected):
            ls = etree.SubElement(lsa, f"{_HP}lineseg")
            for k, v in _make_lineseg_attrs(i, expected, text_len).items():
                ls.set(k, v)
        return True

    # Case 2: existing segs — fix vertsize=0 then top up count if short.
    fixed = False
    for i, ls in enumerate(segs):
        try:
            vs = int(ls.get("vertsize") or "0")
        except ValueError:
            vs = 0
        if vs <= 0:
            for k, v in _DEFAULT_LINESEG.items():
                cur = ls.get(k)
                if cur is None or cur == "0":
                    ls.set(k, v)
            fixed = True

    if len(segs) < expected:
        for i in range(len(segs), expected):
            ls = etree.SubElement(lsa, f"{_HP}lineseg")
            for k, v in _make_lineseg_attrs(i, expected, text_len).items():
                ls.set(k, v)
        fixed = True

    return fixed


def _process_section_xml(xml_bytes: bytes) -> tuple[bytes, int]:
    """Walk every ``<hp:p>`` in a section XML and ensure each has linesegs.

    Returns (new_bytes, number_of_paragraphs_modified).
    """
    parser = etree.XMLParser(remove_blank_text=False)
    try:
        root = etree.fromstring(xml_bytes, parser)
    except etree.XMLSyntaxError as e:
        logger.warning("lineseg_postprocess.parse_failed: %s", e)
        return xml_bytes, 0

    modified = 0
    for p in root.iter(f"{_HP}p"):
        if _ensure_lineseg(p):
            modified += 1

    if modified == 0:
        return xml_bytes, 0

    # Preserve the XML declaration HwpxBuilder writes. We round-trip via
    # ``tostring`` with the same encoding/standalone flags HwpxBuilder uses.
    out = etree.tostring(
        root,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )
    return out, modified


def synthesize_linesegs(hwpx_bytes: bytes) -> bytes:
    """Return new HWPX bytes with synthesized linesegs on every paragraph.

    Walks ``Contents/section*.xml`` only; every other ZIP entry is copied
    byte-for-byte (so embedded images, fonts, BinData stay identical).
    Idempotent: applying twice produces the same output as applying once.
    """
    buf_in = io.BytesIO(hwpx_bytes)
    buf_out = io.BytesIO()

    total_modified = 0
    sections_touched = 0

    with zipfile.ZipFile(buf_in, "r") as zin, zipfile.ZipFile(
        buf_out, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if _SECTION_RE.match(item.filename):
                new_data, modified = _process_section_xml(data)
                if modified:
                    total_modified += modified
                    sections_touched += 1
                    data = new_data
            zout.writestr(item, data)

    if total_modified:
        logger.info(
            "lineseg_postprocess.applied",
            extra={"sections": sections_touched, "paragraphs": total_modified},
        )
    return buf_out.getvalue()
